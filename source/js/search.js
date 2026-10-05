window.Flux.register('search', () => {
    const shared = new Map(),
        C = FluxSearchCore;

    // Reject failed search requests before parsing their response data
    function json(url, options) {
        return fetch(url, options).then((r) => {
            if (!r.ok) throw new Error('Search unavailable');
            return r.json();
        });
    }

    // Share catalog and shard requests while allowing failed downloads to retry
    function cached(url) {
        if (!shared.has(url))
            shared.set(
                url,
                json(url).catch((e) => {
                    shared.delete(url);
                    throw e;
                })
            );
        return shared.get(url);
    }

    // Normalize stored history to ten unique nonempty search queries
    function recentSearches() {
        const stored = Flux.read('search-recent', []);
        if (!Array.isArray(stored)) return [];
        return [
            ...new Set(
                stored
                    .filter((q) => typeof q === 'string')
                    .map((q) => q.trim())
                    .filter(Boolean)
            ),
        ].slice(0, 10);
    }

    Alpine.data('search', (config) => ({
        query: '',
        type: '',
        tag: '',
        category: '',
        from: '',
        to: '',
        results: [],
        matches: [],
        docs: [],
        topics: {},
        vocabulary: [],
        vocabularyReady: null,
        vocabularyFallback: null,
        worker: null,
        workerJobs: null,
        workerSequence: 0,
        recent: recentSearches(),
        suggestions: [],
        active: -1,
        isLoading: false,
        catalogLoading: false,
        isWaiting: false,
        error: '',
        limitedResults: false,
        sequence: 0,
        catalogSequence: 0,
        catalogReady: false,
        alive: true,
        timer: null,
        controller: null,
        element: null,
        pop: null,
        legacyVocabulary: false,
        // List unique tags from the loaded search catalog
        get tags() {
            return [...new Set(this.docs.flatMap((d) => d.tags))].sort();
        },
        // List unique categories from the loaded search catalog
        get categories() {
            return [...new Set(this.docs.flatMap((d) => d.categories))].sort();
        },
        // Detect active filters independently of the search query
        get hasFilters() {
            return Boolean(this.type || this.tag || this.category || this.from || this.to);
        },
        // Label counts that may be capped by the remote provider
        get resultCount() {
            return this.matches.length + (this.limitedResults ? ' results returned' : ' results');
        },
        // Combine catalog loading, query loading, and debounce state
        get isBusy() {
            return this.catalogLoading || this.isLoading || this.isWaiting;
        },
        // Restore URL filters and connect them to the search lifecycle
        async init() {
            this.element = this.$el;
            // Normalize older stored histories and keep at most ten unique, nonempty queries
            Flux.write('search-recent', this.recent);
            const params = new URLSearchParams(location.search);

            for (const key of ['query', 'type', 'tag', 'category', 'from', 'to'])
                this[key] = params.get(key === 'query' ? 'q' : key) || '';
            for (const key of ['query', 'type', 'tag', 'category', 'from', 'to'])
                this.$watch(key, () => this.schedule());
            this.pop = () => {
                const p = new URLSearchParams(location.search);

                for (const key of ['query', 'type', 'tag', 'category', 'from', 'to'])
                    this[key] = p.get(key === 'query' ? 'q' : key) || '';
                this.schedule();
            };
            addEventListener('popstate', this.pop);
            await this.retry();
        },
        // Reload the catalog while invalidating searches tied to earlier requests
        async retry() {
            const seq = ++this.catalogSequence;
            let loaded = false;
            ++this.sequence;
            this.controller?.abort();
            clearTimeout(this.timer);
            this.timer = null;
            this.isWaiting = false;
            this.error = '';
            this.limitedResults = false;
            this.isLoading = false;
            this.catalogLoading = true;
            try {
                const data = await cached(
                    Flux.root + (config.index_path || 'search/') + 'catalog.json'
                );
                if (!this.alive || seq !== this.catalogSequence) return;
                this.docs = data.docs;
                this.topics = data.topics || {};
                this.vocabulary = data.vocabulary || [];
                this.legacyVocabulary = Array.isArray(data.vocabulary);
                this.catalogReady = true;
                loaded = true;
            } catch {
                if (this.alive && seq === this.catalogSequence)
                    this.error = 'Could not load search. Try again.';
            } finally {
                if (this.alive && seq === this.catalogSequence) {
                    this.catalogLoading = false;
                    if (loaded) this.schedule();
                }
            }
        },
        // Cancel obsolete work immediately and debounce the latest nonempty query
        schedule() {
            ++this.sequence;
            this.controller?.abort();
            clearTimeout(this.timer);
            this.timer = null;
            this.isLoading = false;
            this.isWaiting = false;
            this.limitedResults = false;
            this.results = [];
            this.matches = [];
            this.suggestions = [];
            this.active = -1;
            this.error = '';
            if (!this.catalogReady || this.catalogLoading) return;
            // Clearing the query and browsing local filters do not need a remote request
            if (!C.tokenize(this.query.trim()).length) {
                this.performSearch();
                return;
            }
            this.isWaiting = true;
            this.timer = setTimeout(() => this.performSearch(), config.debounce ?? 3000);
        },
        // Clear the query and return keyboard focus to the search field
        clearSearch() {
            this.query = '';
            this.schedule();
            this.$refs.searchInput?.focus();
        },
        // Clear all filters before scheduling a fresh search
        clearFilters() {
            for (const key of ['type', 'tag', 'category', 'from', 'to']) this[key] = '';
            this.schedule();
        },
        // Clear saved search history and return focus to the search field
        clearRecent() {
            this.recent = [];
            Flux.write('search-recent', this.recent);
            this.$refs.searchInput?.focus();
        },
        // Apply filters and rankings before loading excerpts for the latest query
        async performSearch() {
            clearTimeout(this.timer);
            this.timer = null;
            this.isWaiting = false;
            this.isLoading = false;
            const seq = ++this.sequence;
            this.controller?.abort();
            this.controller = new AbortController();
            const signal = this.controller.signal;
            this.error = '';
            this.suggestions = [];
            this.active = -1;
            const query = this.query.trim(),
                terms = C.tokenize(query);
            if (!Flux.manifest.playground) {
                const u = new URL(location.href);

                for (const key of ['query', 'type', 'tag', 'category', 'from', 'to']) {
                    const name = key === 'query' ? 'q' : key;
                    if (this[key]) u.searchParams.set(name, this[key]);
                    else u.searchParams.delete(name);
                }
                history.replaceState(history.state, '', u);
            }
            if (!terms.length && !this.hasFilters) {
                this.matches = [];
                this.results = [];
                return;
            }
            if (this.from && this.to && this.from > this.to) {
                this.error = 'The start date must be before the end date.';
                return;
            }
            this.isLoading = true;
            try {
                let candidates,
                    ranked = false;
                this.limitedResults = false;
                if (!terms.length) candidates = this.docs;
                else if (['turso', 'upstash_search'].includes(config.mode)) {
                    const ids = await this.nativeIds(query, signal),
                        catalog = new Map(this.docs.map((doc) => [doc.id, doc])),
                        seen = new Set();
                    candidates = ids.flatMap((id) => {
                        if (seen.has(id) || !catalog.has(id)) return [];
                        seen.add(id);
                        return [catalog.get(id)];
                    });
                    ranked = true;
                } else {
                    const sets =
                        config.mode === 'local' || !config.mode
                            ? await this.localIds(terms)
                            : await this.remoteIds(terms, signal);
                    candidates = this.docs.filter((d) => sets.every((set) => set.has(d.id)));
                }
                const filtered = candidates.filter((d) => C.matches(d, this)),
                    matches = ranked ? filtered : C.rank(filtered, query);
                // Discard late responses so earlier queries cannot overwrite current results
                if (seq !== this.sequence) return;
                this.limitedResults = ranked && config.mode === 'upstash_search';
                this.matches = matches;
                await this.showResults(15, seq, signal);
                if (seq !== this.sequence) return;
                if (!matches.length) {
                    const suggestions = await this.vocabularyTask('suggest', query);
                    if (seq === this.sequence) this.suggestions = suggestions;
                }
                if (query && seq === this.sequence) {
                    this.recent = [query, ...this.recent.filter((q) => q !== query)].slice(0, 10);
                    Flux.write('search-recent', this.recent);
                }
            } catch (e) {
                if (seq === this.sequence && e.name !== 'AbortError')
                    this.error = navigator.onLine
                        ? 'Search unavailable. Try again.'
                        : 'Search is unavailable offline.';
            } finally {
                if (seq === this.sequence) this.isLoading = false;
            }
        },
        // Match worker responses to their pending jobs and enforce a response timeout
        workerCall(type, payload) {
            const id = ++this.workerSequence;
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    this.workerJobs.delete(id);
                    reject(new Error('Search worker timed out'));
                }, 10000);
                this.workerJobs.set(id, {
                    // Cancel the response timeout before resolving the worker job
                    resolve: (value) => {
                        clearTimeout(timer);
                        resolve(value);
                    },
                    // Cancel the response timeout before rejecting the worker job
                    reject: (error) => {
                        clearTimeout(timer);
                        reject(error);
                    },
                });
                try {
                    this.worker.postMessage({ id, type, payload });
                } catch (error) {
                    this.workerJobs.get(id).reject(error);
                    this.workerJobs.delete(id);
                }
            });
        },
        // Reject pending jobs before terminating an unavailable vocabulary worker
        stopWorker() {
            this.worker?.terminate();
            this.worker = null;
            for (const job of this.workerJobs?.values() || [])
                job.reject(new Error('Search worker stopped'));
            this.workerJobs?.clear();
        },
        // Load vocabulary once and prepare a worker or a browser-thread fallback
        async ensureVocabulary() {
            if (!this.vocabularyReady)
                this.vocabularyReady = (async () => {
                    if (!this.legacyVocabulary && !this.vocabulary.length) {
                        const data = await cached(
                            Flux.root + (config.index_path || 'search/') + 'vocabulary.json'
                        );
                        this.vocabulary = data.words;
                    }
                    if (!this.alive) return;
                    if (typeof Worker !== 'undefined') {
                        try {
                            this.worker = new Worker(Flux.asset('js/search-worker.js'));
                            this.workerJobs = new Map();
                            this.worker.onmessage = (event) => {
                                const { id, result, error } = event.data,
                                    job = this.workerJobs.get(id);
                                if (!job) return;
                                this.workerJobs.delete(id);
                                if (error) job.reject(new Error(error));
                                else job.resolve(result);
                            };
                            this.worker.onerror = () => this.stopWorker();
                            await this.workerCall('init', {
                                words: this.vocabulary,
                                core: Flux.asset('js/search-core.js'),
                            });
                        } catch {
                            this.stopWorker();
                        }
                    }
                    if (!this.worker)
                        this.vocabularyFallback = await C.vocabularyIndex(this.vocabulary);
                })().catch((error) => {
                    this.vocabularyReady = null;
                    throw error;
                });
            await this.vocabularyReady;
        },
        // Retry vocabulary work locally if the worker stops responding
        async vocabularyTask(type, payload) {
            await this.ensureVocabulary();
            if (!this.alive) throw new Error('Search closed');
            if (this.worker) {
                try {
                    return await this.workerCall(type, payload);
                } catch {
                    this.stopWorker();
                }
            }
            if (!this.vocabularyFallback)
                this.vocabularyFallback = await C.vocabularyIndex(this.vocabulary);
            return type === 'expand'
                ? C.expand(this.vocabularyFallback, payload)
                : C.indexedSuggestions(this.vocabularyFallback, payload);
        },
        // Download only term shards needed by the expanded query words
        async localIds(terms) {
            const expanded = await this.vocabularyTask('expand', terms);
            return Promise.all(
                terms.map(async (t, i) => {
                    const words = expanded[i],
                        shards = [
                            ...new Set(words.map((w) => (w.codePointAt(0) % 16).toString(16))),
                        ],
                        data = await Promise.all(
                            shards.map((s) =>
                                cached(
                                    Flux.root +
                                        (config.index_path || 'search/') +
                                        'terms-' +
                                        s +
                                        '.json'
                                )
                            )
                        );
                    return new Set(data.flatMap((index) => words.flatMap((w) => index[w] || [])));
                })
            );
        },
        // Read every legacy provider page before intersecting query matches
        async remoteIds(terms, signal) {
            if (config.mode === 'upstash') {
                const u = config.upstash;
                return Promise.all(
                    terms.map(async (term) => {
                        const ids = new Set();
                        let cursor = '0';
                        // Scan empty batches until the provider returns the final cursor
                        do {
                            const rows = await json(u.url.replace(/\/$/, '') + '/pipeline', {
                                method: 'POST',
                                headers: {
                                    Authorization: 'Bearer ' + u.token,
                                    'Content-Type': 'application/json',
                                },
                                body: JSON.stringify([
                                    [
                                        'HSCAN',
                                        (u.index || 'flux') + ':index',
                                        cursor,
                                        'MATCH',
                                        '*' + term + '*',
                                        'COUNT',
                                        1000,
                                    ],
                                ]),
                                signal,
                            });
                            if (rows[0]?.error || !rows[0]?.result)
                                throw new Error('Search unavailable');
                            const [next, fields] = rows[0].result;
                            cursor = String(next);
                            for (let i = 1; i < fields.length; i += 2)
                                for (const id of fields[i].split(',')) ids.add(id);
                        } while (cursor !== '0');
                        return ids;
                    })
                );
            }
            const s = config.supabase,
                sets = terms.map(() => new Set());
            let offset = 0;

            while (true) {
                const p = new URLSearchParams({
                        select: 'word,doc_ids',
                        or: '(' + terms.map((t) => 'word.ilike.*' + t + '*').join(',') + ')',
                        limit: '1000',
                        offset: String(offset),
                        order: 'word.asc',
                    }),
                    rows = await json(
                        s.url.replace(/\/$/, '') +
                            '/rest/v1/' +
                            (s.table || 'flux_search') +
                            '_index?' +
                            p,
                        {
                            headers: s.key?.startsWith('sb_')
                                ? { apikey: s.key }
                                : { apikey: s.key, Authorization: 'Bearer ' + s.key },
                            signal,
                        }
                    );
                if (!Array.isArray(rows)) throw new Error('Search unavailable');
                rows.forEach((row) =>
                    terms.forEach((t, i) => {
                        if (C.normalize(row.word).includes(t))
                            row.doc_ids.forEach((id) => sets[i].add(id));
                    })
                );
                if (rows.length < 1000) break;
                offset += rows.length;
            }
            return sets;
        },
        // Keep provider rankings while fetching complete Turso pages or capped hybrid results
        async nativeIds(query, signal) {
            if (config.mode === 'turso') {
                const t = config.turso,
                    ids = [];
                let offset = 0;

                while (true) {
                    signal.throwIfAborted();
                    const body = await json(t.url + '/v2/pipeline', {
                            method: 'POST',
                            headers: {
                                Authorization: 'Bearer ' + t.read_token,
                                'Content-Type': 'application/json',
                            },
                            body: JSON.stringify({
                                requests: [
                                    {
                                        type: 'execute',
                                        stmt: C.tursoQuery(t.table, query, this, offset),
                                    },
                                    { type: 'close' },
                                ],
                            }),
                            signal,
                        }),
                        rows = C.tursoResults(body);
                    ids.push(...rows);
                    if (rows.length < 500) return ids;
                    offset += rows.length;
                }
            }
            const u = config.upstash_search,
                body = await json(u.url + '/search/' + encodeURIComponent(u.index), {
                    method: 'POST',
                    headers: {
                        Authorization: 'Bearer ' + u.read_token,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        query,
                        topK: u.max_results,
                        includeData: false,
                        includeMetadata: true,
                        filter: C.upstashFilter(this),
                        semanticWeight: u.semantic_weight,
                        reranking: u.reranking,
                        inputEnrichment: u.input_enrichment,
                    }),
                    signal,
                });
            return C.upstashResults(body);
        },
        // Fetch excerpts only for displayed results and discard superseded updates
        async showResults(count, seq = this.sequence, signal = this.controller?.signal) {
            const docs = this.matches.slice(0, count),
                shards = [...new Set(docs.map((d) => d.snippet))],
                snippets = Object.assign(
                    {},
                    ...(await Promise.all(
                        shards.map((s) =>
                            cached(
                                Flux.root +
                                    (config.index_path || 'search/') +
                                    'snippets-' +
                                    s +
                                    '.json'
                            )
                        )
                    ))
                );
            if (seq === this.sequence && !signal?.aborted)
                this.results = docs.map((d) => ({ ...d, excerpt: snippets[d.id] || '' }));
        },
        // Extend visible results without changing the active query or its ordering
        async loadMore() {
            const seq = this.sequence;
            try {
                await this.showResults(this.results.length + 15, seq);
            } catch {
                if (seq === this.sequence) this.error = 'Could not load more results. Try again.';
            }
        },
        // Highlight matching query terms through the shared escaping helper
        highlight(value) {
            return C.highlight(value, this.query);
        },
        // Prefer generated taxonomy links and fall back to filtered search URLs
        topicUrl(result, name, kind = 'tag') {
            const topics = this.topics[result.type],
                links = kind === 'category' ? topics?.category?.[result.url] : topics?.tag;
            if (links && Object.prototype.hasOwnProperty.call(links, name)) return links[name];
            // Older catalogs and playground topics still have a usable filtered listing
            const url = new URL(location.href);
            url.search = '';
            url.hash = '';
            url.searchParams.set('type', result.type);
            url.searchParams.set(kind, name);
            return url.pathname + url.search;
        },
        // Cycle result links with arrow keys and open the selected result on Enter
        keydown(event) {
            if (event.key === 'Escape') {
                event.preventDefault();
                this.clearSearch();
            }
            if (['ArrowDown', 'ArrowUp'].includes(event.key) && this.results.length) {
                event.preventDefault();
                this.active =
                    (this.active + (event.key === 'ArrowDown' ? 1 : -1) + this.results.length) %
                    this.results.length;
                this.$nextTick(() =>
                    this.element
                        .querySelectorAll('.search-result .post-title a')
                        [this.active]?.focus()
                );
            }
            if (
                event.key === 'Enter' &&
                this.active >= 0 &&
                event.target === this.$refs.searchInput
            ) {
                event.preventDefault();
                this.element.querySelectorAll('.search-result .post-title a')[this.active]?.click();
            }
        },
        // Cancel requests, timers, and worker jobs when the search page leaves
        destroy() {
            this.stopWorker();
            this.alive = false;
            ++this.sequence;
            ++this.catalogSequence;
            this.controller?.abort();
            clearTimeout(this.timer);
            this.timer = null;
            this.isWaiting = false;
            this.isLoading = false;
            removeEventListener('popstate', this.pop);
            this.catalogLoading = false;
        },
    }));
});
