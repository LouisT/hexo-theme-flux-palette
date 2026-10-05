'use strict';
const cache = require('./cache.cjs'),
    core = require('../source/js/search-core.js'),
    errors = require('./search-errors.cjs');
const NATIVE = ['turso', 'upstash_search'],
    REMOTE = ['upstash', 'supabase', ...NATIVE];
const VERSION = 1;

// Resolve required search settings from literals or environment references
function setting(value, name) {
    if (typeof value === 'string' && value.startsWith('env:')) {
        const variable = value.slice(4);
        value = process.env[variable];
        if (!value)
            throw new Error(
                'Required environment variable ' + variable + ' for search.' + name + ' is missing'
            );
    }
    if (typeof value !== 'string' || !value.trim()) throw new Error('Missing search.' + name);
    return value;
}

// Validate provider settings and omit build credentials when resolving browser config
function resolve(cfg, write = true) {
    const mode = cfg.service || 'local';
    if (!['local', ...REMOTE].includes(mode)) throw new Error('Unknown search provider: ' + mode);
    if (mode === 'local') return null;
    if (!NATIVE.includes(mode)) {
        const source = cfg[mode] || {},
            result = {};
        // Resolve provider-specific settings while omitting write keys for browser requests
        for (const key of mode === 'supabase'
            ? ['url', 'sec_key', 'pub_key', 'table']
            : ['url', 'token', 'read_token', 'index']) {
            if (!write && key === (mode === 'supabase' ? 'sec_key' : 'token')) continue;
            const raw = source[key];
            if (typeof raw === 'string' && raw.startsWith('env:'))
                result[key] = setting(raw, mode + '.' + key);
            else result[key] = raw;
        }
        if (result.url) {
            let parsed;
            try {
                parsed = new URL(result.url);
            } catch {
                throw new Error('Invalid search.' + mode + '.url');
            }
            if (
                !['https:', 'http:'].includes(parsed.protocol) ||
                parsed.username ||
                parsed.password ||
                parsed.search ||
                parsed.hash
            )
                throw new Error('Invalid search.' + mode + '.url');
        }
        if (mode === 'supabase' && result.table) core.sqlIdentifier(result.table);
        if (!write) delete result[mode === 'supabase' ? 'sec_key' : 'token'];
        return result;
    }
    const source = cfg[mode] || {},
        value = (key) => setting(source[key], mode + '.' + key);
    // Normalize libSQL URLs before requiring a credential-free HTTPS origin
    let url = value('url');
    if (mode === 'turso') url = url.replace(/^libsql:\/\//, 'https://');
    const parsed = new URL(url);
    if (
        parsed.protocol !== 'https:' ||
        parsed.username ||
        parsed.password ||
        parsed.search ||
        parsed.hash ||
        !['', '/'].includes(parsed.pathname)
    )
        throw new Error('search.' + mode + '.url must be an HTTPS database origin');
    const result = { url: parsed.origin, read_token: value('read_token') };
    if (write) {
        result.token = value('token');
        if (result.token === result.read_token)
            throw new Error('search.' + mode + ' requires separate write and read-only tokens');
    }
    if (mode === 'turso') {
        result.table = source.table ?? 'flux_search';
        core.sqlIdentifier(result.table);
    } else {
        result.index = source.index ?? 'flux';
        if (typeof result.index !== 'string' || !result.index.trim())
            throw new Error('Missing search.upstash_search.index');
        result.max_results = source.max_results ?? 100;
        result.semantic_weight = source.semantic_weight ?? 0.75;
        result.reranking = source.reranking ?? false;
        result.input_enrichment = source.input_enrichment ?? false;
        if (
            !Number.isInteger(result.max_results) ||
            result.max_results < 1 ||
            result.max_results > 1000
        )
            throw new Error('search.upstash_search.max_results must be an integer from 1 to 1000');
        if (
            !Number.isFinite(result.semantic_weight) ||
            result.semantic_weight < 0 ||
            result.semantic_weight > 1
        )
            throw new Error('search.upstash_search.semantic_weight must be between 0 and 1');
        if (typeof result.reranking !== 'boolean' || typeof result.input_enrichment !== 'boolean')
            throw new Error('Upstash Search reranking and input_enrichment must be booleans');
    }
    return result;
}

// Publish provider options with read credentials only
function frontend(cfg, mode = cfg.service || 'local') {
    const result = { mode, debounce: cfg.debounce ?? 3000 },
        resolved = REMOTE.includes(mode) ? resolve({ ...cfg, service: mode }, false) : null;
    if (NATIVE.includes(mode)) result[mode] = resolve({ ...cfg, service: mode }, false);
    else if (mode === 'upstash')
        result.upstash = {
            url: resolved.url,
            token: resolved.read_token,
            index: resolved.index,
        };
    else if (mode === 'supabase')
        result.supabase = {
            url: resolved.url,
            key: resolved.pub_key,
            table: resolved.table,
        };
    return result;
}

// Prepare stable remote documents with placeholders for protected article bodies
function documents(docs) {
    return docs
        .map((d) => ({
            id: d.id,
            title: d.title,
            url: d.url,
            type: d.type,
            date: d.date,
            day: d.day,
            encrypted: Boolean(d.encrypted),
            tags: d.tags,
            categories: d.categories,
            body: d.encrypted ? 'This content has been password protected.' : d.content,
        }))
        .sort((a, b) => a.id.localeCompare(b.id));
}

// Split searchable text into overlapping Unicode-safe chunks within provider limits
function chunks(docs) {
    const result = [];
    for (const doc of docs) {
        const text = [doc.title, ...doc.tags, ...doc.categories, doc.body].join('\n'),
            chars = Array.from(text),
            metadata = {
                doc_id: doc.id,
                type: doc.type,
                tags: doc.tags,
                categories: doc.categories,
                day: core.dayNumber(doc.day),
                filter_type: core.filterValue(doc.type),
                filter_tags: doc.tags.map(core.filterValue),
                filter_categories: doc.categories.map(core.filterValue),
            };
        if (Buffer.byteLength(JSON.stringify(metadata)) > 48000)
            throw new Error('Upstash Search filter metadata exceeds 48 KB for document ' + doc.id);
        let start = 0,
            chunk = 0;
        do {
            let end = Math.min(start + 3500, chars.length);
            // Bound the serialized searchable object too, including escaped characters
            const fits = (end) =>
                JSON.stringify({ text: chars.slice(start, end).join('') }).length <= 4096;
            // Find the largest serializable chunk without splitting Unicode code points
            if (!fits(end)) {
                let low = start + 1,
                    high = end;
                while (low < high) {
                    const middle = Math.ceil((low + high) / 2);
                    if (fits(middle)) low = middle;
                    else high = middle - 1;
                }
                end = low;
            }
            if (end < chars.length) {
                const boundary = chars
                    .slice(start, end)
                    .join('')
                    .search(/\s+\S*$/u);
                // Convert the UTF-16 offset back to a code-point count
                if (boundary > 0) {
                    const length = Array.from(
                        chars
                            .slice(start, end)
                            .join('')
                            .slice(0, boundary + 1)
                    ).length;
                    if (length > (end - start) * 0.8) end = start + length;
                }
            }
            result.push({
                id: 'flux:' + doc.id + ':' + chunk++,
                content: { text: chars.slice(start, end).join('') },
                metadata,
            });
            if (end === chars.length) break;
            start = Math.max(start + 1, end - 200);
        } while (start < chars.length);
    }
    return result;
}

// Hash the exact provider records used to detect unchanged uploads
function prepare(mode, docs) {
    const normalized = documents(docs),
        records = mode === 'upstash_search' ? chunks(normalized) : normalized;
    return { records, digest: cache.hash([VERSION, mode, records]) };
}

// Upsert current documents transactionally before deleting stale generations
async function tursoSync(config, records, generation, request, timeout) {
    const docs = core.sqlIdentifier(config.table + '_docs'),
        fts = core.sqlIdentifier(config.table + '_fts');
    // Continue batched SQL on the same connection using the returned transaction baton
    async function pipeline(statements, connection, close = true) {
        const body = await (
            await request(
                (connection?.base_url || config.url).replace(/\/$/, '') + '/v2/pipeline',
                {
                    method: 'POST',
                    headers: {
                        Authorization: 'Bearer ' + config.token,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        ...(connection?.baton ? { baton: connection.baton } : {}),
                        requests: [
                            ...statements.map((stmt) => ({ type: 'execute', stmt })),
                            ...(close ? [{ type: 'close' }] : []),
                        ],
                    }),
                },
                timeout
            )
        ).json();
        if (
            !Array.isArray(body.results) ||
            body.results.length !== statements.length + Number(close) ||
            body.results.some((r) => r.type !== 'ok')
        ) {
            const error = new Error('Turso rejected a SQL statement');
            error.connection = body;
            throw error;
        }
        return body;
    }
    // Keep full-text rows synchronized through triggers on the document table
    const schema = [
        `CREATE TABLE IF NOT EXISTS ${docs} (rowid INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, title TEXT NOT NULL, url TEXT NOT NULL, type TEXT NOT NULL, date TEXT NOT NULL, day TEXT NOT NULL, tags TEXT NOT NULL, categories TEXT NOT NULL, tags_text TEXT NOT NULL, categories_text TEXT NOT NULL, body TEXT NOT NULL, generation TEXT NOT NULL)`,
        `CREATE VIRTUAL TABLE IF NOT EXISTS ${fts} USING fts5(title, tags_text, categories_text, body, content='${config.table}_docs', content_rowid='rowid', prefix='2 3 4')`,
        `CREATE TRIGGER IF NOT EXISTS ${core.sqlIdentifier(config.table + '_ai')} AFTER INSERT ON ${docs} BEGIN INSERT INTO ${fts}(rowid,title,tags_text,categories_text,body) VALUES (new.rowid,new.title,new.tags_text,new.categories_text,new.body); END`,
        `CREATE TRIGGER IF NOT EXISTS ${core.sqlIdentifier(config.table + '_ad')} AFTER DELETE ON ${docs} BEGIN INSERT INTO ${fts}(${fts},rowid,title,tags_text,categories_text,body) VALUES ('delete',old.rowid,old.title,old.tags_text,old.categories_text,old.body); END`,
        `CREATE TRIGGER IF NOT EXISTS ${core.sqlIdentifier(config.table + '_au')} AFTER UPDATE ON ${docs} BEGIN INSERT INTO ${fts}(${fts},rowid,title,tags_text,categories_text,body) VALUES ('delete',old.rowid,old.title,old.tags_text,old.categories_text,old.body); INSERT INTO ${fts}(rowid,title,tags_text,categories_text,body) VALUES (new.rowid,new.title,new.tags_text,new.categories_text,new.body); END`,
    ];
    try {
        await pipeline(schema.map((sql) => ({ sql })));
    } catch (error) {
        throw new Error(
            'Could not initialize Turso search tables. Use a dedicated libSQL database with FTS5 support and a write-enabled build token. ' +
                error.message
        );
    }
    // Rollback rejected batches before releasing the database connection
    async function transaction(statements) {
        let connection;
        try {
            connection = await pipeline([{ sql: 'BEGIN IMMEDIATE' }], null, false);
            if (!connection.baton) throw new Error('Turso did not return a transaction baton');
            connection = await pipeline(statements, connection, false);
            await pipeline([{ sql: 'COMMIT' }], connection);
        } catch (error) {
            const active = error.connection?.baton ? error.connection : connection;
            if (active?.baton) await pipeline([{ sql: 'ROLLBACK' }], active).catch(() => {});
            throw error;
        }
    }
    const fields = [
        'id',
        'title',
        'url',
        'type',
        'date',
        'day',
        'tags',
        'categories',
        'tags_text',
        'categories_text',
        'body',
        'generation',
    ];
    // Limit each transactional upsert batch to 25 documents
    for (let i = 0; i < records.length; i += 25) {
        await transaction(
            records.slice(i, i + 25).map((doc) => ({
                sql: `INSERT INTO ${docs} (${fields.join(',')}) VALUES (${fields.map(() => '?').join(',')}) ON CONFLICT(id) DO UPDATE SET ${fields
                    .slice(1)
                    .map((field) => field + '=excluded.' + field)
                    .join(',')}`,
                args: [
                    doc.id,
                    core.normalize(doc.title),
                    doc.url,
                    doc.type,
                    doc.date,
                    doc.day,
                    JSON.stringify(doc.tags),
                    JSON.stringify(doc.categories),
                    core.normalize(doc.tags.join(' ')),
                    core.normalize(doc.categories.join(' ')),
                    core.normalize(doc.body),
                    generation,
                ].map(core.sqlArg),
            }))
        );
    }
    // Stale records are removed only after every current document was written
    await transaction([
        { sql: `DELETE FROM ${docs} WHERE generation <> ?`, args: [core.sqlArg(generation)] },
    ]);
}

// Replace managed chunks and confirm ingestion before deleting obsolete records
async function upstashSync(config, records, request, timeout, runtime = {}) {
    const now = runtime.now || Date.now,
        sleep = runtime.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
        index = encodeURIComponent(config.index);
    // Reject provider errors even when the HTTP response succeeds
    async function send(path, body, limit = timeout) {
        const data = await (
            await request(
                config.url + '/' + path,
                {
                    method: 'POST',
                    headers: {
                        Authorization: 'Bearer ' + config.token,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(body),
                },
                limit
            )
        ).json();
        if (data.error || data.result === undefined) {
            const detail = errors.detail(data, [config.token, config.read_token]);
            throw new Error(
                'Upstash Search rejected an index command' + (detail ? ': ' + detail : '')
            );
        }
        return data.result;
    }
    const current = new Set(records.map((doc) => doc.id)),
        stale = [],
        cursors = new Set();
    let cursor = '0';
    // Collect stale managed IDs while rejecting repeated pagination cursors
    do {
        if (cursors.has(cursor)) throw new Error('Upstash Search returned a repeated range cursor');
        cursors.add(cursor);
        const page = await send('range/' + index, {
            cursor,
            // Upstash Search permits at most 100 records per range request
            limit: 100,
            prefix: 'flux:',
            includeData: false,
            includeMetadata: false,
        });
        if (!Array.isArray(page.vectors) || typeof page.nextCursor !== 'string')
            throw new Error('Invalid Upstash Search range response');
        for (const doc of page.vectors)
            if (doc.id.startsWith('flux:') && !current.has(doc.id)) stale.push(doc.id);
        cursor = page.nextCursor;
    } while (cursor !== '');
    // Upload managed chunks in batches before waiting for ingestion
    for (let i = 0; i < records.length; i += 100) {
        const result = await send('upsert-data/' + index, records.slice(i, i + 100));
        if (result !== 'Success')
            throw new Error('Upstash Search did not accept the uploaded documents');
    }
    // Bound ingestion waits and require two spaced confirmations of an idle index
    async function ready(minimum) {
        const deadline = now() + 120000;
        let idle = 0;
        do {
            const info = await send(
                'info',
                undefined,
                Math.min(timeout, Math.max(1, deadline - now()))
            );
            if (!info.namespaces || typeof info.namespaces !== 'object')
                throw new Error('Invalid Upstash Search info response');
            const state = info.namespaces[config.index];
            const complete =
                (!state && minimum === 0) ||
                (state?.pendingVectorCount === 0 && state.vectorCount >= minimum);
            // Ignore an initially stale zero count until a second poll confirms ingestion
            idle = complete ? idle + 1 : 0;
            if (idle === 2) return;
            if (now() >= deadline) break;
            await sleep(Math.min(2000, deadline - now()));
        } while (now() < deadline);
        throw new Error('Upstash Search indexing did not finish within 120 seconds');
    }
    await ready(current.size + stale.length);
    for (let i = 0; i < stale.length; i += 100) {
        const result = await send('delete/' + index, { ids: stale.slice(i, i + 100) });
        if (!Number.isInteger(result.deleted))
            throw new Error('Invalid Upstash Search delete response');
    }
}

// Synchronize prepared records with the selected native provider
async function sync(mode, config, prepared, request, timeout) {
    if (mode === 'turso')
        await tursoSync(config, prepared.records, prepared.digest, request, timeout);
    else await upstashSync(config, prepared.records, request, timeout);
}

// Send bearer authentication only for legacy JWT-style Supabase keys
function supabaseHeaders(key) {
    return key?.startsWith('sb_')
        ? { apikey: key }
        : { apikey: key, Authorization: 'Bearer ' + key };
}

module.exports = {
    supabaseHeaders,
    NATIVE,
    REMOTE,
    resolve,
    frontend,
    documents,
    chunks,
    prepare,
    tursoSync,
    upstashSync,
    sync,
};
