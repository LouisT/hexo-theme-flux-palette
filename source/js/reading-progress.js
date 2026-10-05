window.Flux.register('reading-progress', () => {
    Alpine.data('readingProgress', () => ({
        progress: 0,
        // Coalesce scroll and resize updates into a single animation frame
        init() {
            this.update = () => {
                cancelAnimationFrame(this.frame);
                this.frame = requestAnimationFrame(() => this.updateProgress());
            };
            document.addEventListener('scroll', this.update, true);
            addEventListener('resize', this.update);
            this.updateProgress();
        },
        // Clamp progress to the portion of article content that has entered the viewport
        updateProgress() {
            const el = this.$refs.content;
            if (!el) return;
            this.progress = Math.max(
                0,
                Math.min(
                    100,
                    ((innerHeight - el.getBoundingClientRect().top) /
                        Math.max(1, el.offsetHeight)) *
                        100
                )
            );
        },
        // Cancel pending frames and remove progress listeners on navigation
        destroy() {
            cancelAnimationFrame(this.frame);
            document.removeEventListener('scroll', this.update, true);
            removeEventListener('resize', this.update);
        },
    }));
});
