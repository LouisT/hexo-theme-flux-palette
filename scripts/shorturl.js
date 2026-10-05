'use strict';
const crypto = require('crypto'),
    fs = require('fs'),
    path = require('path'),
    fm = require('hexo-front-matter');

// Derive a stable eight-character hash for a short URL
function makeShortHash(input) {
    return crypto.createHash('sha256').update(String(input)).digest('hex').slice(0, 8);
}

// Render redirect markup with canonical and JavaScript fallbacks
function redirectTemplate(target) {
    return [
        '<!DOCTYPE html>',
        '<html>',
        '<head>',
        '  <meta charset="utf-8">',
        '  <title>Redirecting…</title>',
        '  <meta http-equiv="refresh" content="0;url=' + target + '">',
        '  <link rel="canonical" href="' + target + '">',
        '</head>',
        '<body>',
        '  <p>This short link redirects to <a href="' + target + '">' + target + '</a></p>',
        '  <script>',
        '    try { window.location.replace(' + JSON.stringify(target) + '); } catch (e) {',
        '      window.location.href = ' + JSON.stringify(target) + ';',
        '    }',
        '  </script>',
        '</body>',
        '</html>',
    ].join('\n');
}

// Read project front matter so project detail pages also receive short URLs
function loadFolderProjects(hexo) {
    const base = path.join(hexo.base_dir, 'source', '_projects');

    if (!fs.existsSync(base)) return [];

    // Limit project discovery to Markdown files in the project source folder
    const entries = fs.readdirSync(base, { withFileTypes: true }),
        mdFiles = entries
            .filter((entry) => entry.isFile())
            .map((entry) => entry.name)
            .filter((name) => /\.(md|markdown)$/i.test(name)),
        projects = [];

    // Read project metadata while isolating file and front matter errors
    mdFiles.forEach((filename) => {
        const full = path.join(base, filename);
        let raw;
        try {
            raw = fs.readFileSync(full, 'utf8');
        } catch (err) {
            hexo.log.error('[short-url] Failed to read project file:', full);
            hexo.log.error(err);
            return;
        }

        let parsed;
        try {
            parsed = fm.parse(raw);
        } catch (err) {
            hexo.log.error('[short-url] Failed to parse front matter for project:', full);
            hexo.log.error(err);
            return;
        }

        // Preserve authored short hashes or derive them from project routes
        const slug = parsed.slug || filename.replace(/\.(md|markdown)$/i, ''),
            stat = fs.statSync(full),
            date = parsed.date ? new Date(parsed.date) : stat.mtime,
            projectPath = 'projects/' + slug + '/',
            keySource = parsed.short_hash || projectPath,
            short_hash = parsed.short_hash || makeShortHash(keySource);

        projects.push({
            slug,
            path: projectPath,
            title: parsed.title || slug,
            date,
            short_hash,
        });
    });

    return projects;
}

// Index short hashes by path for template helpers
const shortMap = {};

// Attach short hashes to rendered post records
hexo.extend.filter.register('after_post_render', function (data) {
    // Generate hashes only for post records
    if (data.layout !== 'post') return data;

    // Reuse authored hashes before deriving one from the post URL
    if (!data.short_hash)
        data.short_hash = makeShortHash(data.permalink || data.path || data.slug || data.title);

    // Index the short hash by its full content route
    if (data.path) shortMap[data.path] = data.short_hash;

    return data;
});

// Publish short URL redirects for posts and project detail pages
hexo.extend.generator.register('theme_short_urls', function (locals) {
    const urlBase = (this.config.url || '').replace(/\/+$/, ''),
        routes = [];

    // Generate a redirect route for every post
    locals.posts.forEach((post) => {
        post.short_hash =
            post.short_hash ||
            makeShortHash(post.permalink || post.path || post.slug || post.title);

        // Index the short hash by its full content route
        if (post.path) shortMap[post.path] = post.short_hash;

        routes.push({
            path: `s/${post.short_hash}/index.html`,
            data: () => redirectTemplate(`${urlBase}/${post.path.replace(/^\/+/, '')}`),
        });
    });

    // Read project routes directly from their source front matter
    const folderProjects = loadFolderProjects(this);

    // Publish project redirects using the same short hash lookup
    folderProjects.forEach((project) => {
        const shortPath = `s/${project.short_hash}/index.html`;
        shortMap[project.path] = project.short_hash;
        routes.push({
            path: shortPath,
            data: () => redirectTemplate(`${urlBase}/${project.path.replace(/^\/+/, '')}`),
        });
    });

    return routes;
});

// Look up short hashes using normalized content paths
hexo.extend.helper.register('short_hash_for', function (targetPath) {
    if (!targetPath) return '';

    // Remove leading slashes
    const key = String(targetPath).replace(/^\/+/, '');
    return shortMap[key] || shortMap[`/${key}`] || '';
});
