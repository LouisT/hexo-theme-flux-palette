'use strict';
const config = require('../lib/config.cjs');

// Validate theme settings and front matter before rendering content
hexo.extend.filter.register(
    'before_post_render',
    function (data) {
        config.validate(this);
        config.content(data);
        return data;
    },
    1
);

// Revalidate stored posts and pages even when Hexo skips rendering
hexo.extend.filter.register(
    'before_generate',
    function () {
        config.validate(this);
        for (const model of ['posts', 'pages'])
            for (const item of this.locals.get(model).toArray()) config.content(item);
    },
    0
);
