'use strict';
const { slugize } = require('hexo-util');

// Convert Hexo models into plain arrays for iteration
function toArray(model) {
    if (!model) return [];
    if (Array.isArray(model)) return model;
    if (Array.isArray(model.data)) return model.data;
    if (typeof model.toArray === 'function') return model.toArray();

    return [];
}

// Normalize output path so route generation always targets an html file
function normalizeOutputPath(raw) {
    let value = String(raw || 'cloud/')
        .trim()
        .replace(/^\/+/, '');
    if (!value) value = 'cloud/';
    if (/\.[a-z0-9]+$/i.test(value)) return value;
    if (!value.endsWith('/')) value += '/';

    return `${value}index.html`;
}

// Filter out drafts future posts and unpublished entries from cloud counts
function isVisiblePost(post, config, now) {
    if (!post) return false;
    if (post.published === false) return false;
    if (!config.render_drafts && post.draft) return false;
    if (!config.future && post.date && post.date.valueOf() > now) return false;

    return true;
}

// Build a weighted cloud from taxonomy models
function buildCloudItems(models, dir, cloudCfg, siteCfg, now) {
    const sortBy = cloudCfg.sort_by === 'name' ? 'name' : 'count',
        sortOrder = cloudCfg.sort_order === 'asc' ? 1 : -1,
        minSize = typeof cloudCfg.min_size === 'number' ? cloudCfg.min_size : 0.95,
        maxSize = typeof cloudCfg.max_size === 'number' ? cloudCfg.max_size : 2.2;

    // Count visible posts while preserving native taxonomy paths
    const items = toArray(models)
        .map((model) => {
            const name = model.name || '',
                path = model.path || `${dir}/${slugize(name, { transform: 1 })}/`,
                posts = toArray(model.posts).filter((post) => isVisiblePost(post, siteCfg, now));

            return {
                name,
                path,
                count: posts.length,
            };
        })
        .filter((item) => item.name && item.count > 0);

    // No items
    if (!items.length) return [];

    // Sort
    items.sort((a, b) => {
        if (sortBy === 'name') return sortOrder * a.name.localeCompare(b.name);
        if (a.count !== b.count) return sortOrder * (a.count - b.count);

        return a.name.localeCompare(b.name);
    });

    // Calculate weight and size
    const minCount = items.reduce((min, item) => Math.min(min, item.count), items[0].count),
        maxCount = items.reduce((max, item) => Math.max(max, item.count), items[0].count),
        spread = Math.max(1, maxCount - minCount);

    // Give equal counts a midpoint weight instead of collapsing every topic to the minimum
    return items.map((item) => {
        const weight = maxCount === minCount ? 0.5 : (item.count - minCount) / spread,
            size = minSize + (maxSize - minSize) * weight,
            opacity = 0.65 + 0.35 * weight;

        return Object.assign({}, item, {
            weight: weight.toFixed(4),
            size: size.toFixed(3),
            opacity: opacity.toFixed(3),
        });
    });
}

// Generate a cloud page for categories and tags
hexo.extend.generator.register('theme_cloud_page', function (locals) {
    const cloudCfg = this.theme.config.cloud || this.theme.config.category_cloud || {};
    if (cloudCfg.enabled === false) return;

    // Resolve paths and taxonomy directories
    const now = Date.now(),
        outputPath = normalizeOutputPath(cloudCfg.path),
        categoryDir = this.config.category_dir || 'categories',
        tagDir = this.config.tag_dir || 'tags';

    // Read category and tag cloud configuration
    const categoriesCfg = cloudCfg.categories || {},
        tagsCfg = cloudCfg.tags || {};

    // Build weighted category and tag cloud items
    const categories =
            categoriesCfg.enabled === false
                ? []
                : buildCloudItems(locals.categories, categoryDir, cloudCfg, this.config, now),
        tags =
            tagsCfg.enabled === false
                ? []
                : buildCloudItems(locals.tags, tagDir, cloudCfg, this.config, now);

    // Deduplicate combined and taxonomy views when configured output paths overlap
    const categoriesPath = normalizeOutputPath(categoriesCfg.path || `${categoryDir}/`),
        tagsPath = normalizeOutputPath(tagsCfg.path || `${tagDir}/`),
        routesByPath = new Map(),
        addRoute = (route) =>
            routesByPath.set(route.path, {
                ...route,
                data: {
                    flux_cloud: true,
                    cloud_controls: cloudCfg.controls?.enabled !== false,
                    cloud_sort: `${cloudCfg.sort_by === 'name' ? 'name' : 'count'}:${cloudCfg.sort_order === 'asc' ? 'asc' : 'desc'}`,
                    ...route.data,
                },
            });

    // Generate the combined cloud page
    addRoute({
        path: outputPath,
        layout: 'cloud',
        data: {
            title: cloudCfg.title || 'Cloud',
            categories_title: categoriesCfg.title || 'Categories',
            tags_title: tagsCfg.title || 'Tags',
            categories,
            tags,
        },
    });

    // Generate a categories-only cloud page
    addRoute({
        path: categoriesPath,
        layout: 'cloud',
        data: {
            title: categoriesCfg.page_title || categoriesCfg.title || 'Categories',
            categories_title: categoriesCfg.title || 'Categories',
            tags_title: tagsCfg.title || 'Tags',
            categories,
            tags: [],
        },
    });

    // Generate a tags-only cloud page
    addRoute({
        path: tagsPath,
        layout: 'cloud',
        data: {
            title: tagsCfg.page_title || tagsCfg.title || 'Tags',
            categories_title: categoriesCfg.title || 'Categories',
            tags_title: tagsCfg.title || 'Tags',
            categories: [],
            tags,
        },
    });

    return Array.from(routesByPath.values());
});
