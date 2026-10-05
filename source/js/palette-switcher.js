window.Flux.register('palette-switcher', () => {
    Alpine.data('paletteSwitcher', () => ({
        palettes: (window.FLUX_DATA && window.FLUX_DATA.palettes) || [],
        defaultLight: (window.FLUX_DATA && window.FLUX_DATA.defaultLight) || 'paper-and-ink',
        defaultDark: (window.FLUX_DATA && window.FLUX_DATA.defaultDark) || 'solar-amber',
        currentPalette: 'auto',
        customColor: '#3b82f6',
        customBgColor: '#0a0a0a',
        useCustomBg: false,
        customMode: 'auto',
        paletteName: '',
        systemListener: null,

        // Detect whether palette mode follows the system preference
        get isAuto() {
            return this.customMode === 'auto';
        },

        // Cycle palette mode through automatic, dark, and light settings
        set isAuto(val) {
            this.customMode = val ? 'auto' : this.systemIsDark() ? 'dark' : 'light';
        },

        // Resolve the displayed mode from manual and system preferences
        get isDark() {
            return this.customMode === 'auto' ? this.systemIsDark() : this.customMode === 'dark';
        },

        // Read the system preference for a dark color scheme
        systemIsDark() {
            return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        },

        // Handle manual mode toggling
        toggleMode() {
            if (this.customMode === 'auto')
                this.customMode = this.systemIsDark() ? 'light' : 'dark';
            else this.customMode = this.customMode === 'dark' ? 'light' : 'dark';
        },

        // Restore saved colors and connect palette controls to persistent preferences
        init() {
            try {
                // Restore preferences from LocalStorage
                this.customColor = Flux.storage.getItem('flux-palette-custom-color') || '#3b82f6';
                this.customBgColor =
                    Flux.storage.getItem('flux-palette-custom-bg-color') || '#0a0a0a';
                this.useCustomBg = Flux.storage.getItem('flux-palette-use-custom-bg') === 'true';
                this.customMode = Flux.storage.getItem('flux-palette-custom-mode') || 'auto';
                this.paletteName = Flux.storage.getItem('flux-palette-name') || '';

                // Parse URL hash or storage for active theme key
                let key = 'auto';
                try {
                    let hashget = new URLSearchParams(window.location.hash.substring(1) || '');
                    key =
                        hashget.get('theme') ||
                        Flux.storage.getItem('flux-palette-theme') ||
                        'auto';
                } catch {}

                // Validate key against existing palettes
                if (key !== 'auto' && key !== 'custom' && !this.palettes.some((p) => p.key === key))
                    key = 'auto';

                this.currentPalette = key;
                this.apply(key, false);

                // Watchers to persist state changes to LocalStorage
                this.$watch('currentPalette', (k) => this.apply(k, true));
                this.$watch('customColor', (c) => {
                    if (this.currentPalette === 'custom') this.applyCustom();
                    Flux.storage.setItem('flux-palette-custom-color', c);
                });
                this.$watch('customBgColor', (c) =>
                    Flux.storage.setItem('flux-palette-custom-bg-color', c)
                );
                this.$watch('customMode', (m) => {
                    if (this.currentPalette === 'custom') this.applyCustom();
                    Flux.storage.setItem('flux-palette-custom-mode', m);
                });
                this.$watch('useCustomBg', (v) =>
                    Flux.storage.setItem('flux-palette-use-custom-bg', v)
                );
                this.$watch('paletteName', (n) => Flux.storage.setItem('flux-palette-name', n));
            } catch (e) {
                console.error('Flux Palette Init Error:', e);
            }
        },

        // Publish the resolved palette mode so favicon and comment frames stay synchronized
        emitMode() {
            const key = document.documentElement.getAttribute('data-palette'),
                mode =
                    this.currentPalette === 'custom'
                        ? this.customMode === 'auto'
                            ? this.systemIsDark()
                                ? 'dark'
                                : 'light'
                            : this.customMode
                        : this.palettes.find((p) => p.key === key)?.mode ||
                          (key === this.defaultDark ? 'dark' : 'light');
            document.documentElement.dataset.mode = mode;
            Flux.emit('palette', { mode, key });
        },
        // Remove the system preference listener when the palette component leaves
        destroy() {
            if (this.systemListener)
                matchMedia('(prefers-color-scheme: dark)').removeEventListener(
                    'change',
                    this.systemListener
                );
        },
        // Handler for manual background color input interactions
        handleBgInput(e) {
            this.useCustomBg = true; // User manually picked a color, so we lock it
            this.customBgColor = e.target.value;
            this.applyCustom();
        },

        // Apply preset or custom colors and optionally update the shareable palette hash
        apply(key, updateUrl = false) {
            // Clean up existing media query listeners
            if (this.systemListener) {
                try {
                    window
                        .matchMedia('(prefers-color-scheme: dark)')
                        .removeEventListener('change', this.systemListener);
                } catch {}
                this.systemListener = null;
            }

            // Reset custom CSS if not in custom mode
            if (key !== 'custom') {
                for (const prop of [...document.documentElement.style])
                    if (!prop.startsWith('--reading-'))
                        document.documentElement.style.removeProperty(prop);
                Flux.storage.removeItem('flux-palette-custom-css');
            }

            // Follow system preferences in automatic mode
            if (key === 'auto') {
                this.applySystem();
                this.systemListener = (e) => {
                    document.documentElement.setAttribute(
                        'data-palette',
                        e.matches ? this.defaultDark : this.defaultLight
                    );
                    this.emitMode();
                };
                window
                    .matchMedia('(prefers-color-scheme: dark)')
                    .addEventListener('change', this.systemListener);

                // Apply custom colors using the selected mode
            } else if (key === 'custom') {
                this.applyCustom();
                this.systemListener = (e) => {
                    if (this.customMode === 'auto') this.applyCustom();
                };
                window
                    .matchMedia('(prefers-color-scheme: dark)')
                    .addEventListener('change', this.systemListener);

                // Handle preset palettes
            } else {
                document.documentElement.setAttribute('data-palette', key);
            }

            // Persist theme selection
            try {
                Flux.storage.setItem('flux-palette-theme', key);
            } catch {}

            // Update URL hash for sharing
            this.emitMode();
            if (updateUrl && (!location.hash || location.hash.startsWith('#theme='))) {
                try {
                    let curHash = new URLSearchParams(window.location.hash.substring(1) || '');
                    if (key === 'auto') curHash.delete('theme');
                    else curHash.set('theme', key);
                    const newHash = curHash.toString();
                    if (window.location.hash.substring(1) !== newHash) {
                        if (!newHash)
                            history.replaceState(
                                history.state,
                                '',
                                location.pathname + location.search
                            );
                        else
                            history.replaceState(
                                history.state,
                                '',
                                location.pathname + location.search + '#' + newHash
                            );
                    }
                } catch {}
            }
        },

        // Apply system default palettes based on preference
        applySystem() {
            document.documentElement.setAttribute(
                'data-palette',
                this.systemIsDark() ? this.defaultDark : this.defaultLight
            );
        },

        // Generate and inject CSS variables for custom colors
        applyCustom() {
            let mode = this.customMode;
            if (mode === 'auto') mode = this.systemIsDark() ? 'dark' : 'light';

            document.documentElement.setAttribute(
                'data-palette',
                mode === 'dark' ? this.defaultDark : this.defaultLight
            );

            // If useCustomBg is false, pass null so the engine derives the background
            this.updateCustomPalette(
                this.customColor,
                mode,
                this.useCustomBg ? this.customBgColor : null
            );

            // Keep the background picker aligned with the derived palette color
            if (!this.useCustomBg) this.updateBgPickerUI(this.customColor, mode);
            this.emitMode();
        },

        // Recalculate background picker color based on accent color
        updateBgPickerUI(accentHex, mode) {
            const accent = this.hexToHsl(accentHex),
                isDark = mode === 'dark';
            this.customBgColor = this.hslToHex(
                accent.h,
                isDark ? Math.min(accent.s, 15) : Math.min(accent.s, 25),
                isDark ? 6 : 100
            );
        },

        // Convert HSL channels into a six-digit hexadecimal color
        hslToHex(h, s, l) {
            l /= 100;
            const a = (s * Math.min(l, 1 - l)) / 100,
                // Convert each hue channel into a padded hexadecimal byte
                f = (n) => {
                    const k = (n + h / 30) % 12;
                    return Math.round(255 * (l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1)))
                        .toString(16)
                        .padStart(2, '0');
                };
            return `#${f(0)}${f(8)}${f(4)}`;
        },

        // Normalize hexadecimal colors into HSL channels for palette generation
        hexToHsl(hex) {
            let result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
            if (!result) return { h: 0, s: 0, l: 0 };
            let r = parseInt(result[1], 16) / 255,
                g = parseInt(result[2], 16) / 255,
                b = parseInt(result[3], 16) / 255,
                max = Math.max(r, g, b),
                min = Math.min(r, g, b),
                h,
                s,
                l = (max + min) / 2;
            if (max == min) h = s = 0;
            else {
                let d = max - min;
                s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
                switch (max) {
                    case r:
                        h = (g - b) / d + (g < b ? 6 : 0);
                        break;
                    case g:
                        h = (b - r) / d + 2;
                        break;
                    case b:
                        h = (r - g) / d + 4;
                        break;
                }
                h /= 6;
            }
            return {
                h: Math.round(h * 360),
                s: Math.round(s * 100),
                l: Math.round(l * 100),
            };
        },

        // Derive the complete palette variable map from accent and background colors
        getPaletteVariables(hex, mode, bgHex = null) {
            const accent = this.hexToHsl(hex),
                bg = bgHex ? this.hexToHsl(bgHex) : null,
                isDark = mode === 'dark',
                formatHsl = (h, s, l, a) =>
                    `hsl(${h}, ${s}%, ${l}%${a !== undefined && a < 1 ? `, ${a}` : ''})`;
            let v = {},
                bgH,
                bgS,
                baseL;

            // Generate dark mode variables
            if (isDark) {
                bgH = bg ? bg.h : accent.h;
                bgS = bg ? bg.s : Math.min(accent.s, 15);
                baseL = bg ? bg.l : 6;
                v['--bg'] = formatHsl(bgH, bgS, baseL);
                v['--bg-black'] = formatHsl(bgH, bgS, Math.max(0, baseL - 4));
                v['--bg-alt'] = formatHsl(bgH, bgS, Math.min(100, baseL + 3));
                v['--bg-card'] = formatHsl(bgH, bgS, Math.min(100, baseL + 5));
                v['--bg-radial-start'] = formatHsl(bgH, bgS, Math.min(100, baseL + 10));
                v['--bg-header-end'] = formatHsl(bgH, bgS, Math.min(100, baseL + 3));
                v['--bg-tooltip'] = formatHsl(bgH, bgS, Math.min(100, baseL + 4), 0.96);
                v['--text'] = formatHsl(bgH, Math.min(bgS, 10), 96);
                v['--text-white'] = '#ffffff';
                v['--text-light'] = formatHsl(bgH, Math.min(bgS, 10), 85);
                v['--text-sidebar'] = formatHsl(bgH, Math.min(bgS, 10), 92);
                v['--muted'] = formatHsl(bgH, Math.min(bgS, 15), 65);
                v['--border'] = formatHsl(bgH, bgS, Math.min(100, baseL + 14));
                v['--border-card'] = 'rgba(255, 255, 255, 0.05)';
                v['--border-sidebar'] = 'rgba(255, 255, 255, 0.07)';
                v['--border-code'] = formatHsl(bgH, bgS, Math.min(100, baseL + 12));
                v['--shadow-soft'] = `0 10px 30px ${formatHsl(accent.h, accent.s, 5, 0.7)}`;
                v['--shadow-header'] = `0 8px 20px ${formatHsl(accent.h, accent.s, 5, 0.6)}`;
                v['--shadow-tooltip'] = `0 12px 30px ${formatHsl(accent.h, accent.s, 5, 0.85)}`;

                // Generate light mode variables
            } else {
                bgH = bg ? bg.h : accent.h;
                bgS = bg ? bg.s : Math.min(accent.s, 25);
                baseL = bg ? bg.l : 100;
                v['--bg'] = formatHsl(bgH, bgS, baseL);
                v['--bg-black'] = formatHsl(bgH, bgS, Math.max(0, baseL - 3));
                v['--bg-alt'] = formatHsl(bgH, bgS, Math.max(0, baseL - 2));
                v['--bg-card'] = formatHsl(bgH, bgS, baseL);
                v['--bg-radial-start'] = formatHsl(bgH, bgS, baseL);
                v['--bg-header-end'] = formatHsl(bgH, bgS, Math.max(0, baseL - 6));
                v['--bg-tooltip'] = 'rgba(255, 255, 255, 0.98)';
                v['--text'] = formatHsl(bgH, Math.min(bgS, 30), 20);
                v['--text-white'] = formatHsl(bgH, Math.min(bgS, 30), 10);
                v['--text-light'] = formatHsl(bgH, Math.min(bgS, 20), 40);
                v['--text-sidebar'] = formatHsl(bgH, Math.min(bgS, 30), 30);
                v['--muted'] = formatHsl(bgH, Math.min(bgS, 20), 60);
                v['--border'] = formatHsl(bgH, bgS, Math.max(0, baseL - 10));
                v['--border-card'] = formatHsl(bgH, bgS, Math.max(0, baseL - 8));
                v['--border-sidebar'] = formatHsl(bgH, bgS, Math.max(0, baseL - 6));
                v['--border-code'] = formatHsl(bgH, bgS, Math.max(0, baseL - 12));
                v['--shadow-soft'] = `0 10px 30px ${formatHsl(accent.h, accent.s, 40, 0.08)}`;
                v['--shadow-header'] = `0 4px 12px ${formatHsl(accent.h, accent.s, 40, 0.05)}`;
                v['--shadow-tooltip'] = `0 12px 30px ${formatHsl(accent.h, accent.s, 40, 0.15)}`;
            }

            // Derive accent colors shared by both color modes
            v['--accent'] = hex;
            const softOpacity = isDark ? 0.35 : 0.15,
                ringOpacity = isDark ? 0.6 : 0.4;
            v['--accent-muted'] = formatHsl(
                accent.h,
                Math.max(0, accent.s - 20),
                isDark ? Math.max(20, accent.l - 15) : Math.max(20, accent.l - 10)
            );
            v['--accent-bright'] = formatHsl(
                accent.h,
                Math.min(100, accent.s + 10),
                isDark ? Math.min(90, accent.l + 15) : Math.min(80, accent.l + 10)
            );
            v['--accent-soft'] = formatHsl(accent.h, accent.s, accent.l, softOpacity);
            v['--focus-ring'] = formatHsl(accent.h, accent.s, accent.l, ringOpacity);
            return v;
        },

        // Apply generated palette variables and persist their custom CSS
        updateCustomPalette(hex, mode, bgHex) {
            const v = this.getPaletteVariables(hex, mode, bgHex);
            Flux.storage.setItem(
                'flux-palette-custom-css',
                Object.entries(v)
                    .map(([prop, val]) => {
                        document.documentElement.style.setProperty(prop, val);
                        return `${prop}: ${val}`;
                    })
                    .join(';')
            );
        },

        // Export current custom palette as a downloadable CSS file
        exportPalette() {
            let mode = this.customMode,
                css = '',
                cssBody = ''; // Ensure variable accumulator exists

            if (mode === 'auto') mode = this.systemIsDark() ? 'dark' : 'light';

            // Group exported palette variables by their visual role
            const v = this.getPaletteVariables(
                    this.customColor,
                    mode,
                    this.useCustomBg ? this.customBgColor : null
                ),
                name = this.paletteName || 'Custom Flux',
                slug = name
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, '-')
                    .replace(/(^-|-$)/g, ''),
                groups = [
                    {
                        title: `Backgrounds (${mode === 'dark' ? 'Dark' : 'Light'} Mode)`,
                        keys: [
                            '--bg',
                            '--bg-black',
                            '--bg-alt',
                            '--bg-card',
                            '--bg-radial-start',
                            '--bg-header-end',
                            '--bg-tooltip',
                        ],
                    },
                    {
                        title: 'Text',
                        keys: [
                            '--text',
                            '--text-white',
                            '--text-light',
                            '--text-sidebar',
                            '--muted',
                        ],
                    },
                    {
                        title: 'Primary accent family',
                        keys: [
                            '--accent',
                            '--accent-soft',
                            '--accent-muted',
                            '--accent-bright',
                            '--focus-ring',
                        ],
                    },
                    {
                        title: 'Borders & Shadows',
                        keys: [
                            '--border',
                            '--border-card',
                            '--border-sidebar',
                            '--border-code',
                            '--shadow-soft',
                            '--shadow-header',
                            '--shadow-tooltip',
                        ],
                    },
                ];

            // Write each palette group into the downloadable stylesheet
            groups.forEach((g, i) => {
                if (i > 0) cssBody += '\n';
                cssBody += `    /* ${g.title} */\n`;
                g.keys.forEach((key) => (cssBody += `    ${key}: ${v[key]};\n`));
            });

            // Download the generated stylesheet through a temporary object URL
            const a = document.createElement('a'),
                url = URL.createObjectURL(new Blob([`:root {\n${cssBody}}`], { type: 'text/css' }));
            a.href = url;
            a.download = `${slug || 'flux-palette'}.css`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        },
    }));
});
