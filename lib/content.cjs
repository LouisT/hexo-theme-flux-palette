'use strict';
const fs = require('node:fs'),
    path = require('node:path'),
    fm = require('hexo-front-matter'),
    { load } = require('cheerio'),
    cache = require('./cache.cjs'),
    core = require('../source/js/search-core.js'),
    moment = require('moment-timezone');

// Normalize arrays and Hexo model collections for shared content helpers
const array = (v) => (Array.isArray(v) ? v : v?.data || v?.toArray?.() || []);

// Collect unique taxonomy names from text values or Hexo collections
const names = (v) => [
    ...new Set(
        (typeof v === 'string' ? [v] : array(v))
            .map((x) => (typeof x === 'string' ? x : x?.name))
            .filter(Boolean)
    ),
];

// Detect protected content before it enters public metadata
const protectedItem = (v) => Boolean(v?.password || v?.encrypted);

// Extract readable text while excluding scripts, styles, and inactive templates
const plain = (v) => {
    const $ = load(String(v || ''));
    $('script,style,template').remove();
    $('br').replaceWith(' ');
    $('h1,h2,h3,h4,h5,h6,p,li,div,section,button,td,th,figcaption').after(' ');
    return $.text().replace(/\s+/g, ' ').trim();
};

// Serialize valid dates and leave invalid values empty
const iso = (v) => {
    const date = new Date(v || 0);
    return Number.isNaN(+date) ? '' : date.toISOString();
};

// Interpret front-matter dates in the configured site timezone
function authoredDate(ctx, value) {
    const date = new Date(value),
        zone = moment.tz.zone(ctx.config.timezone || '');
    return zone
        ? new Date(+date - (date.getTimezoneOffset() - zone.utcOffset(+date)) * 60000)
        : date;
}

// Normalize the site prefix with leading and trailing slashes
function root(ctx) {
    return (
        '/' +
        String(ctx.config.root || '/').replace(/^\/+|\/+$/g, '') +
        (ctx.config.root && ctx.config.root !== '/' ? '/' : '')
    );
}

// Join content routes to the configured site root
function url(ctx, value) {
    return root(ctx).replace(/\/$/, '') + '/' + String(value || '').replace(/^\/+/, '');
}

// Exclude unpublished, draft, and disallowed future content
function visible(ctx, item) {
    return (
        item.published !== false &&
        !item.draft &&
        (ctx.config.future !== false || +new Date(item.date) <= Date.now())
    );
}

// Expose shared article metadata while excluding protected bodies and excerpts
function normalize(ctx, item, type) {
    const encrypted = protectedItem(item),
        text = encrypted ? '' : plain(item.content);
    return {
        id: `${type}:${cache.hash(String(item.path)).slice(0, 20)}`,
        title: item.title || item.slug || 'Untitled',
        url: url(ctx, item.path),
        type,
        date: iso(item.date),
        day: moment(item.date)
            .tz(ctx.config.timezone || 'UTC')
            .format('YYYY-MM-DD'),
        encrypted,
        tags: names(type === 'project' ? item.project_tags || item.tags : item.tags),
        categories: names(type === 'project' ? item.project_category : item.categories),
        excerpt: encrypted
            ? 'This content has been password protected.'
            : plain(item.project_summary || item.description || item.excerpt || text).slice(0, 220),
        content: text,
    };
}

// Render project Markdown through post filters with dependency-aware cache reuse
async function loadProjects(ctx) {
    // Share pending project rendering only within the current generation
    if (ctx.fluxProjectsPromise) return ctx.fluxProjectsPromise;
    ctx.fluxProjectsPromise = (async () => {
        const dir = path.join(ctx.source_dir, '_projects');
        if (!fs.existsSync(dir)) return [];
        // Invalidate rendered projects when configuration or renderer dependencies change
        const dependency = cache.hash([
            ctx.theme.config,
            ctx.config,
            fs.readFileSync(path.join(ctx.theme_dir, 'scripts/markdown-enhancements.js'), 'utf8'),
            fs.readFileSync(path.join(ctx.theme_dir, 'lib/rich-content.cjs'), 'utf8'),
            require('katex/package.json').version,
            ...fs
                .readdirSync(path.join(ctx.theme_dir, 'scripts'))
                .filter((f) => f.endsWith('.js'))
                .map((f) => fs.readFileSync(path.join(ctx.theme_dir, 'scripts', f), 'utf8')),
            require('hexo-renderer-marked/package.json').version,
        ]);
        const projects = [];
        for (const filename of fs
            .readdirSync(dir)
            .filter((n) => /\.(md|markdown)$/i.test(n))
            .sort()) {
            const full = path.join(dir, filename),
                raw = fs.readFileSync(full, 'utf8'),
                parsed = fm.parse(raw);
            const slug = parsed.slug || filename.replace(/\.(md|markdown)$/i, ''),
                target = `projects/${slug}/`;
            const data = {
                ...parsed,
                slug,
                path: target,
                _id: `project-${cache.hash(target).slice(0, 16)}`,
                content: parsed._content,
                full_source: full,
                source: filename,
                engine: 'markdown',
                asset_dir: path.join(dir, filename.replace(/\.(md|markdown)$/i, '')),
            };
            const key = [raw, dependency, filename];
            let rendered = protectedItem(parsed) ? null : cache.get(ctx, 'projects', key);
            // Rerender image-bearing projects to register their asset routes in each build
            if (
                /\{%\s*download\b/.test(raw) ||
                (ctx.theme.config.images?.enabled !== false &&
                    (/!\[|<img|\{%\s*(?:figure|image_compare|card)\b/.test(raw) ||
                        parsed.project_screenshots?.length))
            )
                rendered = null;
            if (rendered) Object.assign(data, rendered);
            else {
                await ctx.post.render(null, data);
                if (!protectedItem(data))
                    cache.set(ctx, 'projects', key, {
                        content: data.content,
                        excerpt: data.excerpt || '',
                        read_time: data.read_time || null,
                    });
            }
            delete data._content;
            // Discard private author fields from protected project metadata
            if (data.encrypted) {
                delete data.password;
                delete data.project_summary;
            }
            data.date = parsed.date ? authoredDate(ctx, parsed.date) : fs.statSync(full).mtime;
            if (parsed.updated) data.updated = authoredDate(ctx, parsed.updated);
            data.project_tags = names(parsed.project_tags || parsed.tags);
            data.buttons ||= [];
            if (visible(ctx, data)) projects.push(data);
        }
        // Order projects by weight and newest publication date
        ctx.fluxProjects = projects.sort(
            (a, b) => (b.weight || 0) - (a.weight || 0) || +b.date - +a.date
        );
        return ctx.fluxProjects;
    })();
    return ctx.fluxProjectsPromise;
}

// Combine visible posts and rendered projects into one normalized catalog
async function gather(ctx, locals) {
    const projects = await loadProjects(ctx);
    return [
        ...array(locals.posts)
            .filter((p) => visible(ctx, p))
            .map((p) => normalize(ctx, p, 'post')),
        ...projects.map((p) => normalize(ctx, p, 'project')),
    ];
}

// Rank related articles by shared tags, categories, date, and stable URLs
function related(ctx, current) {
    const docs = ctx.fluxDocs || [],
        target = normalize(ctx, current, current.project_tags ? 'project' : 'post');
    return docs
        .filter((d) => d.url !== target.url)
        .map((d) => ({
            ...d,
            sharedTags: d.tags.filter((t) => target.tags.includes(t)).length,
            sharedCategories: d.categories.filter((t) => target.categories.includes(t)).length,
        }))
        .filter((d) => d.sharedTags || d.sharedCategories)
        .sort(
            (a, b) =>
                b.sharedTags - a.sharedTags ||
                b.sharedCategories - a.sharedCategories ||
                b.date.localeCompare(a.date) ||
                a.url.localeCompare(b.url)
        )
        .slice(0, Math.min(4, ctx.theme.config.related_content?.limit || 4));
}

module.exports = {
    array,
    names,
    protectedItem,
    plain,
    iso,
    authoredDate,
    root,
    url,
    visible,
    normalize,
    loadProjects,
    gather,
    related,
    core,
};
