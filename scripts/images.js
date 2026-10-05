'use strict';
const fs = require('node:fs'),
    path = require('node:path'),
    sharp = require('sharp'),
    { load } = require('cheerio'),
    cache = require('../lib/cache.cjs'),
    content = require('../lib/content.cjs'),
    version = sharp.versions.sharp,
    tasks = require('../lib/tasks.cjs'),
    pending = new WeakMap(),
    files = () => path.join(cache.folder(hexo), 'image-files');

// Track image work in the current build or carry it into the next generation
function count(ctx, key, value) {
    const name = ctx.fluxCountingGeneration ? 'fluxImageStats' : 'fluxPendingImageStats';
    ctx[name] ||= { transformed: 0, reused: 0 };
    ctx[name][key] += value;
}

// Resolve project asset links before image optimization and encryption
hexo.extend.filter.register(
    'after_post_render',
    function (data) {
        if (!String(data._id || '').startsWith('project-') || !data.asset_dir) return data;
        const $ = load(data.content || '', null, false),
            prefix = content.root(this),
            // Prefer project assets only when the same path has no site-wide source file
            resolveAsset = (src) => {
                if (!src || /^(?:https?:|\/\/|data:|blob:)/i.test(src) || !src.startsWith('/'))
                    return src;
                const rooted = src.startsWith(prefix) ? src.slice(prefix.length) : src.slice(1),
                    relative = rooted.startsWith(data.path)
                        ? rooted.slice(data.path.length)
                        : rooted,
                    file = path.resolve(data.asset_dir, decodeURIComponent(relative));
                if (
                    file.startsWith(path.resolve(data.asset_dir) + path.sep) &&
                    fs.existsSync(file) &&
                    !fs.existsSync(path.resolve(this.source_dir, rooted))
                )
                    return content.url(this, data.path + relative);
                return src;
            };
        $('img,source').each((i, node) => {
            const el = $(node);

            for (const attr of ['src', 'data-original-src'])
                if (el.attr(attr)) el.attr(attr, resolveAsset(el.attr(attr)));
            if (el.attr('srcset'))
                el.attr(
                    'srcset',
                    el
                        .attr('srcset')
                        .split(',')
                        .map((value) => {
                            const parts = value.trim().split(/\s+/);
                            parts[0] = resolveAsset(parts[0]);
                            return parts.join(' ');
                        })
                        .join(', ')
                );
        });
        data.content = $.html();
        return data;
    },
    15
);

// Generate responsive variants for eligible local images in public content
async function optimize(data) {
    if (!data.content || content.protectedItem(data) || this.theme.config.images?.enabled === false)
        return data;
    const $ = load(data.content, null, false),
        cfg = this.theme.config.images || {};
    let index = 0;

    for (const img of $('img').toArray()) {
        const el = $(img),
            src = el.attr('data-original-src') || el.attr('src') || '',
            first = index++ === 0;
        el.attr('decoding', el.attr('decoding') || 'async');
        el.attr('loading', el.attr('loading') || (first ? 'eager' : 'lazy'));
        if ((el.attr('srcset') || '').includes('/flux-images/')) el.removeAttr('srcset');
        if (
            el.attr('srcset') ||
            el.closest('picture').length ||
            /^(?:https?:|\/\/|data:|blob:)/i.test(src) ||
            !/\.(png|jpe?g|webp)$/i.test(src)
        )
            continue;
        let file;
        const rooted = src.startsWith(content.root(this))
                ? src.slice(content.root(this).length)
                : src.replace(/^\//, ''),
            candidates = src.startsWith('/')
                ? [path.resolve(this.source_dir, rooted)]
                : [
                      path.resolve(
                          data.asset_dir || path.dirname(data.full_source || this.source_dir),
                          src
                      ),
                      path.resolve(this.source_dir, src),
                  ];
        if (data.asset_dir && rooted.startsWith(data.path || '\0'))
            candidates.push(path.resolve(data.asset_dir, rooted.slice(data.path.length)));
        file = candidates.find(
            (f) =>
                (f.startsWith(path.resolve(this.source_dir) + path.sep) ||
                    f.startsWith(path.resolve(this.theme_dir, 'source') + path.sep)) &&
                fs.existsSync(f)
        );
        if (!file) {
            this.log.warn('[images] Local image not found: %s', src);
            continue;
        }
        try {
            const buffer = fs.readFileSync(file),
                meta = await tasks.run(this, () => sharp(buffer).metadata());
            if (meta.pages > 1) continue;
            const rotated = meta.orientation >= 5,
                intrinsicWidth = rotated ? meta.height : meta.width,
                intrinsicHeight = rotated ? meta.width : meta.height,
                widths = cfg.widths || [320, 640, 960, 1280],
                key = [
                    cache.hash(buffer),
                    widths,
                    cfg.quality || 80,
                    version,
                    cache.hash(fs.readFileSync(__filename)),
                ];
            let variants = cache.get(this, 'images', key);
            if (!variants) {
                if (!pending.has(this)) pending.set(this, new Map());
                const work = pending.get(this),
                    digest = cache.hash(key);
                // Share pending transforms when several articles reference the same image
                if (!work.has(digest)) {
                    const job = Promise.all(
                        [...new Set(widths.map((w) => Math.min(w, intrinsicWidth)))]
                            .sort((a, b) => a - b)
                            .map((width) =>
                                tasks.run(this, async () => {
                                    const output = await sharp(buffer)
                                        .rotate()
                                        .resize({ width, withoutEnlargement: true })
                                        .webp({ quality: cfg.quality ?? 80 })
                                        .toBuffer({ resolveWithObject: true });
                                    return {
                                        name:
                                            digest.slice(0, 20) + '-' + output.info.width + '.webp',
                                        width: output.info.width,
                                        buffer: output.data.toString('base64'),
                                    };
                                })
                            )
                    )
                        .then((result) => {
                            cache.set(this, 'images', key, result);
                            count(this, 'transformed', result.length);
                            return result;
                        })
                        .finally(() => work.delete(digest));
                    work.set(digest, job);
                } else
                    count(
                        this,
                        'reused',
                        [...new Set(widths.map((w) => Math.min(w, intrinsicWidth)))].length
                    );
                variants = await work.get(digest);
            } else count(this, 'reused', variants.length);
            fs.mkdirSync(files(), { recursive: true });
            for (const v of variants)
                fs.writeFileSync(path.join(files(), v.name), Buffer.from(v.buffer, 'base64'));
            if (el.attr('data-flux-dimensions') || (!el.attr('width') && !el.attr('height'))) {
                el.attr('width', intrinsicWidth);
                el.attr('height', intrinsicHeight);
                el.attr('data-flux-dimensions', 'true');
            }
            el.attr(
                'src',
                src.startsWith('/')
                    ? src
                    : new URL(src, 'https://local.invalid' + content.url(this, data.path || ''))
                          .pathname
            );
            el.attr('data-original-src', el.attr('src'));
            el.attr(
                'srcset',
                variants
                    .map((v) => `${content.url(this, 'flux-images/' + v.name)} ${v.width}w`)
                    .join(', ')
            );
            el.attr(
                'sizes',
                el.attr('sizes') ||
                    (el.closest('.gallery-grid').length
                        ? '(max-width: 600px) 45vw, 300px'
                        : '(max-width: 600px) 95vw, (max-width: 1200px) 70vw, 960px')
            );
        } catch (e) {
            this.log.warn('[images] %s: %s', src, e.message);
        }
    }
    data.content = $.html();
    return data;
}

hexo.extend.filter.register('after_post_render', optimize, 20);
// Recheck asset dependencies even when Hexo reuses an unchanged post's rendered HTML
hexo.extend.filter.register(
    'before_generate',
    async function () {
        await Promise.all(
            [
                ...content.array(this.locals.get('posts')),
                ...content.array(this.locals.get('pages')),
            ].map(async (item) => {
                if (/<img\b/.test(item.content || '')) {
                    const original = item.content;
                    await optimize.call(this, item);
                    if (item.content !== original && typeof item.save === 'function')
                        await item.save();
                }
            })
        );
    },
    15
);

// Publish referenced variants and remove image files left by earlier builds
hexo.extend.generator.register('flux_images', function (locals) {
    const html = [
            ...content.array(locals.posts),
            ...content.array(locals.pages),
            ...(this.fluxProjects || []),
        ]
            .filter((p) => !content.protectedItem(p))
            .map((p) => p.content || '')
            .join(' '),
        names = [
            ...new Set([...html.matchAll(/flux-images\/([a-f0-9]+-\d+\.webp)/g)].map((m) => m[1])),
        ];
    if (fs.existsSync(files()))
        for (const name of fs.readdirSync(files()))
            if (!names.includes(name)) fs.rmSync(path.join(files(), name));
    return names
        .filter((n) => fs.existsSync(path.join(files(), n)))
        .map((n) => ({ path: 'flux-images/' + n, data: fs.readFileSync(path.join(files(), n)) }));
});
// Hexo skips _projects directories: publish only referenced public project assets
hexo.extend.generator.register('flux_project_assets', function () {
    const routes = new Map();

    for (const item of (this.fluxProjects || []).filter((p) => !content.protectedItem(p))) {
        const $ = load(item.content || ''),
            base = new URL(content.url(this, item.path), 'https://flux.invalid'),
            sources = [];
        $('img,source').each((i, node) => {
            sources.push($(node).attr('src'), $(node).attr('data-original-src'));
            sources.push(
                ...($(node).attr('srcset') || '').split(',').map((v) => v.trim().split(/\s/)[0])
            );
        });
        for (const source of sources.filter(Boolean))
            try {
                const target = new URL(source, base);
                if (target.origin !== base.origin || !target.pathname.startsWith(base.pathname))
                    continue;
                const relative = decodeURIComponent(target.pathname.slice(base.pathname.length)),
                    file = path.resolve(item.asset_dir, relative);
                if (
                    file.startsWith(path.resolve(item.asset_dir) + path.sep) &&
                    fs.existsSync(file) &&
                    fs.statSync(file).isFile()
                )
                    routes.set(
                        decodeURIComponent(target.pathname.slice(content.root(this).length)),
                        fs.readFileSync(file)
                    );
            } catch {}
    }
    return [...routes].map(([path, data]) => ({ path, data }));
});
