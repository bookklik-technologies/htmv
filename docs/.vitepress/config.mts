import { defineConfig } from 'vitepress';

// GitHub Pages deploys project sites under the repository slug
// (https://bookklik-technologies.github.io/htmv/). Override locally with VITEPRESS_BASE.
const base = process.env.VITEPRESS_BASE ?? '/htmv/';

export default defineConfig({
  base,
  appearance: 'dark',
  lang: 'en-US',
  title: 'HTMV',
  description:
    'Create video compositions with HTML and CSS. Preview frames, mix audio, and export MP4 or WebM in the browser.',
  sitemap: {
    hostname: 'https://bookklik-technologies.github.io/htmv/'
  },
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: `${base}icon.svg` }]
  ],
  cleanUrls: true,
  markdown: {
    lineNumbers: false
  },
  themeConfig: {
    logo: { src: '/logo.svg', alt: 'HTMV' },
    nav: [
      { text: 'Guide', link: '/guide/introduction', activeMatch: '/guide/' },
      { text: 'Reference', link: '/reference/elements', activeMatch: '/reference/' },
      { text: 'Examples', link: '/examples' }
    ],
    sidebar: {
      '/guide/': [
        {
          text: 'Getting started',
          collapsed: false,
          items: [
            { text: 'Introduction', link: '/guide/introduction' },
            { text: 'Getting started', link: '/guide/getting-started' },
            { text: 'Time model', link: '/guide/time-model' },
            { text: 'Composition and elements', link: '/guide/composition' }
          ]
        },
        {
          text: 'Authoring',
          collapsed: false,
          items: [
            { text: 'Layers, series & transitions', link: '/guide/layers-transitions' },
            { text: 'Animation', link: '/guide/animation' },
            { text: 'Templates & data binding', link: '/guide/templates' },
            { text: 'Text and CSS', link: '/guide/text-and-css' }
          ]
        },
        {
          text: 'Media & output',
          collapsed: false,
          items: [
            { text: 'Media sources & clips', link: '/guide/media' },
            { text: 'Audio & captions', link: '/guide/audio-and-captions' },
            { text: 'Exporting video', link: '/guide/export' }
          ]
        }
      ],
      '/reference/': [
        {
          text: 'Reference',
          collapsed: false,
          items: [
            { text: 'Elements & attributes', link: '/reference/elements' },
            { text: 'JavaScript API', link: '/reference/javascript-api' },
            { text: 'Player & events', link: '/reference/player' },
            { text: 'Plugins', link: '/reference/plugins' },
            { text: 'Diagnostics & limits', link: '/reference/diagnostics' },
            { text: 'Recipes', link: '/reference/recipes' }
          ]
        }
      ]
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/bookklik-technologies/htmv' }
    ],
    outline: { level: [2, 3], label: 'On this page' },
    search: {
      provider: 'local',
      options: {
        translations: {
          button: { buttonText: 'Search docs', buttonAriaLabel: 'Search docs' }
        }
      }
    },
    footer: {
      message: 'HTMV — HyperText Markup Video',
      copyright: 'Copyright © 2026 Bookklik Technologies'
    },
    docFooter: { prev: 'Previous', next: 'Next' },
    lastUpdated: true
  },
  vite: {
    build: {
      chunkSizeWarningLimit: 2000
    }
  }
});
