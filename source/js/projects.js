window.Flux.register('projects', () => {
    Alpine.data('projectFilters', () => ({
        tag: '',
        category: '',
        status: '',
        current: 1,
        perPage: 10,
        cards: [],
        total: 0,
        enhanced: false,
        base: '',
        hash: null,
        // Restore URL filters and enhance the existing project cards with pagination
        init() {
            this.cards = [...this.$el.querySelectorAll('[data-project-card]')];
            this.perPage = Number(this.$el.dataset.perPage) || this.cards.length || 10;
            this.base = this.$el.dataset.paginationBase || '';
            const p = new URLSearchParams(location.search);

            for (const k of ['tag', 'category', 'status']) this[k] = p.get('project_' + k) || '';
            this.current =
                Number(this.base ? this.$el.dataset.current : p.get('project_page')) || 1;
            for (const k of ['tag', 'category', 'status'])
                this.$watch(k, () => {
                    this.current = 1;
                    this.update();
                });
            this.$watch('current', () => this.update());
            this.update();
            this.enhanced = true;
            this.hash = () => this.reveal();
            addEventListener('hashchange', this.hash);
            this.reveal();
        },
        // List unique tags from the rendered project cards
        get tags() {
            return [...new Set(this.cards.flatMap((c) => JSON.parse(c.dataset.tags)))].sort();
        },
        // List nonempty project categories in alphabetical order
        get categories() {
            return [...new Set(this.cards.map((c) => c.dataset.category).filter(Boolean))].sort();
        },
        // List nonempty project statuses in alphabetical order
        get statuses() {
            return [...new Set(this.cards.map((c) => c.dataset.status).filter(Boolean))].sort();
        },
        // Count pages after applying the current project filters
        get pages() {
            return Math.ceil(this.total / this.perPage);
        },
        // Build pagination controls around the current project page
        get pageItems() {
            return FluxPagination.items(this.current, this.pages);
        },
        // Preserve filters when building static or in-page pagination URLs
        pageHref(number) {
            const url = new URL(location.href);
            if (this.base) url.pathname = FluxPagination.path(this.base, number);
            else if (number > 1) url.searchParams.set('project_page', number);
            else url.searchParams.delete('project_page');
            for (const k of ['tag', 'category', 'status']) {
                if (this[k]) url.searchParams.set('project_' + k, this[k]);
                else url.searchParams.delete('project_' + k);
            }
            return url.pathname + url.search + url.hash;
        },
        // Use in-page paging only for listings without generated page routes
        goTo(number, event) {
            if (number < 1 || number > this.pages) {
                event.preventDefault();
                return;
            }
            if (
                event.metaKey ||
                event.ctrlKey ||
                event.shiftKey ||
                event.altKey ||
                event.button > 0
            )
                return;
            if (number === this.current) {
                event.preventDefault();
                return;
            }
            // Generated listing routes use normal navigation and browser history
            if (this.base) return;
            event.preventDefault();
            this.current = number;
            this.$nextTick(() => this.$el.scrollIntoView({ block: 'start', behavior: 'instant' }));
        },
        // Filter cards before clamping the page and synchronizing the URL
        update() {
            const cards = this.cards.filter(
                (c) =>
                    (!this.tag || JSON.parse(c.dataset.tags).includes(this.tag)) &&
                    (!this.category || c.dataset.category === this.category) &&
                    (!this.status || c.dataset.status === this.status)
            );
            this.total = cards.length;
            this.current = Math.max(1, Math.min(this.current, this.pages || 1));
            this.cards.forEach((c) => (c.hidden = true));
            cards
                .slice((this.current - 1) * this.perPage, this.current * this.perPage)
                .forEach((c) => (c.hidden = false));
            if (!Flux.manifest.playground) {
                history.replaceState(history.state, '', this.pageHref(this.current));
            }
        },
        // Clear project filters and return the listing to its first page
        clear() {
            this.tag = '';
            this.category = '';
            this.status = '';
            this.current = 1;
            this.update();
        },
        // Clear filters and reveal the page containing a linked project card
        reveal() {
            try {
                const target = document.getElementById(decodeURIComponent(location.hash.slice(1))),
                    index = this.cards.indexOf(target);
                if (index >= 0) {
                    this.tag = '';
                    this.category = '';
                    this.status = '';
                    this.$nextTick(() => {
                        this.current = Math.floor(index / this.perPage) + 1;
                        this.update();
                        this.$nextTick(() =>
                            target.scrollIntoView({ behavior: Flux.reduced() ? 'instant' : 'auto' })
                        );
                    });
                }
            } catch {}
        },
        // Remove project reveal listeners after navigation
        destroy() {
            removeEventListener('hashchange', this.hash);
        },
    }));
});
