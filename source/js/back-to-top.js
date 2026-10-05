window.Flux.register('back-to-top', () => {
    Alpine.data('backToTop', () => ({
        show: false,
        // Show the control after the reader scrolls down
        init() {
            this.scroll = () => (this.show = Flux.scrollTop() > 300);
            document.addEventListener('scroll', this.scroll, true);
            this.scroll();
        },
        // Return the active scroll container to the top through the shared runtime
        scrollToTop() {
            Flux.scrollTo(0);
        },
        // Remove the shared scroll listener when the component leaves
        destroy() {
            document.removeEventListener('scroll', this.scroll, true);
        },
    }));
});
