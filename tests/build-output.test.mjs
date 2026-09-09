import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const dist = join(process.cwd(), 'dist');
const routes = [
  { file: 'index.html', locale: 'de', path: '/' },
  { file: 'tools/index.html', locale: 'de', path: '/tools/' },
  { file: 'impressum/index.html', locale: 'de', path: '/impressum/' },
  { file: 'datenschutz/index.html', locale: 'de', path: '/datenschutz/' },
  { file: 'en/index.html', locale: 'en', path: '/' },
  { file: 'en/tools/index.html', locale: 'en', path: '/tools/' },
  { file: 'en/impressum/index.html', locale: 'en', path: '/impressum/' },
  { file: 'en/datenschutz/index.html', locale: 'en', path: '/datenschutz/' },
];

function readOutput(file) {
  return readFileSync(join(dist, file), 'utf8');
}

function readCssOutput() {
  return readdirSync(dist, { recursive: true })
    .filter((file) => file.endsWith('.css'))
    .map((file) => readOutput(file))
    .join('\n');
}

function linkPattern(rel, href, hreflang) {
  const language = hreflang ? `(?=[^>]*\\bhreflang="${hreflang}")` : '';
  const escapedHref = href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`<link(?=[^>]*\\brel="${rel}")${language}(?=[^>]*\\bhref="${escapedHref}")[^>]*>`);
}

function sitemapAlternatePattern(href, hreflang) {
  const escapedHref = href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`<xhtml:link(?=[^>]*\\brel="alternate")(?=[^>]*\\bhreflang="${hreflang}")(?=[^>]*\\bhref="${escapedHref}")[^>]*>`);
}

function sitemapEntry(sitemap, url) {
  const escapedUrl = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return sitemap.match(new RegExp(`<url>\\s*<loc>${escapedUrl}</loc>[\\s\\S]*?</url>`))?.[0];
}

function assertSitemapRoutePairs(sitemap) {
  for (const path of new Set(routes.map((route) => route.path))) {
    const deUrl = `https://orkaid.de${path}`;
    const enUrl = `https://orkaid.de/en${path}`;

    for (const [url, label] of [[deUrl, 'German'], [enUrl, 'English']]) {
      const entry = sitemapEntry(sitemap, url);
      assert.ok(entry, `${label} sitemap entry exists for ${path}`);
      assert.match(entry, sitemapAlternatePattern(deUrl, 'de-DE'), `${label} sitemap entry links to German ${path}`);
      assert.match(entry, sitemapAlternatePattern(enUrl, 'en'), `${label} sitemap entry links to English ${path}`);
    }
  }
}

test('link metadata checks reject regex-like URL lookalikes', () => {
  const lookalike = '<link rel="canonical" href="https://orkaidXde/tools/">';
  assert.doesNotMatch(lookalike, linkPattern('canonical', 'https://orkaid.de/tools/'));
});

test('build emits all mirrored routes with locale metadata and CSP', () => {
  for (const route of routes) {
    const html = readOutput(route.file);
    const deUrl = `https://orkaid.de${route.path}`;
    const enUrl = `https://orkaid.de/en${route.path}`;
    const canonical = route.locale === 'de' ? deUrl : enUrl;

    assert.match(html, new RegExp(`<html[^>]*\\blang="${route.locale}"`), route.file);
    assert.match(html, linkPattern('canonical', canonical), route.file);
    assert.match(html, linkPattern('alternate', deUrl, 'de'), route.file);
    assert.match(html, linkPattern('alternate', enUrl, 'en'), route.file);
    assert.match(html, linkPattern('alternate', deUrl, 'x-default'), route.file);

    const csp = html.match(/<meta(?=[^>]*http-equiv="content-security-policy")[^>]*>/i)?.[0];
    assert.ok(csp, `${route.file} has a CSP meta tag`);
    assert.match(csp, /default-src 'self'/, route.file);
    assert.match(csp, /object-src 'none'/, route.file);
  }
});

test('homepages ship the hydration proof island', () => {
  for (const [file, label] of [
    ['index.html', 'Plattform-Hydrationsprüfung'],
    ['en/index.html', 'Platform hydration check'],
  ]) {
    const html = readOutput(file);
    assert.match(html, /<astro-island\b/, file);
    assert.match(html, new RegExp(label), file);
    assert.ok(html.includes(`aria-label="${label}: 0"`), `${file} accessible name includes the count`);
  }
});

test('built shell keeps accent out of text and focus colors', () => {
  const css = readCssOutput();
  assert.doesNotMatch(css, /(?:^|[;{])color:var\(--accent\)/);
  assert.match(css, /:focus-visible\{[^}]*outline:[^;}]*var\(--ink\)/);
  assert.match(css, /text-decoration-color:var\(--accent\)/);
});

test('built h1 CSS lets long German words wrap on narrow screens', () => {
  assert.match(readCssOutput(), /h1\{[^}]*overflow-wrap:anywhere/);
});

test('built CSS includes the exact core brand trio and highlights the hydration control', () => {
  const css = readCssOutput();
  for (const declaration of ['--paper:#fafaf8', '--accent:#4fa7a3', '--highlight:#fff997']) {
    assert.ok(css.includes(declaration), declaration);
  }
  assert.match(readOutput('index.html'), /button\.[^{]*\{[^}]*background:var\(--highlight\)/);
});

test('build references and copies local fonts and logo', () => {
  const logo = '/assets/orkaid-logo-horizontal-light-600x160.png';
  assert.match(readOutput('index.html'), new RegExp(logo));
  assert.ok(existsSync(join(dist, logo)), logo);

  const fontFiles = [
    'source-serif-4-latin-400-normal.woff2',
    'source-serif-4-latin-600-normal.woff2',
    'ibm-plex-sans-latin-400-normal.woff2',
    'ibm-plex-sans-latin-500-normal.woff2',
    'ibm-plex-mono-latin-400-normal.woff2',
    'ibm-plex-mono-latin-500-normal.woff2',
  ];
  const css = readCssOutput();

  for (const file of fontFiles) {
    assert.match(css, new RegExp(`/fonts/${file}`), file);
    assert.ok(existsSync(join(dist, 'fonts', file)), file);
  }
});

test('sitemap contains reciprocal locale alternates in each route entry', () => {
  const sitemapFiles = readdirSync(dist).filter(
    (file) => file === 'sitemap.xml' || file === 'sitemap-index.xml' || /^sitemap-\d+\.xml$/.test(file),
  );
  assert.ok(sitemapFiles.length > 0, 'sitemap output exists');
  const sitemap = sitemapFiles.map(readOutput).join('\n');

  assertSitemapRoutePairs(sitemap);
});

test('sitemap route checks reject missing entries and alternates', () => {
  const sitemap = readOutput('sitemap-0.xml');
  assertSitemapRoutePairs(sitemap);
  assert.throws(() => assertSitemapRoutePairs(sitemap.replace('<url><loc>https://orkaid.de/tools/</loc>', '<url>')));
  assert.throws(() => assertSitemapRoutePairs(sitemap.replace(/<xhtml:link[^>]*\/>/g, '')));
});
