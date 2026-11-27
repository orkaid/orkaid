import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import svelte from '@astrojs/svelte';

export default defineConfig({
  site: 'https://orkaid.de',
  output: 'static',
  // No Markdown/code content at bootstrap; add Prism only when syntax highlighting is required.
  markdown: { syntaxHighlight: false },
  trailingSlash: 'always',
  // The CSP allows only 'self' (public/_headers), so no stylesheet may be inlined into a page.
  build: { inlineStylesheets: 'never' },
  i18n: {
    defaultLocale: 'de',
    locales: ['de', 'en'],
    routing: { prefixDefaultLocale: false },
  },
  integrations: [
    svelte(),
    sitemap({
      // PR-20: the legal pages carry noindex, so they stay out of the sitemap (they remain linked in the footer).
      filter: (page) => !/^\/(en\/)?(impressum|datenschutz)\/$/.test(new URL(page).pathname),
      i18n: {
        defaultLocale: 'de',
        locales: { de: 'de-DE', en: 'en' },
      },
    }),
  ],
});
