window.Flux.register('cloud', () => {
    Alpine.data('cloudExplorer', () => ({
        query: '',
        sort: 'count:desc',
        groups: [],
        enhanced: false,
        // Read topic counts from native links before enabling search and sorting
        init() {
            this.sort = this.$el.dataset.sort || 'count:desc';
            this.groups = [...this.$el.querySelectorAll('[data-cloud-list]')].map((list) => ({
                key: list.dataset.cloudList,
                list,
                visible: 0,
                items: [...list.children].map((el) => ({
                    el,
                    name: el.dataset.name,
                    count: Number(el.dataset.count),
                })),
            }));
            this.$watch('query', () => this.update());
            this.$watch('sort', () => this.update());
            this.update();
            this.enhanced = true;
        },
        // Count visible topics in the requested taxonomy group
        visible(key) {
            return this.groups.find((group) => group.key === key)?.visible || 0;
        },
        // Describe visible topics with plural labels for filtered and unfiltered lists
        summary(key) {
            const group = this.groups.find((group) => group.key === key);
            if (!group) return '';
            const filtered = Boolean(this.query.trim()),
                count = filtered ? group.items.length : group.visible,
                noun =
                    key === 'categories'
                        ? count === 1
                            ? 'category'
                            : 'categories'
                        : count === 1
                          ? 'tag'
                          : 'tags';
            return `${group.visible}${filtered ? ' of ' + group.items.length : ''} ${noun}`;
        },
        // Describe search matches across all taxonomy groups
        get status() {
            return this.groups.map((group) => this.summary(group.key)).join(', ') + '.';
        },
        // Sort and filter existing topic links while preserving keyboard order
        update() {
            const query = this.query.trim().toLocaleLowerCase(),
                [by, order] = this.sort.split(':'),
                direction = order === 'asc' ? 1 : -1;

            for (const group of this.groups) {
                const items = [...group.items].sort((a, b) => {
                    if (by === 'name') return direction * a.name.localeCompare(b.name);
                    return direction * (a.count - b.count) || a.name.localeCompare(b.name);
                });
                let visible = 0;
                // Keep DOM and keyboard order aligned, without recreating the native links
                Alpine.mutateDom(() => {
                    for (const item of items) {
                        item.el.hidden = !item.name.toLocaleLowerCase().includes(query);
                        if (!item.el.hidden) visible++;
                        group.list.appendChild(item.el);
                    }
                });
                group.visible = visible;
            }
        },
        // Clear the topic query and restore focus to the filter field
        clear() {
            this.query = '';
            this.$refs.query.focus();
        },
    }));
});
