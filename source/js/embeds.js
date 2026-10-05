window.Flux.register('embeds', () => {
    Alpine.data('deferredEmbed', () => ({
        loaded: false,
        message: '',
        // Declare instance state so Alpine does not assign it to an ancestor's scope
        element: null,
        target: null,
        network: null,
        // Reset activated embeds when connectivity is lost
        init() {
            this.element = this.$el;
            this.target = this.element.querySelector('[x-ref="target"]');
            this.network = () => {
                if (!navigator.onLine) {
                    this.message = 'This embed needs an internet connection.';
                    this.target.replaceChildren();
                    this.loaded = false;
                } else this.message = '';
            };
            addEventListener('online', this.network);
            addEventListener('offline', this.network);
            this.network();
        },
        // Load provider markup only after the visitor requests the embed
        activate() {
            if (this.loaded) return;
            if (!navigator.onLine) {
                this.message = 'This embed needs an internet connection.';
                return;
            }
            const template = this.element.querySelector('template[data-embed-html]'),
                provider = this.element.dataset.fluxEmbed;
            if (!template || !this.target) {
                this.message = 'This embed could not be loaded. Use the provider link to open it.';
                return;
            }
            // Isolate script-based providers in a sandboxed iframe
            if (['gist', 'tiktok'].includes(provider)) {
                const iframe = document.createElement('iframe');
                iframe.title = provider + ' embed';
                iframe.className = 'script-embed-frame';
                iframe.setAttribute('sandbox', 'allow-scripts allow-popups');
                iframe.srcdoc =
                    '<!doctype html><meta charset="utf-8"><base href="https://' +
                    (provider === 'gist' ? 'gist.github.com' : 'www.tiktok.com') +
                    '/"><style>body{margin:0}iframe{max-width:100%}</style>' +
                    template.innerHTML;
                this.target.appendChild(iframe);
            } else this.target.appendChild(template.content.cloneNode(true));
            this.loaded = true;
            this.message = '';
        },
        // Remove embedded content and network listeners when the page leaves
        destroy() {
            removeEventListener('online', this.network);
            removeEventListener('offline', this.network);
            this.target?.replaceChildren();
        },
    }));
});
