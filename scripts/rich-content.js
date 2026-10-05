'use strict';
const fs = require('node:fs'),
    path = require('node:path'),
    esbuild = require('esbuild'),
    rich = require('../lib/rich-content.cjs'),
    cache = require('../lib/cache.cjs'),
    content = require('../lib/content.cjs');

rich.register(hexo);
hexo.extend.filter.register('before_post_render', rich.protectRaw, 1);
hexo.extend.filter.register('after_post_render', rich.finalize, 8);

// Publish local vendors through the same route/fingerprinting pipeline as other features
hexo.extend.generator.register('flux_rich_vendors', async function () {
    const vendors = path.dirname(require.resolve('katex/package.json')),
        root = content.root(this),
        routes = [
            {
                path: 'css/vendor/katex.css',
                data: fs
                    .readFileSync(path.join(vendors, 'dist/katex.min.css'), 'utf8')
                    .replace(
                        /url\((?:["'])?fonts\/([^)'"\s]+)(?:["'])?\)/g,
                        (_, font) => `url("${root}fonts/katex/${font}")`
                    ),
            },
        ];
    for (const font of fs.readdirSync(path.join(vendors, 'dist/fonts')))
        routes.push({
            path: 'fonts/katex/' + font,
            data: fs.readFileSync(path.join(vendors, 'dist/fonts', font)),
        });
    const entry = path.join(
            path.dirname(require.resolve('mermaid/package.json')),
            'dist/mermaid.esm.mjs'
        ),
        key = [
            require('mermaid/package.json').version,
            esbuild.version,
            cache.hash(fs.readFileSync(__filename)),
            fs.readFileSync(path.resolve(vendors, '../../package-lock.json'), 'utf8'),
        ],
        cached = cache.get(this, 'rich-vendor', key);
    let bundle = cached;
    if (!bundle) {
        const bundles = (globalThis[Symbol.for('flux.mermaid.bundles')] ||= new Map()),
            digest = cache.hash(key);
        if (!bundles.has(digest))
            bundles.set(
                digest,
                esbuild
                    .build({
                        stdin: {
                            contents: `import mermaid from ${JSON.stringify(entry)}; window.FluxMermaid = mermaid;`,
                            resolveDir: this.theme_dir,
                        },
                        bundle: true,
                        write: false,
                        format: 'iife',
                        platform: 'browser',
                        target: 'es2020',
                        minify: true,
                        legalComments: 'inline',
                    })
                    .then((output) => output.outputFiles[0].text)
                    .catch((error) => {
                        bundles.delete(digest);
                        throw error;
                    })
            );
        bundle = await bundles.get(digest);
        cache.set(this, 'rich-vendor', key, bundle);
    }
    routes.push({ path: 'js/vendor/mermaid.js', data: bundle });
    const locals = this.locals.toObject(),
        items = [
            ...content.array(locals.posts),
            ...content.array(locals.pages),
            ...(this.fluxProjects || []),
        ];
    this.fluxRichPublicDownloads = new Set();
    for (const item of items) {
        for (const download of item.flux_rich_downloads || []) {
            // Recheck the source location when unchanged Markdown reuses rendered HTML
            download.file = rich.localFile(this, item, content.url(this, download.route)).file;
            this.fluxRichPublicDownloads.add(download.route);
            routes.push({ path: download.route, data: fs.readFileSync(download.file) });
        }
    }
    return routes;
});
