window.Flux.register('curated', () => {
    Alpine.data('curatedCarousel', () => ({
        track: null,
        cards: [],
        controls: null,
        atStart: true,
        atEnd: true,
        position: '',
        frame: null,
        update: null,
        observer: null,
        // Track each section independently and update controls after scrolling or resizing
        init() {
            this.track = this.$refs.track;
            this.cards = [...this.track.children];
            this.controls = this.$refs.controls;
            this.update = () => {
                cancelAnimationFrame(this.frame);
                this.frame = requestAnimationFrame(() => this.sync());
            };
            this.track.addEventListener('scroll', this.update, { passive: true });
            this.observer = new ResizeObserver(this.update);
            this.observer.observe(this.track);
            this.$nextTick(() => this.sync());
        },
        // Match arrow availability and visible item counts to the current viewport
        sync() {
            const maximum = this.track.scrollWidth - this.track.clientWidth,
                overflow = maximum > 1,
                viewport = this.track.getBoundingClientRect(),
                visible = this.cards
                    .map((card, index) => ({ bounds: card.getBoundingClientRect(), index }))
                    .filter(
                        ({ bounds }) =>
                            bounds.right > viewport.left + 1 && bounds.left < viewport.right - 1
                    );
            this.atStart = this.track.scrollLeft <= 1;
            this.atEnd = this.track.scrollLeft >= maximum - 1;
            this.controls.hidden = !overflow;
            this.track.tabIndex = overflow ? 0 : -1;
            if (visible.length)
                this.position = `${visible[0].index + 1}–${visible.at(-1).index + 1} of ${this.cards.length}`;
        },
        // Move by the number of complete cards that fit in the current viewport
        move(direction) {
            const width = this.cards[0].getBoundingClientRect().width,
                gap = parseFloat(getComputedStyle(this.track).columnGap) || 0,
                stride = width + gap,
                count = Math.max(1, Math.floor((this.track.clientWidth + gap) / stride));
            this.scroll(this.track.scrollLeft + direction * stride * count);
        },
        // Clamp scrolling to the available cards and respect reduced motion preferences
        scroll(left) {
            this.track.scrollTo({
                left: Math.max(0, Math.min(left, this.track.scrollWidth - this.track.clientWidth)),
                behavior: Flux.reduced() ? 'instant' : 'smooth',
            });
        },
        // Support arrow and endpoint keys while leaving card link keyboard behavior native
        key(event) {
            if (event.target !== this.track) return;
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            if (event.key === 'Home') this.scroll(0);
            else if (event.key === 'End') this.scroll(this.track.scrollWidth);
            else this.move(event.key === 'ArrowRight' ? 1 : -1);
        },
        // Remove observers and pending updates when navigation replaces the homepage
        destroy() {
            cancelAnimationFrame(this.frame);
            this.track.removeEventListener('scroll', this.update);
            this.observer.disconnect();
        },
    }));
});
