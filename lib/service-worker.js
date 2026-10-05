// Use generated download rules to cache only explicitly saved public articles
const PREFIX = 'flux:' + CONFIG.root + ':offline:v1:',
    DATA = PREFIX + 'data',
    metaUrl = new URL(CONFIG.root + '_flux/offline-library', self.location.origin).href;
let queue = Promise.resolve();
const absolute = (url) => new URL(url, self.location.origin).href;

// Read the saved article records from the offline cache
async function metadata() {
    const cache = await caches.open(DATA),
        res = await cache.match(metaUrl);
    return res ? res.json() : {};
}

// Persist article records alongside their cached resources
async function write(meta) {
    const cache = await caches.open(DATA);
    await cache.put(
        metaUrl,
        new Response(JSON.stringify(meta), { headers: { 'Content-Type': 'application/json' } })
    );
}

// Remove resources no longer used by saved articles or the reading shell
async function prune(meta) {
    const keep = new Set([
            metaUrl,
            ...CONFIG.shell.map(absolute),
            ...Object.values(meta).flatMap((m) => m.resources),
        ]),
        cache = await caches.open(DATA);

    for (const req of await cache.keys()) if (!keep.has(req.url)) await cache.delete(req);
}

// Refresh public download eligibility when the network is available
async function refresh() {
    try {
        const response = await fetch(CONFIG.root + 'offline/catalog.json', { cache: 'no-store' });
        if (!response.ok) return;
        const latest = await response.json();
        if (latest.root === CONFIG.root && latest.articles && Array.isArray(latest.shell))
            Object.assign(CONFIG, latest);
    } catch {} // Saved eligibility remains usable while disconnected
}

// Discard downloads that have become protected or disappeared
async function reconcile() {
    await refresh();
    const meta = await metadata();

    for (const url of Object.keys(meta)) if (!CONFIG.articles[url]) delete meta[url];
    await write(meta);
    await prune(meta);
    return meta;
}

// Stage a complete article download before replacing cached resources
async function save(url, port, id) {
    const meta = await reconcile(),
        article = CONFIG.articles[url];
    if (!article) throw new Error('Only public articles can be saved offline.');
    if (!meta[url] && Object.keys(meta).length >= CONFIG.maxArticles)
        throw new Error('Download limit reached. Remove an article and try again.');
    const stageName = PREFIX + 'stage-' + id,
        stage = await caches.open(stageName),
        resources = [...new Set([url, ...article.resources, ...CONFIG.shell])].map(absolute);
    let bytes = 0;
    const backups = new Map(),
        committed = [],
        cache = await caches.open(DATA),
        // Account for existing resources that this download will not replace
        retained = new Set(
            Object.entries(meta)
                .filter(([u]) => u !== url)
                .flatMap(([, m]) => m.resources)
                .filter((resource) => !resources.includes(resource))
        );
    let used = 0;

    for (const resource of retained) {
        const response = await cache.match(resource);
        if (response) used += (await response.arrayBuffer()).byteLength;
    }
    try {
        for (let i = 0; i < resources.length; i++) {
            const response = await fetch(resources[i], { cache: 'reload' });
            if (!response.ok || new URL(response.url).origin !== self.location.origin)
                throw new Error('A local article resource could not be downloaded. Try again.');
            bytes += (await response.clone().arrayBuffer()).byteLength;
            if (bytes + used > CONFIG.maxBytes)
                throw new Error('Download storage limit reached. Remove an article and try again.');
            await stage.put(resources[i], response);
            port.postMessage({ id, progress: Math.round(((i + 1) / resources.length) * 100) });
        }
        // Back up shared resources so a failed commit can restore earlier downloads
        for (const resource of resources) {
            backups.set(resource, await cache.match(resource));
            await cache.put(resource, await stage.match(resource));
            committed.push(resource);
        }
        meta[url] = { url, title: article.title, bytes, resources };
        await write(meta);
        return meta[url];
    } catch (e) {
        await caches.delete(stageName);
        for (const resource of committed) await cache.delete(resource);
        for (const resource of committed) {
            const previous = backups.get(resource);
            if (previous) await cache.put(resource, previous);
        }
        if (e.name === 'QuotaExceededError')
            throw new Error(
                'The browser has insufficient offline storage. Remove downloads or free space and try again.'
            );
        throw e;
    } finally {
        await caches.delete(stageName);
    }
}

self.addEventListener('install', (event) => event.waitUntil(self.skipWaiting()));

// Remove abandoned staging caches before taking control of pages
self.addEventListener('activate', (event) =>
    event.waitUntil(
        (async () => {
            for (const name of await caches.keys())
                if (name.startsWith(PREFIX + 'stage-')) await caches.delete(name);
            await reconcile();
            await self.clients.claim();
        })()
    )
);

self.addEventListener('message', (event) => {
    const { id, action, url } = event.data || {},
        port = event.ports[0];
    if (!port) return;
    // Dispatch offline requests and report failures through the requesting message port
    const work = async () => {
        try {
            let value;
            if (action === 'save') value = await save(url, port, id);
            else if (action === 'list') value = Object.values(await reconcile());
            else if (action === 'remove') {
                const meta = await metadata();
                delete meta[url];
                await write(meta);
                await prune(meta);
                value = true;
            } else if (action === 'clear') {
                await write({});
                await prune({});
                value = true;
            } else throw new Error('Unknown offline action');
            port.postMessage({ id, value });
        } catch (e) {
            port.postMessage({ id, error: e.message });
        }
    };
    // Serialize cache mutations so concurrent downloads cannot overwrite metadata
    queue = queue.then(work, work);
    event.waitUntil(queue);
});

// Serve saved public resources only after the network request fails
self.addEventListener('fetch', (event) => {
    const request = event.request,
        url = new URL(request.url);
    if (
        request.method !== 'GET' ||
        url.origin !== self.location.origin ||
        url.pathname.includes('/_encrypted/') ||
        url.pathname === CONFIG.root + 'offline/catalog.json' ||
        (!url.pathname.startsWith(CONFIG.root) && request.mode === 'navigate')
    )
        return;
    event.respondWith(
        (async () => {
            try {
                return await fetch(request);
            } catch (e) {
                const cache = await caches.open(DATA);
                let key = request;
                if (request.mode === 'navigate') {
                    const meta = await metadata(),
                        path = url.pathname.endsWith('index.html')
                            ? url.pathname.slice(0, -10)
                            : url.pathname,
                        record = meta[path];
                    if (record && !CONFIG.articles[path]) throw e;
                    key = record ? absolute(path) : request;
                }
                const cached = await cache.match(key);
                if (cached) return cached;
                throw e;
            }
        })()
    );
});
