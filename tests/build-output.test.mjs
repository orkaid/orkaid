import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const dist = join(process.cwd(), 'dist');
const sourceCss = readFileSync(join(process.cwd(), 'src/styles/tokens.css'), 'utf8');
const expectedPaths = ['/', '/datenschutz/', '/impressum/', '/tools/'];
const routes = expectedPaths.flatMap((path) => [
  { file: path === '/' ? 'index.html' : `${path.slice(1)}index.html`, locale: 'de', path },
  { file: path === '/' ? 'en/index.html' : `en${path}index.html`, locale: 'en', path },
]);

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

function localeRouteSets() {
  const files = readdirSync(dist, { recursive: true }).filter((file) => file.endsWith('index.html'));
  const toPath = (file) => `/${file.replace(/index\.html$/, '')}`;
  return {
    de: files.filter((file) => !file.startsWith('en/')).map(toPath).sort(),
    en: files.filter((file) => file.startsWith('en/')).map((file) => toPath(file.slice(3))).sort(),
  };
}

function assertSitemapRoutePairs(sitemap, paths = localeRouteSets().de) {
  for (const path of paths) {
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
    assert.match(html, linkPattern('alternate', deUrl, 'de-DE'), route.file);
    assert.match(html, linkPattern('alternate', enUrl, 'en'), route.file);
    assert.match(html, linkPattern('alternate', deUrl, 'x-default'), route.file);
    assert.doesNotMatch(html, /hreflang="de"/, route.file);

    const csp = html.match(/<meta(?=[^>]*http-equiv="content-security-policy")[^>]*>/i)?.[0];
    assert.ok(csp, `${route.file} has a CSP meta tag`);
    assert.match(csp, /default-src 'self'/, route.file);
    assert.match(csp, /object-src 'none'/, route.file);
    assert.doesNotMatch(csp, /'unsafe-inline'/, route.file);
    assert.doesNotMatch(csp, /'unsafe-eval'/, route.file);
  }
});

test('public shell restores positioning and removes bootstrap-only hydration proof', () => {
  const de = readOutput('index.html');
  const en = readOutput('en/index.html');
  assert.match(de, /Open-Source-Werkzeuge für Finanzen, Buchhaltung und Compliance/);
  assert.match(en, /open-source tools for finance, accounting and compliance/);
  assert.match(de, /Keine Steuer- oder Rechtsberatung/);
  assert.match(en, /No tax or legal advice/);
  assert.doesNotMatch(`${de}\n${en}`, /<astro-island\b|Hydrationsprüfung|hydration check|Interaktive Insel|Interactive island/i);
});

test('built shell keeps accent out of text and focus colors', () => {
  assert.doesNotMatch(sourceCss, /(?:^|[;{])\s*color:\s*var\(--accent\)/);
  assert.match(sourceCss, /:focus-visible\s*\{[^}]*outline:[^;}]*var\(--ink\)/s);
  assert.match(sourceCss, /text-decoration-color:\s*var\(--accent\)/);
});

test('built h1 CSS lets long German words wrap on narrow screens', () => {
  assert.match(sourceCss, /h1\s*\{[^}]*overflow-wrap:\s*anywhere/s);
});

test('source tokens contain the exact core brand trio and the real status accent', () => {
  for (const [token, value] of [['paper', '#fafaf8'], ['accent', '#4fa7a3'], ['highlight', '#fff997']]) {
    assert.match(sourceCss, new RegExp(`--${token}:\\s*${value}`, 'i'));
  }
  assert.match(sourceCss, /\.status-highlight\s*\{[^}]*background:\s*var\(--highlight\)/s);
  assert.match(readOutput('tools/index.html'), /class="status-highlight"[^>]*>In Entwicklung</);
  assert.match(readOutput('en/tools/index.html'), /class="status-highlight"[^>]*>In development</);
});

test('legal pages wrap long link text without broad paragraph wrapping', () => {
  assert.match(sourceCss, /\.legal a\s*\{[^}]*overflow-wrap:\s*anywhere/s);
  assert.doesNotMatch(sourceCss, /\.legal p\s*\{[^}]*overflow-wrap/s);
});

test('privacy and English legal access copy reflect the current site', () => {
  const privacy = readOutput('datenschutz/index.html');
  assert.doesNotMatch(privacy, /Coming-Soon-Seite/);
  assert.match(privacy, /Links zu externen Diensten und Websites/);
  assert.match(readOutput('en/impressum/index.html'), /<h1>Legal notice<\/h1>/);

  const enPrivacy = readOutput('en/datenschutz/index.html');
  assert.doesNotMatch(enPrivacy, /German version is authoritative/i);
  assert.match(enPrivacy, /<h1>Privacy notice<\/h1>/);
  assert.match(enPrivacy, /GDPR Art\. 13/);
  assert.doesNotMatch(enPrivacy, /GDPR Art\. 13, 14/);
  assert.match(enPrivacy, /Hosting and security processing by Cloudflare/);
  assert.match(enPrivacy, /Zoho Mail/);
  assert.match(enPrivacy, /Your rights under the GDPR/);
  assert.match(enPrivacy, /Insofar as the applicable statutory conditions are met/);
});

test('generated German and English content route sets are exact mirrors', () => {
  const routeSets = localeRouteSets();
  assert.deepEqual(routeSets.de, expectedPaths);
  assert.deepEqual(routeSets.en, routeSets.de);
});

test('Cloudflare Pages static headers provide narrow transport-level hardening', () => {
  const headers = readOutput('_headers');
  assert.match(headers, /^\/\*$/m);
  assert.match(headers, /^  Content-Security-Policy: frame-ancestors 'none'$/m);
  assert.match(headers, /^  X-Content-Type-Options: nosniff$/m);
  assert.match(headers, /^  Referrer-Policy: strict-origin-when-cross-origin$/m);
  assert.match(headers, /^  Permissions-Policy: camera=\(\), geolocation=\(\), microphone=\(\)$/m);
  assert.doesNotMatch(headers, /default-src|script-src|style-src|Strict-Transport-Security/i);
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
