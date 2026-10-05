'use strict';
// Generate the themed error page with the normal site locals
hexo.extend.generator.register('theme_404', function (locals) {
    return {
        path: '404.html',
        layout: '404',
        data: Object.assign({}, locals, {
            __is_404: true,
            title: 'Not Found',
        }),
    };
});
