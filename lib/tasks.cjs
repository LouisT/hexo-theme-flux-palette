'use strict';
const os = require('node:os');
const pools = new WeakMap();

// Use the configured concurrency or a modest limit based on available CPUs
function limit(ctx) {
    return (
        ctx.theme.config.build?.concurrency ??
        Math.min(4, os.availableParallelism?.() || os.cpus().length || 1)
    );
}

// Share a bounded work queue across image and JavaScript tasks for each site
function pool(ctx) {
    if (!pools.has(ctx)) {
        let active = 0;
        const queue = [];
        // Release task slots after success or failure so queued work continues
        function next() {
            while (active < limit(ctx) && queue.length) {
                const { fn, resolve, reject } = queue.shift();
                active++;
                Promise.resolve()
                    .then(fn)
                    .then(resolve, reject)
                    .finally(() => {
                        active--;
                        next();
                    });
            }
        }
        pools.set(
            ctx,
            (fn) =>
                new Promise((resolve, reject) => {
                    queue.push({ fn, resolve, reject });
                    next();
                })
        );
    }
    return pools.get(ctx);
}

// Schedule a task in the site's shared concurrency pool
const run = (ctx, fn) => pool(ctx)(fn);

module.exports = { run, limit };
