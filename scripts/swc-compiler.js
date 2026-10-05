'use strict';
const cache = require('../lib/cache.cjs'),
    tasks = require('../lib/tasks.cjs');
let swc;
try {
    swc = require('@swc/core');
} catch (e) {
    console.warn(
        '[swc-compiler] @swc/core not found. ' +
            'Install theme dependencies with "npm ci --prefix themes/flux-palette --include=optional" to enable JS pre-compilation.'
    );
}

// Check if an object is a readable stream
function isStream(x) {
    return x && typeof x.pipe === 'function' && typeof x.on === 'function';
}

// Convert a readable stream into a UTF-8 string
function streamToString(stream) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        stream.on('data', (chunk) =>
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        );
        stream.on('error', reject);
        stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
}

// Normalize route callbacks, streams, and byte arrays into JavaScript source
async function readRouteToString(routeData) {
    if (!routeData) return null;

    // If it's a function, call it and recurse on the result
    if (typeof routeData === 'function') return readRouteToString(routeData());

    // Read streamed route content
    if (isStream(routeData)) return streamToString(routeData);

    // Buffer / string / other typed data
    if (Buffer.isBuffer(routeData)) return routeData.toString('utf8');
    if (typeof routeData === 'string') return routeData;

    // Decode typed byte arrays from route providers
    if (routeData instanceof Uint8Array) return Buffer.from(routeData).toString('utf8');

    // Last resort: try toString, but don't assume it's file content
    if (typeof routeData.toString === 'function') return String(routeData);

    return null;
}

// Main filter to pre-compile JS files using SWC
hexo.extend.filter.register('after_generate', async function () {
    if (!swc) return;

    const ctx = this,
        themeCfg = ctx.theme.config || {},
        cfg = themeCfg.swc || {};

    const enabled = cfg.enabled !== false;
    if (!enabled) {
        ctx.log.info('[swc-compiler] disabled via theme config.');
        return;
    }

    // SWC options
    const target = cfg.target || 'es5',
        minify = !!cfg.minify;

    // Restrict compilation to configured route prefixes
    const include = Array.isArray(cfg.include) && cfg.include.length ? cfg.include : ['js/'],
        exclude = Array.isArray(cfg.exclude) ? cfg.exclude : [],
        // Normalize a path prefix for comparison
        normalize = (p) => (p.startsWith('/') ? p.slice(1) : p);

    // Check if a route path should be processed
    function shouldProcess(routePathRaw) {
        const routePath = normalize(routePathRaw);
        return !routePath.endsWith('.js') ||
            !include.some((prefix) => routePath.startsWith(normalize(prefix))) ||
            exclude.some((prefix) => routePath.startsWith(normalize(prefix)))
            ? false
            : true;
    }

    // Get all routes
    const routes = ctx.route.list();
    ctx.log.info('[swc-compiler] scanning %d routes...', routes.length);

    // Filter routes to process
    const toProcess = routes.filter(shouldProcess);
    if (!toProcess.length) {
        ctx.log.info('[swc-compiler] no JS routes matched include/exclude filters.');
        return;
    }

    ctx.log.info(
        '[swc-compiler] compiling %d JS files with SWC (target=%s, minify=%s)...',
        toProcess.length,
        target,
        String(minify)
    );

    await Promise.all(
        toProcess.map((routePath) =>
            tasks.run(ctx, async () => {
                let routeData;
                try {
                    routeData = ctx.route.get(routePath);
                } catch (err) {
                    ctx.log.error('[swc-compiler] route.get failed for %s', routePath);
                    ctx.log.error(err);
                    return;
                }

                const sourceCode = await readRouteToString(routeData);
                if (typeof sourceCode !== 'string' || !sourceCode.length) {
                    ctx.log.warn('[swc-compiler] skipped (unreadable/empty): %s', routePath);
                    return;
                }

                ctx.log.debug(
                    '[swc-compiler] processing %s (original length=%d)',
                    routePath,
                    sourceCode.length
                );

                // Reuse compilation only when source, compiler, and transform settings match
                const key = [
                        sourceCode,
                        target,
                        minify,
                        swc.version,
                        cache.hash(require('node:fs').readFileSync(__filename)),
                    ],
                    saved = cache.get(ctx, 'swc', key);
                if (saved) {
                    ctx.route.set(routePath, saved);
                    return;
                }
                let compiled = sourceCode;
                try {
                    compiled = (
                        await swc.transform(sourceCode, {
                            filename: routePath,
                            jsc: {
                                parser: {
                                    syntax: 'ecmascript',
                                    jsx: true,
                                    dynamicImport: true,
                                },
                                target,
                                loose: true,
                            },
                            module: { type: 'es6' },
                            sourceMaps: false,
                        })
                    ).code;

                    // Apply optional minification after syntax lowering
                    if (minify) {
                        compiled = (
                            await swc.minify(compiled, {
                                compress: true,
                                mangle: true,
                            })
                        ).code;
                    }
                } catch (err) {
                    ctx.log.error('[swc-compiler] SWC failed for %s (keeping original)', routePath);
                    ctx.log.error(err);
                }

                ctx.log.debug('[swc-compiler] %s compiled length: %d', routePath, compiled.length);

                // Overwrite route with compiled JS
                cache.set(ctx, 'swc', key, compiled);
                ctx.route.set(routePath, compiled);
            })
        )
    );

    ctx.log.info('[swc-compiler] done.');
});
