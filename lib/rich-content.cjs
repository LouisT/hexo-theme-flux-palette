'use strict';
const fs = require('node:fs'),
    path = require('node:path'),
    { load } = require('cheerio'),
    { escapeHTML, highlight } = require('hexo-util'),
    katex = require('katex'),
    cache = require('./cache.cjs'),
    content = require('./content.cjs');

// Escape author text for generated HTML and attributes
const escape = (value) => escapeHTML(String(value ?? '')).replace(/'/g, '&#39;');

// Encode nested tag payloads and restore them after Markdown rendering
const pack = (value) => Buffer.from(JSON.stringify(value)).toString('base64'),
    unpack = (value) => JSON.parse(Buffer.from(value, 'base64').toString());
const rawPrefix = 'FLUX_RICH_RAW:',
    icons = { info: 'ⓘ', check: '✓', code: '</>', download: '↓' };

// Report malformed rich content with the source article's identity
function fail(item, message) {
    throw new Error(
        `[Rich content] ${item.source || item.title || item.path || 'article'}: ${message}`
    );
}

// Reserve leading tag arguments for titles, URLs, or inline content
const positional = {
    step: 1,
    card: 1,
    image_compare: 2,
    math: 1,
    term: 2,
    figure: 2,
    figure_ref: 1,
    download: 2,
};

// Separate positional arguments from key:value options without misreading title text
function options(args, name) {
    const values = [],
        named = Object.create(null);
    for (const [index, arg] of args.entries()) {
        const match = /^([a-z_]+):(.*)$/s.exec(arg);
        if (match && index >= (positional[name] || 0)) named[match[1]] = match[2];
        else values.push(arg);
    }
    return { values, named };
}

// Require component IDs that remain safe in HTML attributes and fragment links
function id(item, value) {
    if (!value || !/^[a-zA-Z][\w-]*$/.test(value))
        fail(
            item,
            'IDs must start with a letter and contain only letters, numbers, underscores, or hyphens.'
        );
    return value;
}

// Validate author URLs and resolve local routes under the configured site root
function destination(ctx, item, value) {
    if (!value || /[\x00-\x20\\]/.test(value))
        fail(item, `Invalid destination: ${value || '(missing)'}`);
    if (/^https?:\/\//i.test(value)) {
        const url = new URL(value);
        if (url.username || url.password) fail(item, 'URLs cannot contain credentials.');
        return value;
    }
    if (/^(?:[a-z][\w+.-]*:|\/\/)/i.test(value)) fail(item, `Unsupported destination: ${value}`);
    if (value.startsWith('#')) return value;
    const root = content.root(ctx);
    if (value.startsWith('/')) return value.startsWith(root) ? value : content.url(ctx, value);
    return new URL(value, 'https://flux.invalid' + content.url(ctx, item.path || '')).pathname;
}

// Resolve local downloads within source directories and infer their sizes
function localFile(ctx, item, value) {
    const href = destination(ctx, item, value),
        root = content.root(ctx);
    if (/^https?:\/\//i.test(href)) return { href };
    if (/[?#]/.test(href))
        fail(item, 'Local downloads must reference a file without query or fragment.');
    // The built-in playground publishes its examples directly without source files
    const generated = item.flux_rich_assets instanceof Map ? item.flux_rich_assets.get(href) : null;
    if (Buffer.isBuffer(generated)) return { href, bytes: generated.length, local: true };
    const relative = decodeURIComponent(href.slice(root.length)),
        candidates = [
            path.resolve(ctx.source_dir, relative),
            path.resolve(ctx.theme_dir, 'source', relative),
        ];
    if (item.asset_dir) {
        const assetRelative = relative.startsWith(item.path || '\0')
            ? relative.slice(item.path.length)
            : value.replace(/^\//, '');
        candidates.push(path.resolve(item.asset_dir, assetRelative));
    }
    // Resolve real paths so symlinks cannot escape the allowed source directories
    const bases = [ctx.source_dir, path.join(ctx.theme_dir, 'source')].map(
        (folder) => fs.realpathSync(folder) + path.sep
    );
    const file = candidates.find((candidate) => {
        try {
            return (
                bases.some((base) => fs.realpathSync(candidate).startsWith(base)) &&
                fs.statSync(candidate).isFile()
            );
        } catch {
            return false;
        }
    });
    if (!file) fail(item, `Local download not found: ${value}`);
    return { href, file, bytes: fs.statSync(file).size };
}

// Format download sizes using binary units
function size(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    const unit = bytes < 1024 ** 2 ? 1 : bytes < 1024 ** 3 ? 2 : 3;
    return `${Number((bytes / 1024 ** unit).toFixed(1))} ${['B', 'KiB', 'MiB', 'GiB'][unit]}`;
}

// Expand code line ranges and reject reversed or out-of-bounds selections
function lines(item, value, count) {
    if (!value) return [];
    const result = new Set();
    for (const part of value.split(',')) {
        const match = /^(\d+)(?:-(\d+))?$/.exec(part);
        if (!match) fail(item, `Invalid code range: ${value}`);
        const first = +match[1],
            last = +(match[2] || match[1]);
        if (first < 1 || first > last || last > count)
            fail(item, `Code range ${part} is outside 1-${count}.`);
        for (let n = first; n <= last; n++) result.add(n);
    }
    return [...result];
}

// Remove shared indentation while preserving the relative layout of raw bodies
function dedent(value) {
    value = value.replace(/\r\n/g, '\n').replace(/^\n|\n$/g, '');
    const indents = value
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => /^\s*/.exec(line)[0].length);
    const minimum = Math.min(...indents, Infinity);
    return Number.isFinite(minimum)
        ? value
              .split('\n')
              .map((line) => line.slice(minimum))
              .join('\n')
        : value;
}

// Encode raw bodies before Hexo's fenced-code filter or Nunjucks can alter them
function protectRaw(data) {
    data.flux_rich_downloads = [];
    // Skip Markdown fences and inline code while locating raw rich-content tags
    const pattern =
        /(^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^[ \t]*\2[ \t]*(?:\n|$))|(`+)[^\n]*?\3|\{%\s*(annotated_code|mermaid|math)\b([^]*?)%\}([\s\S]*?)\{%\s*end\4\s*%\}/gm;
    data.content = data.content.replace(pattern, (match, fence, marker, inline, tag, args, body) =>
        tag ? `{% ${tag}${args}%}${rawPrefix}${pack(body)}{% end${tag} %}` : match
    );
    return data;
}

// Restore encoded code, diagram, and equation bodies without altering plain content
function raw(body) {
    return body.startsWith(rawPrefix) ? unpack(body.slice(rawPrefix.length)) : body;
}

// Register rich-content tags with shared Markdown rendering and article-aware errors
function register(ctx) {
    // Render child descriptions and captions through Hexo's Markdown engine
    const md = (text) => ctx.render.renderSync({ text: dedent(text || ''), engine: 'markdown' });

    // Normalize tag arguments and attach article context to rendering errors
    const tag = (name, ends, fn) =>
        ctx.extend.tag.register(
            name,
            function (args, body) {
                try {
                    return fn.call(this, options(args, name), body || '');
                } catch (error) {
                    if (error.message.startsWith('[Rich content]')) throw error;
                    fail(this, `${name}: ${error.message}`);
                }
            },
            { ends }
        );

    // Preserve child block metadata in markers until their parent renders
    const child = (name) =>
        tag(name, true, function (opts, body) {
            return `<!--flux-rich-${name}:${pack({ ...opts, html: md(body) })}-->`;
        });

    // Accept only expected child blocks and discard empty Markdown wrappers
    const children = (item, body, allowed) => {
        const found = [];
        const remainder = body.replace(
            /<!--flux-rich-(\w+):([A-Za-z0-9+/=]+)-->/g,
            (match, name, value) => {
                if (!allowed.includes(name)) fail(item, `Unexpected ${name} child.`);
                found.push({ name, ...unpack(value) });
                return '';
            }
        );
        const extra = load(remainder, null, false);
        extra('p').each((_, node) => {
            if (!extra(node).text().trim() && !extra(node).children().length) extra(node).remove();
        });
        if (extra.html().trim() || !found.length)
            fail(item, `Expected ${allowed.join('/')} children only.`);
        return found;
    };
    for (const name of ['step', 'card', 'pros', 'cons']) child(name);

    // Render numbered steps with optional completion tracking and built-in icons
    tag('steps', true, function ({ named }, body) {
        if (named.track && !['true', 'false'].includes(named.track))
            fail(this, 'steps track must be true or false.');
        const tracked = named.track === 'true',
            items = children(this, body, ['step']);
        if (tracked) id(this, named.id);
        const html = items
            .map((item, index) => {
                const title = item.values[0];
                if (!title) fail(this, 'Each step needs a title.');
                if (item.named.icon && !icons[item.named.icon])
                    fail(this, `Unknown step icon: ${item.named.icon}`);
                return `<li><div class="rich-step-title">${tracked ? `<label class="rich-completion"><input type="checkbox" disabled data-rich-check aria-label="Complete step ${index + 1}: ${escape(title)}"></label>` : ''}<span class="rich-step-number" aria-hidden="true">${index + 1}</span>${item.named.icon ? `<span aria-hidden="true">${escape(icons[item.named.icon])}</span>` : ''}<strong>${escape(title)}</strong></div><div class="rich-step-body">${item.html}</div></li>`;
            })
            .join('');
        return `<section class="rich-steps${tracked ? ' rich-progress' : ''}"${tracked ? ` data-rich-progress="${escape(named.id)}" x-data="richProgress"` : ''}><ol>${html}</ol>${tracked ? progressFooter() : ''}</section>`;
    });

    // Render card descriptions with validated links and optional image covers
    tag('cards', true, function (_, body) {
        return `<div class="rich-cards">${children(this, body, ['card'])
            .map((item) => {
                if (!item.values[0]) fail(this, 'Each card needs a title.');
                const href = destination(ctx, this, item.named.url);
                if (item.named.image && !item.named.alt)
                    fail(this, 'Card images require alt text.');
                return `<article class="rich-card">${item.named.image ? `<a href="${escape(href)}" tabindex="-1" aria-hidden="true"><img src="${escape(destination(ctx, this, item.named.image))}" alt="${escape(item.named.alt)}"></a>` : ''}<div class="rich-card-body"><a class="rich-card-title" href="${escape(href)}">${escape(item.values[0])}</a>${item.html}</div></article>`;
            })
            .join('')}</div>`;
    });

    // Preserve table headers while marking the recommended column
    tag('comparison', true, function ({ named }, body) {
        const $ = load(md(body), null, false),
            tables = $('table');
        if (tables.length !== 1) fail(this, 'comparison requires one Markdown table.');
        const headers = tables.find('thead th');
        if (named.recommended) {
            const matches = headers
                .toArray()
                .map((el, i) => ($(el).text().trim() === named.recommended ? i : -1))
                .filter((i) => i >= 0);
            if (matches.length !== 1) fail(this, 'Recommended column must match one table header.');
            const column = matches[0];
            tables
                .find('tr')
                .each((_, row) => $(row).children().eq(column).addClass('rich-recommended'));
            headers.eq(column).append('<span class="rich-recommendation">Recommended</span>');
        }
        headers.attr('scope', 'col');
        tables.find('tbody tr').each((_, row) => {
            const cell = $(row).children().first();
            cell.replaceWith(
                `<th scope="row" class="${escape(cell.attr('class') || '')}">${cell.html()}</th>`
            );
        });
        return `<div class="rich-comparison" tabindex="0" role="region" aria-label="Comparison table">${$.html()}</div>`;
    });

    // Render contained comparison images with labeled native slider controls
    tag('image_compare', false, function ({ values, named }) {
        if (values.length !== 2 || !named.before_alt || !named.after_alt)
            fail(this, 'image_compare requires two URLs and before_alt/after_alt text.');
        return `<figure class="rich-image-compare" x-data="richImageCompare"><div class="rich-image-stage"><img class="rich-before" src="${escape(destination(ctx, this, values[0]))}" alt="${escape(named.before_alt)}"><img class="rich-after" src="${escape(destination(ctx, this, values[1]))}" alt="${escape(named.after_alt)}"><span class="rich-image-label rich-before-label">Before</span><span class="rich-image-label rich-after-label">After</span><span class="rich-image-divider" aria-hidden="true"></span></div><label class="rich-image-control">Compare before and after <input type="range" min="0" max="100" value="50" disabled aria-label="Image comparison position"></label><noscript><p>Before and after images are shown in order.</p></noscript></figure>`;
    });

    // Separate raw code from validated notes before syntax highlighting
    tag('annotated_code', true, function ({ named }, body) {
        body = raw(body);
        const notes = [],
            firstNote = body.search(/\{%\s*code_note\b/),
            code = dedent(firstNote < 0 ? body : body.slice(0, firstNote).trimEnd());
        const count = code.split('\n').length;
        // Keep note explanations outside the highlighted block and validate their line ranges
        if (firstNote >= 0) {
            const rest = body
                .slice(firstNote)
                .replace(
                    /\{%\s*code_note\s+(["']?)([\d,-]+)\1\s*%\}([\s\S]*?)\{%\s*endcode_note\s*%\}/g,
                    (_, quote, range, note) => {
                        lines(this, range, count);
                        notes.push(`<li><strong>Lines ${escape(range)}</strong>${md(note)}</li>`);
                        return '';
                    }
                );
            if (rest.trim())
                fail(this, 'code_note blocks must follow the code and use valid line ranges.');
        }
        if (named.lang && !/^[\w-]+$/.test(named.lang)) fail(this, 'Invalid code language.');
        const rendered = highlight(code, {
            lang: named.lang || 'text',
            gutter: ctx.config.highlight?.line_number !== false,
            wrap: true,
            hljs: false,
            mark: lines(this, named.highlight, count),
            stripIndent: false,
        });
        return `<div class="rich-annotated-code">${named.filename ? `<div class="rich-code-filename">${escape(named.filename)}</div>` : ''}${rendered}${notes.length ? `<ol class="rich-code-notes">${notes.join('')}</ol>` : ''}</div>`;
    });

    // Reject code notes that appear outside an annotated code block
    tag('code_note', true, function () {
        fail(this, 'code_note must appear after code inside annotated_code.');
    });

    // Publish escaped diagram source for local rendering and source-view fallback controls
    tag('mermaid', true, function ({ named }, body) {
        const source = raw(body).trim();
        if (!source) fail(this, 'mermaid requires diagram source.');
        return `<figure class="rich-mermaid" x-data="richMermaid" data-rich-mermaid><figcaption>${escape(named.title || 'Diagram')}</figcaption><div class="rich-mermaid-output" role="img" aria-label="${escape(named.title || 'Diagram')}"></div><p class="rich-mermaid-status" role="status" hidden></p><details class="rich-mermaid-source" open><summary>Diagram source</summary><pre><code>${escape(source)}</code></pre></details></figure>`;
    });

    // Render TeX into HTML and MathML with escaped fallbacks for invalid equations
    tag('math', true, function ({ values }, body) {
        const mode = values[0] || 'display';
        if (!['inline', 'display'].includes(mode))
            fail(this, 'math mode must be inline or display.');
        const source = raw(body).trim();
        try {
            return katex.renderToString(source, {
                displayMode: mode === 'display',
                output: 'htmlAndMathml',
                trust: false,
                throwOnError: true,
            });
        } catch (error) {
            ctx.log.warn(
                '[Rich content] %s: Invalid equation: %s',
                this.source || this.title,
                error.message
            );
            return `<${mode === 'display' ? 'div' : 'span'} class="rich-math-error"><code>${escape(source)}</code><span> (Equation could not be rendered)</span></${mode === 'display' ? 'div' : 'span'}>`;
        }
    });

    // Keep glossary definitions readable before interactive controls initialize
    tag('term', false, function ({ values }) {
        if (values.length !== 2 || !values.every((v) => v.trim()))
            fail(this, 'term requires a term and a plain-text definition.');
        return `<span class="rich-term" x-data="richTerm"><button type="button" class="rich-term-button">${escape(values[0])}</button><span class="rich-term-definition" role="tooltip">${escape(values[1])}</span></span>`;
    });

    // Render task lists with stable IDs and accessible checkbox names
    tag('checklist', true, function ({ named }, body) {
        id(this, named.id);
        const $ = load(md(body), null, false),
            inputs = $('input[type="checkbox"]');
        if (!inputs.length) fail(this, 'checklist requires Markdown task-list items.');
        inputs.each((index, node) => {
            const input = $(node),
                item = input.closest('li');
            input
                .attr('data-rich-check', '')
                .attr('disabled', '')
                .attr(
                    'aria-label',
                    item.clone().find('ul,ol').remove().end().text().trim() ||
                        `Checklist item ${index + 1}`
                );
        });
        return `<section class="rich-checklist rich-progress" data-rich-progress="${escape(named.id)}" x-data="richProgress">${$.html()}${progressFooter()}</section>`;
    });

    // Render figures with Markdown captions and optional credit links
    tag('figure', true, function ({ values, named }, body) {
        if (values.length !== 2 || !values[1])
            fail(this, 'figure requires an image URL and alternative text.');
        id(this, named.id);
        const credit = named.credit
            ? `<span class="rich-figure-credit">Credit: ${named.credit_url ? `<a href="${escape(destination(ctx, this, named.credit_url))}">${escape(named.credit)}</a>` : escape(named.credit)}</span>`
            : '';
        return `<figure class="rich-figure" id="figure-${escape(named.id)}" data-rich-figure="${escape(named.id)}"><img src="${escape(destination(ctx, this, values[0]))}" alt="${escape(values[1])}"><figcaption><span class="rich-figure-number"></span>${md(body)}${credit}</figcaption></figure>`;
    });

    // Defer figure labels until article-wide numbering is available
    tag('figure_ref', false, function ({ values }) {
        id(this, values[0]);
        return `<a data-rich-figure-ref="${escape(values[0])}" href="#figure-${escape(values[0])}">Figure</a>`;
    });

    // Render public download metadata without requesting external files
    tag('download', true, function ({ values, named }, body) {
        if (values.length !== 2 || !values[1])
            fail(this, 'download requires a file URL and title.');
        const file = localFile(ctx, this, values[0]);
        if (file.file) {
            ctx.fluxRichDownloads ||= new Map();
            ctx.fluxRichDownloads.set(file.href.slice(content.root(ctx).length), file.file);
        }
        const format =
                named.format ||
                path
                    .extname(new URL(file.href, 'https://flux.invalid').pathname)
                    .slice(1)
                    .toUpperCase() ||
                'File',
            metadata = [format, file.bytes === undefined ? named.size : size(file.bytes)]
                .filter(Boolean)
                .join(' · ');
        return `<aside class="rich-download"><a class="rich-download-title" href="${escape(file.href)}"${file.file || file.local ? ' download' : ''}${file.file ? ` data-rich-download-route="${escape(file.href.slice(content.root(ctx).length))}" data-rich-download-format="${escape(format)}"` : ''}>${escape(values[1])}</a><span class="rich-download-meta">${escape(metadata)}</span>${content.protectedItem(this) ? '<strong class="rich-download-public">Public file</strong>' : ''}${md(body)}</aside>`;
    });

    // Require separate pros and cons blocks and label each panel
    tag('proscons', true, function (_, body) {
        const items = children(this, body, ['pros', 'cons']);
        if (items.length !== 2 || items[0].name === items[1].name)
            fail(this, 'proscons requires one pros block and one cons block.');
        return `<div class="rich-proscons">${['pros', 'cons'].map((name) => `<section class="rich-${name}"><strong><span aria-hidden="true">${name === 'pros' ? '✓' : '−'}</span> ${name === 'pros' ? 'Pros' : 'Cons'}</strong>${items.find((i) => i.name === name).html}</section>`).join('')}</div>`;
    });
}

// Keep progress counts and reset controls hidden until tracking initializes
function progressFooter() {
    return '<div class="rich-progress-tools" hidden><span class="rich-progress-count" role="status"></span><button type="button" class="rich-progress-reset">Reset progress</button></div>';
}

// Resolve references and revisions before images, metadata, or encryption consume the body
function finalize(data) {
    if (!data.content || !/rich-|flux-rich-/.test(data.content)) return data;
    const $ = load(data.content, null, false),
        figures = new Map(),
        ids = new Set();
    // Carry local download paths into route generation alongside their format metadata
    data.flux_rich_downloads = $('[data-rich-download-route]')
        .map((_, node) => {
            const route = $(node).attr('data-rich-download-route');
            return {
                route,
                file: this.fluxRichDownloads?.get(route),
                format: $(node).attr('data-rich-download-format'),
            };
        })
        .get();
    if (/<!--flux-rich-/.test(data.content))
        fail(data, 'A rich-content child tag is outside its parent.');
    // Reset saved progress when item text or initial completion states change
    $('[data-rich-progress]').each((_, node) => {
        const el = $(node),
            name = el.attr('data-rich-progress');
        if (ids.has(name)) fail(data, `Duplicate progress ID: ${name}`);
        ids.add(name);
        const items = el
            .find('[data-rich-check]')
            .map((_, input) => ({
                text: $(input).closest('li').text().trim(),
                checked: $(input).is('[checked]'),
            }))
            .get();
        el.attr('data-rich-revision', cache.hash(items).slice(0, 16));
        if (content.protectedItem(data)) el.attr('data-rich-private', 'true');
    });
    // Number only tagged figures and reject duplicate article-local IDs
    $('[data-rich-figure]').each((index, node) => {
        const el = $(node),
            name = el.attr('data-rich-figure');
        if (figures.has(name) || $(`[id="figure-${name}"]`).length !== 1)
            fail(data, `Duplicate figure ID: ${name}`);
        figures.set(name, index + 1);
        el.find('.rich-figure-number')
            .first()
            .text(`Figure ${index + 1}. `);
    });
    // Resolve forward references after every figure has been numbered
    $('[data-rich-figure-ref]').each((_, node) => {
        const el = $(node),
            name = el.attr('data-rich-figure-ref');
        if (!figures.has(name)) fail(data, `Unresolved figure reference: ${name}`);
        el.text(`Figure ${figures.get(name)}`);
    });
    // Unwrap paragraph containers around standalone image comparison blocks
    $('p > .rich-image-compare:only-child').each((_, node) =>
        $(node).parent().replaceWith($(node))
    );
    data.content = $.html();
    return data;
}

module.exports = {
    register,
    protectRaw,
    finalize,
    escape,
    lines,
    destination,
    localFile,
    pack,
    raw,
    size,
    fail,
};
