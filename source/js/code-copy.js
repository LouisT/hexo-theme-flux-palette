window.Flux.register('code-copy', () => {
    Alpine.data('codeCopy', () => ({
        copied: false,
        alive: true,
        // Copy code text and ignore clipboard feedback after the component leaves
        async copy() {
            // Read code from the Hexo highlight table without including line numbers
            const figure = this.$el.closest('.highlight'),
                codeElement = figure ? figure.querySelector('td.code pre') : null;
            if (codeElement)
                try {
                    // writeText is supported in modern secure contexts
                    await navigator.clipboard.writeText(codeElement.innerText);
                    if (!this.alive) return;
                    this.copied = true;
                    clearTimeout(this.timer);
                    this.timer = setTimeout(() => (this.copied = false), 2000);
                } catch (err) {
                    console.error('Failed to copy: ', err);
                }
        },
        // Discard clipboard feedback and clear its timer after navigation
        destroy() {
            this.alive = false;
            clearTimeout(this.timer);
        },
    }));
    Alpine.data('codeImage', () => ({
        alive: true,
        // Render the highlighted code table through SVG into a downloadable PNG
        async capture() {
            // Read the highlighted table used for code image export
            const figure = this.$el.closest('.highlight'),
                table = figure.querySelector('table');
            if (!table) return;

            // Read the active palette and highlighted code typography
            const styles = window.getComputedStyle(figure),
                root = window.getComputedStyle(document.documentElement),
                padding = 24;

            // Reserve padding around the measured code table
            const width = table.offsetWidth + padding * 2,
                height = table.offsetHeight + padding * 2;

            // Embed the active syntax highlighting colors in the exported SVG
            const themeStyles = `
            .highlight { color: ${styles.color}; font-family: ${styles.fontFamily}; font-size: ${styles.fontSize}; background: ${styles.backgroundColor}; padding: ${padding}px; border-radius: 0; }
            .gutter { padding-right: 1.5rem; color: ${root.getPropertyValue('--muted')}; opacity: 0.5; text-align: right; border-right: 1px solid ${root.getPropertyValue('--border-code')}; user-select: none; }
            .code { padding-left: 1.5rem; }
            .comment, .quote, .doctag { color: ${root.getPropertyValue('--hl-comment')}; font-style: italic; }
            .keyword, .selector-tag, .section, .name, .literal { color: ${root.getPropertyValue('--hl-keyword')}; font-weight: 700; }
            .function, .title, .built_in, .class { color: ${root.getPropertyValue('--hl-function')}; }
            .string, .regexp, .symbol, .link { color: ${root.getPropertyValue('--hl-string')}; }
            .number, .bullet, .boolean, .constant { color: ${root.getPropertyValue('--hl-number')}; }
            .tag, .selector-class, .selector-id { color: ${root.getPropertyValue('--hl-tag')}; }
            .attr, .attribute, .variable, .property, .params { color: ${root.getPropertyValue('--hl-attribute')}; }
            .operator, .punctuation, .meta, .delimiter { color: ${root.getPropertyValue('--hl-operator')}; }
            .meta-string, .meta-keyword { color: ${root.getPropertyValue('--hl-meta')}; }
            .addition { color: ${root.getPropertyValue('--accent')}; background: rgba(70, 199, 102, 0.1); }
            .deletion { color: ${root.getPropertyValue('--muted')}; text-decoration: line-through; background: rgba(0, 0, 0, 0.1); }
            pre { margin: 0; white-space: pre-wrap; font-family: inherit; line-height: 1.5; }
            table { border-collapse: collapse; width: 100%; }`;

            // Serialize the code table as XML for embedding in SVG
            const contentHtml = new XMLSerializer().serializeToString(table);

            // Load a styled SVG containing the serialized code table
            const img = new Image();
            if (this.image) {
                this.image.onload = null;
                this.image.src = '';
            }
            this.image = img;
            img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`
            <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
                <foreignObject width="100%" height="100%">
                    <div xmlns="http://www.w3.org/1999/xhtml" style="height:100%; width:100%;">
                        <style><![CDATA[
                            * { box-sizing: border-box; }
                            body { margin: 0; padding: 0; background: ${styles.backgroundColor}; }
                            ${themeStyles}
                        ]]></style>
                        <div class="highlight">${contentHtml}</div>
                    </div>
                </foreignObject>
            </svg>`)}`;

            // Allocate a canvas matching the padded code image dimensions
            const canvas = document.createElement('canvas'),
                ctx = canvas.getContext('2d');
            canvas.width = width;
            canvas.height = height;

            // Export only after the SVG image finishes loading
            img.onload = () => {
                if (!this.alive) return;
                // Rasterize the loaded SVG before exporting PNG bytes
                ctx.drawImage(img, 0, 0);

                // Trigger a PNG download from the rasterized code table
                const link = document.createElement('a');
                link.download = `code-flux-${Date.now()}.png`;
                link.href = canvas.toDataURL('image/png');
                link.click();
                img.onload = null;
            };
        },
        // Cancel image callbacks and release the pending code capture on navigation
        destroy() {
            this.alive = false;
            if (this.image) {
                this.image.onload = null;
                this.image.src = '';
                this.image = null;
            }
        },
    }));
});
