'use strict';
const { load } = require('cheerio'),
    fm = require('hexo-front-matter'),
    content = require('../lib/content.cjs');

const markdownSource = (item) =>
        /\.(?:md|markdown)$/i.test(item.source || '') &&
        (/^_posts\//.test(item.source) || String(item._id || '').startsWith('project-')),
    // Collect content links while excluding downloads and local heading references
    links = (html) => {
        const $ = load(html || '');
        return $('a[href]')
            .filter(
                (i, element) =>
                    !$(element).is('[download]') && !$(element).closest('.rich-download').length
            )
            .map((i, element) => $(element).attr('href'))
            .get()
            .filter((href) => href && !href.startsWith('#'));
    };

// Retain build-only link references before a protected Markdown body is encrypted
hexo.extend.filter.register(
    'after_post_render',
    function (data) {
        if (markdownSource(data)) data.flux_preview_links = links(data.content);
        return data;
    },
    45
);

// Upgrade already-rendered protected posts once without exposing their bodies
hexo.extend.filter.register(
    'before_generate',
    function () {
        if (this.theme.config.link_previews?.enabled === false) return;
        for (const post of content.array(this.model('Post').find({})))
            if (
                markdownSource(post) &&
                content.protectedItem(post) &&
                !Array.isArray(post.flux_preview_links)
            ) {
                const password = fm.parse(post.raw || '').password;
                if (!password)
                    throw new Error(
                        '[link-previews] Cannot refresh protected links in ' + post.source
                    );
                post.password = password;
                post.content = null;
            }
    },
    4
);

// Read generated route streams into HTML for metadata extraction
async function read(stream) {
    const parts = [];
    for await (const part of stream) parts.push(Buffer.from(part));
    return Buffer.concat(parts).toString();
}

// Resolve generated HTML before assets and offline resources are finalized
hexo.extend.filter.register(
    'after_generate',
    async function () {
        const prefix = 'link-previews/',
            root = content.root(this),
            routes = this.route.list(),
            enabled = this.theme.config.link_previews?.enabled !== false,
            pages = [],
            targets = new Map(),
            sources = new Set(),
            referenced = new Set(),
            titles = new Map(),
            locals = this.locals.toObject(),
            siteTitle =
                this.config.title + (this.config.subtitle ? ' ' + this.config.subtitle : ''),
            // Normalize encoded route paths while preserving malformed percent escapes
            key = (url) => {
                try {
                    return decodeURI(url.pathname);
                } catch {
                    return url.pathname;
                }
            },
            base = (name) => new URL(content.url(this, name), this.config.url);

        for (const item of [
            ...content.array(locals.posts),
            ...content.array(locals.pages),
            ...(this.fluxProjects || []),
        ])
            titles.set(key(base(item.path)), item.title || item.slug || 'Untitled');

        for (const name of routes.filter((name) => /\.html$/i.test(name))) {
            const $ = load(await read(this.route.get(name))),
                url = base(name),
                directoryPage = /(?:^|\/)index\.html$/.test(name),
                canonical = directoryPage
                    ? content.url(this, name.slice(0, -10))
                    : content.url(this, name),
                title = $('title').text().trim(),
                suffix = ' | ' + siteTitle,
                protectedPage = $('.encrypted-post').length > 0,
                data = {
                    version: 1,
                    url: canonical,
                    title:
                        titles.get(key(url)) ||
                        titles.get(key(new URL(canonical, this.config.url))) ||
                        (title.endsWith(suffix) ? title.slice(0, -suffix.length) : title) ||
                        'Untitled',
                    summary: protectedPage
                        ? 'This content has been password protected.'
                        : (
                              $('meta[property="og:description"]').attr('content') ||
                              $('.post-content p').first().text() ||
                              ''
                          )
                              .replace(/\s+/g, ' ')
                              .trim()
                              .slice(0, 220),
                },
                preview =
                    prefix +
                    (name === 'default.html'
                        ? 'default.html.json'
                        : name.replace(/\.html$/i, '.json')),
                page = { $, name, url, preview, data };
            pages.push(page);
            targets.set(key(url), page);
            // Share metadata between directory URLs and their index aliases
            if (directoryPage) {
                const directory = key(new URL(canonical, this.config.url));
                targets.set(directory, page);
                if (directory !== root) targets.set(directory.replace(/\/$/, ''), page);
            }
        }

        // These metadata files are regenerated from public HTML, never private bodies
        for (const name of routes.filter(
            (name) => name.startsWith(prefix) && name.endsWith('.json')
        ))
            this.route.remove(name);
        const files = new Set(routes.map((name) => key(base(name))));
        // Limit preview generation to links authored in Markdown posts and projects
        if (enabled)
            for (const item of [
                ...content.array(locals.posts).filter((post) => content.visible(this, post)),
                ...(this.fluxProjects || []),
            ].filter(markdownSource)) {
                const source = targets.get(key(base(item.path)));
                if (!source) continue;
                sources.add(source);
                const hrefs = content.protectedItem(item)
                    ? item.flux_preview_links || []
                    : links(item.content);
                for (const href of hrefs)
                    try {
                        const url = new URL(href, source.url);
                        if (url.origin !== source.url.origin || !url.pathname.startsWith(root))
                            continue;
                        const target = targets.get(key(url));
                        if (target && target !== source) referenced.add(target);
                    } catch {}
            }
        for (const page of pages) {
            let changed = false;
            page.$('.post-content a[href]').each((i, element) => {
                const link = page.$(element),
                    href = link.attr('href');
                if (link.is('[data-flux-preview],[data-flux-no-preview]')) {
                    link.removeAttr('data-flux-preview data-flux-no-preview');
                    changed = true;
                }
                if (!enabled || !sources.has(page) || !href || href.startsWith('#')) return;
                let url;
                try {
                    url = new URL(href, page.url);
                    if (url.origin !== page.url.origin || !url.pathname.startsWith(root)) return;
                    url = key(url);
                } catch {
                    return;
                }
                const target = targets.get(url);
                if (
                    link.is('[download]') ||
                    link.closest('.rich-download').length ||
                    target === page ||
                    (!target && files.has(url))
                ) {
                    link.attr('data-flux-no-preview', '');
                    changed = true;
                } else if (target && referenced.has(target)) {
                    link.attr('data-flux-preview', content.url(this, target.preview));
                    changed = true;
                }
            });
            if (changed) this.route.set(page.name, page.$.html());
            if (enabled && referenced.has(page))
                this.route.set(page.preview, JSON.stringify(page.data));
        }
        if (enabled)
            this.route.set(
                prefix + 'default.json',
                JSON.stringify({
                    version: 1,
                    title: 'Preview unavailable',
                    summary: 'Open this link to read the page.',
                })
            );
    },
    70
);
