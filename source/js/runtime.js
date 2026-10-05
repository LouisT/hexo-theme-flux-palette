(function () {
    'use strict';
    if (window.Flux) return;
    const scripts = new Map(),
        registrations = new Map(),
        memory = new Map(),
        initial = JSON.parse(document.getElementById('flux-manifest').textContent),
        root = initial.root,
        // Retain in-memory preferences when browser storage is unavailable
        storage = {
            // Prefer current in-memory values and tolerate blocked browser storage
            getItem(key) {
                if (memory.has(key)) return memory.get(key);
                try {
                    return localStorage.getItem(key);
                } catch {
                    return null;
                }
            },
            // Update memory before attempting to persist a browser preference
            setItem(key, value) {
                memory.set(key, String(value));
                try {
                    localStorage.setItem(key, String(value));
                } catch {}
            },
            // Clear memory and attempt to remove the persisted preference
            removeItem(key) {
                memory.delete(key);
                try {
                    localStorage.removeItem(key);
                } catch {}
            },
        },
        Flux = (window.Flux = {
            root,
            manifest: initial,
            storage,
            key: (name) => `flux:${root}:${name}`,
            // Reject stored values whose shape no longer matches the expected defaults
            read(name, fallback) {
                try {
                    const value = JSON.parse(storage.getItem(this.key(name))) ?? fallback;
                    if (Array.isArray(fallback) && !Array.isArray(value)) return fallback;
                    if (
                        fallback &&
                        typeof fallback === 'object' &&
                        !Array.isArray(fallback) &&
                        (typeof value !== 'object' || Array.isArray(value))
                    )
                        return fallback;
                    return value;
                } catch {
                    return fallback;
                }
            },
            // Serialize preferences under the site-root storage key
            write(name, value) {
                storage.setItem(this.key(name), JSON.stringify(value));
            },
            // Register each feature once and initialize it when Alpine is ready
            register(name, fn) {
                if (registrations.has(name)) return;
                registrations.set(name, fn);
                if (window.Alpine) fn();
            },
            // Resolve fingerprinted assets with stable paths as a fallback
            asset(name, manifest = this.manifest) {
                return manifest.assets?.[name] || root + name;
            },
            // Share script requests and allow failed loads to retry
            load(name, manifest = this.manifest) {
                if (!scripts.has(name))
                    scripts.set(
                        name,
                        new Promise((resolve, reject) => {
                            const el = document.createElement('script');
                            el.src = this.asset('js/' + name + '.js', manifest);
                            el.onload = resolve;
                            el.onerror = () => {
                                scripts.delete(name);
                                el.remove();
                                reject(new Error(`Could not load ${name}`));
                            };
                            document.head.appendChild(el);
                        })
                    );
                return scripts.get(name);
            },
            // Load shared dependencies before initializing page-specific features
            async prepare(manifest) {
                if (manifest.math && !document.querySelector('link[data-flux-math]')) {
                    const style = document.createElement('link');
                    style.rel = 'stylesheet';
                    style.dataset.fluxMath = '';
                    style.href = this.asset('css/vendor/katex.css', manifest);
                    document.head.appendChild(style);
                }
                const dependencies = { search: ['search-core'], projects: ['pagination-core'] },
                    jobs = new Map(),
                    // Share dependency jobs before loading their dependent feature scripts
                    prepare = (name) => {
                        if (!jobs.has(name))
                            jobs.set(
                                name,
                                Promise.all((dependencies[name] || []).map(prepare)).then(() =>
                                    this.load(name, manifest)
                                )
                            );
                        return jobs.get(name);
                    };
                await Promise.all(manifest.features.map(prepare));
            },
            // Dispatch namespaced events shared by independent theme controls
            emit(name, detail) {
                window.dispatchEvent(new CustomEvent('flux:' + name, { detail }));
            },
            // Target the active scroll container used by the responsive layout
            scrollTo(top) {
                const el = document.scrollingElement;
                if (document.body.scrollHeight > document.body.clientHeight)
                    document.body.scrollTo({ top, behavior: 'instant' });
                else el.scrollTo({ top, behavior: 'instant' });
            },
            // Read scroll position from the container used by the responsive layout
            scrollTop() {
                return document.body.scrollTop || document.scrollingElement.scrollTop || 0;
            },
            // Respect the visitor preference for reduced motion
            reduced() {
                return matchMedia('(prefers-reduced-motion: reduce)').matches;
            },
        });
    document.addEventListener(
        'alpine:init',
        () => {
            for (const fn of registrations.values()) fn();
        },
        { once: true }
    );
    // Load feature definitions and plugins before starting Alpine
    (async () => {
        await Promise.all([Flux.prepare(initial), Flux.load('vendor/collapse')]);
        await Flux.load('vendor/alpine');
        await Flux.load('view-transitions');
        Flux.emit('page', initial);
    })().catch((error) => {
        console.error(error);
        document.documentElement.classList.add('flux-load-failed');
    });
})();
