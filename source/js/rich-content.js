window.Flux.register('rich-content', () => {
    let sequence = 0;
    Alpine.data('richProgress', () => ({
        element: null,
        inputs: [],
        defaults: [],
        revision: '',
        private: false,
        name: '',
        tools: null,
        change: null,
        reset: null,
        // Restore valid public progress and connect completion and reset controls
        init() {
            this.element = this.$el;
            this.inputs = [...this.element.querySelectorAll('[data-rich-check]')].filter(
                (input) => input.closest('[data-rich-progress]') === this.element
            );
            this.defaults = this.inputs.map((input) => input.hasAttribute('checked'));
            this.revision = this.element.dataset.richRevision;
            this.private = this.element.dataset.richPrivate === 'true';
            this.name = `rich-progress:${location.pathname}:${this.element.dataset.richProgress}`;
            // Restore saved checks only when the authored revision and item shape match
            const saved = this.private ? null : Flux.read(this.name, {}),
                valid =
                    saved?.revision === this.revision &&
                    Array.isArray(saved.items) &&
                    saved.items.length === this.inputs.length &&
                    saved.items.every((value) => typeof value === 'boolean');
            this.inputs.forEach((input, index) => {
                input.disabled = false;
                input.checked = valid ? saved.items[index] : this.defaults[index];
            });
            this.tools = this.element.querySelector(':scope > .rich-progress-tools');
            this.tools.hidden = false;
            this.change = (event) => {
                if (this.inputs.includes(event.target)) this.sync(true);
            };
            this.reset = () => {
                this.inputs.forEach((input, index) => {
                    input.checked = this.defaults[index];
                });
                this.sync(true);
            };
            this.element.addEventListener('change', this.change);
            this.tools.querySelector('button').addEventListener('click', this.reset);
            this.sync(false);
        },
        // Update completion counts and persist progress only for public content
        sync(save) {
            const items = this.inputs.map((input) => input.checked);
            this.tools.querySelector('.rich-progress-count').textContent =
                `${items.filter(Boolean).length} of ${items.length} complete`;
            this.inputs.forEach((input) =>
                input.closest('li').classList.toggle('rich-complete', input.checked)
            );
            if (save && !this.private) Flux.write(this.name, { revision: this.revision, items });
        },
        // Remove progress controls when their article leaves
        destroy() {
            this.element.removeEventListener('change', this.change);
            this.tools.querySelector('button').removeEventListener('click', this.reset);
        },
    }));
    Alpine.data('richImageCompare', () => ({
        element: null,
        stage: null,
        input: null,
        before: null,
        dragging: false,
        update: null,
        dimensions: null,
        move: null,
        down: null,
        up: null,
        // Connect comparison controls and preserve the first image aspect ratio
        init() {
            this.element = this.$el;
            this.stage = this.element.querySelector('.rich-image-stage');
            this.input = this.element.querySelector('input');
            this.before = this.element.querySelector('.rich-before');
            this.element.classList.add('rich-enhanced');
            this.input.disabled = false;
            this.update = () => {
                this.stage.style.setProperty('--compare-position', this.input.value + '%');
                this.input.setAttribute(
                    'aria-valuetext',
                    `${this.input.value}% before, ${100 - this.input.value}% after`
                );
            };
            this.dimensions = () => {
                if (this.before.naturalWidth > 1)
                    this.stage.style.aspectRatio = `${this.before.naturalWidth} / ${this.before.naturalHeight}`;
            };
            this.move = (event) => {
                if (!this.dragging) return;
                const bounds = this.stage.getBoundingClientRect();
                // Clamp pointer movement to the image bounds before updating the slider
                this.input.value = Math.round(
                    Math.max(0, Math.min(100, ((event.clientX - bounds.left) / bounds.width) * 100))
                );
                this.update();
            };
            this.down = (event) => {
                if (event.button !== 0) return;
                this.dragging = true;
                // Continue dragging when the pointer leaves the image bounds
                this.stage.setPointerCapture(event.pointerId);
                this.input.focus({ preventScroll: true });
                this.move(event);
            };
            this.up = () => {
                this.dragging = false;
            };
            this.input.addEventListener('input', this.update);
            this.before.addEventListener('load', this.dimensions);
            this.stage.addEventListener('pointerdown', this.down);
            this.stage.addEventListener('pointermove', this.move);
            this.stage.addEventListener('pointerup', this.up);
            this.stage.addEventListener('pointercancel', this.up);
            this.dimensions();
            this.update();
        },
        // Remove comparison input, image, and pointer listeners after navigation
        destroy() {
            this.input.removeEventListener('input', this.update);
            this.before.removeEventListener('load', this.dimensions);
            for (const [event, fn] of [
                ['pointerdown', this.down],
                ['pointermove', this.move],
                ['pointerup', this.up],
                ['pointercancel', this.up],
            ])
                this.stage.removeEventListener(event, fn);
        },
    }));
    Alpine.data('richTerm', () => ({
        element: null,
        button: null,
        definition: null,
        show: null,
        hide: null,
        outside: null,
        key: null,
        // Connect glossary focus and dismissal controls with a unique description ID
        init() {
            this.element = this.$el;
            this.button = this.element.querySelector('button');
            this.definition = this.element.querySelector('[role="tooltip"]');
            this.definition.id = 'rich-term-' + ++sequence;
            this.button.setAttribute('aria-describedby', this.definition.id);
            this.element.classList.add('rich-enhanced');
            this.show = () => {
                this.toggle(true);
                this.definition.style.transform = '';
                // Keep the definition within the visible viewport
                const box = this.definition.getBoundingClientRect(),
                    offset =
                        box.right > innerWidth - 8
                            ? innerWidth - 8 - box.right
                            : box.left < 8
                              ? 8 - box.left
                              : 0;
                this.definition.style.transform = `translateX(${offset}px)`;
            };
            this.hide = () => this.toggle(false);
            this.outside = (event) => {
                if (!this.element.contains(event.target)) this.hide();
            };
            this.key = (event) => {
                if (event.key === 'Escape') {
                    this.hide();
                    event.stopPropagation();
                }
            };
            this.button.addEventListener('focus', this.show);
            this.button.addEventListener('click', this.show);
            this.button.addEventListener('blur', this.hide);
            this.button.addEventListener('keydown', this.key);
            document.addEventListener('pointerdown', this.outside);
            this.toggle(false);
        },
        // Keep definition visibility and the trigger expansion state synchronized
        toggle(open) {
            this.definition.hidden = !open;
            this.button.setAttribute('aria-expanded', String(open));
        },
        // Remove glossary handlers from both its trigger and the document
        destroy() {
            for (const [event, fn] of [
                ['focus', this.show],
                ['click', this.show],
                ['blur', this.hide],
                ['keydown', this.key],
            ])
                this.button.removeEventListener(event, fn);
            document.removeEventListener('pointerdown', this.outside);
        },
    }));
});
