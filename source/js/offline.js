window.Flux.register('offline', () => {
    let registration,
        failure = '';
    // Register downloads only when the site scope has no competing service worker
    const ready = (async () => {
        try {
            if (!('serviceWorker' in navigator) || !window.isSecureContext)
                throw new Error('Offline downloads are unavailable in this browser or connection.');
            const scope = new URL(Flux.root, location.origin).href,
                existing = await navigator.serviceWorker.getRegistration(scope);
            if (
                existing &&
                existing.scope === scope &&
                ![existing.active, existing.waiting, existing.installing]
                    .filter(Boolean)
                    .every((w) => w.scriptURL === scope + 'flux-sw.js')
            )
                throw new Error(
                    'This site uses another offline application. Downloads are unavailable.'
                );
            registration = await navigator.serviceWorker.register(Flux.root + 'flux-sw.js', {
                scope: Flux.root,
            });
            await navigator.serviceWorker.ready;
            Flux.emit('downloads');
            return registration;
        } catch (e) {
            failure = e.message;
            throw e;
        }
    })();
    ready.catch(() => {});

    // Send worker requests through a dedicated channel with progress and timeout handling
    function send(action, url, progress) {
        return ready.then(
            () =>
                new Promise((resolve, reject) => {
                    const channel = new MessageChannel(),
                        id = Math.random().toString(36).slice(2),
                        timer = setTimeout(() => {
                            channel.port1.close();
                            reject(new Error('Offline operation timed out. Try again.'));
                        }, 120000);
                    channel.port1.onmessage = (event) => {
                        const data = event.data;
                        if ('progress' in data) {
                            progress?.(data.progress);
                            return;
                        }
                        clearTimeout(timer);
                        channel.port1.close();
                        if (data.error) reject(new Error(data.error));
                        else {
                            resolve(data.value);
                            if (action !== 'list') Flux.emit('downloads');
                        }
                    };
                    const worker = registration.active || navigator.serviceWorker.controller;
                    if (!worker) {
                        clearTimeout(timer);
                        reject(new Error('Offline downloads are not ready. Try again.'));
                        return;
                    }
                    worker.postMessage({ id, action, url }, [channel.port2]);
                })
        );
    }

    Flux.offline = {
        list: () => send('list'),
        remove: (url) => send('remove', url),
        clear: () => send('clear'),
    };
    const reconcile = () =>
        send('list')
            .then(() => Flux.emit('downloads'))
            .catch(() => {});
    ready.then(reconcile).catch(() => {});
    addEventListener('online', reconcile);
    Alpine.data('offlineArticle', () => ({
        busy: false,
        saved: false,
        message: '',
        alive: true,
        // Restore download status for the current article
        async init() {
            try {
                const items = await send('list');
                if (this.alive) this.saved = items.some((d) => d.url === Flux.manifest.article.url);
            } catch (e) {
                if (this.alive) this.message = e.message;
            }
        },
        // Report download progress while preventing duplicate save operations
        async save() {
            if (this.busy) return;
            this.busy = true;
            this.message = 'Preparing download…';
            try {
                await send('save', Flux.manifest.article.url, (n) => {
                    if (this.alive) this.message = 'Downloading ' + n + '%';
                });
                if (this.alive) {
                    this.saved = true;
                    this.message = 'Saved for offline reading.';
                }
            } catch (e) {
                if (this.alive) this.message = e.message;
            } finally {
                if (this.alive) this.busy = false;
            }
        },
        // Remove the current download and update controls only while the component is alive
        async remove() {
            if (this.busy) return;
            this.busy = true;
            try {
                await send('remove', Flux.manifest.article.url);
                if (this.alive) {
                    this.saved = false;
                    this.message = 'Download removed.';
                }
            } catch (e) {
                if (this.alive) this.message = e.message;
            } finally {
                if (this.alive) this.busy = false;
            }
        },
        // Remove download update listeners when the article control leaves
        destroy() {
            this.alive = false;
        },
    }));

    // Explain unavailable remote images while the browser is offline
    function placeholders() {
        document.querySelectorAll('.post-content img').forEach((img) => {
            try {
                if (
                    new URL(img.dataset.originalSrc || img.src, location.href).origin !==
                    location.origin
                ) {
                    img.classList.toggle('offline-image', !navigator.onLine);
                    const existing = img.nextElementSibling?.classList.contains(
                        'offline-media-placeholder'
                    )
                        ? img.nextElementSibling
                        : null;
                    if (!navigator.onLine && !existing) {
                        const notice = document.createElement('span');
                        notice.className = 'offline-media-placeholder';
                        notice.textContent = (img.alt || 'Image') + ' (available online)';
                        img.after(notice);
                    } else if (navigator.onLine) existing?.remove();
                }
            } catch {}
        });
    }

    addEventListener('offline', placeholders);
    addEventListener('online', placeholders);
    addEventListener('flux:page', placeholders);
    placeholders();
});
