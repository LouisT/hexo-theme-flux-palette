window.Flux.register('reading', () => {
    const defaults = { size: 100, spacing: 1.6, width: 'auto' };

    // Accept only supported reading settings from persisted preferences
    function preferences(value) {
        return {
            size: [90, 100, 110, 125, 150].includes(Number(value.size)) ? Number(value.size) : 100,
            spacing: [1.4, 1.6, 1.8, 2].includes(Number(value.spacing))
                ? Number(value.spacing)
                : 1.6,
            width: ['auto', '60ch', '75ch', '90ch'].includes(value.width) ? value.width : 'auto',
        };
    }

    // Apply validated reading preferences through shared CSS variables
    function apply(value) {
        const p = preferences(value),
            style = document.documentElement.style;
        style.setProperty('--reading-size', p.size / 100 + 'rem');
        style.setProperty('--reading-spacing', p.spacing);
        style.setProperty('--reading-width', p.width === 'auto' ? '100%' : p.width);
    }

    apply(Flux.read('preferences', defaults));
    // Keep only bookmark URLs belonging to this site root
    const library = () =>
        Flux.read('bookmarks', []).filter(
            (d) =>
                d &&
                typeof d.url === 'string' &&
                d.url.startsWith(Flux.root) &&
                !d.url.startsWith('//')
        );

    // Store public bookmark metadata and clear resume state when removing an article
    function toggleBookmark(article) {
        let list = library();
        const saved = list.some((d) => d.url === article.url);
        if (saved) {
            list = list.filter((d) => d.url !== article.url);
            const positions = Flux.read('positions', {});
            delete positions[article.url];
            Flux.write('positions', positions);
        } else {
            const { content, excerpt, ...metadata } = article;
            list.unshift(metadata);
        }
        Flux.write('bookmarks', list);
        Flux.emit('bookmarks');
        return !saved;
    }

    // Keep listing bookmark controls synchronized with the shared reading library
    Alpine.data('cardBookmark', (article = null) => ({
        article,
        saved: false,
        message: '',
        changed: null,
        // Load bookmark state and subscribe to changes from other reading controls
        init() {
            this.article ||= JSON.parse(this.$el.dataset.bookmark);
            this.refresh();
            this.changed = () => this.refresh();
            addEventListener('flux:bookmarks', this.changed);
        },
        // Check the current article against the shared bookmark library
        refresh() {
            this.saved = library().some((d) => d.url === this.article.url);
        },
        // Toggle the card bookmark and announce the resulting state
        toggle() {
            this.saved = toggleBookmark(this.article);
            this.message = this.saved ? 'Added to your reading list.' : 'Bookmark removed.';
        },
        // Remove bookmark listeners when the card leaves
        destroy() {
            removeEventListener('flux:bookmarks', this.changed);
        },
    }));
    Alpine.data('readingTools', () => ({
        article: Flux.manifest.article,
        prefs: preferences(Flux.read('preferences', defaults)),
        saved: false,
        position: null,
        fragment: location.hash,
        resumed: false,
        prefsOpen: false,
        message: '',
        prefsMessage: '',
        changed: null,
        hash: null,
        scroll: null,
        leave: null,
        timer: null,
        // Restore article preferences and avoid retaining progress for protected content
        init() {
            this.refreshBookmark();
            this.changed = () => this.refreshBookmark();
            addEventListener('flux:bookmarks', this.changed);
            if (this.saved)
                Flux.write(
                    'bookmarks',
                    library().map((d) => (d.url === this.article.url ? this.article : d))
                );
            if (this.article.encrypted) {
                const positions = Flux.read('positions', {});
                delete positions[this.article.url];
                Flux.write('positions', positions);
            }
            this.$watch('prefs', (value) => {
                apply(value);
                Flux.write('preferences', preferences(value));
                this.prefsMessage = '';
            });
            this.hash = () => {
                this.fragment = location.hash;
            };
            addEventListener('hashchange', this.hash);
            this.scroll = () => {
                clearTimeout(this.timer);
                this.timer = setTimeout(() => this.capture(), 300);
            };
            document.addEventListener('scroll', this.scroll, true);
            this.leave = () => this.capture();
            addEventListener('flux:leave', this.leave);
        },
        // Load saved progress only for bookmarked public articles
        refreshBookmark() {
            this.saved = library().some((d) => d.url === this.article.url);
            this.position =
                this.saved && !this.article.encrypted
                    ? Flux.read('positions', {})[this.article.url]
                    : null;
        },
        // Offer resume only for partial reading without an explicit destination heading
        get canResume() {
            return (
                this.saved &&
                !this.resumed &&
                this.position &&
                this.position.progress > 0.03 &&
                this.position.progress < 0.98 &&
                (!this.fragment || this.fragment.startsWith('#theme='))
            );
        },
        // Toggle the article bookmark and capture progress when it becomes saved
        toggle() {
            this.saved = toggleBookmark(this.article);
            this.message = this.saved ? 'Added to your reading list.' : 'Bookmark removed.';
            if (this.saved) this.capture();
        },
        // Close the preferences disclosure and optionally restore its keyboard focus
        closePreferences(restoreFocus = true) {
            if (!this.$refs.preferences?.open) return;
            this.$refs.preferences.open = false;
            this.prefsOpen = false;
            if (restoreFocus)
                this.$refs.preferences.querySelector('summary').focus({ preventScroll: true });
        },
        // Restore default reading preferences and announce the reset
        reset() {
            this.prefs = { ...defaults };
            apply(this.prefs);
            Flux.write('preferences', this.prefs);
            this.$nextTick(() => {
                this.prefsMessage = 'Preferences reset.';
            });
        },
        // Persist the last visible heading and reading fraction for public bookmarks
        capture() {
            if (!this.saved || this.article.encrypted) return;
            const el = document.querySelector('.post-content');
            if (!el || el.querySelector('.encrypted-post')) return;
            const top = Flux.scrollTop(),
                start = el.getBoundingClientRect().top + top,
                progress = Math.max(
                    0,
                    Math.min(1, (top - start) / Math.max(1, el.offsetHeight - innerHeight))
                ),
                headings = [...el.querySelectorAll('h1[id],h2[id],h3[id],h4[id],h5[id],h6[id]')],
                heading =
                    headings
                        .filter(
                            (h) => h.getClientRects().length && h.getBoundingClientRect().top < 160
                        )
                        .at(-1)?.id || '',
                positions = Flux.read('positions', {});
            positions[this.article.url] = { heading, progress };
            Flux.write('positions', positions);
        },
        // Reveal the saved heading or fall back to the recorded reading fraction
        resume() {
            if (!this.canResume) return;
            this.resumed = true;
            this.closePreferences(false);
            const target = document.getElementById(this.position.heading);
            if (target) {
                Flux.emit('reveal', { target });
                this.$nextTick(() =>
                    target.scrollIntoView({ behavior: Flux.reduced() ? 'instant' : 'smooth' })
                );
            } else {
                const el = document.querySelector('.post-content');
                Flux.scrollTo(
                    el.getBoundingClientRect().top +
                        Flux.scrollTop() +
                        this.position.progress * Math.max(0, el.offsetHeight - innerHeight)
                );
            }
        },
        // Save the final reading position before removing article event handlers
        destroy() {
            this.capture();
            clearTimeout(this.timer);
            document.removeEventListener('scroll', this.scroll, true);
            removeEventListener('flux:leave', this.leave);
            removeEventListener('hashchange', this.hash);
            removeEventListener('flux:bookmarks', this.changed);
        },
    }));
    Alpine.data('readingLibrary', () => ({
        items: [],
        downloads: [],
        message: '',
        alive: true,
        changed: null,
        controller: null,
        // Load the reading library and subscribe to bookmark and download changes
        init() {
            this.refresh();
            this.changed = () => this.refresh();
            addEventListener('flux:bookmarks', this.changed);
            addEventListener('flux:downloads', this.changed);
        },
        // Refresh bookmark metadata and downloads without applying obsolete responses
        async refresh() {
            this.items = library();
            this.controller?.abort();
            this.controller = new AbortController();
            const controller = this.controller;
            if (navigator.onLine)
                try {
                    const response = await fetch(Flux.root + 'reading/catalog.json', {
                        cache: 'no-store',
                        signal: controller.signal,
                    });
                    if (response.ok) {
                        const docs = await response.json();
                        if (!this.alive || controller.signal.aborted) return;
                        const positions = Flux.read('positions', {});
                        this.items = library().map((item) => {
                            const current = docs.find((d) => d.url === item.url);
                            if (current?.encrypted) delete positions[item.url];
                            return current || item;
                        });
                        Flux.write('bookmarks', this.items);
                        Flux.write('positions', positions);
                    }
                } catch {}
            if (Flux.offline) {
                try {
                    const downloads = await Flux.offline.list();
                    if (this.alive && !controller.signal.aborted) this.downloads = downloads;
                } catch (e) {
                    if (this.alive && !controller.signal.aborted) this.message = e.message;
                }
            }
        },
        // Show saved reading progress only for public articles
        progress(item) {
            return item.encrypted
                ? ''
                : Math.round((Flux.read('positions', {})[item.url]?.progress || 0) * 100) +
                      '% read';
        },
        // Remove a bookmark and its reading position together
        remove(url) {
            Flux.write(
                'bookmarks',
                library().filter((d) => d.url !== url)
            );
            const p = Flux.read('positions', {});
            delete p[url];
            Flux.write('positions', p);
            Flux.emit('bookmarks');
        },
        // Remove one offline article and refresh the library after success
        async removeDownload(url) {
            try {
                await Flux.offline.remove(url);
                this.refresh();
            } catch (e) {
                this.message = e.message;
            }
        },
        // Clear offline articles and refresh the library after success
        async clearDownloads() {
            try {
                await Flux.offline.clear();
                this.refresh();
            } catch (e) {
                this.message = e.message;
            }
        },
        // Prevent library updates after navigation and cancel pending catalog requests
        destroy() {
            this.alive = false;
            this.controller?.abort();
            removeEventListener('flux:bookmarks', this.changed);
            removeEventListener('flux:downloads', this.changed);
        },
    }));
});
