'use strict';
const fs = require('node:fs'),
    fm = require('hexo-front-matter'),
    content = require('../lib/content.cjs'),
    cache = require('../lib/cache.cjs');

// Reset build statistics while preserving image work performed during post rendering
hexo.extend.filter.register(
    'before_generate',
    async function () {
        this.fluxProjectsPromise = null;
        this.fluxCacheStats = { hits: 0, misses: 0 };
        this.fluxCacheUsed = new Set();
        this.fluxImageStats = this.fluxPendingImageStats || { transformed: 0, reused: 0 };
        this.fluxPendingImageStats = null;
        this.fluxCountingGeneration = true;
    },
    10
);

// Gather shared public metadata once for search and reading features
hexo.extend.filter.register(
    'before_generate',
    async function () {
        this.fluxDocs = await content.gather(this, this.locals.toObject());
    },
    20
);

// Escape JSON delimiters before embedding data in scripts or HTML attributes
hexo.extend.helper.register('flux_json', (value) =>
    JSON.stringify(value).replace(/</g, '\\u003c').replace(/'/g, '\\u0027').replace(/&/g, '\\u0026')
);

// Normalize posts and projects into the shared article metadata shape
hexo.extend.helper.register('flux_article', function () {
    return content.normalize(
        hexo,
        this.page.project || this.page,
        this.page.project ? 'project' : 'post'
    );
});

// Expose bookmark metadata without storing article bodies
hexo.extend.helper.register('flux_bookmark', function (item, type) {
    return {
        title: item.title || item.slug || 'Untitled',
        url: content.url(hexo, item.path),
        type,
        encrypted: content.protectedItem(item),
    };
});

hexo.extend.helper.register('flux_related', function (item) {
    return content.related(hexo, item);
});

// Use authored update dates rather than Hexo filesystem timestamps
hexo.extend.helper.register('flux_freshness', function (item) {
    let explicit = item.updated;
    if (!item.project_tags) {
        try {
            explicit = fm.parse(item.raw || '').updated ? item.updated : null;
        } catch {
            explicit = null;
        }
    }
    const updated = content.iso(explicit),
        date = content.iso(item.date),
        cfg = this.theme.content_freshness || {};
    return {
        updated: explicit && updated > date ? updated : '',
        stale:
            cfg.enabled !== false &&
            cfg.stale_notice?.enabled === true &&
            Date.now() - +new Date(explicit && updated > date ? updated : date) >
                (cfg.stale_notice.after_days || 365) * 86400000,
    };
});

// Declare page features and public metadata for the browser runtime
hexo.extend.helper.register('flux_manifest', function () {
    const p = this.page,
        t = this.theme,
        item = p.project || p,
        html = item.content || '',
        encrypted = content.protectedItem(item),
        features = ['sidebar', 'accessibility'];
    if (!t.favicon) features.push('favicon');
    if (t.sidebar?.palette_selector?.enabled !== false) features.push('palette-switcher');
    if (t.backtotop?.enabled !== false) features.push('back-to-top');
    const article = Boolean(p.project || this.is_post?.() || p.flux_playground);
    if (article) features.push('reading-progress');
    if (article && /<h[1-6]\b/.test(html)) features.push('toc-spy');
    if (
        t.reading?.enabled !== false &&
        (article ||
            p.flux_reading ||
            p.flux_search ||
            p.__is_blog ||
            (p.__index && p.posts) ||
            p.projects)
    )
        features.push('reading');
    if (p.flux_search || p.flux_playground) features.push('search-core', 'search');
    if (p.flux_cloud && p.cloud_controls && (p.categories?.length || p.tags?.length))
        features.push('cloud');
    const curated = p.__index ? this.flux_curated() : null;
    if (curated && (curated.posts.length || curated.projects.length)) features.push('curated');
    if (
        (t.home?.mode === 'projects' && p.__index) ||
        (p.projects && t.projects?.filters?.enabled !== false) ||
        p.flux_playground
    )
        features.push('projects');
    // Preload enhancements that may be needed after protected content unlocks
    if (encrypted) features.push('encrypted-post');
    if (encrypted || /class="highlight/.test(html)) features.push('code-copy');
    if (encrypted || /<img\b/.test(html)) features.push('lightbox');
    if (encrypted || /data-flux-embed/.test(html)) features.push('embeds');
    if (encrypted || /class="rich-/.test(html)) features.push('rich-content');
    if (encrypted || /data-rich-mermaid/.test(html)) features.push('mermaid');
    if (t.heading_links?.enabled !== false && (encrypted || /<h[1-6]\b/.test(html)))
        features.push('heading-links');
    if (
        t.link_previews?.enabled !== false &&
        (p.project || this.is_post?.()) &&
        (encrypted || /<a\b/.test(html))
    )
        features.push('link-previews');
    if (article && t.comments?.enabled && item.comments !== false && !encrypted)
        features.push('comments');
    if (t.offline?.enabled) features.push('offline');
    return {
        root: content.root(hexo),
        math: encrypted || /class="katex/.test(html),
        features: [...new Set(features)],
        reading: t.reading || {},
        offline: t.offline || {},
        article: article
            ? (({ content: body, excerpt, ...meta }) => meta)(
                  content.normalize(hexo, item, p.project ? 'project' : 'post')
              )
            : null,
        comments: { sync: t.comments?.sync_theme !== false },
        library: Boolean(p.flux_reading),
        playground: Boolean(p.flux_playground),
    };
});

// Publish the Alpine runtime and collapse plugin from installed dependencies
hexo.extend.generator.register('flux_vendor', function () {
    return [
        ['alpinejs', 'alpine.js'],
        ['@alpinejs/collapse', 'collapse.js'],
    ].map(([pkg, file]) => ({
        path: `js/vendor/${file}`,
        data: fs.readFileSync(require.resolve(`${pkg}/dist/cdn.min.js`)),
    }));
});

// Generate the reading library and a catalog containing metadata only
hexo.extend.generator.register('flux_reading', function () {
    if (this.theme.config.reading?.enabled === false) return [];
    return [
        {
            path: 'reading/index.html',
            layout: 'reading',
            data: { title: 'Reading list', flux_reading: true },
        },
        {
            path: 'reading/catalog.json',
            data: JSON.stringify(
                (this.fluxDocs || []).map(({ content, excerpt, ...metadata }) => metadata)
            ),
        },
    ];
});

// Clear persisted build work so the next generation recomputes assets and search
hexo.extend.console.register(
    'flux-cache-clear',
    'Clear Flux Palette build caches',
    {},
    function () {
        fs.rmSync(cache.folder(this), { recursive: true, force: true });
        this.log.info(
            'Flux Palette cache cleared. The next generation will rebuild and upload search.'
        );
    }
);

// Report build reuse before pruning cache entries no longer referenced
hexo.extend.filter.register(
    'after_generate',
    function () {
        this.log.info(
            '[flux-cache] %d hits, %d misses; images: %d transformed, %d reused',
            this.fluxCacheStats?.hits || 0,
            this.fluxCacheStats?.misses || 0,
            this.fluxImageStats?.transformed || 0,
            this.fluxImageStats?.reused || 0
        );
        this.fluxCountingGeneration = false;
        cache.prune(this);
    },
    1000
);

// Original files used exclusively by protected content must not be copied publicly
hexo.extend.filter.register(
    'after_generate',
    function () {
        const locals = this.locals.toObject(),
            items = [
                ...content.array(locals.posts),
                ...content.array(locals.pages),
                ...(this.fluxProjects || []),
            ],
            privateAssets = new Set(items.flatMap((item) => item.flux_private_assets || [])),
            { load } = require('cheerio'),
            publicAssets = new Set();
        for (const route of this.fluxRichPublicDownloads || []) publicAssets.add(route);

        // Preserve images reused publicly when removing assets from protected articles
        for (const item of items.filter((item) => !content.protectedItem(item))) {
            const $ = load(item.content || ''),
                values = [item.cover, item.image].filter(Boolean);
            $('[src],[href],[data-original-src],[srcset]').each((i, el) => {
                const node = $(el);
                values.push(
                    ...['src', 'href', 'data-original-src'].map((a) => node.attr(a)).filter(Boolean)
                );
                values.push(
                    ...(node.attr('srcset') || '')
                        .split(',')
                        .map((v) => v.trim().split(/\s/)[0])
                        .filter(Boolean)
                );
            });
            for (const value of values)
                try {
                    const parsed = new URL(
                        value,
                        new URL(content.url(this, item.path), this.config.url)
                    );
                    if (parsed.origin === new URL(this.config.url).origin)
                        publicAssets.add(
                            decodeURIComponent(parsed.pathname).slice(content.root(this).length)
                        );
                } catch {}
        }
        for (const asset of privateAssets) if (!publicAssets.has(asset)) this.route.remove(asset);
    },
    60
);
