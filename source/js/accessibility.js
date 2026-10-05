window.Flux.register('accessibility', () => {
    Alpine.data('accessibleTabs', () => ({
        tab: 0,
        // Connect tabs to panels with unique ARIA IDs and reveal linked sections
        init() {
            this.tabs = [...this.$el.querySelectorAll('[role="tab"]')];
            this.panels = [...this.$el.querySelectorAll('[role="tabpanel"]')];
            const prefix = 'tabs-' + Math.random().toString(36).slice(2);
            this.tabs.forEach((t, i) => {
                t.id = prefix + '-' + i;
                t.setAttribute('aria-controls', prefix + '-panel-' + i);
                this.panels[i].id = prefix + '-panel-' + i;
                this.panels[i].setAttribute('aria-labelledby', t.id);
            });
            this.$watch('tab', () => this.sync());
            this.hash = (event) => this.check(event.detail?.target);
            addEventListener('hashchange', this.hash);
            addEventListener('flux:reveal', this.hash);
            this.check();
            this.sync();
        },
        // Keep keyboard tab stops and selection state aligned with the active panel
        sync() {
            this.tabs.forEach((t, i) => {
                t.setAttribute('aria-selected', String(i === this.tab));
                t.tabIndex = i === this.tab ? 0 : -1;
            });
        },
        // Activate the tab containing a heading requested by a link or reading resume
        check(reveal) {
            try {
                const target =
                        reveal ||
                        document.getElementById(decodeURIComponent(location.hash.slice(1))),
                    index = this.panels.findIndex((p) => p.contains(target));
                if (index >= 0) {
                    this.tab = index;
                    this.$nextTick(() =>
                        target.scrollIntoView({ behavior: Flux.reduced() ? 'instant' : 'auto' })
                    );
                }
            } catch {}
        },
        // Support wrapping arrow navigation and endpoint keys for tabs
        key(event) {
            const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
            if (!keys.includes(event.key)) return;
            event.preventDefault();
            this.tab =
                event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? this.tabs.length - 1
                      : (this.tab + (event.key === 'ArrowRight' ? 1 : -1) + this.tabs.length) %
                        this.tabs.length;
            this.tabs[this.tab].focus();
        },
        // Remove tab reveal listeners when the component leaves
        destroy() {
            removeEventListener('hashchange', this.hash);
            removeEventListener('flux:reveal', this.hash);
        },
    }));
    Alpine.data('accessibleAccordions', () => ({
        active: null,
        // Pair accordion controls with labeled regions and reveal linked content
        init() {
            this.element = this.$el;
            this.buttons = [...this.element.querySelectorAll('.accordion-header')];
            const panels = [...this.element.querySelectorAll('.accordion-content')],
                prefix = 'accordion-' + Math.random().toString(36).slice(2);
            this.buttons.forEach((button, i) => {
                button.id = prefix + '-' + i;
                button.setAttribute('aria-controls', prefix + '-panel-' + i);
                panels[i].id = prefix + '-panel-' + i;
                panels[i].setAttribute('role', 'region');
                panels[i].setAttribute('aria-labelledby', button.id);
            });
            this.hash = (event) => this.check(event.detail?.target);
            addEventListener('hashchange', this.hash);
            addEventListener('flux:reveal', this.hash);
            this.check();
        },
        // Expand the accordion containing the requested heading before scrolling
        check(reveal) {
            try {
                const target =
                        reveal ||
                        document.getElementById(decodeURIComponent(location.hash.slice(1))),
                    items = [...this.element.querySelectorAll('.accordion-item')],
                    i = items.findIndex((el) => el.contains(target));
                if (i >= 0) {
                    this.active = i;
                    this.$nextTick(() =>
                        target.scrollIntoView({ behavior: Flux.reduced() ? 'instant' : 'auto' })
                    );
                }
            } catch {}
        },
        // Move accordion focus with arrow keys while leaving expansion to the controls
        key(event) {
            if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const index = this.buttons.indexOf(event.target);
            this.buttons[
                event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? this.buttons.length - 1
                      : (index + (event.key === 'ArrowDown' ? 1 : -1) + this.buttons.length) %
                        this.buttons.length
            ].focus();
        },
        // Remove accordion reveal listeners when the component leaves
        destroy() {
            removeEventListener('hashchange', this.hash);
            removeEventListener('flux:reveal', this.hash);
        },
    }));
});
