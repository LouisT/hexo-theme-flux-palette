'use strict';
const content = require('../lib/content.cjs'),
    cache = require('../lib/cache.cjs'),
    providers = require('../lib/search-providers.cjs'),
    errors = require('../lib/search-errors.cjs'),
    { slugize } = require('hexo-util'),
    bucket = (word) => (word.codePointAt(0) % 16).toString(16);

// Separate public metadata, excerpts, and word indexes for lazy search loading
function build(ctx, docs) {
    const index = {},
        snippets = {},
        catalog = [];
    docs.forEach((doc, i) => {
        const { content: body, excerpt, ...meta } = doc,
            shard = Math.floor(i / 100);
        catalog.push({ ...meta, snippet: shard });
        (snippets[shard] ||= {})[doc.id] = excerpt;
        const input = [doc.title, ...doc.tags, ...doc.categories, body].join(' '),
            key = [
                input,
                cache.hash(
                    require('node:fs').readFileSync(require.resolve('../source/js/search-core.js'))
                ),
            ],
            words = doc.encrypted
                ? content.core.tokenize(input)
                : cache.get(ctx, 'tokens', key) || content.core.tokenize(input);
        if (!doc.encrypted) cache.set(ctx, 'tokens', key, words);
        for (const word of words) (index[word] ||= []).push(doc.id);
    });
    return { index, snippets, catalog, vocabulary: Object.keys(index).sort() };
}

// Map search topics to the native post and project taxonomy routes
function topicUrls(ctx, locals, docs) {
    const taxonomy = (items) =>
            Object.fromEntries(
                content.array(items).map((item) => [item.name, content.url(ctx, item.path)])
            ),
        projectTags = [
            ...new Set(docs.filter((doc) => doc.type === 'project').flatMap((doc) => doc.tags)),
        ];
    return {
        post: {
            tag: taxonomy(locals.tags),
            category: Object.fromEntries(
                content
                    .array(locals.posts)
                    .filter((post) => post.categories.length)
                    .map((post) => [content.url(ctx, post.path), taxonomy(post.categories)])
            ),
        },
        project: {
            tag: Object.fromEntries(
                projectTags.map((tag) => [
                    tag,
                    content.url(ctx, `project-tag/${slugize(tag, { transform: 1 })}/`),
                ])
            ),
        },
    };
}

// Emit catalogs and excerpt shards with term shards only for local search
function routes(data, prefix, local, topics = {}) {
    const result = [
            {
                path: prefix + 'catalog.json',
                data: JSON.stringify({
                    version: 3,
                    docs: data.catalog,
                    topics,
                }),
            },
            {
                path: prefix + 'vocabulary.json',
                data: JSON.stringify({ version: 1, words: data.vocabulary }),
            },
        ],
        shards = {};
    if (local)
        for (const [word, ids] of Object.entries(data.index))
            (shards[bucket(word)] ||= {})[word] = ids;
    for (const [shard, index] of Object.entries(shards))
        result.push({ path: prefix + `terms-${shard}.json`, data: JSON.stringify(index) });
    for (const [shard, snippets] of Object.entries(data.snippets))
        result.push({ path: prefix + `snippets-${shard}.json`, data: JSON.stringify(snippets) });
    return result;
}

// Build search data for the selected provider and optional local fallback
hexo.extend.generator.register('theme_search', async function (locals) {
    const cfg = this.theme.config.search || {};
    if (cfg.enabled === false) return [];
    providers.resolve(cfg);
    const docs = this.fluxDocs || (await content.gather(this, locals)),
        data = build(this, docs);
    this.fluxSearch = data;
    this.fluxSearchDocs = docs;
    this.fluxSearchMode = cfg.service || 'local';
    return routes(
        data,
        'search/',
        !providers.NATIVE.includes(cfg.service) &&
            (cfg.local_fallback !== false || !providers.REMOTE.includes(cfg.service)),
        topicUrls(this, locals, docs)
    );
});

hexo.extend.helper.register('flux_search_mode', function () {
    return hexo.fluxSearchMode || this.theme.search?.service || 'local';
});

// Expose the selected provider configuration with read credentials only
hexo.extend.helper.register('flux_search_config', function () {
    return providers.frontend(this.theme.search || {}, hexo.fluxSearchMode);
});

// Keep playground sample searches separate from published site content
hexo.extend.generator.register('flux_playground_search', function () {
    if (!this.theme.config.playground?.enabled) return [];
    const docs = require('../lib/playground-content.json').map((item) =>
        content.normalize(
            this,
            { ...item, path: 'playground/#' + item.slug, content: item.project_summary },
            'project'
        )
    );
    return routes(build(this, docs), 'playground/search/', true);
});

// Bound provider requests and report actionable errors without exposing credentials
async function request(url, options, timeout) {
    let res;
    try {
        res = await fetch(url, { ...options, signal: AbortSignal.timeout(timeout) });
    } catch (error) {
        const code = error.cause?.code || error.code;
        let message = 'Network request failed. Check the provider URL and network connectivity.';
        if (['ENOTFOUND', 'EAI_AGAIN'].includes(code))
            message = `DNS lookup failed (${code}). Check the provider URL and DNS/network settings.`;
        else if (
            ['TimeoutError', 'AbortError'].includes(error.name) ||
            ['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT'].includes(code)
        )
            message = `Search upload timed out after ${timeout} ms.`;
        else if (code === 'ECONNREFUSED')
            message = 'Connection refused. Check the provider URL and service availability.';
        throw new Error(message, { cause: error });
    }
    if (!res.ok) {
        const detail = errors.detail(await res.json().catch(() => null), [
            options.headers?.Authorization?.replace(/^Bearer\s+/i, ''),
            options.headers?.apikey,
        ]);
        throw new Error(
            `Search upload failed (HTTP ${res.status}). ` +
                (detail
                    ? detail
                    : [401, 403].includes(res.status)
                      ? 'Check the build credentials and database permissions.'
                      : 'Check the provider URL, database tables, and service availability.')
        );
    }
    return res;
}

// Synchronize changed remote indexes and retain retries after partial failures
hexo.extend.filter.register('after_generate', async function () {
    if (!['generate', 'g'].includes(this.env.cmd)) return;
    const cfg = this.theme.config.search || {},
        mode = cfg.service;
    if (cfg.enabled === false || !providers.REMOTE.includes(mode)) return;
    const data = this.fluxSearch;
    if (!data) return;
    const configuredTimeout = Number(cfg.upload?.timeout_ms),
        timeout =
            Number.isInteger(configuredTimeout) && configuredTimeout > 0
                ? Math.min(configuredTimeout, 2147483647)
                : 15000,
        native = providers.NATIVE.includes(mode),
        config = providers.resolve(cfg),
        prepared = native ? providers.prepare(mode, this.fluxSearchDocs) : null,
        identity = cache.hash([mode, config || cfg[mode]]),
        digest = prepared?.digest || cache.hash(data),
        pending = native && cache.get(this, 'remote', identity + ':pending');
    // Skip uploads only when a matching index finished syncing successfully
    if (!pending && cache.get(this, 'remote', identity)?.digest === digest) {
        this.log.info('[search] unchanged remote index; upload skipped');
        return;
    }
    const docs = data.catalog.map(({ snippet, tags, categories, day, ...doc }) => ({
        ...doc,
        excerpt: data.snippets[snippet][doc.id],
    }));
    try {
        // Mark unfinished replacements before changing remote index data
        if (native) {
            // Retry partial syncs even when content reverts to the last successful digest
            cache.set(this, 'remote', identity + ':pending', { digest });
            await providers.sync(mode, config, prepared, request, timeout);
        } else if (mode === 'upstash') {
            cache.remove(this, 'remote', identity);
            const u = config || {},
                prefix = u.index || 'flux';
            if (!u.url || !u.token) throw new Error('Missing Upstash build credentials');
            const commands = [
                ['DEL', prefix + ':docs'],
                ['DEL', prefix + ':index'],
            ];

            for (let i = 0; i < docs.length; i += 100)
                commands.push([
                    'HSET',
                    prefix + ':docs',
                    ...docs.slice(i, i + 100).flatMap((d) => [d.id, JSON.stringify(d)]),
                ]);
            const words = Object.entries(data.index);

            for (let i = 0; i < words.length; i += 100)
                commands.push([
                    'HSET',
                    prefix + ':index',
                    ...words.slice(i, i + 100).flatMap(([w, ids]) => [w, ids.join(',')]),
                ]);
            for (let i = 0; i < commands.length; i += 100) {
                const rows = await (
                    await request(
                        u.url.replace(/\/$/, '') + '/pipeline',
                        {
                            method: 'POST',
                            headers: {
                                Authorization: `Bearer ${u.token}`,
                                'Content-Type': 'application/json',
                            },
                            body: JSON.stringify(commands.slice(i, i + 100)),
                        },
                        timeout
                    )
                ).json();
                if (rows.some((row) => row.error))
                    throw new Error('Upstash rejected an index command');
            }
        } else {
            cache.remove(this, 'remote', identity);
            const s = config || {},
                table = s.table || 'flux_search';
            if (!s.url || !s.sec_key) throw new Error('Missing Supabase build credentials');
            const send = (endpoint, method, body) =>
                request(
                    s.url.replace(/\/$/, '') + '/rest/v1/' + endpoint,
                    {
                        method,
                        headers: {
                            ...providers.supabaseHeaders(s.sec_key),
                            'Content-Type': 'application/json',
                            Prefer: 'return=minimal',
                        },
                        body: body ? JSON.stringify(body) : undefined,
                    },
                    timeout
                );
            await send(table + '_docs?id=neq.placeholder', 'DELETE');
            await send(table + '_index?word=neq.placeholder', 'DELETE');
            for (let i = 0; i < docs.length; i += 100)
                await send(table + '_docs', 'POST', docs.slice(i, i + 100));
            const rows = Object.entries(data.index)
                .filter(([w]) => w !== 'placeholder')
                .map(([word, doc_ids]) => ({ word, doc_ids }));

            for (let i = 0; i < rows.length; i += 500)
                await send(table + '_index', 'POST', rows.slice(i, i + 500));
        }
        cache.set(this, 'remote', identity, { digest });
        if (native) cache.remove(this, 'remote', identity + ':pending');
        this.log.info('[search] remote index uploaded');
    } catch (error) {
        const provider =
            mode === 'turso'
                ? 'Turso'
                : mode === 'upstash_search'
                  ? 'Upstash Search'
                  : mode === 'supabase'
                    ? 'Supabase'
                    : 'Upstash';
        if (native || cfg.upload?.fail_on_error === true) {
            this.log.error(
                '[search] %s upload failed: %s Next generation will retry.',
                provider,
                error.message
            );
            throw error;
        }
        if (cfg.local_fallback !== false) this.fluxSearchMode = 'local';
        this.log.warn(
            '[search] %s upload failed: %s %s Next generation will retry.',
            provider,
            error.message,
            cfg.local_fallback !== false
                ? 'Using local search for this build.'
                : 'Remote search may be outdated or unavailable.'
        );
    }
});

// Generate the search page only when search is enabled
hexo.extend.generator.register('theme_search_page', function () {
    if (this.theme.config.search?.enabled === false) return [];
    return {
        path: 'search/index.html',
        layout: 'search',
        data: { title: this.theme.config.search?.title || 'Search', flux_search: true },
    };
});
