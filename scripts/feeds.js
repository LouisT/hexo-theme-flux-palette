'use strict';
const { stripHTML } = require('hexo-util');

// Escape XML reserved characters
function xmlEscape(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

// Convert Hexo models to plain arrays
function toArray(model) {
    if (!model) return [];
    if (Array.isArray(model)) return model;
    if (Array.isArray(model.data)) return model.data;
    if (typeof model.toArray === 'function') return model.toArray();
    return [];
}

// Parse unknown values into valid Date objects
function asDate(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

// Build absolute URLs from route paths
function asAbsoluteUrl(siteUrl, targetPath, urlFor) {
    const relative = urlFor(targetPath || '/');
    if (/^https?:\/\//i.test(relative)) return relative;
    const normalized = relative.startsWith('/') ? relative : `/${relative}`;
    return `${siteUrl}${normalized}`;
}

// Strip markup and trim text to a max length
function plainText(value, maxLen) {
    if (!value) return '';
    const cleaned = stripHTML(String(value)).replace(/\s+/g, ' ').trim();
    if (!maxLen || cleaned.length <= maxLen) return cleaned;
    return `${cleaned.slice(0, Math.max(0, maxLen - 3)).trimEnd()}...`;
}

// Read taxonomy collections into flat name arrays
function collectionNames(value) {
    return toArray(value)
        .map((item) => (typeof item === 'string' ? item : item && item.name))
        .filter(Boolean)
        .map((item) => String(item));
}

// Select the latest valid date from a list
function latestDate(values) {
    return values.reduce((latest, value) => {
        const date = asDate(value);
        if (!date) return latest;
        if (!latest || date > latest) return date;
        return latest;
    }, null);
}

// Normalize paths for route and config comparisons
function normalizeRoutePath(value) {
    return String(value || '')
        .replace(/^\/+/, '')
        .replace(/\/+$/, '');
}

// Normalize route path lists from config values
function normalizedPathList(value) {
    if (!value) return [];
    const input = Array.isArray(value) ? value : [value];
    return input.map((item) => normalizeRoutePath(item)).filter(Boolean);
}

// Build feed entries with public summaries for password-protected posts
function buildPostEntries(ctx, locals, cfg, siteUrl, urlFor) {
    const now = Date.now();
    let posts = toArray(locals.posts.sort('-date')).filter((post) => {
        if (post.published === false) return false;
        if (!cfg.include_drafts && post.draft) return false;
        if (!cfg.include_future && post.date && post.date.valueOf() > now) return false;
        if (post.feed === false || post.rss === false) return false;
        return true;
    });

    if (cfg.limit > 0) posts = posts.slice(0, cfg.limit);

    return posts.map((post) => {
        const isEncrypted = Boolean('password' in post ? post.password : post.encrypted);
        let title = post.title || post.slug || '';
        if (isEncrypted && cfg.mark_encrypted_in_title) title = `[Encrypted] ${title}`;

        return {
            title,
            url: asAbsoluteUrl(siteUrl, post.path, urlFor),
            date: asDate(post.date),
            updated: asDate(post.updated || post.date),
            summary: isEncrypted
                ? 'This post has been password protected.'
                : plainText(post.excerpt || post.content || '', cfg.summary_length),
            encrypted: isEncrypted,
            categories: collectionNames(post.categories),
            tags: collectionNames(post.tags),
            author: post.author || ctx.config.author || '',
        };
    });
}

// Apply sitemap visibility rules to posts and pages
function includeSitemapEntry(entry, cfg, now) {
    if (!entry) return false;
    if (entry.published === false) return false;
    if (!cfg.include_drafts && entry.draft) return false;
    if (!cfg.include_future && entry.date && entry.date.valueOf() > now) return false;
    if (entry.noindex === true || entry.sitemap === false) return false;
    return true;
}

// Build sitemap URL entries from enabled site collections
function buildSitemapEntries(ctx, locals, cfg, siteUrl, urlFor) {
    const now = Date.now(),
        entries = new Map(),
        excluded = new Set(cfg.sitemap.exclude.slice());

    excluded.add(normalizeRoutePath(cfg.sitemap.path));
    excluded.add(normalizeRoutePath(cfg.rss.path));
    excluded.add(normalizeRoutePath(cfg.atom.path));

    // Deduplicate sitemap URLs while retaining the latest valid update date
    const add = (targetPath, dateValue) => {
        const routePath = targetPath || '/',
            normalizedPath = normalizeRoutePath(routePath);
        if (excluded.has(normalizedPath)) return;

        const loc = asAbsoluteUrl(siteUrl, routePath, urlFor),
            date = asDate(dateValue);

        if (!entries.has(loc)) {
            entries.set(loc, date);
            return;
        }

        const existing = entries.get(loc);
        if (!existing || (date && date > existing)) entries.set(loc, date);
    };

    if (cfg.sitemap.include_home) add('/', null);

    if (cfg.sitemap.include_posts) {
        toArray(locals.posts).forEach((post) => {
            if (!includeSitemapEntry(post, cfg, now)) return;
            add(post.path, post.updated || post.date);
        });
    }

    if (cfg.sitemap.include_pages) {
        toArray(locals.pages).forEach((page) => {
            if (!includeSitemapEntry(page, cfg, now)) return;
            add(page.path, page.updated || page.date);
        });
    }

    if (cfg.sitemap.include_archives) add('/archives/', null);

    if (cfg.sitemap.include_search_page && ctx.theme.config?.search?.enabled !== false)
        add('/search/', null);

    if (cfg.sitemap.include_categories) {
        add('/categories/', null);
        toArray(locals.categories).forEach((category) => {
            const categoryPosts = toArray(category.posts).filter((post) =>
                    includeSitemapEntry(post, cfg, now)
                ),
                categoryDate = latestDate(categoryPosts.map((post) => post.updated || post.date));
            add(category.path, categoryDate);
        });
    }

    if (cfg.sitemap.include_tags) {
        add('/tags/', null);
        toArray(locals.tags).forEach((tag) => {
            const tagPosts = toArray(tag.posts).filter((post) =>
                    includeSitemapEntry(post, cfg, now)
                ),
                tagDate = latestDate(tagPosts.map((post) => post.updated || post.date));
            add(tag.path, tagDate);
        });
    }

    if (cfg.sitemap.include_projects) {
        toArray(locals.projects).forEach((project) => {
            if (!includeSitemapEntry(project, cfg, now)) return;
            add(project.path, project.updated || project.date);
        });
    }

    if (ctx.fluxSeries?.length) {
        add('/series/', null);
        for (const group of ctx.fluxSeries)
            add(
                '/series/' + group.id + '/',
                latestDate(group.chapters.map((chapter) => chapter.date))
            );
    }
    return Array.from(entries.entries()).map(([loc, date]) => ({ loc, date }));
}

// Render RSS XML output from prepared post entries
function renderRssXml(entries, ctx, cfg, siteUrl) {
    const updated = latestDate(entries.map((item) => item.updated || item.date)),
        channelDate = updated ? updated.toUTCString() : new Date().toUTCString(),
        feedSelf = `${siteUrl}/${String(cfg.rss.path).replace(/^\/+/, '')}`,
        itemsXml = entries
            .map((entry) => {
                const encryptedTag =
                        entry.encrypted && cfg.add_encrypted_element
                            ? '      <encrypted>true</encrypted>\n'
                            : '',
                    categoryNodes = entry.categories
                        .concat(entry.tags)
                        .map((value) => `      <category>${xmlEscape(value)}</category>`)
                        .join('\n'),
                    categoryBlock = categoryNodes ? `${categoryNodes}\n` : '';

                return [
                    '    <item>',
                    `      <title>${xmlEscape(entry.title)}</title>`,
                    `      <link>${xmlEscape(entry.url)}</link>`,
                    `      <guid isPermaLink="true">${xmlEscape(entry.url)}</guid>`,
                    `      <pubDate>${entry.date ? xmlEscape(entry.date.toUTCString()) : ''}</pubDate>`,
                    `      <description>${xmlEscape(entry.summary)}</description>`,
                    categoryBlock + encryptedTag + '    </item>',
                ].join('\n');
            })
            .join('\n');

    return `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${xmlEscape(ctx.config.title || '')}</title>
    <link>${xmlEscape(siteUrl)}/</link>
    <atom:link href="${xmlEscape(feedSelf)}" rel="self" type="application/rss+xml" />
    <description>${xmlEscape(ctx.config.description || '')}</description>
    <lastBuildDate>${xmlEscape(channelDate)}</lastBuildDate>
    <generator>theme-flux-palette-feeds</generator>
${itemsXml}
  </channel>
</rss>
`;
}

// Render Atom XML output from prepared post entries
function renderAtomXml(entries, ctx, cfg, siteUrl) {
    const updated = latestDate(entries.map((item) => item.updated || item.date)) || new Date(),
        selfLink = `${siteUrl}/${String(cfg.atom.path).replace(/^\/+/, '')}`,
        entryXml = entries
            .map((entry) => {
                const categoryNodes = entry.categories
                        .concat(entry.tags)
                        .map((value) => `    <category term="${xmlEscape(value)}" />`)
                        .join('\n'),
                    authorNode = entry.author
                        ? `    <author><name>${xmlEscape(entry.author)}</name></author>\n`
                        : '';

                return `<entry>
    <title>${xmlEscape(entry.title)}</title>
    <id>${xmlEscape(entry.url)}</id>
    <link href="${xmlEscape(entry.url)}" />
    <published>${entry.date ? entry.date.toISOString() : updated.toISOString()}</published>
    <updated>${(entry.updated || entry.date || updated).toISOString()}</updated>
${authorNode}${categoryNodes ? `${categoryNodes}\n` : ''}    <summary>${xmlEscape(entry.summary)}</summary>
  </entry>`;
            })
            .join('\n');

    return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${xmlEscape(ctx.config.title || '')}</title>
  <id>${xmlEscape(siteUrl)}/</id>
  <link href="${xmlEscape(siteUrl)}/" />
  <link href="${xmlEscape(selfLink)}" rel="self" />
  <updated>${updated.toISOString()}</updated>
  <subtitle>${xmlEscape(ctx.config.description || '')}</subtitle>
  <generator>theme-flux-palette-feeds</generator>
${entryXml}
</feed>
`;
}

// Render sitemap XML output from URL entries
function renderSitemapXml(entries) {
    const rows = entries
        .sort((a, b) => a.loc.localeCompare(b.loc))
        .map((entry) => {
            const lastmod = entry.date
                ? `\n    <lastmod>${entry.date.toISOString()}</lastmod>`
                : '';
            return `  <url>\n    <loc>${xmlEscape(entry.loc)}</loc>${lastmod}\n  </url>`;
        })
        .join('\n');

    return `<?xml version="1.0" encoding="utf-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${rows}
</urlset>
`;
}

// Merge new feed config with legacy keys for compatibility
function resolveFeedConfig(themeConfig) {
    const legacy = themeConfig.rss || {},
        legacySitemap = themeConfig.sitemap || {},
        feeds = themeConfig.feeds || {},
        root = Object.assign({}, legacy, feeds),
        rss = Object.assign({}, legacy.rss || {}, feeds.rss || {}),
        atom = Object.assign(
            {},
            legacy.attom || {},
            legacy.atom || {},
            feeds.attom || {},
            feeds.atom || {}
        ),
        sitemap = Object.assign({}, legacySitemap, legacy.sitemap || {}, feeds.sitemap || {});

    return {
        enabled: root.enabled !== false,
        limit: Number.isFinite(root.limit) ? root.limit : 20,
        include_drafts: root.include_drafts === true,
        include_future: root.include_future === true,
        mark_encrypted_in_title: root.mark_encrypted_in_title !== false,
        add_encrypted_element: root.add_encrypted_element !== false,
        summary_length: Number.isFinite(root.summary_length) ? root.summary_length : 300,
        rss: {
            enabled: root.enable_rss !== false && rss.enabled !== false,
            path:
                normalizeRoutePath(rss.path || root.path || root.rss_path || 'rss.xml') ||
                'rss.xml',
        },
        atom: {
            enabled:
                root.enable_attom !== false && root.enable_atom !== false && atom.enabled !== false,
            path:
                normalizeRoutePath(atom.path || root.atom_path || root.attom_path || 'atom.xml') ||
                'atom.xml',
        },
        sitemap: {
            enabled:
                root.enable_sitemap !== false &&
                root.enable_sidemap !== false &&
                sitemap.enabled !== false,
            path:
                normalizeRoutePath(
                    sitemap.path || root.sitemap_path || root.sidemap_path || 'sitemap.xml'
                ) || 'sitemap.xml',
            include_home: sitemap.include_home !== false,
            include_posts: sitemap.include_posts !== false,
            include_pages: sitemap.include_pages !== false,
            include_archives: sitemap.include_archives !== false,
            include_categories: sitemap.include_categories !== false,
            include_tags: sitemap.include_tags !== false,
            include_projects: sitemap.include_projects !== false,
            include_search_page: sitemap.include_search_page !== false,
            exclude: normalizedPathList(sitemap.exclude),
        },
    };
}

// Generate enabled feed routes for RSS Atom and sitemap
hexo.extend.generator.register('theme_feeds', function (locals) {
    const { config, theme } = this,
        cfg = resolveFeedConfig(theme.config || {}),
        urlFor = this.extend.helper.get('url_for').bind(this),
        siteUrl = (config.url || '').replace(/\/+$/, '');

    if (!cfg.enabled) return [];

    if (!siteUrl) {
        this.log.warn('[theme_feeds] config.url is not set, skipping feed generation');
        return [];
    }

    const postEntries = buildPostEntries(this, locals, cfg, siteUrl, urlFor),
        routes = [];

    if (cfg.rss.enabled) {
        routes.push({
            path: cfg.rss.path,
            data: renderRssXml(postEntries, this, cfg, siteUrl),
        });
    }

    if (cfg.atom.enabled) {
        routes.push({
            path: cfg.atom.path,
            data: renderAtomXml(postEntries, this, cfg, siteUrl),
        });
    }

    if (cfg.sitemap.enabled) {
        routes.push({
            path: cfg.sitemap.path,
            data: renderSitemapXml(buildSitemapEntries(this, locals, cfg, siteUrl, urlFor)),
        });
    }

    this.log.info(`[theme_feeds] Generated ${routes.length} feed file(s)`);
    return routes;
});
