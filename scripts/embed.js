'use strict';
// Identify supported embed providers from the authored URL
function detectPlatformFromUrl(url) {
    if (/(?:youtube\.com|youtu\.be)/.test(url)) return 'youtube';
    if (/spotify\.com/.test(url)) return 'spotify';
    if (/vimeo\.com/.test(url)) return 'vimeo';
    if (/twitch\.tv/.test(url)) return 'twitch';
    if (/tiktok\.com/.test(url)) return 'tiktok';
    if (/gist\.github\.com/.test(url)) return 'gist';
    if (/jsfiddle\.net/.test(url)) return 'jsfiddle';
    if (/codesandbox\.io/.test(url)) return 'codesandbox';
    return null;
}

// Accept YouTube video URLs and standalone video IDs
function extractYouTubeId(input) {
    if (!input) return null;
    const str = String(input).trim();

    // Match supported provider URL forms before accepting shorthand IDs
    const patterns = [
        /(?:https?:\/\/)?(?:www\.)?youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/,
        /(?:https?:\/\/)?youtu\.be\/([a-zA-Z0-9_-]{11})/,
        /(?:https?:\/\/)?(?:www\.)?youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
        /^([a-zA-Z0-9_-]{11})$/,
    ];

    for (const pattern of patterns) {
        const match = str.match(pattern);
        if (match) return match[1];
    }

    return null;
}

// Render a lazy YouTube player from a validated video ID
function generateYouTubeEmbed(input) {
    const videoId = extractYouTubeId(input);
    if (!videoId) return '';

    const embedUrl = `https://www.youtube.com/embed/${videoId}`;
    return [
        '<div class="video-embed-container">',
        '  <iframe',
        '    style="position: absolute; top: 0; left: 0; width: 100%; height: 100%;"',
        '    src="' + embedUrl + '"',
        '    frameborder="0"',
        '    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"',
        '    allowfullscreen',
        '    loading="lazy"',
        '  ></iframe>',
        '</div>',
    ].join('\n');
}

// Spotify track, playlist, and artist types
const SPOTIFY_TYPES = new Set(['track', 'playlist', 'artist', 'episode']);

// Resolve Spotify URLs or shorthand IDs with an optional content type
function extractSpotifyRef(input, forcedType) {
    if (!input) return null;
    const str = String(input).trim(),
        typeHint = forcedType && SPOTIFY_TYPES.has(forcedType) ? forcedType : null;

    // Match supported provider URL forms before accepting shorthand IDs
    const patterns = [
        {
            regex: /^spotify:(track|playlist|artist|episode):([a-zA-Z0-9]+)$/,
            typeIndex: 1,
            idIndex: 2,
        },
        {
            regex: /open\.spotify\.com\/(track|playlist|artist|episode)\/([a-zA-Z0-9]+)/,
            typeIndex: 1,
            idIndex: 2,
        },
        {
            regex: /open\.spotify\.com\/embed\/(track|playlist|artist|episode)\/([a-zA-Z0-9]+)/,
            typeIndex: 1,
            idIndex: 2,
        },
    ];

    for (const pattern of patterns) {
        const match = str.match(pattern.regex);
        if (match) return { type: match[pattern.typeIndex], id: match[pattern.idIndex] };
    }

    // Accept standalone Spotify IDs with a track default
    if (/^[a-zA-Z0-9]{22}$/.test(str)) return { type: typeHint || 'track', id: str };

    return null;
}

// Render Spotify players using the resolved content type and ID
function generateSpotifyEmbed(input, forcedType) {
    const ref = extractSpotifyRef(input, forcedType);
    if (!ref) return '';

    const { type, id } = ref,
        embedUrl = `https://open.spotify.com/embed/${type}/${id}`,
        height = type === 'track' ? 80 : 352;

    return [
        '<div class="spotify-embed-inline">',
        '  <iframe',
        '    src="' + embedUrl + '"',
        '    width="100%"',
        '    height="' + height + '"',
        '    frameborder="0"',
        '    allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"',
        '    loading="lazy"',
        '  ></iframe>',
        '</div>',
    ].join('\n');
}

// Accept Vimeo video URLs and standalone numeric IDs
function extractVimeoId(input) {
    if (!input) return null;
    const str = String(input).trim(),
        match = str.match(/vimeo\.com\/(\d+)/);
    if (match) return match[1];
    if (/^(\d+)$/.test(str)) return str;
    return null;
}

// Render a lazy Vimeo player from a validated video ID
function generateVimeoEmbed(input) {
    const videoId = extractVimeoId(input);
    if (!videoId) return '';

    const embedUrl = `https://player.vimeo.com/video/${videoId}`;
    return [
        '<div class="video-embed-container">',
        '  <iframe',
        '    style="position: absolute; top: 0; left: 0; width: 100%; height: 100%;"',
        '    src="' + embedUrl + '"',
        '    frameborder="0"',
        '    allow="autoplay; fullscreen; picture-in-picture"',
        '    allowfullscreen',
        '    loading="lazy"',
        '  ></iframe>',
        '</div>',
    ].join('\n');
}

// Twitch video and channel types
const TWITCH_TYPES = new Set(['video', 'channel']);

// Resolve Twitch video URLs, channel URLs, and shorthand references
function extractTwitchRef(input, forcedType) {
    if (!input) return null;
    const str = String(input).trim(),
        typeHint = forcedType && TWITCH_TYPES.has(forcedType) ? forcedType : null;

    // Recognize Twitch video URLs before interpreting channel names
    let match = str.match(/twitch\.tv\/videos\/(\d+)/);
    if (match) return { type: 'video', id: match[1] };

    // Read channel names from supported Twitch hostnames
    match = str.match(/twitch\.tv\/([a-zA-Z0-9_]+)\/?$/);
    if (match) {
        const id = match[1];
        if (id.toLowerCase() !== 'videos') return { type: 'channel', id: id };
    }

    if (typeHint) {
        if (typeHint === 'video' && /^\d+$/.test(str)) return { type: 'video', id: str };
        if (typeHint === 'channel' && /^[a-zA-Z0-9_]+$/.test(str))
            return { type: 'channel', id: str };
    }

    // Treat numeric shorthand as videos unless an explicit type is provided
    if (/^\d+$/.test(str)) return { type: 'video', id: str };
    if (/^[a-zA-Z0-9_]+$/.test(str)) return { type: 'channel', id: str };

    return null;
}

// Build Twitch players with the configured site hostname as their parent
function generateTwitchEmbed(input, forcedType) {
    const ref = extractTwitchRef(input, forcedType);
    if (!ref) return '';

    const { type, id } = ref,
        url = new URL(hexo.config.url),
        parent = url.hostname;

    // Choose the video or channel parameter for the Twitch player
    let embedUrl;
    if (type === 'video') {
        embedUrl = `https://player.twitch.tv/?video=${id}&parent=${parent}`;
    } else {
        embedUrl = `https://player.twitch.tv/?channel=${id}&parent=${parent}`;
    }

    return [
        '<div class="video-embed-container">',
        '  <iframe',
        '    style="position: absolute; top: 0; left: 0; width: 100%; height: 100%;"',
        '    src="' + embedUrl + '"',
        '    frameborder="0"',
        '    allow="autoplay; fullscreen"',
        '    allowfullscreen',
        '    loading="lazy"',
        '  ></iframe>',
        '</div>',
    ].join('\n');
}

// Read TikTok author and video identifiers from full video URLs
function extractTikTokInfo(input) {
    if (!input) return null;
    const str = String(input).trim();
    let match;

    match = str.match(/(https?:\/\/(?:www\.)?tiktok\.com\/@.+?\/video\/(\d+))/);
    if (match) return { url: match[1], id: match[2] };

    if (/^\d+$/.test(str)) return { url: null, id: str };

    return null;
}

// Render TikTok markup for a validated author and video pair
function generateTikTokEmbed(input) {
    const info = extractTikTokInfo(input);
    if (!info) return '';

    const citeAttr = info.url ? `cite="${info.url}"` : '';
    return [
        `<blockquote class="tiktok-embed" ${citeAttr} data-video-id="${info.id}" style="max-width: 605px;min-width: 325px;" >`,
        `<section></section>`,
        `</blockquote>`,
        `<script async src="https://www.tiktok.com/embed.js"></script>`,
    ].join('');
}

// Resolve Gist URLs and shorthand author or revision references
function extractGistRef(input) {
    if (!input) return null;
    const str = String(input).trim();

    // Parse provider URLs before trying shorthand references
    try {
        const url = new URL(str);
        if (url.hostname === 'gist.github.com') {
            const parts = url.pathname.split('/').filter(Boolean);
            if (parts.length >= 1) {
                const id = parts[parts.length - 1];
                if (/^[a-f0-9]+$/i.test(id)) {
                    const user = parts.length >= 2 ? parts[0] : null,
                        file = url.searchParams.get('file');
                    return { user, id, file };
                }
            }
        }
    } catch {
        // Ignore URL parse errors; we still support shorthand formats below
    }

    // Accept author and identifier shorthand
    let match = str.match(/^([a-zA-Z0-9-]+)\/([a-f0-9]+)$/i);
    if (match) return { user: match[1], id: match[2], file: null };

    // Accept an identifier without an author prefix
    if (/^[a-f0-9]+$/i.test(str)) return { user: null, id: str, file: null };

    return null;
}

// Render a Gist iframe with its optional revision
function generateGistEmbed(input) {
    const ref = extractGistRef(input);
    if (!ref) return '';

    const base = ref.user
            ? `https://gist.github.com/${ref.user}/${ref.id}.js`
            : `https://gist.github.com/${ref.id}.js`,
        scriptUrl = ref.file ? `${base}?file=${encodeURIComponent(ref.file)}` : base;

    return [
        '<div class="gist-embed-inline">',
        '  <script src="' + scriptUrl + '"></script>',
        '</div>',
    ].join('\n');
}

// Resolve JSFiddle URLs and shorthand identifiers with optional revisions
function extractJsFiddleRef(input) {
    if (!input) return null;
    const str = String(input).trim();

    // Parse provider URLs before trying shorthand references
    try {
        const url = new URL(str);
        if (url.hostname === 'jsfiddle.net' || url.hostname.endsWith('.jsfiddle.net')) {
            const parts = url.pathname.split('/').filter(Boolean);
            if (!parts.length) return null;

            const embeddedIndex = parts.indexOf('embedded'),
                trimmed = embeddedIndex === -1 ? parts : parts.slice(0, embeddedIndex);
            if (!trimmed.length) return null;

            if (trimmed.length === 1) return { user: null, id: trimmed[0], revision: null };

            const user = trimmed[0],
                id = trimmed[1],
                revision = trimmed.length > 2 && /^\d+$/.test(trimmed[2]) ? trimmed[2] : null;

            return { user, id, revision };
        }
    } catch {
        // Ignore URL parse errors; we still support shorthand formats below
    }

    // Accept author and fiddle shorthand with an optional revision
    let match = str.match(/^([a-zA-Z0-9-_]+)\/([a-zA-Z0-9]+)(?:\/(\d+))?$/);
    if (match) return { user: match[1], id: match[2], revision: match[3] || null };

    // Accept an identifier without an author prefix
    if (/^[a-zA-Z0-9]+$/.test(str)) return { user: null, id: str, revision: null };

    return null;
}

// Render the selected fiddle revision in a lazy iframe
function generateJsFiddleEmbed(input) {
    const ref = extractJsFiddleRef(input);
    if (!ref) return '';

    let embedUrl = ref.user
        ? `https://jsfiddle.net/${ref.user}/${ref.id}`
        : `https://jsfiddle.net/${ref.id}`;
    if (ref.revision) embedUrl += `/${ref.revision}`;
    embedUrl += '/embedded/';

    return [
        '<div class="video-embed-container" style="padding-top: 62.5%;">',
        '  <iframe',
        '    style="position: absolute; top: 0; left: 0; width: 100%; height: 100%;"',
        '    src="' + embedUrl + '"',
        '    frameborder="0"',
        '    allowfullscreen',
        '    loading="lazy"',
        '  ></iframe>',
        '</div>',
    ].join('\n');
}

// Resolve legacy and project-style CodeSandbox URLs or shorthand slugs
function extractCodeSandboxRef(input) {
    if (!input) return null;
    const str = String(input).trim();

    // Parse provider URLs before trying shorthand references
    try {
        const url = new URL(str);
        if (url.hostname === 'codesandbox.io' || url.hostname.endsWith('.codesandbox.io')) {
            const parts = url.pathname.split('/').filter(Boolean),
                search = url.search || '';
            if (!parts.length) return null;

            // Reuse an existing CodeSandbox embed path
            if (parts[0] === 'embed' && parts[1])
                return { mode: 'embed', slug: parts[1], search: search };

            // Resolve legacy sandbox short links
            if (parts[0] === 's' && parts[1])
                return { mode: 'short', slug: parts[1], search: search };

            // Resolve sandbox project links by kind and slug
            if (parts[0] === 'p' && parts[1] && parts[2])
                return { mode: 'project', kind: parts[1], slug: parts[2], search: search };
        }
    } catch {
        // Ignore URL parse errors; we still support shorthand formats below
    }

    // /p/<kind>/<slug> shorthand
    let match = str.match(/^p\/([a-zA-Z0-9-_]+)\/([a-zA-Z0-9-_]+)$/);
    if (match) return { mode: 'project', kind: match[1], slug: match[2], search: '' };

    // /s/<slug> shorthand
    match = str.match(/^s\/([a-zA-Z0-9-_]+)$/);
    if (match) return { mode: 'short', slug: match[1], search: '' };

    // Accept a standalone sandbox slug
    if (/^[a-zA-Z0-9-_]+$/.test(str)) return { mode: 'short', slug: str, search: '' };

    return null;
}

// Render CodeSandbox embeds from normalized sandbox references
function generateCodeSandboxEmbed(input) {
    const ref = extractCodeSandboxRef(input);
    if (!ref) return '';

    const params = new URLSearchParams(ref.search);
    params.set('view', 'editor + preview');

    let embedUrl;
    if (ref.mode === 'project') {
        if (!params.has('embed')) params.set('embed', '1');
        const query = params.toString();
        embedUrl = `https://codesandbox.io/p/${ref.kind}/${ref.slug}${query ? '?' + query : ''}`;
    } else {
        const query = params.toString();
        embedUrl = `https://codesandbox.io/embed/${ref.slug}${query ? '?' + query : ''}`;
    }

    return [
        '<div class="video-embed-container" style="padding-top: 62.5%;">',
        '  <iframe',
        '    style="position: absolute; top: 0; left: 0; width: 100%; height: 100%;"',
        '    src="' + embedUrl + '"',
        '    frameborder="0"',
        '    allow="accelerometer; ambient-light-sensor; camera; encrypted-media; geolocation; gyroscope; hid; microphone; midi; payment; usb; vr; xr-spatial-tracking"',
        '    allowfullscreen',
        '    loading="lazy"',
        '  ></iframe>',
        '</div>',
    ].join('\n');
}

const { load: parseEmbed } = require('cheerio'),
    { escapeHTML } = require('hexo-util');

// Keep provider HTML inert until the visitor activates the embed
function deferred(provider, html) {
    if (!html || hexo.theme.config.embeds?.enabled === false) return html;
    const $ = parseEmbed(html),
        href =
            $('iframe').first().attr('src') ||
            $('blockquote').attr('cite') ||
            $('script').first().attr('src') ||
            '#',
        label = escapeHTML(provider[0].toUpperCase() + provider.slice(1));
    return `<div class="deferred-embed" data-flux-embed="${provider}" x-data="deferredEmbed"><div x-show="!loaded"><p>${label} embed</p><div class="embed-actions"><button type="button" @click="activate">Load ${label}</button><a class="post-btn" href="${escapeHTML(href)}" target="_blank" rel="noopener">Open on ${label}</a></div></div><p role="status" x-text="message"></p><div x-ref="target"></div><template data-embed-html>${html}</template></div>`;
}
// Select an embed renderer from the URL or an explicit provider hint
hexo.extend.tag.register(
    'embed',
    function (args) {
        if (!args || !args.length) return '';

        // Prefer an explicit provider hint when one is present
        const input = args[0],
            hint = args.length > 1 ? args[1].toLowerCase() : null,
            platform = detectPlatformFromUrl(input) || hint;

        // Dispatch each supported provider through its own reference parser
        const render = () => {
            switch (platform) {
                case 'youtube':
                    return generateYouTubeEmbed(input);
                case 'spotify':
                    // Honor the explicit Spotify content type
                    const forcedSpotifyType =
                        args.length > 2 && SPOTIFY_TYPES.has(args[2].toLowerCase())
                            ? args[2].toLowerCase()
                            : null;
                    return generateSpotifyEmbed(input, forcedSpotifyType);
                case 'vimeo':
                    return generateVimeoEmbed(input);
                case 'twitch':
                    const forcedTwitchType =
                        args.length > 2 && TWITCH_TYPES.has(args[2].toLowerCase())
                            ? args[2].toLowerCase()
                            : null;
                    return generateTwitchEmbed(input, forcedTwitchType);
                case 'tiktok':
                    return generateTikTokEmbed(input);
                case 'gist':
                    return generateGistEmbed(input);
                case 'jsfiddle':
                    return generateJsFiddleEmbed(input);
                case 'codesandbox':
                    return generateCodeSandboxEmbed(input);
                default:
                    return '';
            }
        };
        return deferred(platform, render());
    },
    { ends: false }
);

// Map provider tags to their renderers and optional content type overrides
const embedTags = {
    youtube: (args) => generateYouTubeEmbed(args.join(' ')),
    // Honor an optional Spotify type when rendering the provider tag
    spotify: (args) => {
        const forcedType =
            args.length == 2 && SPOTIFY_TYPES.has(args[1].toLowerCase())
                ? args[1].toLowerCase()
                : null;
        return generateSpotifyEmbed(args[0], forcedType);
    },
    vimeo: (args) => generateVimeoEmbed(args.join(' ')),
    // Honor an optional Twitch type when rendering the provider tag
    twitch: (args) => {
        const forcedType =
            args.length == 2 && TWITCH_TYPES.has(args[1].toLowerCase())
                ? args[1].toLowerCase()
                : null;
        return generateTwitchEmbed(args[0], forcedType);
    },
    tiktok: (args) => generateTikTokEmbed(args.join(' ')),
    gist: (args) => generateGistEmbed(args.join(' ')),
    jsfiddle: (args) => generateJsFiddleEmbed(args.join(' ')),
    codesandbox: (args) => generateCodeSandboxEmbed(args.join(' ')),
};

// Register provider tags through the shared deferred embed wrapper
for (const tag of Object.keys(embedTags))
    hexo.extend.tag.register(tag, (args) => deferred(tag, embedTags[tag](args)), { ends: false });
