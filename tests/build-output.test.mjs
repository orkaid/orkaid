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

function linkPattern(rel, href, hreflang) {
  const language = hreflang ? `(?=[^>]*\\bhreflang="${hreflang}")` : '';
  return new RegExp(`<link(?=[^>]*\\brel="${rel}")${language}(?=[^>]*\\bhref="${href}")[^>]*>`);
}

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
  }
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
  const css = readdirSync(dist, { recursive: true })
    .filter((file) => file.endsWith('.css'))
    .map((file) => readOutput(file))
    .join('\n');

  for (const file of fontFiles) {
    assert.match(css, new RegExp(`/fonts/${file}`), file);
    assert.ok(existsSync(join(dist, 'fonts', file)), file);
  }
});

test('sitemap includes both locale route trees', () => {
  const sitemapFiles = readdirSync(dist).filter(
    (file) => file === 'sitemap.xml' || file === 'sitemap-index.xml' || /^sitemap-\d+\.xml$/.test(file),
  );
  assert.ok(sitemapFiles.length > 0, 'sitemap output exists');
  const sitemap = sitemapFiles.map(readOutput).join('\n');

  for (const route of routes) {
    const prefix = route.locale === 'en' ? '/en' : '';
    assert.match(sitemap, new RegExp(`https://orkaid\\.de${prefix}${route.path}`), route.file);
  }
});
