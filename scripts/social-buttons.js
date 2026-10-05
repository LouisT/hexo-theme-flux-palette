'use strict';
const { escapeHTML } = require('hexo-util');

// Resolve theme configuration from the render context or Hexo instance
function getThemeConfig(ctx) {
    return ctx && ctx.theme && ctx.theme.config
        ? ctx.theme.config
        : (hexo.theme && hexo.theme.config) || {};
}

// Read site social defaults from the Hexo configuration
function getSiteConfig() {
    return hexo && hexo.config ? hexo.config : {};
}

// Prefer theme social links and fall back to site social links
function resolveSocialItems(ctx) {
    const themeCfg = getThemeConfig(ctx),
        siteCfg = getSiteConfig(),
        themeSocial = Array.isArray(themeCfg.social) ? themeCfg.social : [],
        siteSocial = Array.isArray(siteCfg.social) ? siteCfg.social : [];

    // Prefer theme social if present; otherwise fall back to site social
    return themeSocial.length ? themeSocial : siteSocial;
}

// Merge site button defaults with theme sidebar overrides
function resolveSocialButtonsConfig(ctx) {
    const themeCfg = getThemeConfig(ctx),
        siteCfg = getSiteConfig(),
        siteSB = siteCfg.social_buttons || {},
        themeSB = themeCfg.sidebar?.social_buttons || {};

    // Site provides defaults; theme overrides
    return Object.assign({}, siteSB, themeSB);
}

// Recognize network, email, and telephone destinations
function isExternal(url) {
    return /^(https?:)?\/\/|^mailto:|^tel:/i.test(url);
}

// Parse social button overrides from key-value arguments and bare flags
function parseTagArgs(args = []) {
    // Accept colon or equals separators and bare boolean flags
    const out = {};

    for (const raw of args) {
        const m = String(raw).match(/^([^:=]+)[:=](.*)$/);
        if (m) out[m[1]] = m[2];
        else out[raw] = true;
    }
    return out;
}

// Escape social link attributes and resolve icon sources before rendering buttons
function buildButtons(ctx, options = {}) {
    const cfg = resolveSocialButtonsConfig(ctx),
        items = resolveSocialItems(ctx);

    if (!items.length) return '';
    if (!cfg.enabled) return '';

    const size = options.size || cfg.size || '2.5em';
    return (
        items
            .filter((i) => i && i.url)
            .map((i) => {
                const name = i.name || i.label || '',
                    title = i.title || name,
                    rawIcon = i.icon || i.iconify || '',
                    rel = i.rel || cfg.rel || 'me noopener noreferrer',
                    target = i.target || cfg.target || '_blank';

                // Apply the site root only to local social destinations
                const href =
                    !isExternal(i.url) && ctx && typeof ctx.url_for === 'function'
                        ? ctx.url_for(i.url)
                        : i.url;

                // Reserve icon dimensions before the icon resource loads
                const wrapStyle = `width: ${escapeHTML(String(size))}; height: ${escapeHTML(String(size))}; font-size: ${escapeHTML(String(size))}; vertical-align: middle;`;

                // Resolve authored icon URLs and Iconify shorthand
                let iconHtml = '';
                if (rawIcon) {
                    let src = rawIcon;
                    // If it looks like "prefix:name" without slashes, treat as Iconify
                    if (!src.includes('/') && src.includes(':')) {
                        const parts = src.split(':');
                        if (parts.length >= 2)
                            src = `https://api.iconify.design/${parts[0]}/${parts.slice(1).join(':')}.svg`;
                    }
                    // Color icon masks with the inherited text color
                    iconHtml = `<span class="social-icon" style="--icon-url: url('${escapeHTML(src)}');"></span>`;
                }

                // Render an escaped icon or text link with accessible labels
                return rawIcon || name
                    ? [
                          `<a class="link" href="${escapeHTML(href)}"`,
                          ` target="${escapeHTML(target)}" rel="${escapeHTML(rel)}"`,
                          title ? ` title="${escapeHTML(title)}"` : '',
                          name ? ` aria-label="${escapeHTML(name)}"` : '',
                          '>',
                          iconHtml
                              ? `<div class="social-icon-wrap" style="${wrapStyle}">${iconHtml}</div>`
                              : '',
                          !rawIcon && name ? `<span class="label">${escapeHTML(name)}</span>` : '',
                          '</a>',
                      ].join('')
                    : '';
            })
            .join('') || ''
    );
}

// Render post tags with the same social button configuration as template helpers
hexo.extend.tag.register('social_buttons', function (args) {
    return buildButtons(this, parseTagArgs(args));
});

// Render social buttons for templates using the resolved configuration
hexo.extend.helper.register('social_buttons', function (options = {}) {
    return buildButtons(this, options);
});

// Show social controls only when enabled links have usable destinations
hexo.extend.helper.register('has_social_buttons', function () {
    const cfg = resolveSocialButtonsConfig(this);
    if (!cfg.enabled) return false;

    let items = resolveSocialItems(this);
    if (!items.length) return false;

    return items.some((i) => i && typeof i.url === 'string' && i.url.trim().length > 0);
});
