'use strict';
const pagination = require('../source/js/pagination-core');

// Share pagination controls and URL rules between templates and browser filters
hexo.extend.helper.register('flux_page_items', pagination.items);

hexo.extend.helper.register('flux_page_path', pagination.path);
