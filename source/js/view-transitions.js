(function () {
    if (window.FluxNavigation) return;
    window.FluxNavigation = true;
    const positions = new Map();
    let path = location.pathname + location.search,
        sequence = 0,
        controller;
    const id = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
    let entry = history.state?.flux_entry || id();
    history.replaceState({ ...history.state, flux_entry: entry }, '');
    if (document.startViewTransition) history.scrollRestoration = 'manual';

    // Remember history scroll positions only for public articles
    function capture() {
        if (!Flux.manifest.article?.encrypted) positions.set(entry, Flux.scrollTop());
        else positions.delete(entry);
    }

    document.addEventListener('scroll', capture, true);

    // Wait for an animation frame before measuring the restored layout
    function frame() {
        return new Promise((resolve) => requestAnimationFrame(resolve));
    }

    // Restore history positions after layout settles or reveal the destination heading
    async function position(manifest, restore, request) {
        await frame();
        await frame();
        if (request !== sequence) return;
        if (restore !== undefined && !manifest.article?.encrypted) {
            Flux.scrollTo(restore);
            // Retry scroll restoration for late layout changes until the visitor interacts
            const observer = new ResizeObserver(() => {
                    if (request === sequence) Flux.scrollTo(restore);
                }),
                // Stop scroll restoration once the visitor interacts or its timeout expires
                stop = () => {
                    observer.disconnect();
                    clearTimeout(timer);
                    for (const name of ['wheel', 'touchstart', 'keydown', 'pointerdown'])
                        removeEventListener(name, stop);
                },
                timer = setTimeout(stop, 1000);

            for (const name of ['wheel', 'touchstart', 'keydown', 'pointerdown'])
                addEventListener(name, stop, { once: true });
            observer.observe(document.getElementById('main-content'));
            setTimeout(() => {
                if (request !== sequence) stop();
            }, 0);
        } else {
            Flux.scrollTo(0);
            if (location.hash && !location.hash.startsWith('#theme=')) {
                try {
                    document
                        .getElementById(decodeURIComponent(location.hash.slice(1)))
                        ?.scrollIntoView();
                } catch {}
            } else document.getElementById('main-content')?.focus({ preventScroll: true });
        }
    }

    // Prepare destination features and swap the page only for the latest navigation
    async function navigate(url, push, targetEntry) {
        const request = ++sequence;
        controller?.abort();
        controller = new AbortController();
        const restore = push ? undefined : positions.get(targetEntry);
        try {
            const res = await fetch(url, { signal: controller.signal });
            if (!res.ok) throw new Error('Navigation failed');
            const doc = new DOMParser().parseFromString(await res.text(), 'text/html'),
                manifest = JSON.parse(doc.getElementById('flux-manifest').textContent);
            // Reload fully when asset versions differ so old scripts cannot control new markup
            if (manifest.asset_version !== Flux.manifest.asset_version) {
                if (request === sequence) location.href = url;
                return;
            }
            await Flux.prepare(manifest);
            if (request !== sequence) return;
            // Destroy outgoing Alpine state before replacing metadata and initializing the new body
            const swap = () => {
                Flux.emit('leave');
                Alpine.stopObservingMutations();
                Alpine.destroyTree(document.body);
                entry = push ? id() : targetEntry || id();
                if (push) history.pushState({ flux_entry: entry }, '', url);
                else if (!targetEntry)
                    history.replaceState({ ...history.state, flux_entry: entry }, '');
                path = location.pathname + location.search;
                document.title = doc.title;
                for (const selector of [
                    'meta[name="description"]',
                    'meta[property^="og:"]',
                    'meta[name^="twitter:"]',
                    'link[rel="canonical"]',
                    'script[data-flux-schema]',
                ]) {
                    document.head.querySelectorAll(selector).forEach((el) => el.remove());
                    doc.head
                        .querySelectorAll(selector)
                        .forEach((el) => document.head.appendChild(el.cloneNode(true)));
                }
                Flux.manifest = manifest;
                document.body.replaceWith(doc.body);
                Alpine.initTree(document.body);
                Alpine.startObservingMutations();
                Flux.emit('page', manifest);
            };
            if (document.startViewTransition && !Flux.reduced())
                await document.startViewTransition(swap).updateCallbackDone;
            else swap();
            await position(manifest, restore, request);
        } catch (error) {
            if (error.name !== 'AbortError' && request === sequence) location.href = url;
        }
    }

    // Intercept ordinary same-origin page links while preserving native browser actions
    document.addEventListener('click', (event) => {
        const link = event.target.closest('a');
        if (
            !link ||
            event.defaultPrevented ||
            event.button !== 0 ||
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey ||
            (link.target && link.target !== '_self') ||
            link.hasAttribute('download') ||
            link.hasAttribute('data-no-view-transition')
        )
            return;
        const url = new URL(link.href);
        if (
            url.origin !== location.origin ||
            !['http:', 'https:'].includes(url.protocol) ||
            url.pathname === location.pathname ||
            !document.startViewTransition
        )
            return;
        event.preventDefault();
        capture();
        navigate(url.href, true);
    });
    // Restore the scroll position belonging to the destination history entry
    addEventListener('popstate', (event) => {
        const next = location.pathname + location.search,
            target = event.state?.flux_entry;
        if (path !== next) navigate(location.href, false, target);
        else if (target && target !== entry) {
            capture();
            entry = target;
            position(Flux.manifest, positions.get(entry), sequence);
        }
    });
})();
