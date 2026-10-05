const fs = require('node:fs'),
    path = require('node:path'),
    { html: beautify } = require('js-beautify');

const mode = process.argv[2];

// Reject unsupported formatter modes before reading or modifying templates
if (!['--write', '--check'].includes(mode) || process.argv.length !== 3) {
    console.error('Usage: node tools/format-ejs.cjs --write|--check');
    process.exit(2);
}

const theme = path.resolve(__dirname, '..'),
    layout = path.join(theme, 'layout'),
    options = JSON.parse(fs.readFileSync(path.join(theme, '.jsbeautifyrc'), 'utf8')),
    files = fs
        .readdirSync(layout, { recursive: true })
        .filter((file) => file.endsWith('.ejs'))
        .sort(),
    changes = [];

// Validate all formatted templates before writing any files
for (const file of files) {
    const target = path.join(layout, file),
        source = fs.readFileSync(target, 'utf8'),
        formatted = beautify(source, options);
    // Compare raw EJS blocks so HTML formatting cannot change template code
    const ejsBlocks = (text) => text.match(/<%[\s\S]*?%>/g) || [];
    if (JSON.stringify(ejsBlocks(source)) !== JSON.stringify(ejsBlocks(formatted))) {
        throw new Error(
            `Formatting would change EJS code in layout/${file}; no templates written.`
        );
    }
    if (source !== formatted) changes.push({ target, file, formatted });
}

// Write templates only after every formatted result passes validation
for (const { target, file, formatted } of changes) {
    if (mode === '--write') fs.writeFileSync(target, formatted);
    console.log(`layout/${file}`);
}

// Report outstanding formatting without writing during check mode
if (mode === '--check' && changes.length) {
    console.error(`${changes.length} EJS templates need formatting. Run npm run format:ejs.`);
    process.exitCode = 1;
} else {
    console.log(
        `${files.length} EJS templates ${mode === '--write' ? `formatted (${changes.length} changed)` : 'checked'}.`
    );
}
