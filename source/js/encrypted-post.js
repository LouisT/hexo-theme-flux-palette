window.Flux.register('encrypted-post', () => {
    // Keep the article toolbar synchronized with its protected content component
    Alpine.data('articleLock', () => ({
        unlocked: false,
        busy: false,
        article: null,
        target: null,
        stateHandler: null,
        // Track unlock state published by the matching protected article component
        init() {
            this.article = this.$el.closest('.post-single');
            this.target = this.article?.querySelector('.encrypted-post');
            this.stateHandler = (event) => {
                if (event.target !== this.target) return;
                this.unlocked = event.detail.unlocked;
                this.busy = event.detail.busy;
            };
            this.article?.addEventListener('flux:protected-state', this.stateHandler);
        },
        // Forward the toolbar action to the protected article lock control
        toggle() {
            this.target?.dispatchEvent(new CustomEvent('flux:toggle-lock'));
        },
        // Remove protected state listeners when the toolbar leaves
        destroy() {
            this.article?.removeEventListener('flux:protected-state', this.stateHandler);
        },
    }));
    Alpine.data('encryptedPost', (slug, apiUrl) => ({
        slug,
        apiUrl,
        password: '',
        error: '',
        decryptedContent: '',
        isDecrypting: false,
        derivedKey: null,
        imagesData: {},
        urls: [],
        generation: 0,
        observer: null,
        controller: null,
        element: null,
        toggleHandler: null,
        // Wire lock controls and publish the initial protected state
        init() {
            this.element = this.$el;
            this.toggleHandler = () => {
                if (this.isDecrypting) return;
                if (this.decryptedContent) this.lock(true);
                else this.focusPassword();
            };
            this.element.addEventListener('flux:toggle-lock', this.toggleHandler);
            this.publishState();
        },
        // Notify the toolbar when unlock progress or visibility changes
        publishState() {
            this.element.dispatchEvent(
                new CustomEvent('flux:protected-state', {
                    bubbles: true,
                    detail: {
                        unlocked: Boolean(this.decryptedContent),
                        busy: this.isDecrypting,
                    },
                })
            );
        },
        // Focus the password field when the article needs to be unlocked
        focusPassword() {
            this.$nextTick(() => this.$refs.passwordInput?.focus());
        },
        // Decode encrypted payload fields into bytes for the Web Crypto API
        base64ToUint8Array(b64) {
            return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        },
        // Derive a non-exportable AES key using the build-time PBKDF2 parameters
        async deriveKey(password, salt, iterations) {
            const base = await crypto.subtle.importKey(
                'raw',
                new TextEncoder().encode(password),
                'PBKDF2',
                false,
                ['deriveKey']
            );
            return crypto.subtle.deriveKey(
                { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
                base,
                { name: 'AES-GCM', length: 256 },
                false,
                ['decrypt']
            );
        },
        // Append the authentication tag to match the Web Crypto AES-GCM input format
        async decryptChunk(key, ct, iv, at) {
            const body = this.base64ToUint8Array(ct),
                tag = this.base64ToUint8Array(at),
                combined = new Uint8Array(body.length + tag.length);
            combined.set(body);
            combined.set(tag, body.length);
            return crypto.subtle.decrypt(
                { name: 'AES-GCM', iv: this.base64ToUint8Array(iv), tagLength: 128 },
                key,
                combined
            );
        },
        // Fetch and decrypt the payload while ignoring work invalidated by locking
        async handleUnlock() {
            if (this.isDecrypting) return;
            if (!this.password) {
                this.error = 'Please enter a password.';
                return;
            }
            const generation = ++this.generation,
                password = this.password;
            this.isDecrypting = true;
            this.error = '';
            this.controller = new AbortController();
            this.publishState();
            try {
                const response = await fetch(this.apiUrl, {
                    signal: this.controller.signal,
                    cache: 'no-store',
                });
                if (!response.ok) throw new Error('Could not load encrypted content');
                const payload = await response.json(),
                    key = await this.deriveKey(
                        password,
                        this.base64ToUint8Array(payload.s),
                        payload.i
                    ),
                    buffer = await this.decryptChunk(key, payload.ct, payload.iv, payload.at);
                if (generation !== this.generation) return;
                this.derivedKey = key;
                this.imagesData = payload.imgs || {};
                this.decryptedContent = new TextDecoder().decode(buffer);
                this.$nextTick(() => {
                    if (generation === this.generation) this.initLazyLoader();
                });
            } catch (e) {
                if (generation === this.generation && e.name !== 'AbortError')
                    this.error =
                        e.name === 'OperationError'
                            ? 'Incorrect password or decryption failed.'
                            : 'Could not load content. Check your connection and try again.';
            } finally {
                if (generation === this.generation) {
                    this.isDecrypting = false;
                    this.password = '';
                    this.publishState();
                }
            }
        },
        // Decrypt protected images only as they approach the viewport
        initLazyLoader() {
            const images = this.$refs.contentContainer?.querySelectorAll('img[data-enc-id]') || [];
            this.observer?.disconnect();
            if (!window.IntersectionObserver) {
                images.forEach((img) => this.revealImage(img.dataset.encId, img));
                return;
            }
            this.observer = new IntersectionObserver(
                (entries) =>
                    entries.forEach((entry) => {
                        if (entry.isIntersecting) {
                            this.revealImage(entry.target.dataset.encId, entry.target);
                            this.observer.unobserve(entry.target);
                        }
                    }),
                { rootMargin: '200px' }
            );
            images.forEach((img) => this.observer.observe(img));
        },
        // Attach a decrypted image only while its article remains unlocked
        async revealImage(id, img) {
            const generation = this.generation,
                data = this.imagesData[id],
                key = this.derivedKey;
            if (!data || !key) return;
            try {
                const buffer = await this.decryptChunk(key, data.ct, data.iv, data.at);
                if (generation !== this.generation || !img.isConnected) return;
                const url = URL.createObjectURL(new Blob([buffer], { type: data.m }));
                this.urls.push(url);
                img.src = url;
                img.dataset.originalSrc = url;
                delete this.imagesData[id];
            } catch {
                if (generation === this.generation) img.alt = 'Image could not be decrypted';
            }
        },
        // Invalidate pending decryptions and release every decrypted object URL
        lock(focus = false) {
            ++this.generation;
            this.controller?.abort();
            this.observer?.disconnect();
            this.controller = null;
            this.observer = null;
            Flux.emit('lock', { urls: this.urls.slice() });
            this.urls.forEach((url) => URL.revokeObjectURL(url));
            this.urls = [];
            this.decryptedContent = '';
            this.$refs.contentContainer?.replaceChildren();
            this.derivedKey = null;
            this.imagesData = {};
            this.password = '';
            this.error = '';
            this.isDecrypting = false;
            this.publishState();
            if (focus) this.focusPassword();
        },
        // Relock content and remove toolbar handlers when the article leaves
        destroy() {
            this.element.removeEventListener('flux:toggle-lock', this.toggleHandler);
            this.lock();
        },
    }));
});
