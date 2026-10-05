'use strict';
const content = require('../lib/content.cjs'),
    samples = require('../lib/playground-content.json').map((item) => ({
        ...item,
        path: 'playground/#' + item.slug,
        flux_sample: true,
        buttons: [],
    }));

// Render sample content through the same Markdown filters as published articles
hexo.extend.generator.register('flux_playground', async function () {
    if (!this.theme.config.playground?.enabled) return [];
    const assets = Object.entries(require('../lib/playground-assets.cjs')).map(([name, text]) => ({
            path: 'flux-playground/' + name,
            data: Buffer.from(text),
        })),
        data = {
            title: 'Theme playground',
            slug: 'playground',
            path: 'playground/',
            date: new Date('2025-01-01'),
            engine: 'markdown',
            flux_rich_assets: new Map(
                assets.map((asset) => [content.url(this, asset.path), asset.data])
            ),
            content:
                `
## Reading and Markdown
Try the reading toolbar above, copy a heading link, and switch palettes in the sidebar.

{% alert info Information %}This is an accessible content callout.{% endalert %}

{% tabs %}
{% tab First %}The first panel.{% endtab %}
{% tab Second %}
## Second panel heading
The second panel.
{% endtab %}
{% endtabs %}

{% accordions %}
{% accordion Details %}Expandable content with keyboard controls.{% endaccordion %}
{% endaccordions %}

\`\`\`js
console.log('Flux Palette');
\`\`\`

## Gallery
{% gallery thumb:false %}
![Flux sample](/images/flux-sample.svg)
{% endgallery %}

## Embeds
{% youtube dQw4w9WgXcQ %}
` +
                require('../lib/rich-content-sample.cjs')(
                    '/images/flux-sample.svg',
                    '/flux-playground/downloads/rich-content-guide.txt',
                    '/flux-playground/images/rich-before.svg',
                    '/flux-playground/images/rich-after.svg'
                ),
        };
    await this.post.render(null, data);
    return [
        {
            path: 'playground/index.html',
            layout: 'playground',
            data: { ...data, flux_playground: true, projects: samples },
        },
        ...assets,
    ];
});
