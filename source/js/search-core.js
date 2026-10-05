(function (scope) {
    'use strict';
    const normalize = (value) =>
            String(value || '')
                .normalize('NFKC')
                .toLowerCase(),
        tokenize = (value) => [
            ...new Set(normalize(value).match(/[\p{L}\p{N}]+(?:[.-][\p{L}\p{N}]+)*/gu) || []),
        ],
        escape = (value) =>
            String(value || '').replace(
                /[&<>"']/g,
                (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
            );

    // Highlight literal query terms while escaping all source text
    function highlight(value, query) {
        const terms = tokenize(query).sort((a, b) => b.length - a.length);
        if (!terms.length) return escape(value);
        const pattern = new RegExp(
            terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
            'giu'
        );
        let last = 0,
            result = '';

        for (const match of String(value || '').matchAll(pattern)) {
            result +=
                escape(String(value).slice(last, match.index)) +
                '<mark>' +
                escape(match[0]) +
                '</mark>';
            last = match.index + match[0].length;
        }
        return result + escape(String(value || '').slice(last));
    }

    // Apply topic and inclusive date filters before ranking or pagination
    function matches(doc, f = {}) {
        return (
            (!f.type || doc.type === f.type) &&
            (!f.tag || (doc.tags || []).includes(f.tag)) &&
            (!f.category || (doc.categories || []).includes(f.category)) &&
            (!f.from || (doc.day || doc.date.slice(0, 10)) >= f.from) &&
            (!f.to || (doc.day || doc.date.slice(0, 10)) <= f.to)
        );
    }

    // Favor title and topic matches with deterministic date and URL tie-breaks
    function rank(docs, query) {
        const terms = tokenize(query),
            score = (doc) =>
                terms.reduce(
                    (n, t) =>
                        n +
                        (normalize(doc.title).includes(t) ? 100 : 0) +
                        (normalize(
                            [...(doc.tags || []), ...(doc.categories || [])].join(' ')
                        ).includes(t)
                            ? 20
                            : 0),
                    0
                );
        return docs
            .slice()
            .sort(
                (a, b) =>
                    score(b) - score(a) ||
                    b.date.localeCompare(a.date) ||
                    a.url.localeCompare(b.url)
            );
    }

    // Compute edit distance with only the previous row retained
    function distance(a, b) {
        let row = Array.from({ length: b.length + 1 }, (_, i) => i);

        for (let i = 0; i < a.length; i++) {
            const next = [i + 1];

            for (let j = 0; j < b.length; j++)
                next.push(Math.min(next[j] + 1, row[j + 1] + 1, row[j] + (a[i] !== b[j])));
            row = next;
        }
        return row[b.length];
    }

    // Suggest nearby vocabulary words for terms missing from the index
    function suggestions(query, vocabulary) {
        const terms = tokenize(query),
            found = [];

        for (const term of terms) {
            if (vocabulary.includes(term)) continue;
            const candidates = vocabulary
                .filter((w) => Math.abs(w.length - term.length) <= 2)
                .map((word) => ({ word, d: distance(term, word) }))
                .filter((x) => x.d <= (term.length > 5 ? 2 : 1))
                .sort((a, b) => a.d - b.d || a.word.localeCompare(b.word));

            for (const c of candidates.slice(0, 3))
                found.push(terms.map((t) => (t === term ? c.word : t)).join(' '));
        }
        return [...new Set(found)].slice(0, 3);
    }

    const pause = () => new Promise((resolve) => setTimeout(resolve, 0));

    // Index word lengths and trigrams while yielding periodically to the event loop
    async function vocabularyIndex(words) {
        const index = { words, exact: new Set(words), lengths: new Map(), grams: new Map() };

        for (let id = 0; id < words.length; id++) {
            const word = words[id];
            if (!index.lengths.has(word.length)) index.lengths.set(word.length, []);
            index.lengths.get(word.length).push(id);
            const chars = Array.from(word),
                grams = new Set();

            for (let i = 0; i < chars.length - 2; i++) grams.add(chars.slice(i, i + 3).join(''));
            for (const gram of grams) {
                if (!index.grams.has(gram)) index.grams.set(gram, []);
                index.grams.get(gram).push(id);
            }
            if (id % 512 === 511) await pause();
        }
        return index;
    }

    // Intersect trigram candidates before checking exact substring matches
    async function expand(index, terms) {
        const result = [];

        for (const term of terms) {
            const chars = Array.from(term),
                groups = [];

            for (let i = 0; i < chars.length - 2; i++)
                groups.push(index.grams.get(chars.slice(i, i + 3).join('')) || []);
            let ids;
            if (groups.length) {
                groups.sort((a, b) => a.length - b.length);
                const rest = groups.slice(1).map((group) => new Set(group));
                ids = groups[0].filter((id) => rest.every((group) => group.has(id)));
            } else ids = index.words.map((word, id) => id);
            const words = [];

            for (let i = 0; i < ids.length; i++) {
                const word = index.words[ids[i]];
                if (word.includes(term)) words.push(word);
                if (i % 512 === 511) await pause();
            }
            result.push(words);
        }
        return result;
    }

    // Stop edit-distance work once a candidate exceeds the allowed typo limit
    function boundedDistance(a, b, limit) {
        if (Math.abs(a.length - b.length) > limit) return limit + 1;
        let row = Array.from({ length: b.length + 1 }, (_, i) => i);

        for (let i = 0; i < a.length; i++) {
            const next = Array(b.length + 1).fill(limit + 1);
            next[0] = i + 1;
            for (let j = Math.max(0, i - limit); j < Math.min(b.length, i + limit + 1); j++)
                next[j + 1] = Math.min(next[j] + 1, row[j + 1] + 1, row[j] + (a[i] !== b[j]));
            if (Math.min(...next) > limit) return limit + 1;
            row = next;
        }
        return row[b.length];
    }

    // Search nearby word lengths for typo suggestions without blocking the browser
    async function indexedSuggestions(index, query) {
        const terms = tokenize(query),
            found = [];

        for (const term of terms) {
            if (index.exact.has(term)) continue;
            const limit = term.length > 5 ? 2 : 1,
                candidates = [];
            let checked = 0;

            for (let length = Math.max(0, term.length - 2); length <= term.length + 2; length++)
                for (const id of index.lengths.get(length) || []) {
                    const word = index.words[id],
                        d = boundedDistance(term, word, limit);
                    if (d <= limit) candidates.push({ word, d });
                    if (++checked % 256 === 0) await pause();
                }
            candidates.sort((a, b) => a.d - b.d || a.word.localeCompare(b.word));
            for (const c of candidates.slice(0, 3))
                found.push(terms.map((t) => (t === term ? c.word : t)).join(' '));
        }
        return [...new Set(found)].slice(0, 3);
    }

    // Validate table names before inserting identifiers into SQL
    function sqlIdentifier(value) {
        if (typeof value !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value))
            throw new Error('Invalid Turso table prefix');
        return '"' + value + '"';
    }

    const sqlArg = (value) => ({
        type: Number.isInteger(value) ? 'integer' : 'text',
        value: String(value),
    });

    // Build a ranked FTS query with bound search terms, filters, and pagination
    function tursoQuery(table, query, filters = {}, offset = 0) {
        const docs = sqlIdentifier((table || 'flux_search') + '_docs'),
            fts = sqlIdentifier((table || 'flux_search') + '_fts'),
            where = [fts + ' MATCH ?'],
            args = [
                sqlArg(
                    tokenize(query)
                        .map((t) => '"' + t.replace(/"/g, '""') + '"*')
                        .join(' AND ')
                ),
            ];

        for (const key of ['type', 'from', 'to']) {
            if (!filters[key]) continue;
            where.push(
                key === 'type' ? 'd.type = ?' : 'd.day ' + (key === 'from' ? '>=' : '<=') + ' ?'
            );
            args.push(sqlArg(filters[key]));
        }
        for (const [key, field] of [
            ['tag', 'tags'],
            ['category', 'categories'],
        ]) {
            if (!filters[key]) continue;
            where.push('EXISTS (SELECT 1 FROM json_each(d.' + field + ') WHERE value = ?)');
            args.push(sqlArg(filters[key]));
        }
        args.push(sqlArg(500), sqlArg(offset));
        return {
            sql:
                'SELECT d.id FROM ' +
                fts +
                ' JOIN ' +
                docs +
                ' d ON d.rowid = ' +
                fts +
                '.rowid WHERE ' +
                where.join(' AND ') +
                ' ORDER BY bm25(' +
                fts +
                ', 5, 2, 2, 1), d.date DESC, d.url ASC LIMIT ? OFFSET ?',
            args,
        };
    }

    // Validate pipeline results before returning document IDs in provider order
    function tursoResults(body) {
        if (!Array.isArray(body?.results) || body.results.some((r) => r.type !== 'ok'))
            throw new Error('Turso rejected a SQL statement');
        const result = body.results[0]?.response?.result;
        if (!Array.isArray(result?.rows)) throw new Error('Invalid Turso response');
        return result.rows.map((row) => {
            if (row[0]?.type !== 'text' || typeof row[0].value !== 'string')
                throw new Error('Invalid Turso document ID');
            return row[0].value;
        });
    }
    // Encode filter values consistently to avoid ambiguous provider escaping rules
    const filterValue = (value) =>
        encodeURIComponent(String(value)).replace(
            /[!'()*]/g,
            (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase()
        );

    // Convert date filters to the numeric format stored in the search index
    function dayNumber(value) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Invalid search date');
        return Number(value.replace(/-/g, ''));
    }

    // Combine encoded metadata filters with inclusive numeric date bounds
    function upstashFilter(filters = {}) {
        const parts = [];

        for (const [key, field, op] of [
            ['type', 'filter_type', '='],
            ['tag', 'filter_tags', 'CONTAINS'],
            ['category', 'filter_categories', 'CONTAINS'],
        ])
            if (filters[key])
                parts.push(
                    '@metadata.' + field + ' ' + op + " '" + filterValue(filters[key]) + "'"
                );
        if (filters.from) parts.push('@metadata.day >= ' + dayNumber(filters.from));
        if (filters.to) parts.push('@metadata.day <= ' + dayNumber(filters.to));
        return parts.join(' AND ');
    }

    // Deduplicate chunk hits while preserving provider relevance scores
    function upstashResults(body) {
        if (body?.error || !Array.isArray(body?.result))
            throw new Error('Invalid Upstash Search response');
        const seen = new Set();
        return body.result
            .slice()
            .sort((a, b) => b.score - a.score)
            .flatMap((hit) => {
                const id = hit.metadata?.doc_id;
                if (typeof id !== 'string' || !Number.isFinite(hit.score))
                    throw new Error('Invalid Upstash Search hit');
                if (seen.has(id)) return [];
                seen.add(id);
                return [id];
            });
    }

    const api = {
        normalize,
        tokenize,
        escape,
        highlight,
        matches,
        rank,
        suggestions,
        vocabularyIndex,
        expand,
        indexedSuggestions,
        sqlIdentifier,
        sqlArg,
        tursoQuery,
        tursoResults,
        filterValue,
        dayNumber,
        upstashFilter,
        upstashResults,
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else scope.FluxSearchCore = api;
})(typeof window === 'undefined' ? globalThis : window);
