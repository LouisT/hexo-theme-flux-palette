window.Flux.register('comments', () => {
    Alpine.data('commentTheme', () => ({
        offline: !navigator.onLine,
        element: null,
        update: null,
        network: null,
        ready: null,
        observer: null,
        script: null,
        frame: null,
        frameLoad: null,
        frameUrl: '',
        frameReady: false,
        // Track comment iframe readiness and synchronize palette and network changes
        init() {
            this.element = this.$el;
            this.update = () => this.sync();
            this.network = () => {
                this.offline = !navigator.onLine;
                if (!this.offline) this.load();
            };
            addEventListener('flux:palette', this.update);
            addEventListener('online', this.network);
            addEventListener('offline', this.network);
            this.frameLoad = () => {
                // A newly inserted frame still has the parent's about:blank origin
                if (!this.frame?.src || this.frame.contentDocument?.URL === 'about:blank') return;
                this.frameReady = true;
                this.sync();
            };
            this.ready = () => {
                const frame = this.element.querySelector('iframe');
                if (frame !== this.frame || (frame?.src || '') !== this.frameUrl) {
                    this.frame?.removeEventListener('load', this.frameLoad);
                    this.frame = frame;
                    this.frameUrl = frame?.src || '';
                    this.frameReady = false;
                    frame?.addEventListener('load', this.frameLoad);
                    if (frame?.contentDocument === null) this.frameLoad();
                }
            };
            this.observer = new MutationObserver(this.ready);
            this.observer.observe(this.element, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['src'],
            });
            this.load();
            this.ready();
            this.sync();
        },
        // Insert the provider script once the browser has a connection
        load() {
            if (this.offline || this.script) return;
            const source = this.element
                .querySelector('template[data-comment-script]')
                ?.content.querySelector('script');
            if (!source) return;
            this.script = document.createElement('script');
            for (const attr of source.attributes) this.script.setAttribute(attr.name, attr.value);
            this.element.appendChild(this.script);
        },
        // Send palette updates only to supported providers after their iframe loads
        sync() {
            if (!this.frameReady || this.offline || !Flux.manifest.comments.sync) return;
            const dark =
                    document.documentElement.dataset.mode === 'dark' ||
                    (!document.documentElement.dataset.mode &&
                        matchMedia('(prefers-color-scheme:dark)').matches),
                frame = this.frame;
            if (!frame) return;
            let origin;
            try {
                origin = new URL(frame.src).origin;
            } catch {
                return;
            }
            if (origin === 'https://giscus.app')
                frame.contentWindow.postMessage(
                    { giscus: { setConfig: { theme: dark ? 'dark' : 'light' } } },
                    origin
                );
            if (origin === 'https://utteranc.es')
                frame.contentWindow.postMessage(
                    { type: 'set-theme', theme: dark ? 'github-dark' : 'github-light' },
                    origin
                );
        },
        // Remove provider frames, observers, and listeners when leaving the article
        destroy() {
            this.observer?.disconnect();
            this.frame?.removeEventListener('load', this.frameLoad);
            this.script?.remove();
            this.frame?.remove();
            removeEventListener('flux:palette', this.update);
            removeEventListener('online', this.network);
            removeEventListener('offline', this.network);
        },
    }));
});
