'use strict';
const { slugize } = require('hexo-util');

// Markers for tab and accordion tags
const MARKER = {
    TAB_START: '@@FLUX_TAB_HEAD@@',
    TAB_SPLIT: '@@FLUX_TAB_SPLIT@@',
    TAB_END: '@@FLUX_TAB_FOOT@@',
    ACC_START: '@@FLUX_ACC_HEAD@@',
    ACC_SPLIT: '@@FLUX_ACC_SPLIT@@',
    ACC_END: '@@FLUX_ACC_FOOT@@',
    TL_START: '@@FLUX_TL_HEAD@@',
    TL_SPLIT: '@@FLUX_TL_SPLIT@@',
    TL_END: '@@FLUX_TL_FOOT@@',
};

// Render nested Markdown and report renderer failures
function renderMd(text) {
    try {
        return hexo.render.renderSync({ text: text || '', engine: 'markdown' });
    } catch (e) {
        console.error('[Flux Tags] Render error:', e);
        return text;
    }
}

// Remove matching outer quotes from tag arguments
function cleanArgs(str) {
    const s = (str || '').trim();
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))
        return s.substring(1, s.length - 1);
    return s;
}

// Remove shared indentation without changing relative nesting
function dedent(str = '') {
    // Normalize line endings
    str = str.replace(/\r\n/g, '\n').replace(/^\n+|\n+$/g, '');

    // Find smallest indent across non-empty lines
    const indents = str.match(/^[ \t]+(?=\S)/gm);
    if (!indents) return str;

    // Measure the shared leading indentation before removing it
    let min = indents.reduce((m, x) => Math.min(m, x.length), Infinity);

    // Dedent all lines by that amount
    return str.replace(new RegExp(`^[ \\t]{${min}}`, 'gm'), '');
}

// Replace renderer heading links with the theme permalink and copy controls
hexo.extend.filter.register('after_post_render', function (data) {
    if (!data.content) return data;

    // Match rendered headings that already have anchor IDs
    const regex = /<h([1-6])([^>]*?)id="([^"]+)"([^>]*?)>(.*?)<\/h\1>/gi;

    // Wrap heading text with permalink and copy controls
    data.content = data.content.replace(regex, (match, level, preAttrs, id, postAttrs, text) => {
        // Remove existing heading links before creating the permalink
        if (text.includes('<a ')) text = text.replace(/<a [^>]+>(.*?)<\/a>/gi, '$1');

        // Strip markup and escape quotes in the heading title attribute
        const plainTitle = text
            .trim()
            .replace(/<[^>]+>/g, '')
            .replace(/"/g, '&quot;');

        const enabled = hexo.theme.config.heading_links?.enabled !== false,
            anchor = `<a href="#${id}" class="headerlink" title="${plainTitle}"${enabled ? ' @click="copy($event)" x-ref="anchor"' : ''}>${text}</a>`,
            permalink = enabled
                ? `<span class="heading-permalink" x-data="headingLink">${anchor}<span class="heading-link-feedback" role="status" x-text="message" x-show="message && !manual" x-cloak></span><span class="heading-link-fallback" x-show="manual" @keydown.escape.prevent.stop="dismiss" x-cloak><label><span x-text="message"></span><input x-ref="fallback" :value="link" aria-label="Section link" readonly></label><button type="button" @click="dismiss" aria-label="Dismiss section link"><svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="m4 4 8 8m0-8-8 8" /></svg></button></span></span>`
                : anchor;
        return `<h${level}${preAttrs}id="${id}"${postAttrs}>${permalink}</h${level}>`;
    });

    return data;
});

// Encode tab titles and bodies for the enclosing tabs tag
hexo.extend.tag.register(
    'tab',
    function (args, content) {
        return `${MARKER.TAB_START}${args.join(' ').replace(/["']/g, '')}${MARKER.TAB_SPLIT}${content || ''}${MARKER.TAB_END}`;
    },
    { ends: true }
);

// Render tab markers into linked controls and panels
hexo.extend.tag.register(
    'tabs',
    function (args, content) {
        const raw = content || '',
            tabs = [],
            chunks = raw.split(MARKER.TAB_START);

        // Parse each tab block
        for (let i = 1; i < chunks.length; i++) {
            const chunk = chunks[i],
                endIdx = chunk.indexOf(MARKER.TAB_END);

            // Skip incomplete tab markers instead of rendering malformed panels
            if (endIdx === -1) continue;

            const block = chunk.substring(0, endIdx),
                parts = block.split(MARKER.TAB_SPLIT);
            if (parts.length >= 2)
                tabs.push({
                    title: parts[0].trim(),
                    content: renderMd(parts.slice(1).join(MARKER.TAB_SPLIT)),
                });
        }

        // Preserve the authored body when no complete tab markers remain
        if (!tabs.length) return renderMd(raw);

        // Pair each tab control with its corresponding content panel
        let [nav, panels] = tabs.reduce(
            ([navAcc, panelAcc], tab, i) => [
                (navAcc += `<button type="button" class="tab-btn" :class="{ 'active': tab === ${i} }"  @click="tab = ${i}" role="tab" @keydown="key($event)">${tab.title}</button>`),
                (panelAcc += `<div class="tab-panel" x-show="tab === ${i}"  x-cloak role="tabpanel">${tab.content}</div>`),
            ],
            ['<div class="tabs-nav" role="tablist">', '<div class="tabs-panels">']
        );

        // Attach keyboard navigation to the completed tab group
        return `<div class="tabs-container" x-data="accessibleTabs">${nav}</div>${panels}</div></div>`;
    },
    { ends: true }
);

// Encode accordion titles and bodies for their enclosing group
hexo.extend.tag.register(
    'accordion',
    function (args, content) {
        return `${MARKER.ACC_START}${args.join(' ').replace(/["']/g, '')}${MARKER.ACC_SPLIT}${content || ''}${MARKER.ACC_END}`;
    },
    { ends: true }
);

// Render accordion markers into expandable content sections
hexo.extend.tag.register(
    'accordions',
    function (args, content) {
        const raw = content || '',
            items = [],
            chunks = raw.split(MARKER.ACC_START);

        // Parse each accordion block
        for (let i = 1; i < chunks.length; i++) {
            const chunk = chunks[i],
                endIdx = chunk.indexOf(MARKER.ACC_END);
            if (endIdx === -1) continue;

            const block = chunk.substring(0, endIdx),
                parts = block.split(MARKER.ACC_SPLIT);
            if (parts.length >= 2)
                items.push({
                    title: parts[0].trim(),
                    content: renderMd(parts.slice(1).join(MARKER.ACC_SPLIT)),
                });
        }

        // Preserve the authored body when no complete accordion items remain
        if (!items.length) return renderMd(raw);

        // Build paired accordion controls and content regions
        let html = items
            .reduce(
                (htmlAcc, item, i) => [
                    ...htmlAcc,
                    `<div class="accordion-item">
            <button type="button"
                class="accordion-header"
                @keydown="key($event)"
                @click="active = (active === ${i} ? null : ${i})" :aria-expanded="active === ${i}"
                :class="{ 'active': active === ${i} }">
                <span>${item.title}</span>
                <span x-text="active === ${i} ? '-' : '+'">+</span>
            </button>
            <div class="accordion-content" x-show="active === ${i}" x-collapse x-cloak>
                <div class="accordion-inner">${item.content}</div>
            </div>
        </div>`,
                ],
                ['<div class="accordion-group" x-data="{ active: null }">']
            )
            .join('');

        return (
            html.replace('x-data="{ active: null }"', 'x-data="accessibleAccordions"') + '</div>'
        );
    },
    { ends: true }
);

// Add language labels, clipboard controls, and image export to highlighted code
hexo.extend.filter.register('after_post_render', function (data) {
    if (!data.content) return data;

    // Match highlighted code figures while preserving optional captions
    const regex = /(<figure class="highlight.*?>)(?:<figcaption>.*?<\/figcaption>)?/gi;

    // Insert code controls before the existing highlight table
    data.content = data.content.replace(regex, (match, openTag) => {
        // Read language names from the highlight class
        let lang = 'code';
        const classMatch = /class=["']highlight\s+([a-zA-Z0-9\-_]+)/.exec(openTag);

        // Fall back to the generic highlight class
        if (classMatch && classMatch[1]) lang = classMatch[1];

        // Normalize the language label for display
        if (lang === 'plain') lang = 'text';

        return `${match}
        <div class="code-actions">
            <span class="code-lang">${lang.toUpperCase()}</span>
            <button type="button" class="code-copy-btn" x-data="codeCopy" @click="copy" aria-label="Copy code">
                <template x-if="!copied">
                    <div style="display: flex; align-items: center; gap: 4px;">
                        <span class="copy-icon">
                        <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                        </svg>
                        </span>
                        <span class="copy-text">Copy</span>
                    </div>
                </template>
                <template x-if="copied">
                    <div style="display: flex; align-items: center; gap: 4px;" x-cloak>
                        <span class="copy-success-icon">
                        <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                        </span>
                        <span class="copy-success">Copied!</span>
                    </div>
                </template>
            </button>
            <button type="button" class="code-copy-btn" x-data="codeImage" @click="capture" aria-label="Save as Image">
                <div style="display: flex; align-items: center; gap: 4px;">
                    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                        <circle cx="8.5" cy="8.5" r="1.5"></circle>
                        <polyline points="21 15 16 10 5 21"></polyline>
                    </svg>
                    <span>Save as Image</span>
                </div>
            </button>
        </div>`;
    });

    return data;
});

// Standard icons for alert types
const ICONS = {
    info: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>',
    warning:
        '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>',
    danger: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>',
    success:
        '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>',
    tip: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>',
};

// Render labeled alerts with a matching icon and Markdown body
hexo.extend.tag.register(
    'alert',
    function (args, content) {
        const type = (args[0] || 'info').toLowerCase(),
            title =
                args.length > 1
                    ? args.slice(1).join(' ')
                    : type.charAt(0).toUpperCase() + type.slice(1);

        return `
    <div class="alert alert-${type}">
        <div class="alert-title">
            <span class="alert-icon">${ICONS[type] || ICONS['info']}</span>
            <span>${title}</span>
        </div>
        <div class="alert-content">${renderMd(content || '')}</div>
    </div>`;
    },
    { ends: true }
);

// Render galleries with configurable thumbnails and full-size lightbox sources
hexo.extend.tag.register(
    'gallery',
    function (args, content) {
        const config = hexo.theme.config.gallery || {},
            siteUrl = hexo.config.url;

        // Resolve thumbnail settings from tag overrides and theme defaults
        let useThumbs = config.thumbnails !== false;

        // Parse arguments to determine if thumbnails are enabled/disabled
        args.forEach((arg) => {
            const [key, val] = arg.split(':');
            if (key === 'thumb' || key === 'thumbnails')
                useThumbs = val !== 'false' && val !== '0' && val !== 'off';
        });

        // Read the thumbnail service pattern with the default proxy fallback
        const servicePattern =
            config.service_pattern || 'https://wsrv.nl/?url=%s&w=300&h=300&fit=inside&q=80';

        // Render markdown, strip <p> tags, and process images
        let rendered = renderMd(content || '')
            .replace(/<\/?p[^>]*>/g, '')
            .replace(/<img([^>]*)>/gi, (match, attr) => {
                const srcMatch = attr.match(/src=["']([^"']+)["']/),
                    originalSrc = srcMatch ? srcMatch[1] : '';
                let thumbSrc = originalSrc;

                // Generate thumbnail URL if enabled
                if (useThumbs && originalSrc) {
                    try {
                        let fullUrl = originalSrc;

                        // Resolve local gallery images before requesting thumbnails
                        if (!/^https?:\/\//.test(originalSrc) && siteUrl)
                            fullUrl = new URL(originalSrc, siteUrl).href;
                        else if (/^https?:\/\//.test(originalSrc)) fullUrl = originalSrc;

                        // Only apply the thumbnail service pattern if we have a valid absolute URL
                        if (/^https?:\/\//.test(fullUrl))
                            thumbSrc = servicePattern.replace('%s', encodeURIComponent(fullUrl));
                    } catch {}
                }

                // Replace src with the generated thumbnail
                let newAttr = attr.replace(/src=["']([^"']+)["']/, `src="${thumbSrc}"`);

                // Add data-original-src pointing to the original image for the lightbox
                newAttr += ` data-original-src="${originalSrc}"`;

                // Use image alternative text to label the gallery control
                const altMatch = newAttr.match(/alt=["']([^"']*)["']/),
                    altText = altMatch ? altMatch[1] : '';

                // Ensure lazy loading is enabled
                if (!newAttr.includes('loading=')) newAttr += ' loading="lazy"';

                return `<div class="gallery-item" x-data="{ loaded: false }" x-init="loaded = $refs.img.complete">
                <img${newAttr} x-ref="img" @load="loaded = true">
                ${altText ? `<span class="gallery-tag" x-show="loaded">${altText}</span>` : ''}
            </div>`;
            });

        return `<div class="gallery-grid">${rendered}</div>`;
    },
    { ends: true }
);

// Wrap inline spoiler text in a focusable reveal control
function spoilerTag(args) {
    return `<button type="button" class="spoiler" aria-expanded="false" onclick="this.classList.toggle('revealed');this.setAttribute('aria-expanded',this.classList.contains('revealed'))">${args.join(' ')}</button>`;
}

// Register the spoiler/redact tags
hexo.extend.tag.register('spoiler', spoilerTag, { ends: false });

hexo.extend.tag.register('redact', spoilerTag, { ends: false });

// Clean up timeline tag lines
hexo.extend.filter.register('before_post_render', (data) => {
    if (!data.content) return data;

    // Unindent timeline tag lines so Markdown does not turn them into code blocks
    data.content = data.content.replace(
        /^\s*(\{%\s*(?:timeline|endtimeline|timeline_item|endtimeline_item)\b[^%]*%\})\s*$/gm,
        '$1'
    );

    return data;
});

// Register child tag for timeline items
hexo.extend.tag.register(
    'timeline_item',
    function (args, content) {
        // Normalize the timeline date and title arguments
        const date = cleanArgs(args[0]),
            title = cleanArgs(args.slice(1).join(' '));

        return `${MARKER.TL_START}${date}${MARKER.TL_SPLIT}${title}${MARKER.TL_SPLIT}${content || ''}${MARKER.TL_END}`;
    },
    { ends: true }
);

// Register parent tag for timeline
hexo.extend.tag.register(
    'timeline',
    function (args, content) {
        const raw = content || '',
            chunks = raw.split(MARKER.TL_START),
            items = [];

        // Choose an authored timeline ID or allocate the next generated ID
        const customId = cleanArgs(args[0]);
        let timelineId;

        if (customId) timelineId = customId;
        else {
            if (this.flux_timeline_count === undefined) this.flux_timeline_count = 0;
            timelineId = ++this.flux_timeline_count;
        }

        // Skip content preceding the first timeline item
        for (let i = 1; i < chunks.length; i++) {
            const chunk = chunks[i],
                endIdx = chunk.indexOf(MARKER.TL_END);

            // Skip timeline markers without a closing delimiter
            if (endIdx === -1) continue;

            // Add item to collection if valid
            const parts = chunk.substring(0, endIdx).split(MARKER.TL_SPLIT);

            // Split timeline markers into date, title, and Markdown content
            if (parts.length >= 3)
                items.push({
                    date: parts[0],
                    title: parts[1],
                    // Render the body content using the existing helper
                    content: renderMd(dedent(parts.slice(2).join(MARKER.TL_SPLIT))),
                });
        }

        // If no items were successfully parsed, render raw content to reveal errors
        if (items.length === 0) return renderMd(raw);

        // Build timeline HTML with Alpine.js scroll logic
        const html = items
            .map((item) => {
                const slug = slugize(item.title, { transform: 1 }),
                    id = `Timeline-${timelineId}-${slug}`;
                return `
        <div class="timeline-item"
            id="${id}"
            :class="{ 'active': activeId === '${id}' }"
            @click="window.location.hash = '${id}'"
            style="cursor: pointer;"
        >
            <div class="timeline-marker"></div>
            <div class="timeline-content">
                <div class="timeline-header">
                    <span class="timeline-date">${item.date}</span>
                    <h4 class="timeline-title">${item.title}</h4>
                </div>
                <div class="timeline-body">${item.content}</div>
            </div>
        </div>`;
            })
            .join('');

        return `<div class="timeline" x-data="{
        activeId: '',
        init() {
            this.check();
            window.addEventListener('hashchange', () => this.check());
        },
        check() {
            if (!window.location.hash) {
                this.activeId = '';
                return;
            }
            try {
                const id = decodeURIComponent(window.location.hash.substring(1));
                this.activeId = id;
                const el = document.getElementById(id);
                if (el && this.$el.contains(el))
                    this.$nextTick(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
            } catch (e) {}
        }
    }">${html}</div>`;
    },
    { ends: true }
);
