'use strict';
const fs = require('node:fs'),
    path = require('node:path'),
    crypto = require('node:crypto');
const VERSION = 1;

// Hash strings, buffers, and structured inputs for stable cache keys
const hash = (value) =>
    crypto
        .createHash('sha256')
        .update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value))
        .digest('hex');

// Keep generated cache entries in the installed theme's private cache directory
function folder(ctx) {
    return path.join(ctx.theme_dir, '.cache', 'flux');
}

// Mark cache entries as used when resolving their versioned input hash
function entry(ctx, group, input) {
    const file = path.join(folder(ctx), group, hash([VERSION, input]) + '.json');
    ctx.fluxCacheUsed ||= new Set();
    ctx.fluxCacheUsed.add(file);
    return file;
}

// Treat missing or invalid cache data as a miss and record build statistics
function get(ctx, group, input) {
    if (ctx.theme.config.build_cache?.enabled === false) return null;
    try {
        const file = entry(ctx, group, input),
            value = JSON.parse(fs.readFileSync(file, 'utf8'));
        ctx.fluxCacheStats ||= { hits: 0, misses: 0 };
        ctx.fluxCacheStats.hits++;
        return value;
    } catch {
        ctx.fluxCacheStats ||= { hits: 0, misses: 0 };
        ctx.fluxCacheStats.misses++;
        return null;
    }
}

// Publish complete cache values through a temporary file and rename
function set(ctx, group, input, value) {
    if (ctx.theme.config.build_cache?.enabled === false) return;
    const dir = path.join(folder(ctx), group);
    fs.mkdirSync(dir, { recursive: true });
    const file = entry(ctx, group, input),
        temp = file + '.' + process.pid + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(value));
    fs.renameSync(temp, file);
}

// Invalidate successful uploads even when caching has since been disabled
function remove(ctx, group, input) {
    fs.rmSync(entry(ctx, group, input), { force: true });
}

// Remove cached results that the current generation no longer references
function prune(ctx) {
    if (ctx.theme.config.build_cache?.enabled === false) return;
    for (const group of ['projects', 'tokens', 'images', 'palettes', 'swc', 'css', 'remote']) {
        const dir = path.join(folder(ctx), group);
        if (!fs.existsSync(dir)) continue;
        for (const name of fs.readdirSync(dir)) {
            const file = path.join(dir, name);
            if (name.endsWith('.json') && !ctx.fluxCacheUsed?.has(file)) fs.rmSync(file);
        }
    }
}

module.exports = { hash, folder, get, set, remove, prune };
