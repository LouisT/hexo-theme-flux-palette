'use strict';
const fs = require('node:fs'),
    path = require('node:path'),
    { load } = require('cheerio'),
    content = require('../lib/content.cjs');

// Read generated route streams before collecting offline dependencies
async function read(stream) {
    const parts = [];

    for await (const part of stream) parts.push(Buffer.isBuffer(part) ? part : Buffer.from(part));
    return Buffer.concat(parts).toString();
}

// Generate a download catalog and service worker for public articles
hexo.extend.filter.register(
    'after_generate',
    async function () {
        if (!this.theme.config.offline?.enabled) return;
        const root = content.root(this),
            articles = {},
            cfg = this.theme.config.offline;

        // Collect local scripts, styles, and images while excluding encrypted resources
        function resources(html, articleUrl) {
            const $ = load(html),
                manifest = JSON.parse($('#flux-manifest').text()),
                urls = new Set([
                    manifest.assets?.['js/runtime.js'] || root + 'js/runtime.js',
                    manifest.assets?.['js/view-transitions.js'] || root + 'js/view-transitions.js',
                    manifest.assets?.['js/vendor/alpine.js'] || root + 'js/vendor/alpine.js',
                    manifest.assets?.['js/vendor/collapse.js'] || root + 'js/vendor/collapse.js',
                ]);

            for (const name of manifest.features)
                urls.add(manifest.assets?.['js/' + name + '.js'] || root + 'js/' + name + '.js');
            if (manifest.features.includes('link-previews'))
                urls.add(root + 'link-previews/default.json');
            if (manifest.features.includes('mermaid'))
                urls.add(
                    manifest.assets?.['js/vendor/mermaid.js'] || root + 'js/vendor/mermaid.js'
                );
            if (manifest.math)
                for (const name of this.route
                    .list()
                    .filter((name) => name.startsWith('fonts/katex/')))
                    urls.add(root + name);
            $('link[rel="stylesheet"],link[rel="icon"]').each((i, e) =>
                urls.add($(e).attr('href'))
            );
            $('.post-content img').each((i, e) => {
                const img = $(e);
                urls.add(img.attr('src'));
                urls.add(img.attr('data-original-src'));
                for (const src of (img.attr('srcset') || '').split(','))
                    urls.add(src.trim().split(/\s/)[0]);
            });
            // Save only the small public preview metadata, never linked attachments
            $('.post-content a[data-flux-preview]').each((i, e) =>
                urls.add($(e).attr('data-flux-preview'))
            );
            const base = new URL(articleUrl, this.config.url);
            return [...urls]
                .filter(Boolean)
                .filter((u) => {
                    try {
                        const url = new URL(u, base);
                        return (
                            url.origin === base.origin &&
                            !url.pathname.includes('/_encrypted/') &&
                            !/^(data:|blob:)/.test(u)
                        );
                    } catch {
                        return false;
                    }
                })
                .map((u) => new URL(u, base).pathname);
        }

        // Include the reading library shell so saved articles stay discoverable offline
        const shellPath = 'reading/index.html';
        if (!this.route.list().includes(shellPath))
            throw new Error('Offline reading requires reading.enabled.');
        const shellHtml = await read(this.route.get(shellPath)),
            shell = [root + 'reading/', ...resources.call(this, shellHtml, root + 'reading/')];

        for (const doc of this.fluxDocs || []) {
            if (doc.encrypted) continue;
            const route = doc.url.slice(root.length).replace(/\/$/, '') + '/index.html';
            if (!this.route.list().includes(route)) continue;
            articles[doc.url] = {
                title: doc.title,
                resources: resources.call(this, await read(this.route.get(route)), doc.url),
            };
        }
        const configuration = {
            root,
            articles,
            shell,
            maxArticles: cfg.max_articles || 50,
            maxBytes: cfg.max_bytes || 50 * 1024 * 1024,
        };
        this.route.set('offline/catalog.json', JSON.stringify(configuration));
        this.route.set(
            'flux-sw.js',
            'const CONFIG=' +
                JSON.stringify(configuration) +
                ';\n' +
                fs.readFileSync(path.join(this.theme_dir, 'lib/service-worker.js'), 'utf8')
        );
    },
    100
);
