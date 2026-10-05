(function (scope) {
    'use strict';
    const escape = (value) =>
        String(value).replace(
            /[&<>"']/g,
            (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]
        );

    // Escape palette values before inserting them into favicon SVG attributes
    function svg(background, accent) {
        return `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="${escape(background)}"/><circle cx="16" cy="16" r="9" fill="${escape(accent)}"/></svg>`;
    }

    const api = {
        svg,
        uri: (background, accent) =>
            'data:image/svg+xml,' + encodeURIComponent(svg(background, accent)),
    };
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
        return;
    }
    if (scope.FluxFavicon) return;
    scope.FluxFavicon = api;

    // Refresh the favicon only when the active palette exposes valid colors
    function update() {
        const icon = document.querySelector('link[data-flux-favicon]');
        if (!icon) return;
        const style = getComputedStyle(document.documentElement),
            background = style.getPropertyValue('--bg').trim(),
            accent = style.getPropertyValue('--accent').trim();
        if (!CSS.supports('color', background) || !CSS.supports('color', accent)) return;
        const href = api.uri(background, accent);
        if (icon.getAttribute('href') !== href) icon.setAttribute('href', href);
    }

    scope.addEventListener('flux:palette', update);
    scope.addEventListener('flux:page', update);
    update();
})(typeof window === 'undefined' ? globalThis : window);
