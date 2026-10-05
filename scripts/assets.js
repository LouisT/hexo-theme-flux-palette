'use strict';
const fs = require('node:fs'),
    { load } = require('cheerio'),
    { transform } = require('lightningcss'),
    cache = require('../lib/cache.cjs'),
    content = require('../lib/content.cjs'),
    version = require('../package.json').dependencies.lightningcss;

// Resolve route callbacks and streams into bytes for hashing
async function read(value) {
    if (typeof value === 'function') return read(value());
    if (typeof value === 'string' || Buffer.isBuffer(value)) return Buffer.from(value);
    const chunks = [];

    for await (const chunk of value) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
}

// Minify and fingerprint final assets after JavaScript compilation
hexo.extend.filter.register(
    'after_generate',
    async function () {
        const cfg = this.theme.config.assets || {},
            root = content.root(this),
            assets = {},
            digests = {};
        // Hash final bytes while retaining stable aliases for revalidation
        const paletteFolder = (
                this.theme.config.sidebar?.palette_selector?.palette_folder || 'css/palettes'
            ).replace(/^\/+|\/+$/g, ''),
            names = this.route
                .list()
                .filter(
                    (name) =>
                        /^(?:css|js)\/.*\.(?:css|js)$/.test(name) &&
                        !name.startsWith(paletteFolder + '/')
                )
                .sort();

        for (const name of names) {
            let bytes = await read(this.route.get(name));
            if (name.endsWith('.css') && cfg.minify_css !== false) {
                const key = [bytes.toString(), version, cache.hash(fs.readFileSync(__filename))];
                let saved = cache.get(this, 'css', key);
                if (saved === null) {
                    try {
                        saved = transform({
                            filename: name,
                            code: bytes,
                            minify: true,
                        }).code.toString();
                    } catch {
                        throw new Error(
                            '[assets] Could not minify ' + name + '. Check CSS syntax.'
                        );
                    }
                    cache.set(this, 'css', key, saved);
                }
                bytes = Buffer.from(saved);
                this.route.set(name, bytes);
            }
            digests[name] = cache.hash(bytes);
            const target =
                cfg.fingerprint === false
                    ? name
                    : 'flux-assets/' +
                      name
                          .replace(/\//g, '-')
                          .replace(/\.(css|js)$/, '.' + digests[name].slice(0, 20) + '.$1');
            assets[name] = root + target;
            if (target !== name) this.route.set(target, bytes);
        }
        const assetVersion = cache.hash([assets, digests]).slice(0, 20),
            current = new Set(Object.values(assets).map((url) => url.slice(root.length)));

        for (const name of this.route.list().filter((name) => name.startsWith('flux-assets/')))
            if (!current.has(name)) this.route.remove(name);
        // Rewrite current and previous asset URLs so reused HTML gets fresh fingerprints
        for (const name of this.route.list().filter((name) => name.endsWith('.html'))) {
            const $ = load((await read(this.route.get(name))).toString()),
                element = $('#flux-manifest');
            if (!element.length) continue;
            const manifest = JSON.parse(element.text()),
                old = manifest.assets || {},
                aliases = new Map();

            for (const [logical, url] of Object.entries(assets)) aliases.set(root + logical, url);
            for (const [logical, url] of Object.entries(old))
                if (assets[logical]) aliases.set(url, assets[logical]);
            $('script[src],link[href]').each((i, node) => {
                const el = $(node),
                    attr = el.is('script') ? 'src' : 'href',
                    value = el.attr(attr);
                if (aliases.has(value)) el.attr(attr, aliases.get(value));
            });
            manifest.assets = assets;
            manifest.asset_version = assetVersion;
            element.text(JSON.stringify(manifest).replace(/</g, '\\u003c'));
            this.route.set(name, $.html());
        }
        // Replace generated cache rules while preserving authored hosting headers
        const prefix = '# Flux generated cache headers';
        let headers = this.route.list().includes('_headers')
            ? (await read(this.route.get('_headers'))).toString().split(prefix)[0].trimEnd()
            : '';
        if (cfg.cache_headers === true) {
            headers +=
                '\n' +
                prefix +
                '\n' +
                [root + 'flux-assets/*', root + 'flux-images/*']
                    .map((url) => url + '\n  Cache-Control: public, max-age=31536000, immutable')
                    .join('\n') +
                '\n';
            this.route.set('_headers', headers.trimStart());
        } else if (headers) this.route.set('_headers', headers + '\n');
        else if (this.route.list().includes('_headers')) this.route.remove('_headers');
    },
    80
);
