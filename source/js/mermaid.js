window.Flux.register('mermaid', () => {
    let serial = 0,
        queue = Promise.resolve();
    // Resolve CSS palette colors into hexadecimal bytes accepted by Mermaid
    const color = (styles, name, fallback) => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1;
        const context = canvas.getContext('2d');
        context.fillStyle = fallback;
        context.fillStyle = styles.getPropertyValue(name).trim() || fallback;
        context.fillRect(0, 0, 1, 1);
        return (
            '#' +
            [...context.getImageData(0, 0, 1, 1).data]
                .slice(0, 3)
                .map((value) => value.toString(16).padStart(2, '0'))
                .join('')
        );
    };
    Alpine.data('richMermaid', () => ({
        element: null,
        output: null,
        status: null,
        details: null,
        source: '',
        alive: false,
        generation: 0,
        started: false,
        palette: null,
        reveal: null,
        observer: null,
        // Read diagram source and rerender when palette or visibility changes
        init() {
            this.element = this.$el;
            this.output = this.element.querySelector('.rich-mermaid-output');
            this.status = this.element.querySelector('.rich-mermaid-status');
            this.details = this.element.querySelector('details');
            this.source = this.details.querySelector('code').textContent;
            this.alive = true;
            this.generation = 0;
            this.palette = () => this.render();
            this.reveal = () => {
                if (!this.started && this.element.getBoundingClientRect().width) this.render();
            };
            addEventListener('flux:palette', this.palette);
            this.observer = new ResizeObserver(this.reveal);
            this.observer.observe(this.element);
            this.render();
        },
        // Serialize Mermaid rendering and discard obsolete results after navigation
        render() {
            if (!this.element.getBoundingClientRect().width) return;
            this.started = true;
            const generation = ++this.generation;
            this.status.hidden = false;
            this.status.textContent = 'Rendering diagram…';
            // Queue diagrams because Mermaid shares its rendering configuration
            queue = queue
                .catch(() => {})
                .then(async () => {
                    try {
                        await Flux.load('vendor/mermaid');
                        if (
                            !this.alive ||
                            generation !== this.generation ||
                            !this.element.getBoundingClientRect().width
                        )
                            return;
                        const styles = getComputedStyle(document.documentElement),
                            mermaid = window.FluxMermaid;
                        mermaid.initialize({
                            startOnLoad: false,
                            securityLevel: 'strict',
                            suppressErrorRendering: true,
                            theme: 'base',
                            fontFamily: getComputedStyle(this.element).fontFamily,
                            themeVariables: {
                                primaryColor: color(styles, '--bg-card', '#eeeeee'),
                                primaryTextColor: color(styles, '--text', '#222222'),
                                primaryBorderColor: color(styles, '--accent', '#777777'),
                                lineColor: color(styles, '--text', '#222222'),
                                textColor: color(styles, '--text', '#222222'),
                                background: color(styles, '--bg', '#ffffff'),
                            },
                        });
                        const result = await mermaid.render(
                            'rich-diagram-' + ++serial,
                            this.source
                        );
                        if (!this.alive || generation !== this.generation) return;
                        const first = !this.output.querySelector('svg');
                        this.output.innerHTML = result.svg;
                        this.status.hidden = true;
                        if (first) this.details.open = false;
                    } catch {
                        if (!this.alive || generation !== this.generation) return;
                        this.status.textContent =
                            'Diagram could not be rendered. The source is available below.';
                        this.status.hidden = false;
                        this.details.open = true;
                    }
                });
        },
        // Invalidate pending diagram renders and remove observers after navigation
        destroy() {
            this.alive = false;
            this.generation++;
            this.observer.disconnect();
            removeEventListener('flux:palette', this.palette);
            this.output.replaceChildren();
        },
    }));
});
