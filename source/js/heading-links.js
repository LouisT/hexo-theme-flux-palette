window.Flux.register('heading-links', () => {
    Alpine.data('headingLink', () => ({
        message: '',
        link: '',
        manual: false,
        alive: true,
        sequence: 0,
        timer: null,
        fadeTimer: null,
        focusFrame: null,
        anchor: null,
        legacyClick: null,
        legacyElement: null,
        feedbackElement: null,
        // Adapt legacy heading markup to the current copy-link controls
        init() {
            this.feedbackElement = this.$el.querySelector('.heading-link-feedback');
            // Unchanged Hexo posts and older encrypted payloads can retain the previous markup
            if (this.$el.classList.contains('heading-copy')) {
                this.anchor = this.$el.closest('h1,h2,h3,h4,h5,h6').querySelector('.headerlink');
                this.legacyClick = (event) => this.copy(event);
                this.anchor?.addEventListener('click', this.legacyClick);
                this.$el.querySelector('button')?.remove();
                this.$el.classList.replace('heading-copy', 'heading-link-legacy');
                this.legacyElement = this.$el;
                this.feedbackElement = this.legacyElement;
                this.legacyElement.style.display = 'none';
                this.$watch('message', (message) => {
                    this.legacyElement.style.display = message ? 'inline-block' : 'none';
                });
            }
        },
        // Copy the heading URL or offer a selectable fallback when clipboard access fails
        async copy(event) {
            if (
                event &&
                (event.button > 0 ||
                    event.metaKey ||
                    event.ctrlKey ||
                    event.shiftKey ||
                    event.altKey)
            )
                return;
            const sequence = ++this.sequence;
            this.clearFeedback();
            const id = this.$el.closest('h1,h2,h3,h4,h5,h6').id,
                url = new URL(location.href);
            url.hash = id;
            this.link = url.href;
            try {
                await navigator.clipboard.writeText(this.link);
                if (!this.alive || sequence !== this.sequence) return;
                this.message = 'Link copied';
            } catch {
                if (!this.alive || sequence !== this.sequence) return;
                this.message = 'Copy this link:';
                this.manual = true;
                this.$nextTick(() => {
                    if (!this.alive || sequence !== this.sequence) return;
                    this.focusFrame = requestAnimationFrame(() => {
                        this.focusFrame = null;
                        if (!this.alive || sequence !== this.sequence) return;
                        this.$refs.fallback?.focus({ preventScroll: true });
                        this.$refs.fallback?.select();
                    });
                });
            }
            if (this.manual) return;
            this.timer = setTimeout(() => {
                if (!this.alive || sequence !== this.sequence) return;
                this.feedbackElement?.classList.add('is-fading');
                this.fadeTimer = setTimeout(() => {
                    if (this.alive && sequence === this.sequence) this.clearFeedback();
                }, 200);
            }, 3000);
        },
        // Cancel pending feedback transitions before resetting the copy state
        clearFeedback() {
            clearTimeout(this.timer);
            clearTimeout(this.fadeTimer);
            cancelAnimationFrame(this.focusFrame);
            this.timer = null;
            this.fadeTimer = null;
            this.focusFrame = null;
            this.feedbackElement?.classList.remove('is-fading');
            this.message = '';
            this.link = '';
            this.manual = false;
        },
        // Invalidate pending clipboard work and return focus to the heading link
        dismiss() {
            ++this.sequence;
            this.clearFeedback();
            (this.$refs.anchor || this.anchor)?.focus({ preventScroll: true });
        },
        // Discard delayed clipboard feedback and remove legacy click handlers
        destroy() {
            this.alive = false;
            ++this.sequence;
            this.clearFeedback();
            this.anchor?.removeEventListener('click', this.legacyClick);
        },
    }));
});
