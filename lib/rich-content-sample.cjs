'use strict';

// Provide rich-content authoring examples with caller-supplied asset URLs
module.exports = (
    image = '/images/flux-sample.svg',
    download = '/downloads/rich-content-guide.txt',
    before = '/images/rich-before.svg',
    after = '/images/rich-after.svg'
) => String.raw`
## Step-by-step guides

{% steps id:setup track:true %}
{% step "Choose your palette" icon:info %}
Select a palette in the sidebar. Each step accepts **Markdown**.
{% endstep %}
{% step "Publish your article" icon:check %}
Preview your changes, then publish the generated site.
{% endstep %}
{% endsteps %}

## Content cards

{% cards %}
{% card "Theme playground" url:/playground/ image:${image} alt:"Flux Palette sample" %}
Try the theme's reading and content controls.
{% endcard %}
{% card "Reading list" url:/reading/ %}
Keep articles you want to revisit in one place.
{% endcard %}
{% endcards %}

## Comparison tables

{% comparison recommended:"Local" %}
| Feature | Local | Hosted |
| --- | --- | --- |
| Credentials | None | Required |
| Offline support | Available | Connection required |
{% endcomparison %}

## Before and after

{% image_compare ${before} ${after} before_alt:"Original article layout" after_alt:"Improved article layout" %}

## Annotated code

{% annotated_code lang:js filename:hello.js highlight:2 %}
const name = 'Reader';
console.log('Hello, ' + name);
{% code_note "2" %}
This line prints the greeting. Copying the code excludes this explanation.
{% endcode_note %}
{% endannotated_code %}

## Mermaid diagrams

{% mermaid title:"Publishing workflow" %}
flowchart LR
    Write --> Preview --> Publish
{% endmermaid %}

## Math equations

Inline math: {% math inline %}a^2 + b^2 = c^2{% endmath %}.

{% math display %}
\sum_{i=1}^{n} i = \frac{n(n+1)}{2}
{% endmath %}

## Glossary popovers

A {% term "static site" "A website generated into files before visitors request its pages." %} can serve content quickly.

## Interactive checklists

{% checklist id:publish %}
- [ ] Review the article
- [ ] Check links and images
- [x] Choose a palette
{% endchecklist %}

## Figures and references

See {% figure_ref example %} for a local image example.

{% figure ${image} "Flux Palette illustration" id:example credit:"Flux Palette" credit_url:https://github.com/LouisT/hexo-theme-flux-palette %}
A local figure with a **Markdown caption** and attribution.
{% endfigure %}

## Download cards

{% download ${download} "Rich content authoring checklist" %}
A small text file you can keep next to your writing tools.
{% enddownload %}

## Pros and cons

{% proscons %}
{% pros %}
- Content stays in Markdown files.
- Components follow the selected palette.
{% endpros %}
{% cons %}
- Interactive controls require JavaScript.
- Publishing changes requires a build.
{% endcons %}
{% endproscons %}
`;
