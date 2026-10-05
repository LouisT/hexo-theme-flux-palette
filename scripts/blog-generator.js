'use strict';
// The theme owns the homepage and Blog routes; skip Hexo's duplicate index pagination
hexo.extend.generator.register('index', () => []);

// Generate Blog pagination and reuse its first page for the homepage
hexo.extend.generator.register('theme_blog', function (locals) {
    const config = this.config || {},
        theme = this.theme.config || {},
        blogCfg = theme.blog || {},
        perPage = blogCfg.per_page ?? config.index_generator?.per_page ?? config.per_page ?? 10,
        title = blogCfg.title || 'Blog',
        allPosts = locals.posts.sort(config.index_generator?.order_by || '-date'),
        total = allPosts.length,
        totalPages = perPage > 0 ? Math.max(1, Math.ceil(total / perPage)) : 1,
        routes = [];

    // Generate Blog pages with page one at the listing root
    for (let i = 1; i <= totalPages; i++) {
        // Pagination setup
        const current = i,
            path = current === 1 ? 'blog/index.html' : `blog/page/${current}/index.html`,
            skip = perPage > 0 ? perPage * (current - 1) : 0,
            pagePosts = perPage > 0 ? allPosts.skip(skip).limit(perPage) : allPosts,
            prev = current > 1 ? current - 1 : 0,
            next = current < totalPages ? current + 1 : 0,
            prev_link = prev > 0 ? (prev === 1 ? 'blog/' : `blog/page/${prev}/`) : '',
            next_link = next > 0 ? `blog/page/${next}/` : '';

        const data = {
            posts: pagePosts,
            current,
            total: totalPages,
            pagination_base: 'blog/',
            prev,
            next,
            prev_link,
            next_link,
        };
        routes.push({ path, layout: ['blog'], data: { ...data, title, __is_blog: true } });
        // Keep one homepage route while Blog owns subsequent post pages
        if (current === 1)
            routes.push({
                path: 'index.html',
                layout: ['index'],
                data: {
                    ...data,
                    pagination_base: theme.home?.mode === 'projects' ? '' : 'blog/',
                    __index: true,
                },
            });
    }

    return routes;
});
