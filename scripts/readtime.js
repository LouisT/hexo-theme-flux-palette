'use strict';
const fs = require('fs'),
    path = require('path'),
    { stripHTML } = require('hexo-util');

// Normalize reading-time options with validated defaults
function getOptions(themeConfig) {
    const cfg = (themeConfig && themeConfig.read_time) || {};
    return {
        enabled: cfg.enabled !== false,
        wpm: typeof cfg.wpm === 'number' && cfg.wpm > 0 ? cfg.wpm : 238,
        min: typeof cfg.min === 'number' && cfg.min > 0 ? cfg.min : 1,
        label: cfg.label || 'minutes',
        write_front_matter: cfg.write_front_matter === true,
    };
}

// Estimate reading time from rendered text with a minimum duration
function computeReadTime(content, options) {
    if (!content) return { words: 0, minutes: 0, text: '' };

    const rawText = stripHTML(content).trim(),
        words = rawText ? rawText.split(/\s+/).length : 0,
        minutes = Math.max(options.min, Math.ceil(words / options.wpm));

    let label = options.label;
    if (minutes === 1 && label === 'minutes') label = 'minute';

    return {
        words,
        minutes,
        text: `About ${minutes.toLocaleString()} ${label}`,
    };
}

// Resolve the full file path of the post/page
function getFilePath(data, ctx) {
    if (data.full_source) return data.full_source;
    if (data.source && ctx.source_dir) return path.join(ctx.source_dir, data.source);
    return null;
}

// Update reading-time front matter without reformatting authored YAML
function injectFrontMatter(ctx, filePath, info) {
    if (!fs.existsSync(filePath)) {
        ctx.log.error(`[ReadTime] File not found: ${filePath}`);
        return;
    }

    try {
        const content = fs.readFileSync(filePath, 'utf8');

        // Match the front matter block while preserving its original line endings
        const fmRegex = /^(---)(\r\n|\n|\r)([\s\S]*?)(\r\n|\n|\r)(---)/,
            match = content.match(fmRegex);

        if (!match) {
            ctx.log.error(`[ReadTime] No valid Front Matter found in: ${path.basename(filePath)}`);
            return;
        }

        let fmContent = match[3],
            hasChanged = false;

        // Update existing reading-time fields or append missing fields
        const updateKey = (key, value) => {
            const keyRegex = new RegExp(`^(${key}:)(.*)$`, 'm');
            if (keyRegex.test(fmContent)) {
                const currentVal = fmContent.match(keyRegex)[2].trim();
                if (currentVal != value) {
                    fmContent = fmContent.replace(keyRegex, `$1 ${value}`);
                    hasChanged = true;
                }
            } else {
                fmContent += `\n${key}: ${value}`;
                hasChanged = true;
            }
        };

        updateKey('read_time_minutes', info.minutes);
        updateKey('read_time_words', info.words);

        // Skip unchanged writes to prevent regeneration loops
        if (hasChanged) {
            fs.writeFileSync(filePath, content.replace(fmRegex, `$1$2${fmContent}$4$5`), 'utf8');
            ctx.log.info(`[ReadTime] ${path.basename(filePath)} -> ${info.minutes} min`);
        }
    } catch (err) {
        ctx.log.error(`[ReadTime] Failed to write ${filePath}:`, err.message);
    }
}

// Generate read time before rendering the post, optionally persisting to disk
hexo.extend.filter.register('before_post_render', function (data) {
    const ctx = this,
        options = getOptions(ctx.theme.config);

    if (!options.enabled) return data;
    if (!data.content) return data;

    const info = computeReadTime(data.content, options);
    data.read_time = info;
    data.read_time_minutes = info.minutes;
    data.read_time_words = info.words;

    // Persist optional reading-time fields only to supported source documents
    if (options.write_front_matter) {
        const filePath = getFilePath(data, ctx);
        if (filePath && /\.(md|markdown|mdx|txt)$/i.test(filePath)) {
            injectFrontMatter(ctx, filePath, info);
        } else {
            if (!filePath) ctx.log.warn(`[ReadTime] Could not resolve path for: ${data.slug}`);
            else ctx.log.warn(`[ReadTime] Skipping non-markdown file: ${path.basename(filePath)}`);
        }
    }

    return data;
});

// Read or compute a formatted reading-time label for posts and pages
hexo.extend.helper.register('read_time', function (post, withWords = false) {
    const targetPost = post || this.page;
    if (!targetPost) return '';

    let info = targetPost.read_time;
    if (!info && targetPost.read_time_minutes) {
        const mins = targetPost.read_time_minutes;
        info = {
            minutes: mins,
            words: targetPost.read_time_words,
            text: `About ${mins.toLocaleString()} minutes`, // Standardize text
        };
    }

    // Compute missing estimates for index pages and uncached posts
    if (!info && targetPost.content)
        info = computeReadTime(targetPost.content, getOptions(this.theme.config));
    if (!info) return '';

    return withWords ? `${info.text} (${info.words.toLocaleString()} words)` : info.text;
});
