window.Flux.register('link-previews', () => {
    const mime = (response) =>
            (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase(),
        isHtml = (response) =>
            response.ok &&
            ['text/html', 'application/xhtml+xml'].includes(mime(response)) &&
            !/^\s*attachment(?:\s*;|\s*$)/i.test(response.headers.get('content-disposition') || '');
    Alpine.data('linkPreview', () => ({
        show: false,
        title: '',
        summary: '',
        pos: { x: 0, y: 0 },
        cache: new Map(),
        pending: new Map(),
        links: new WeakSet(),
        controller: null,
        observer: null,
        lockHandler: null,
        requestId: 0,
        activeKey: null,
        // Discover links again when protected content is inserted after unlocking
        init() {
            this.controller = new AbortController();
            this.attachLinks();
            this.observer = new MutationObserver(() => this.attachLinks());
            document
                .querySelectorAll('.post-content')
                .forEach((element) =>
                    this.observer.observe(element, { childList: true, subtree: true })
                );
            this.lockHandler = () => {
                this.requestId++;
                this.activeKey = null;
                this.show = false;
            };
            addEventListener('flux:lock', this.lockHandler, { signal: this.controller.signal });
        },
        // Attach hover handlers once per eligible content link
        attachLinks() {
            document.querySelectorAll('.post-content a[href]').forEach((link) => {
                if (
                    this.links.has(link) ||
                    link.hasAttribute('download') ||
                    link.hasAttribute('data-flux-no-preview') ||
                    link.closest('.rich-download')
                )
                    return;
                const target = this.target(link);
                if (!target) return;
                this.links.add(link);
                link.addEventListener('mouseenter', (e) => this.handleEnter(e, target), {
                    signal: this.controller.signal,
                });
                link.addEventListener(
                    'mouseleave',
                    () => {
                        this.requestId++;
                        this.activeKey = null;
                        this.show = false;
                    },
                    { signal: this.controller.signal }
                );
            });
        },
        // Resolve preview metadata URLs while excluding downloads and unsupported links
        target(link) {
            const href = link.getAttribute('href'),
                authoredPreview = link.getAttribute('data-flux-preview');
            if (!href || href.startsWith('#')) return null;
            try {
                const url = new URL(href, location.href),
                    root = Flux.root,
                    known = Boolean(authoredPreview);
                // Build annotations also work on an alternate hostname serving this site
                if (!known && (url.origin !== location.origin || !url.pathname.startsWith(root)))
                    return null;
                let preview = authoredPreview;
                if (!preview) {
                    let path = url.pathname.slice(root.length);
                    if (/\.html$/i.test(path))
                        path =
                            path === 'default.html'
                                ? 'default.html.json'
                                : path.replace(/\.html$/i, '.json');
                    else if (!/\.[^/]+$/.test(path))
                        path = path ? path.replace(/\/?$/, '/') + 'index.json' : 'index.json';
                    else path = null;
                    if (path !== null) preview = root + 'link-previews/' + path;
                }
                if (preview) {
                    const metadata = new URL(preview, location.href);
                    if (
                        metadata.origin !== location.origin ||
                        !metadata.pathname.startsWith(root + 'link-previews/')
                    )
                        return null;
                    preview = metadata.href;
                }
                url.hash = '';
                return { url: url.href, preview, known, key: known ? preview : url.href };
            } catch {
                return null;
            }
        },
        // Share pending requests and cache metadata without retaining page HTML
        async handleEnter(e, target) {
            const requestId = ++this.requestId;
            this.activeKey = target.key;
            this.pos = { x: e.clientX, y: e.clientY + 20 };
            this.show = false;
            this.title = '';
            this.summary = '';
            if (this.cache.has(target.key)) {
                this.updateContent(this.cache.get(target.key));
                return;
            }
            try {
                if (!this.pending.has(target.key))
                    this.pending.set(
                        target.key,
                        this.loadPreview(target).finally(() => this.pending.delete(target.key))
                    );
                const data = await this.pending.get(target.key);
                if (this.requestId === requestId) this.updateContent(data);
            } catch {
                if (this.requestId === requestId) this.show = false;
            }
        },
        // Load generated metadata or check unknown destinations with an HTML-only HEAD probe
        async loadPreview(target) {
            const options = { signal: this.controller.signal };
            if (target.preview) {
                const response = await fetch(target.preview, options);
                if (response.ok && mime(response) === 'application/json') {
                    let data;
                    try {
                        data = await response.json();
                    } catch (error) {
                        if (error.name !== 'SyntaxError') throw error;
                    }
                    if (
                        data?.version === 1 &&
                        typeof data.title === 'string' &&
                        data.title.trim() &&
                        typeof data.summary === 'string'
                    ) {
                        const metadata = { title: data.title, summary: data.summary };
                        this.cache.set(target.key, metadata);
                        return metadata;
                    }
                } else await response.body?.cancel();
                // A generated link never falls back to downloading its HTML page
                if (target.known) {
                    if (response.ok || [404, 410].includes(response.status)) {
                        const data = await this.loadDefault();
                        this.cache.set(target.key, data);
                        return data;
                    }
                    return null;
                }
            }
            if (this.activeKey !== target.key) return null;
            // Unknown destinations retain HEAD-first HTML detection
            const head = await fetch(target.url, { ...options, method: 'HEAD' });
            if (!isHtml(head)) {
                if (head.ok || [405, 501].includes(head.status)) this.cache.set(target.key, null);
                return null;
            }
            if (this.activeKey !== target.key) return null;
            const data = await this.loadDefault();
            this.cache.set(target.key, data);
            return data;
        },
        // Share validated fallback metadata across missing preview requests
        async loadDefault() {
            const url = new URL(Flux.root + 'link-previews/default.json', location.href).href;
            if (this.cache.has(url)) return this.cache.get(url);
            if (!this.pending.has(url))
                this.pending.set(
                    url,
                    (async () => {
                        try {
                            const response = await fetch(url, { signal: this.controller.signal });
                            if (!response.ok || mime(response) !== 'application/json') {
                                await response.body?.cancel();
                                return null;
                            }
                            const data = await response.json();
                            if (
                                data?.version !== 1 ||
                                typeof data.title !== 'string' ||
                                !data.title.trim() ||
                                typeof data.summary !== 'string'
                            )
                                return null;
                            const metadata = { title: data.title, summary: data.summary };
                            this.cache.set(url, metadata);
                            return metadata;
                        } finally {
                            this.pending.delete(url);
                        }
                    })()
                );
            return this.pending.get(url);
        },
        // Remove observers, handlers, and pending requests when navigating away
        destroy() {
            this.requestId++;
            this.activeKey = null;
            this.observer?.disconnect();
            this.controller?.abort();
            this.pending.clear();
        },
        // Fill or hide the tooltip from validated preview metadata
        updateContent(data) {
            this.show = !!data;
            this.title = data?.title || '';
            this.summary = data?.summary || '';
        },
    }));
});
