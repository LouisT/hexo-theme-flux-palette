'use strict';
let fs = require('fs'),
    path = require('path'),
    fm = require('hexo-front-matter'),
    { slugize } = require('hexo-util');

const { loadProjects } = require('../lib/content.cjs');

// Generate paginated project listings, detail pages, and tag archives
hexo.extend.generator.register('theme_projects', async function (locals) {
    const theme = this.theme.config || {},
        projCfg = theme.projects || {},
        title = projCfg.title || 'Projects';

    // Load projects through the shared rendering and cache pipeline
    let allProjects = await loadProjects(this, hexo.base_dir);
    if (!allProjects.length) return [];

    const config = this.config || {},
        perPage =
            projCfg.per_page ??
            (config.index_generator && config.index_generator.per_page) ??
            config.per_page ??
            10,
        total = allProjects.length,
        totalPages = perPage > 0 ? Math.ceil(total / perPage) : 1,
        routes = [];

    // Generate project pages with page one at the listing root
    for (let i = 1; i <= totalPages; i++) {
        const current = i,
            listPath =
                current === 1 ? 'projects/index.html' : `projects/page/${current}/index.html`,
            start = perPage > 0 ? perPage * (current - 1) : 0,
            end = perPage > 0 ? start + perPage : total,
            pageProjects = allProjects.slice(start, end),
            prev = current > 1 ? current - 1 : 0,
            next = current < totalPages ? current + 1 : 0,
            prev_link = prev > 0 ? (prev === 1 ? 'projects/' : `projects/page/${prev}/`) : '',
            next_link = next > 0 ? `projects/page/${next}/` : '';

        routes.push({
            path: listPath,
            layout: 'projects',
            data: {
                title,
                projects: pageProjects,
                all_projects: allProjects,
                current,
                total: totalPages,
                pagination_base: 'projects/',
                pagination_per_page: perPage,
                prev,
                next,
                prev_link,
                next_link,
            },
        });
    }

    // Publish a detail route for each rendered project
    allProjects.forEach((project) => {
        routes.push({
            path: project.path,
            layout: 'project',
            data: {
                title: project.title,
                project,
            },
        });
    });

    // Publish encrypted payloads separately from protected project placeholders
    allProjects
        .filter((p) => p.encrypted && p.encrypted_payload)
        .forEach((p) =>
            routes.push({
                path: `_encrypted/${p._id}.json`,
                data: JSON.stringify(p.encrypted_payload),
            })
        );
    // Group projects into their tag archives
    const tags = {};
    allProjects.forEach((project) => {
        const pTags = project.project_tags || [];
        pTags.forEach((tag) => {
            if (!tags[tag]) tags[tag] = [];
            tags[tag].push(project);
        });
    });

    Object.keys(tags).forEach((tag) => {
        const tagProjects = tags[tag],
            tagSlug = slugize(tag, { transform: 1 }),
            tagTotalPages = perPage > 0 ? Math.ceil(tagProjects.length / perPage) : 1;

        // Paginate each project tag with the same page size as the main listing
        for (let i = 1; i <= tagTotalPages; i++) {
            const current = i,
                base = `project-tag/${tagSlug}`,
                path = current === 1 ? `${base}/index.html` : `${base}/page/${current}/index.html`,
                start = perPage > 0 ? perPage * (current - 1) : 0,
                end = perPage > 0 ? start + perPage : tagProjects.length,
                pageProjects = tagProjects.slice(start, end),
                prev = current > 1 ? current - 1 : 0,
                next = current < tagTotalPages ? current + 1 : 0,
                prev_link = prev > 0 ? (prev === 1 ? `${base}/` : `${base}/page/${prev}/`) : '',
                next_link = next > 0 ? `${base}/page/${next}/` : '';

            // Publish the current project tag page with its pagination metadata
            routes.push({
                path: path,
                layout: 'projects',
                data: {
                    title: `Projects: ${tag}`,
                    projects: pageProjects,
                    all_projects: tagProjects,
                    current,
                    total: tagTotalPages,
                    pagination_base: `${base}/`,
                    pagination_per_page: perPage,
                    prev,
                    next,
                    prev_link,
                    next_link,
                    is_tag_page: true,
                    tag_name: tag,
                },
            });
        }
    });

    return routes;
});

// Return the latest rendered projects for sidebar listings
hexo.extend.helper.register('recent_projects', function (limit = 5) {
    return (hexo.fluxProjects || []).slice(0, limit);
});

// Build site-root URLs from normalized project tag slugs
hexo.extend.helper.register('project_tag_url', function (tag) {
    return this.url_for(`/project-tag/${slugize(tag, { transform: 1 })}/`);
});
