'use strict';
const { escapeHTML } = require('hexo-util'),
    content = require('../lib/content.cjs'),
    validate = require('../lib/config.cjs'),
    e = (value) => escapeHTML(String(value ?? ''));

// Render project case-study details before image processing and encryption
hexo.extend.filter.register(
    'after_post_render',
    function (data) {
        if (
            !String(data._id || '').startsWith('project-') ||
            data.content.includes('data-flux-case-study')
        )
            return data;
        const role = data.project_role,
            stack = data.project_stack,
            outcomes = data.project_outcomes || [],
            screenshots = data.project_screenshots || [],
            imageSource = (src) =>
                src.startsWith('/') && !src.startsWith(content.root(this))
                    ? content.url(this, src)
                    : src;
        let details = '';
        if (role || stack?.length || data.project_status) {
            details =
                '<section class="case-study-details" data-flux-case-study><h2 id="flux-project-details">Project details</h2><dl>';
            for (const [label, value] of [
                ['Role', role],
                ['Technology', stack?.join(', ')],
                ['Status', data.project_status],
            ])
                if (value) details += '<dt>' + e(label) + '</dt><dd>' + e(value) + '</dd>';
            details += '</dl></section>';
        }
        let after = '';
        if (outcomes.length)
            after +=
                '<section class="case-study-outcomes" data-flux-case-study><h2 id="flux-project-outcomes">Outcomes</h2><ul>' +
                outcomes.map((value) => '<li>' + e(value) + '</li>').join('') +
                '</ul></section>';
        if (screenshots.length)
            after +=
                '<section data-flux-case-study><h2 id="flux-project-screenshots">Screenshots</h2><div class="gallery-grid">' +
                screenshots
                    .map(
                        (image) =>
                            '<figure><img src="' +
                            e(imageSource(image.src)) +
                            '" alt="' +
                            e(image.alt) +
                            '">' +
                            (image.caption
                                ? '<figcaption>' + e(image.caption) + '</figcaption>'
                                : '') +
                            '</figure>'
                    )
                    .join('') +
                '</div></section>';
        data.content = details + data.content + after;
        return data;
    },
    5
);

// Group visible series chapters and reject conflicting routes or chapter orders
hexo.extend.filter.register(
    'before_generate',
    function () {
        this.fluxSeries = [];
        if (this.theme.config.series?.enabled === false) return;
        const groups = new Map(),
            locals = this.locals.toObject(),
            occupied = new Set(
                [
                    ...content.array(locals.pages),
                    ...content.array(locals.posts),
                    ...(this.fluxProjects || []),
                ].map((item) => item.path.replace(/index\.html$/, '').replace(/\/$/, ''))
            );

        for (const post of content
            .array(locals.posts)
            .filter((p) => content.visible(this, p) && p.series)) {
            validate.content(post);
            if (!groups.has(post.series)) groups.set(post.series, []);
            groups.get(post.series).push(post);
        }
        if (groups.size && occupied.has('series'))
            throw new Error('[series] Route conflict: series/');
        for (const [id, posts] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
            if (new Set(posts.map((post) => post.series_order)).size !== posts.length)
                throw new Error('[series] Duplicate chapter order in ' + id);
            if (occupied.has('series/' + id))
                throw new Error('[series] Route conflict: series/' + id + '/');
            const cfg = this.theme.config.series?.items?.[id] || {};
            this.fluxSeries.push({
                id,
                title:
                    cfg.title ||
                    id
                        .split('-')
                        .map((word) => word[0].toUpperCase() + word.slice(1))
                        .join(' '),
                description: cfg.description || '',
                url: content.url(this, 'series/' + id + '/'),
                chapters: posts
                    .sort((a, b) => a.series_order - b.series_order)
                    .map((post) => content.normalize(this, post, 'post')),
            });
        }
    },
    25
);

// Find the current chapter and its neighboring entries in a series
hexo.extend.helper.register('flux_series', function (post) {
    const group = (hexo.fluxSeries || []).find((series) => series.id === post.series);
    if (!group) return null;
    const index = group.chapters.findIndex(
        (chapter) => chapter.url === content.url(hexo, post.path)
    );
    return index < 0
        ? null
        : { ...group, index, previous: group.chapters[index - 1], next: group.chapters[index + 1] };
});

// Generate the series overview and each ordered chapter listing
hexo.extend.generator.register('flux_series', function () {
    const series = this.fluxSeries || [];
    if (!series.length) return [];
    return [
        {
            path: 'series/index.html',
            layout: 'series',
            data: { title: 'Series', series_list: series },
        },
        ...series.map((group) => ({
            path: 'series/' + group.id + '/index.html',
            layout: 'series',
            data: { title: group.title, series_group: group },
        })),
    ];
});

// Select pinned posts and featured projects for the first homepage page
hexo.extend.helper.register('flux_curated', function () {
    const cfg = this.theme.home?.curated || {};
    if (cfg.enabled !== true || (this.page.current || 1) !== 1 || this.page.__is_blog) return null;
    return {
        posts: content
            .array(hexo.locals.get('posts'))
            .filter((post) => content.visible(hexo, post) && post.pinned)
            .sort(
                (a, b) =>
                    Number(b.pinned) - Number(a.pinned) ||
                    +b.date - +a.date ||
                    a.path.localeCompare(b.path)
            )
            .map((post) => content.normalize(hexo, post, 'post')),
        projects: (hexo.fluxProjects || [])
            .filter((project) => project.featured)
            .map((project) => content.normalize(hexo, project, 'project')),
        pinned_limit: cfg.pinned_limit ?? 3,
        projects_limit: cfg.projects_limit ?? 3,
        topics: cfg.topics || [],
    };
});

hexo.extend.helper.register('flux_canonical', function () {
    return this.full_url_for((this.page.path || '/').replace(/index\.html$/, ''));
});

// Build page-specific structured data with public metadata for protected articles
hexo.extend.helper.register('flux_schema', function (description, image) {
    const item = this.page.project || this.page,
        protectedPage = content.protectedItem(item),
        schema = {
            '@context': 'https://schema.org',
            '@type': protectedPage
                ? 'WebPage'
                : this.page.project
                  ? 'CreativeWork'
                  : this.is_post()
                    ? 'BlogPosting'
                    : 'WebPage',
            name: item.title || this.config.title,
            url: this.flux_canonical(),
            description,
        };
    if (!protectedPage && (this.page.project || this.is_post())) {
        schema.headline = item.title;
        schema.datePublished = content.iso(item.date);
        schema.dateModified = content.iso(item.updated || item.date);
        if (item.author || this.config.author)
            schema.author = { '@type': 'Person', name: item.author || this.config.author };
        if (image) schema.image = this.full_url_for(image);
    }
    return schema;
});
