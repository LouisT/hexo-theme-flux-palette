window.Flux.register('sidebar', () => {
    Alpine.data('sidebarSection', (id) => ({
        id,
        open: Flux.read('sidebar-' + id, true),
        // Persist disclosure state independently for each sidebar section
        init() {
            this.$watch('open', (value) => Flux.write('sidebar-' + id, value));
        },
        // Toggle the responsive sidebar from its navigation control
        toggle() {
            this.open = !this.open;
        },
    }));
});
