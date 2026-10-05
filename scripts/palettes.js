'use strict';
const fs = require('fs'),
    path = require('path');

const cache = require('../lib/cache.cjs');
let PALLETE_CACHE = null;

hexo.extend.filter.register(
    'before_generate',
    () => {
        PALLETE_CACHE = null;
    },
    1
);

// Get merged options with defaults
function getOptions(themeConfig) {
    const cfg = (themeConfig && themeConfig.sidebar && themeConfig.sidebar.palette_selector) || {};
    return {
        enabled: cfg.enabled !== false,
        default_dark: cfg.default_dark || 'solar-amber',
        default_light: cfg.default_light || 'paper-and-ink',
        palette_folder: cfg.palette_folder || 'css/palettes',
        include: cfg.include,
    };
}

// Cache the enabled palette catalog outside development mode
function getPalettes(ctx) {
    if (hexo.env?.env !== 'development' && Array.isArray(PALLETE_CACHE)) return PALLETE_CACHE;
    const options = getOptions(ctx.theme.config);

    // Resolve the configured palette folder within the theme source
    const folderAbs = path.join(
        hexo.theme_dir,
        'source',
        (options.palette_folder || 'css/palettes').replace(/^\/+/, '').replace(/\/+$/, '')
    );

    // Read all files in the palette folder
    let files;
    try {
        files = [
            ...fs
                .readdirSync(path.join(folderAbs, 'enabled/dark'))
                .map((f) => path.join(folderAbs, 'enabled/dark', f)),
            ...fs
                .readdirSync(path.join(folderAbs, 'enabled/light'))
                .map((f) => path.join(folderAbs, 'enabled/light', f)),
        ];
    } catch (err) {
        // Folder missing or unreadable
        hexo.log.warn('[palette_list] Palette folder not found:', folderAbs);
        return [];
    }

    PALLETE_CACHE = files
        .filter(
            (f) =>
                /^.*\.css$/.test(f) &&
                (!options.include ||
                    options.include.includes(
                        path
                            .basename(f)
                            .replace(/^palette-/, '')
                            .replace(/\.css$/, '')
                    ))
        ) // Only .css files
        .map((f) => {
            const folder = path.dirname(f),
                file = path.basename(f),
                key = file
                    .replace(/^palette-/, '') // palette-default.css -> default.css
                    .replace(/\.css$/, ''), // default.css -> default
                name = key
                    .split(/[-_]/)
                    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
                    .join(' ')
                    .replace(/\sand\s/gi, ' & ');
            return {
                folder, // Source directory
                file, // CSS filename
                key, // Palette key
                name, // Display name
                mode: folder.includes('enabled/dark') ? 'dark' : 'light', // Palette color mode
            };
        });

    return PALLETE_CACHE;
}

// Returns a list of available palettes
hexo.extend.helper.register('palette_list', function () {
    return (
        getPalettes(this)?.map?.((p) => ({
            key: p.key,
            name: p.name,
            file: p.file,
            mode: p.mode,
        })) || []
    );
});

// Bundle enabled palettes into the shared palette stylesheet
hexo.extend.generator.register('theme_palettes_bundle', function () {
    const palettes = getPalettes(this);
    if (!palettes.length) {
        this.log.info('[palette-bundle] No palettes defined in theme config.');
        return;
    }

    // Read each palette file
    const parts = palettes.map((p) => {
        const key = p.key,
            file = p.file,
            folder = p.folder,
            fullPath = path.join(folder, file);

        // Check for key and file
        if (!key || !file || !folder) {
            hexo.log.warn('[palette-bundle] Palette entry missing key or file:', p);
            return;
        }

        // Read the file
        if (!fs.existsSync(fullPath)) {
            hexo.log.warn('[palette-bundle] Palette file not found:', file);
            return;
        }

        // Read the palette content
        let content;
        try {
            content = fs.readFileSync(fullPath, 'utf8');
        } catch (err) {
            hexo.log.error('[palette-bundle] Failed to read file:', file);
            hexo.log.error(err);
            return;
        }

        // Scope palette rules to their selected key before bundling
        let selector = `:root[data-palette="${key}"]`,
            rewritten = content.replace(/:root\b/g, selector);
        if (rewritten === content) rewritten = `${selector} {\n ${content}\n}\n`;
        return `/* ==== Palette: ${key} (${file}) ==== */\n${rewritten.trim()}\n`;
    });

    // Skip bundling when no palette parts are available
    if (!parts.length) {
        this.log.warn('[palette-bundle] No palette CSS could be bundled.');
        return;
    }

    // Serve as /css/palettes.css
    const bundleKey = [parts, cache.hash(fs.readFileSync(__filename))];
    let bundle = cache.get(hexo, 'palettes', bundleKey);
    if (!bundle) {
        bundle = parts.join('\n');
        cache.set(hexo, 'palettes', bundleKey, bundle);
    }
    return { path: 'css/palettes.css', data: bundle };
});
