'use strict';
const { load } = require('cheerio'),
    { escapeHTML } = require('hexo-util'),
    crypto = require('crypto'),
    fs = require('fs'),
    path = require('path');

const ALGORITHM = 'aes-256-gcm',
    ITERATIONS = 100000,
    KEY_LEN = 32,
    DIGEST = 'sha256',
    SALT_LEN = 16,
    IV_LEN = 16;

// Encrypt posts asynchronously using pbkdf2 after post is rendered
hexo.extend.filter.register(
    'after_post_render',
    async function (data) {
        // Skip encryption for content without a password
        let password = data.password;
        if (!password) return data;

        // Resolve password references from the named environment variable
        if (typeof password === 'string' && password.startsWith('env:')) {
            const envKey = password.substring(4);
            if (process.env[envKey]) {
                password = process.env[envKey];
            } else {
                throw new Error(
                    `[Encrypt] Required environment variable '${envKey}' is missing for '${data.title}'.`
                );
            }
        }

        // Generate the salt and key to encrypt the content and images
        const salt = await randomBytesAsync(SALT_LEN),
            key = await pbkdf2Async(password, salt, ITERATIONS, KEY_LEN, DIGEST);

        // Encrypt original images after removing public responsive image references
        if (data.content) {
            const $ = load(data.content, null, false);
            $('source').remove();
            $('img').each((i, el) => {
                const img = $(el);
                if (img.attr('data-original-src')) img.attr('src', img.attr('data-original-src'));
                img.removeAttr('srcset sizes data-original-src');
            });
            data.content = $.html();
        }

        // Collect encrypted image payloads by their generated identifiers
        const encryptedImages = {};
        data.flux_private_assets = [];

        // Embed local and remote images as separately encrypted payloads
        if (data.content) {
            // Regex to match img tags and capture the src attribute
            const regex = /<img([^>]*)src=["']([^"']+)["']([^>]*)>/gi,
                matches = [...data.content.matchAll(regex)];

            if (matches.length > 0) {
                // Process all images asynchronously
                const replacements = await Promise.all(
                    matches.map(async (match, index) => {
                        const [fullTag, p1, src, p3] = match;

                        // Skip already embedded data URIs
                        if (src.startsWith('data:')) return null;

                        let buffer = null,
                            mime = 'application/octet-stream';

                        // Download remote images before encrypting their bytes
                        if (/^(?:https?:)?\/\//.test(src)) {
                            try {
                                const result = await fetchUrl(
                                    src.startsWith('//') ? 'https:' + src : src
                                );
                                buffer = result.buffer;
                                if (result.mime) mime = result.mime;
                            } catch (e) {
                                hexo.log.warn(
                                    `[Encrypt] Failed to fetch remote image: ${src} in post '${data.title}'. Error: ${e.message}`
                                );
                                throw new Error(
                                    `[Encrypt] Could not protect remote image in '${data.title}'.`
                                );
                            }
                        }

                        // Resolve local images against site source and article asset folders
                        else {
                            let filePath;

                            // Resolve absolute image paths against the source directory
                            if (src.startsWith('/'))
                                filePath = path.join(
                                    hexo.source_dir,
                                    src.startsWith(hexo.config.root || '/')
                                        ? src.slice((hexo.config.root || '/').length)
                                        : src
                                );

                            // Try relative to post asset folder
                            if ((!filePath || !fs.existsSync(filePath)) && data.asset_dir) {
                                const rooted = src.startsWith(hexo.config.root || '/')
                                        ? src.slice((hexo.config.root || '/').length)
                                        : src.replace(/^\//, ''),
                                    assetPath = path.resolve(
                                        data.asset_dir,
                                        rooted.startsWith(data.path)
                                            ? rooted.slice(data.path.length)
                                            : rooted
                                    );
                                if (fs.existsSync(assetPath)) filePath = assetPath;
                            }

                            // Fallback to source root if no leading slash
                            if (!filePath || !fs.existsSync(filePath)) {
                                const trySource = path.join(hexo.source_dir, src);
                                if (fs.existsSync(trySource)) filePath = trySource;
                            }

                            if (filePath && fs.existsSync(filePath)) {
                                try {
                                    buffer = fs.readFileSync(filePath);
                                    const relative = path
                                        .relative(hexo.source_dir, filePath)
                                        .split(path.sep)
                                        .join('/');
                                    if (!relative.startsWith('../'))
                                        data.flux_private_assets.push(relative);
                                    if (
                                        data.asset_dir &&
                                        filePath.startsWith(path.resolve(data.asset_dir) + path.sep)
                                    )
                                        data.flux_private_assets.push(
                                            data.path +
                                                path
                                                    .relative(data.asset_dir, filePath)
                                                    .split(path.sep)
                                                    .join('/')
                                        );
                                    const ext = path.extname(filePath).toLowerCase();
                                    mime =
                                        {
                                            '.png': 'image/png',
                                            '.jpg': 'image/jpeg',
                                            '.jpeg': 'image/jpeg',
                                            '.gif': 'image/gif',
                                            '.webp': 'image/webp',
                                            '.svg': 'image/svg+xml',
                                            '.bmp': 'image/bmp',
                                        }[ext] || mime;
                                } catch (e) {
                                    hexo.log.warn(
                                        `[Encrypt] Failed to read local image: ${src}. Error: ${e.message}`
                                    );
                                    throw new Error(
                                        `[Encrypt] Could not protect local image in '${data.title}'.`
                                    );
                                }
                            }
                        }

                        // If we didn't get a buffer, return null
                        if (!buffer)
                            throw new Error(
                                `[Encrypt] Local image '${src}' is missing in '${data.title}'.`
                            );

                        // Generate encryption settings for each image independently
                        const imgIv = await randomBytesAsync(IV_LEN),
                            cipher = crypto.createCipheriv(ALGORITHM, key, imgIv);

                        // Encrypt the image buffer
                        let encryptedBuffer = cipher.update(buffer);
                        encryptedBuffer = Buffer.concat([encryptedBuffer, cipher.final()]);

                        // Generate an ID for the image
                        const imgId = `enc-${index}-${Date.now()}`;

                        // Associate the encrypted image payload with its replacement identifier
                        encryptedImages[imgId] = {
                            ct: encryptedBuffer.toString('base64'),
                            iv: imgIv.toString('base64'),
                            at: cipher.getAuthTag().toString('base64'),
                            m: mime,
                        };

                        // Uses a transparent 1x1 GIF as src to prevent broken image icon
                        const placeholderSrc =
                                'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
                            newTag = `<img${p1}src="${placeholderSrc}" data-enc-id="${imgId}"${p3}>`;

                        return {
                            index: match.index,
                            length: fullTag.length,
                            newTag,
                        };
                    })
                );

                // Apply replacements in reverse order to preserve string indices
                replacements
                    .filter((r) => r !== null)
                    .sort((a, b) => b.index - a.index)
                    .forEach(({ index, length, newTag }) => {
                        data.content =
                            data.content.substring(0, index) +
                            newTag +
                            data.content.substring(index + length);
                    });
            }
        }

        // Generate encryption settings for post content
        const iv = await randomBytesAsync(IV_LEN),
            cipher = crypto.createCipheriv(ALGORITHM, key, iv);

        // Store payload in data for the generator to pick up
        data.encrypted_payload = {
            ct: cipher.update(data.content, 'utf8', 'base64') + cipher.final('base64'),
            imgs: encryptedImages,
            s: salt.toString('base64'),
            iv: iv.toString('base64'),
            at: cipher.getAuthTag().toString('base64'),
            i: ITERATIONS,
        };

        // Resolve the public endpoint for the encrypted article payload
        const root = hexo.config.root || '/',
            apiUrl = `${root}_encrypted/${data._id || data.slug}.json`;

        // Replace plaintext content with the password form and unlock controls
        data.content = `
    <div class="encrypted-post" x-data="${escapeHTML(`encryptedPost(${JSON.stringify(String(data.slug))}, ${JSON.stringify(apiUrl)})`)}">
      <div class="encrypted-form" x-show="!decryptedContent">
        <div class="encrypted-input-wrap">
          <label class="encrypted-label" :for="'pass-' + slug">Enter password</label>
          <input
            type="password"
            class="encrypted-input"
            x-ref="passwordInput"
            x-model="password"
            @keydown.enter.prevent="handleUnlock"
            :id="'pass-' + slug"
            autocomplete="off"
          >
        </div>
        <button type="button" class="encrypted-button" @click="handleUnlock" :disabled="isDecrypting">Unlock</button>
        <p class="encrypted-error" x-show="error" x-text="error" style="display:none;"></p>
      </div>
      <p class="protected-print-notice">Password-protected content is hidden in print.</p>
      <div class="encrypted-post-content" x-show="decryptedContent" x-html="decryptedContent" x-ref="contentContainer"></div>
    </div>`;

        // Discard plaintext excerpt and summary fields after encryption
        data.excerpt = '<p>This post has been password protected.</p>';
        data.more = ''; // Clear "read more" content to prevent leaks

        // Remove the plaintext password from the object so it doesn't leak into JSON/XML feeds
        delete data.password;
        data.encrypted = true;

        return data;
    },
    50
);

// Publish encrypted payloads separately from protected post placeholders
hexo.extend.generator.register('encrypted_api', function (locals) {
    return locals.posts
        .filter((post) => post.encrypted && post.encrypted_payload)
        .map((post) => {
            return {
                path: `_encrypted/${post._id || post.slug}.json`,
                data: JSON.stringify(post.encrypted_payload, null, 4),
            };
        });
});

// Generate cryptographic random bytes without blocking the event loop
function randomBytesAsync(size) {
    return new Promise((res, rej) =>
        crypto.randomBytes(size, (err, buf) => (err || !buf ? rej(err) : res(buf)))
    );
}

// Derive encryption keys asynchronously with the configured PBKDF2 parameters
function pbkdf2Async(password, salt, iterations, keylen, digest) {
    return new Promise((res, rej) =>
        crypto.pbkdf2(password, salt, iterations, keylen, digest, (err, derivedKey) =>
            err || !derivedKey ? rej(err) : res(derivedKey)
        )
    );
}

// Retry remote image downloads for transient failures without retrying client errors
async function fetchUrl(url, retries = 3) {
    try {
        const res = await fetch(url, { redirect: 'follow' });

        if (!res.ok) {
            // Reject client errors immediately instead of retrying the download
            if (res.status < 500) {
                const err = new Error(`Status Code: ${res.status} `);
                err.noRetry = true;
                throw err;
            }

            // Retry server failures through the bounded download loop
            throw new Error(`Status Code: ${res.status} `);
        }

        // Return image buffer and mime type
        return {
            buffer: Buffer.from(await res.arrayBuffer()),
            mime: res.headers.get('content-type'),
        };
    } catch (err) {
        // Retry on network errors or 5xx status codes
        if (retries > 0 && !err.noRetry) return fetchUrl(url, retries - 1);
        throw err;
    }
}
