window.Flux.register('lightbox', () => {
    Alpine.data('lightbox', () => ({
        isOpen: false,
        isLoading: false,
        imgSrc: '',
        imgAlt: '',
        opener: null,
        // Enhance article images for keyboard access and observe newly unlocked content
        init() {
            this.dialog = this.$el;
            this.enhance = () =>
                document
                    .querySelectorAll('.post-content img,.page-content img,.gallery-grid img')
                    .forEach((img) => {
                        if (this.eligible(img) && !img.hasAttribute('tabindex')) {
                            img.tabIndex = 0;
                            img.setAttribute('role', 'button');
                            img.setAttribute('aria-haspopup', 'dialog');
                            img.setAttribute('aria-label', 'Open image: ' + (img.alt || 'Image'));
                        }
                    });
            this.enhance();
            this.observer = new MutationObserver(this.enhance);
            this.observer.observe(document.getElementById('main-content'), {
                childList: true,
                subtree: true,
            });
            this.click = (e) => {
                const img = e.target.closest('img');
                if (!img || !img.closest('.post-content,.page-content,.gallery-grid')) return;
                if (img.closest('.rich-image-compare')) return;
                const link = img.closest('a');
                if (link && !/\.(jpe?g|png|gif|webp|svg)(?:[?#]|$)/i.test(link.href)) return;
                e.preventDefault();
                this.open(img);
            };
            document.addEventListener('click', this.click);
            this.key = (e) => {
                if (
                    ['Enter', ' '].includes(e.key) &&
                    e.target.tagName === 'IMG' &&
                    this.eligible(e.target)
                ) {
                    e.preventDefault();
                    this.open(e.target);
                }
            };
            document.addEventListener('keydown', this.key);
            this.lock = (e) => {
                if (e.detail.urls.includes(this.imgSrc)) this.close();
            };
            addEventListener('flux:lock', this.lock);
        },
        // Keep non-image links native while allowing article images to open in the lightbox
        eligible(img) {
            if (img.closest('.rich-image-compare')) return false;
            const link = img.closest('a');
            return (
                img.closest('.post-content,.page-content,.gallery-grid') &&
                (!link || /\.(jpe?g|png|gif|webp|svg)(?:[?#]|$)/i.test(link.href))
            );
        },
        // Open the original image and remember its focus target
        open(img) {
            this.opener = img;
            this.imgSrc = img.dataset.originalSrc || img.src;
            this.imgAlt = img.alt || '';
            this.isLoading = true;
            this.isOpen = true;
            this.dialog.showModal();
        },
        // Release the displayed image and restore focus to its opener
        close() {
            this.dialog.close();
            this.isOpen = false;
            this.imgSrc = '';
            this.isLoading = false;
            this.opener?.focus();
        },
        // Disconnect image observers and clear any protected image still displayed
        destroy() {
            this.observer.disconnect();
            document.removeEventListener('click', this.click);
            document.removeEventListener('keydown', this.key);
            removeEventListener('flux:lock', this.lock);
            this.dialog.close();
            this.imgSrc = '';
        },
    }));
});
