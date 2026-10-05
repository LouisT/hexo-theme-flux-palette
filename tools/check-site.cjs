'use strict';
const fs = require('node:fs'),
    path = require('node:path'),
    { load } = require('cheerio');

// Collect generated files recursively for link and asset validation
function walk(dir) {
    return fs
        .readdirSync(dir, { withFileTypes: true })
        .flatMap((e) =>
            e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]
        );
}

// Check local references against generated files and target heading IDs
function check(directory, root = '/') {
    directory = path.resolve(directory);
    const files = walk(directory),
        errors = [],
        ids = new Map();
    // Index page IDs before checking cross-page fragment links
    for (const file of files.filter((f) => f.endsWith('.html'))) {
        const $ = load(fs.readFileSync(file, 'utf8'));
        ids.set(
            file,
            new Set(
                $('[id]')
                    .map((i, e) => $(e).attr('id'))
                    .get()
            )
        );
    }
    for (const file of ids.keys()) {
        const $ = load(fs.readFileSync(file, 'utf8')),
            relative = path.relative(directory, file).split(path.sep).join('/'),
            base = new URL(root + relative, 'https://flux.invalid');
        // Inspect links and image sources while leaving remote URLs outside local validation
        $('[href],[src],[srcset],[data-original-src]').each((i, e) => {
            const values = ['href', 'src', 'data-original-src']
                .map((attr) => $(e).attr(attr))
                .filter(Boolean);
            if (!($(e).attr('srcset') || '').startsWith('data:'))
                values.push(
                    ...($(e).attr('srcset') || '')
                        .split(',')
                        .map((value) => value.trim().split(/\s/)[0])
                );
            for (const raw of values) {
                if (
                    !raw ||
                    /^(?:https?:|\/\/|data:|blob:|mailto:|tel:|javascript:)/i.test(raw) ||
                    raw.startsWith('#theme=')
                )
                    continue;
                // Resolve local references against their page and keep them within the site root
                const url = new URL(raw, base);
                if (!url.pathname.startsWith(root)) {
                    errors.push(`${relative}: outside site root ${raw}`);
                    continue;
                }
                // Resolve directory-style URLs to their generated index pages
                let name = decodeURIComponent(url.pathname.slice(root.length));
                if (!name || name.endsWith('/')) name += 'index.html';
                let target = path.join(directory, name);
                if (!fs.existsSync(target) && fs.existsSync(target + '/index.html'))
                    target += '/index.html';
                if (!fs.existsSync(target)) errors.push(`${relative}: missing ${raw}`);
                else if (
                    url.hash &&
                    ids.has(target) &&
                    !ids.get(target).has(decodeURIComponent(url.hash.slice(1)))
                )
                    errors.push(`${relative}: missing fragment ${raw}`);
            }
        });
    }
    return [...new Set(errors)];
}

module.exports = { check };

// Expose the same link and asset validation as a command-line check
if (require.main === module) {
    const args = process.argv.slice(2),
        dir = args.includes('--public') ? args[args.indexOf('--public') + 1] : args[0] || 'public',
        root = args.includes('--root') ? args[args.indexOf('--root') + 1] : '/';
    const errors = check(dir, root);
    if (errors.length) {
        console.error(errors.join('\n'));
        process.exitCode = 1;
    } else console.log('Internal links, assets and fragments verified.');
}
