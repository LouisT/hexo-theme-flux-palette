'use strict';
const fs = require('node:fs'),
    path = require('node:path'),
    providers = require('./search-providers.cjs');
const seen = new WeakMap();

// Report invalid settings with a consistent theme-specific error prefix
function fail(name, expected) {
    throw new Error('[Flux config] ' + name + ' must be ' + expected);
}

// Validate optional integer settings within their supported bounds
function integer(value, name, min, max) {
    if (value !== undefined && (!Number.isInteger(value) || value < min || value > max))
        fail(name, `an integer from ${min} to ${max}`);
}

// Require optional text settings to remain strings
function text(value, name) {
    if (value !== undefined && typeof value !== 'string') fail(name, 'text');
}

// Require array settings to contain nonempty text entries
function strings(value, name) {
    if (
        value !== undefined &&
        (!Array.isArray(value) || value.some((v) => typeof v !== 'string' || !v.trim()))
    )
        fail(name, 'an array of nonempty strings');
}

// Validate navigation URLs without allowing embedded credentials
function link(value, name) {
    if (typeof value !== 'string' || !value || !/^(?:\/(?!\/)|https?:\/\/)/i.test(value))
        fail(name, 'a site-root path or HTTP(S) URL');
    try {
        const u = new URL(value, 'https://flux.invalid');
        if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password)
            throw new Error();
    } catch {
        fail(name, 'a valid URL');
    }
}

// Validate series, curation, and project case-study front matter
function content(item) {
    if (item.pinned !== undefined && typeof item.pinned !== 'boolean')
        integer(item.pinned, 'pinned', 1, Number.MAX_SAFE_INTEGER);
    if (item.featured !== undefined && typeof item.featured !== 'boolean')
        fail('featured', 'a boolean');
    if (item.series !== undefined) {
        if (typeof item.series !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.series))
            fail('series', 'a lowercase slug');
        if (item.series_order === undefined)
            fail('series_order', 'a positive integer for a series chapter');
        integer(item.series_order, 'series_order', 1, Number.MAX_SAFE_INTEGER);
    }
    text(item.project_role, 'project_role');
    strings(item.project_stack, 'project_stack');
    strings(item.project_outcomes, 'project_outcomes');
    if (item.project_screenshots !== undefined) {
        if (!Array.isArray(item.project_screenshots)) fail('project_screenshots', 'an array');
        for (const image of item.project_screenshots) {
            if (
                !image ||
                typeof image.src !== 'string' ||
                !image.src.trim() ||
                (/^(?:[a-z]+:|\/\/)/i.test(image.src) && !/^https?:\/\//i.test(image.src))
            )
                fail('project_screenshots.src', 'a local path or HTTP(S) URL');
            if (typeof image.alt !== 'string' || !image.alt.trim())
                fail('project_screenshots.alt', 'nonempty text');
            text(image.caption, 'project_screenshots.caption');
        }
    }
}

// Validate changed site and theme settings once per configuration signature
function validate(ctx) {
    const cfg = ctx.theme.config,
        signature = JSON.stringify([ctx.config.url, ctx.config.root, cfg]);
    if (seen.get(ctx) === signature) return;
    let site;
    try {
        site = new URL(ctx.config.url);
    } catch {
        fail('url', 'an absolute HTTP(S) site URL');
    }
    if (
        !['http:', 'https:'].includes(site.protocol) ||
        site.username ||
        site.password ||
        site.search ||
        site.hash
    )
        fail('url', 'an absolute HTTP(S) site URL without credentials, query, or fragment');
    if (
        typeof ctx.config.root !== 'string' ||
        !/^\/(?!\/)/.test(ctx.config.root) ||
        ctx.config.root.includes('..') ||
        /[?#\\]/.test(ctx.config.root)
    )
        fail('root', 'a site-root path');
    integer(cfg.build?.concurrency, 'build.concurrency', 1, 8);
    integer(cfg.images?.quality, 'images.quality', 1, 100);
    if (
        cfg.images?.widths !== undefined &&
        (!Array.isArray(cfg.images.widths) ||
            !cfg.images.widths.length ||
            cfg.images.widths.some((w) => !Number.isInteger(w) || w < 1 || w > 16384))
    )
        fail('images.widths', 'a nonempty array of positive widths up to 16384');
    integer(cfg.search?.debounce, 'search.debounce', 0, 5000);
    integer(cfg.home?.curated?.pinned_limit, 'home.curated.pinned_limit', 1, 100);
    integer(cfg.home?.curated?.projects_limit, 'home.curated.projects_limit', 1, 100);
    for (const [name, values] of Object.entries({
        assets: ['minify_css', 'fingerprint', 'cache_headers'],
        series: ['enabled'],
        'home.curated': ['enabled'],
    })) {
        const object = name === 'home.curated' ? cfg.home?.curated : cfg[name];
        for (const key of values)
            if (object?.[key] !== undefined && typeof object[key] !== 'boolean')
                fail(name + '.' + key, 'a boolean');
    }
    if (cfg.home?.mode !== undefined && !['blog', 'projects'].includes(cfg.home.mode))
        fail('home.mode', 'blog or projects');
    if (cfg.home?.curated?.topics !== undefined) {
        if (!Array.isArray(cfg.home.curated.topics)) fail('home.curated.topics', 'an array');
        for (const topic of cfg.home.curated.topics) {
            if (!topic || typeof topic.label !== 'string' || !topic.label.trim())
                fail('home.curated.topics.label', 'nonempty text');
            link(topic.url, 'home.curated.topics.url');
        }
    }
    if (cfg.series?.items !== undefined) {
        if (
            !cfg.series.items ||
            typeof cfg.series.items !== 'object' ||
            Array.isArray(cfg.series.items)
        )
            fail('series.items', 'an object keyed by series slug');
        for (const [id, item] of Object.entries(cfg.series.items)) {
            if (
                !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) ||
                !item ||
                typeof item !== 'object' ||
                Array.isArray(item)
            )
                fail('series.items', 'an object keyed by lowercase series slugs');
            text(item.title, 'series.items.' + id + '.title');
            text(item.description, 'series.items.' + id + '.description');
        }
    }
    const selector = cfg.sidebar?.palette_selector || {},
        folder = path.resolve(ctx.theme_dir, 'source', selector.palette_folder || 'css/palettes');
    // Verify palette defaults and include lists against the installed palette files
    const available = ['dark', 'light'].flatMap((mode) => {
        const dir = path.join(folder, 'enabled', mode);
        return fs.existsSync(dir)
            ? fs
                  .readdirSync(dir)
                  .filter((f) => f.endsWith('.css'))
                  .map((f) => ({ key: f.replace(/^palette-/, '').replace(/\.css$/, ''), mode }))
            : [];
    });
    strings(selector.include, 'sidebar.palette_selector.include');
    for (const key of selector.include || [])
        if (!available.some((p) => p.key === key))
            fail('sidebar.palette_selector.include', 'existing palette keys');
    for (const [mode, key] of [
        ['dark', selector.default_dark || 'solar-amber'],
        ['light', selector.default_light || 'paper-and-ink'],
    ])
        if (
            !available.some((p) => p.key === key && p.mode === mode) ||
            (selector.include && !selector.include.includes(key))
        )
            fail('sidebar.palette_selector.default_' + mode, 'an included ' + mode + ' palette');
    if (cfg.search?.enabled !== false) providers.resolve(cfg.search || {});
    const known = new Set([
        'menu',
        'home',
        'blog',
        'projects',
        'archive',
        'search',
        'cloud',
        'backtotop',
        'sidebar',
        'feeds',
        'short_url',
        'swc',
        'read_time',
        'comments',
        'gallery',
        'link_previews',
        'attribution',
        'reading',
        'related_content',
        'images',
        'heading_links',
        'print',
        'offline',
        'embeds',
        'content_freshness',
        'build_cache',
        'playground',
        'assets',
        'build',
        'series',
        'favicon',
        'default_og_image',
        'rss',
        'sitemap',
    ]);
    for (const key of Object.keys(cfg))
        if (!known.has(key)) ctx.log.warn('[Flux config] Unknown theme setting: %s', key);
    seen.set(ctx, signature);
}

module.exports = { validate, content, integer, link };
