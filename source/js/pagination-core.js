(function (scope) {
    'use strict';
    // Keep the current page and endpoints visible with gaps between distant page ranges
    function items(current, total) {
        if (total <= 1) return [];
        const numbers = new Set([1, total]),
            start = total <= 7 || current <= 4 ? 2 : current >= total - 3 ? total - 4 : current - 1,
            end = total <= 7 || current >= total - 3 ? total - 1 : current <= 4 ? 5 : current + 1;

        for (let number = start; number <= end; number++) numbers.add(number);
        const result = [];
        let previous = 0;

        for (const number of [...numbers].sort((a, b) => a - b)) {
            if (number - previous > 1) result.push({ key: 'gap-' + number, number: null });
            result.push({ key: 'page-' + number, number });
            previous = number;
        }
        return result;
    }

    // Use the listing root for page one and generated routes for later pages
    function path(base, number, directory = 'page') {
        return number === 1 ? base : base + directory + '/' + number + '/';
    }

    const api = { items, path };
    if (typeof module === 'object' && module.exports) module.exports = api;
    else scope.FluxPagination = api;
})(typeof window === 'undefined' ? globalThis : window);
