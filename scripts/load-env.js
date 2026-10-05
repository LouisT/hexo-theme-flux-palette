'use strict';
const { loadEnv } = require('../lib/env.cjs');

// Load site variables during startup so read failures propagate before content renders
hexo.extend.filter.register(
    'after_init',
    function () {
        loadEnv(this.base_dir);
    },
    0
);
