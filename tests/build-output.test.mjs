import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const dist = join(process.cwd(), 'dist');
const sourceCss = readFileSync(join(process.cwd(), 'src/styles/tokens.css'), 'utf8');
const knowledgePaths = ['/knowledge/', '/knowledge/e-rechnung/', '/knowledge/xrechnung-erstellen/', '/knowledge/xrechnung-pruefen/'];
const expectedPaths = ['/', '/datenschutz/', '/impressum/', ...knowledgePaths, '/tools/', '/tools/xrechnung/'];
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

// PR-20: the legal pages carry noindex and stay out of the sitemap; every other mirrored route is listed with its alternates.
const legalPaths = ['/datenschutz/', '/impressum/'];
const indexablePaths = expectedPaths.filter((path) => !legalPaths.includes(path));

function assertSitemapRoutePairs(sitemap, paths = indexablePaths) {
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

test('build emits all mirrored routes with locale metadata and no inline CSP meta tag', () => {
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
    assert.doesNotMatch(html, /<meta(?=[^>]*http-equiv="content-security-policy")[^>]*>/i, route.file);
  }
});

test('public shell restores positioning and removes bootstrap-only hydration proof', () => {
  const de = readOutput('index.html');
  const en = readOutput('en/index.html');
  assert.match(de, /Open-Source-Werkzeuge für Finanzen, Buchhaltung und Compliance/);
  assert.match(en, /Open-source tools for finance, accounting and compliance/);
  assert.match(de, /Keine Steuer- oder Rechtsberatung/);
  assert.match(en, /No tax or legal advice/);
  assert.doesNotMatch(`${de}\n${en}`, /<astro-island\b|Hydrationsprüfung|hydration check|Interaktive Insel|Interactive island/i);
});

test('built shell keeps accent out of text and focus colors', () => {
  assert.doesNotMatch(sourceCss, /(?:^|[;{])\s*color:\s*var\(--accent\)/);
  assert.match(sourceCss, /:focus-visible\s*\{[^}]*outline:[^;}]*var\(--ink\)/s);
  assert.match(sourceCss, /text-decoration-color:\s*var\(--accent\)/);
});

// PR-07: \`overflow-wrap: anywhere\` on every h1 split "Datenschutzerklärung" mid-word on desktop. Headings now break at word
// boundaries and at deliberate soft hyphens only; each surface names its heading role.
test('headings break at word boundaries and deliberate soft hyphens, never anywhere', () => {
  assert.doesNotMatch(sourceCss, /h[1-3][^{]*\{[^}]*overflow-wrap:\s*anywhere/s);
  assert.doesNotMatch(sourceCss, /h1\s*\{[^}]*max-width:\s*18ch/s);
  assert.match(sourceCss, /h1,\s*h2,\s*h3\s*\{[^}]*hyphens:\s*manual/s);
  assert.match(readOutput('datenschutz/index.html'), /<h1 class="title-legal">Datenschutz(&shy;|\u00ad)erklärung<\/h1>/);
  for (const [file, role] of [['index.html', 'title-hero'], ['tools/index.html', 'title-page'], ['impressum/index.html', 'title-legal'], ['tools/xrechnung/index.html', 'title-tool']]) {
    assert.match(readOutput(file), new RegExp(`<h1[^>]*class="${role}"`), file);
    assert.match(readOutput(`en/${file}`), new RegExp(`<h1[^>]*class="${role}"`), `en/${file}`);
  }
});

// PR-08: the eyebrow and the lead are separate roles; no descendant rule may restyle every paragraph of a page heading.
test('eyebrow and lead are distinct classes without a page-heading paragraph override', () => {
  assert.doesNotMatch(sourceCss, /\.page-heading p\b/);
  assert.match(sourceCss, /\.eyebrow\s*\{[^}]*font:\s*500 var\(--fs-label\)/s);
  assert.match(sourceCss, /\.lead\s*\{[^}]*margin:\s*0\.875rem 0 0/s);
  assert.match(readOutput('tools/index.html'), /<p class="lead"[ >]/);
});

// PR-10 / PR-12: the exact page alone carries aria-current="page"; an ancestor section is marked without it. Fixed DE | EN order.
test('shell navigation marks the current page, the current section and a fixed-order language selector', () => {
  const nav = (html) => html.match(/<nav class="site-nav"[\s\S]*?<\/nav>/)?.[0] ?? '';
  const lang = (html) => html.match(/<nav class="lang-switch"[\s\S]*?<\/nav>/)?.[0] ?? '';
  for (const route of routes) {
    const html = readOutput(route.file);
    const prefix = route.locale === 'en' ? '/en' : '';
    const toolsLink = nav(html).match(/<a href="[^"]*\/tools\/"[^>]*>/)?.[0] ?? '';
    assert.ok(toolsLink, `${route.file} links the tool hub`);
    assert.match(toolsLink, new RegExp(`href="${prefix}/tools/"`), route.file);
    if (route.path === '/tools/') assert.match(toolsLink, /aria-current="page"/, route.file);
    else assert.doesNotMatch(toolsLink, /aria-current/, route.file);
    if (route.path === '/tools/xrechnung/') assert.match(toolsLink, /class="is-section"/, route.file);
    const knowledgeLink = nav(html).match(/<a href="[^"]*\/knowledge\/"[^>]*>/)?.[0] ?? '';
    assert.match(knowledgeLink, new RegExp(`href="${prefix}/knowledge/"`), `${route.file} links the knowledge index`);
    if (route.path === '/knowledge/') assert.match(knowledgeLink, /aria-current="page"/, route.file);
    else assert.doesNotMatch(knowledgeLink, /aria-current/, route.file);
    if (route.path.startsWith('/knowledge/') && route.path !== '/knowledge/') assert.match(knowledgeLink, /class="is-section"/, route.file);
    else assert.doesNotMatch(knowledgeLink, /is-section/, route.file);
    assert.match(nav(html), /href="https:\/\/github\.com\/orkaid\/orkaid" target="_blank" rel="noopener noreferrer"/, route.file);

    const switcher = lang(html);
    assert.ok(switcher.indexOf('>DE<') !== -1 && switcher.indexOf('>DE<') < switcher.indexOf('>EN<'), `${route.file} keeps DE before EN`);
    const other = route.locale === 'de' ? 'en' : 'de';
    const otherHref = other === 'en' ? `/en${route.path}` : route.path;
    assert.match(switcher, new RegExp(`<span aria-current="true" lang="${route.locale}">${route.locale.toUpperCase()}<`), route.file);
    assert.match(switcher, new RegExp(`<a href="${otherHref}" hreflang="${other === 'de' ? 'de-DE' : 'en'}" lang="${other}" data-locale-switch>${other.toUpperCase()}<`), route.file);
  }
  const home = readOutput('index.html');
  assert.match(home, /<a class="brand" href="\/" aria-current="page">/);
  assert.match(readOutput('datenschutz/index.html'), /<a href="\/datenschutz\/" aria-current="page">Datenschutz<\/a>/);
});

test('footer keeps legal pages, project channels and a disclaimer; external links say they leave the site', () => {
  for (const [file, locale] of [['index.html', 'de'], ['en/tools/xrechnung/index.html', 'en']]) {
    const footer = readOutput(file).match(/<footer class="site-footer">[\s\S]*?<\/footer>/)?.[0] ?? '';
    const prefix = locale === 'en' ? '/en' : '';
    for (const path of ['/tools/', '/impressum/', '/datenschutz/']) assert.match(footer, new RegExp(`href="${prefix}${path}"`), `${file} ${path}`);
    for (const href of ['https://github.com/orkaid/orkaid', 'https://github.com/orkaid/orkaid/issues', 'https://orkaid.substack.com', 'https://www.youtube.com/@orkaidbuilds']) {
      assert.match(footer, new RegExp(`href="${href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}" target="_blank" rel="noopener noreferrer">[^<]+<span class="ext-mark" aria-hidden="true">↗</span><span class="vh">`), `${file} ${href}`);
    }
    assert.match(footer, /href="mailto:kontakt@orkaid\.de"/);
    assert.match(footer, locale === 'de' ? /Keine Steuer- oder Rechtsberatung/ : /No tax or legal advice/);
  }
});

test('source tokens contain the exact core brand trio; the accent yellow marks the primary action', () => {
  for (const [token, value] of [['paper', '#fafaf8'], ['accent', '#4fa7a3'], ['highlight', '#fff997']]) {
    assert.match(sourceCss, new RegExp(`--${token}:\\s*${value}`, 'i'));
  }
  assert.match(sourceCss, /\.button-primary\s*\{[^}]*box-shadow:[^;}]*var\(--highlight\)/s);
});

test('legal pages wrap long link text without broad paragraph wrapping', () => {
  assert.match(sourceCss, /\.legal a\s*\{[^}]*overflow-wrap:\s*anywhere/s);
  assert.doesNotMatch(sourceCss, /\.legal p\s*\{[^}]*overflow-wrap/s);
});

test('privacy and English legal access copy reflect the current site', () => {
  const privacy = readOutput('datenschutz/index.html');
  assert.doesNotMatch(privacy, /Coming-Soon-Seite/);
  assert.match(privacy, /Links zu externen Diensten und Websites/);
  assert.match(readOutput('en/impressum/index.html'), /<h1[^>]*>Legal notice<\/h1>/);

  const enPrivacy = readOutput('en/datenschutz/index.html');
  assert.doesNotMatch(enPrivacy, /German version is authoritative/i);
  assert.match(enPrivacy, /<h1[^>]*>Privacy notice<\/h1>/);
  assert.match(enPrivacy, /GDPR Art\. 13/);
  assert.doesNotMatch(enPrivacy, /GDPR Art\. 13, 14/);
  assert.match(enPrivacy, /Hosting and security processing by Cloudflare/);
  assert.match(enPrivacy, /Zoho Mail/);
  assert.match(enPrivacy, /Your rights under the GDPR/);
  assert.match(enPrivacy, /Insofar as the applicable statutory conditions are met/);

  // The generator has input fields: the notice must describe their local processing, not claim the site has no forms.
  assert.doesNotMatch(privacy, /Formulare oder Kontaktfelder|ohne eigenes Server-Backend, Nutzerkonten oder Formulare/);
  assert.doesNotMatch(enPrivacy, /no forms or contact fields|user accounts or forms of its own/);
  assert.match(privacy, /<h2>3\. XRechnung-Generator<\/h2>/);
  assert.match(enPrivacy, /<h2>3\. XRechnung generator<\/h2>/);
});

test('knowledge guides carry the CC BY 4.0 notice and name the application release apart from the standard', () => {
  for (const path of knowledgePaths.slice(1)) {
    for (const file of [`${path.slice(1)}index.html`, `en${path}index.html`]) {
      const main = mainOf(readOutput(file));
      assert.match(main, /<section class="license"[^>]*>[\s\S]*href="https:\/\/creativecommons\.org\/licenses\/by\/4\.0\/"[\s\S]*MIT/, file);
      assert.match(main, /Orkaid[\s\S]*(Logo|logo)/, `${file} excludes the brand`);
      assert.match(main, /v0\.1\.0/, `${file} names the application release`);
    }
  }
});

test('generated German and English content route sets are exact mirrors', () => {
  const routeSets = localeRouteSets();
  assert.deepEqual(routeSets.de, expectedPaths);
  assert.deepEqual(routeSets.en, routeSets.de);
});

test('XRechnung workspace pages need no inline script or style and use no Astro island loader (CSP script-src/style-src are \'self\')', () => {
  for (const [file, heading] of [['tools/xrechnung/index.html', 'XRechnung-Generator'], ['en/tools/xrechnung/index.html', 'XRechnung generator']]) {
    const html = readOutput(file);
    assert.match(html, new RegExp(`<h1[^>]*>${heading}</h1>`));
    assert.match(html, /<script type="module" src="\/_astro\/[^"]+\.js"><\/script>/, `${file} loads its bundle as an external module`);
    assert.doesNotMatch(html, /<script(?![^>]*\ssrc=)[^>]*>/, `${file} has no inline script`);
    assert.doesNotMatch(html, /<style[\s>]/, `${file} has no inline style element`);
    assert.doesNotMatch(html, /\sstyle=/, `${file} has no inline style attribute`);
    assert.doesNotMatch(html, /astro-island/, `${file} does not use the inline island loader`);
    assert.match(html, /site-shell site-shell--wide/, `${file} uses the route-scoped wide shell`);
    assert.match(html, /<form class="desk[^"]*" data-dirty="false"/, `${file} exposes the pristine dirty state for the leave guard`);
    assert.match(html, /<nav class="crumbs"[^>]*><ol[^>]*><li[^>]*><a href="(\/en)?\/tools\/"/, `${file} has a breadcrumb to the tool hub`);
  }
  for (const file of ['index.html', 'tools/index.html', 'impressum/index.html']) assert.doesNotMatch(readOutput(file), /site-shell--wide/, `${file} keeps the default width`);
});

test('Cloudflare Pages static headers provide transport-level and CSP hardening', () => {
  const headers = readOutput('_headers');
  assert.match(headers, /^\/\*$/m);
  assert.match(headers, /^  Strict-Transport-Security: max-age=63072000$/m); // no includeSubDomains/preload: not every subdomain is known to serve HTTPS, and preload is hard to undo
  assert.match(headers, /^  X-Content-Type-Options: nosniff$/m);
  assert.match(headers, /^  X-Frame-Options: DENY$/m);
  assert.match(headers, /^  Referrer-Policy: strict-origin-when-cross-origin$/m);
  assert.match(headers, /^  Cross-Origin-Opener-Policy: same-origin$/m);
  assert.match(
    headers,
    /^  Permissions-Policy: accelerometer=\(\), camera=\(\), geolocation=\(\), gyroscope=\(\), magnetometer=\(\), microphone=\(\), payment=\(\), usb=\(\), interest-cohort=\(\)$/m,
  );
  assert.match(headers, /^  Content-Security-Policy: .*default-src 'self'/m);
  assert.match(headers, /^  Content-Security-Policy: .*frame-ancestors 'none'/m);
  assert.match(headers, /^  Content-Security-Policy: .*object-src 'none'/m);
  // The built pages carry no inline script or style and load nothing from another origin (no analytics), so the policy allows only 'self'.
  const csp = headers.match(/^  Content-Security-Policy: (.*)$/m)?.[1] ?? '';
  for (const directive of ['script-src', 'style-src', 'img-src', 'font-src', 'connect-src']) {
    assert.match(csp, new RegExp(`(^|; )${directive} 'self'(;|$)`), directive);
  }
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval|https?:|data:/);
  assert.match(headers, /^  Content-Security-Policy: .*upgrade-insecure-requests/m);
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

// PR-01/02/03/05/06/28: the platform content contract, replacing the bootstrap status assertions.
const mainOf = (html) => html.match(/<main[\s\S]*?<\/main>/)?.[0] ?? '';
test('home pages lead to the tool, the three resources, the checking levels and the project channels', () => {
  for (const [file, prefix, headline, cta] of [['index.html', '', 'Werkzeuge für die Praxis.<br[^>]*>Wissen für den Alltag.', 'XRechnung erstellen'], ['en/index.html', '/en', 'Practical tools.<br[^>]*>Knowledge for everyday work.', 'Create an XRechnung']]) {
    const main = mainOf(readOutput(file));
    assert.match(main, new RegExp(`<h1[^>]*class="title-hero"[^>]*>${headline}</h1>`), file);
    assert.match(main, new RegExp(`<a class="button button-primary" href="${prefix}/tools/xrechnung/"[^>]*>${cta}`), file);
    for (const path of knowledgePaths.slice(1)) assert.match(main, new RegExp(`href="${prefix}${path}"`), `${file} ${path}`);
    assert.equal((main.match(/<ol class="ladder"/g) ?? []).length, 1, file);
    for (const href of ['https://github.com/orkaid/orkaid', 'https://orkaid.substack.com', 'https://www.youtube.com/@orkaidbuilds']) assert.match(main, new RegExp(`href="${href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`), `${file} ${href}`);
    assert.doesNotMatch(main, /Bootstrap|geplant|planned|In Entwicklung|In development/i, `${file} has no bootstrap status copy`);
  }
});

test('tool hub is a catalog of the one real tool with guide, checking advice, scope and issue path', () => {
  for (const [file, prefix] of [['tools/index.html', ''], ['en/tools/index.html', '/en']]) {
    const main = mainOf(readOutput(file));
    assert.equal((main.match(/<article class="entry/g) ?? []).length, 1, file);
    for (const path of ['/tools/xrechnung/', '/knowledge/xrechnung-erstellen/', '/knowledge/xrechnung-pruefen/']) assert.match(main, new RegExp(`href="${prefix}${path}"`), `${file} ${path}`);
    assert.match(main, /href="https:\/\/github\.com\/orkaid\/orkaid\/issues"/, file);
    assert.match(main, /<details class="scope/, file);
    assert.doesNotMatch(main, /Bootstrap|In Entwicklung|In development|Grundlage bereit|foundation is ready/i, file);
  }
});

test('knowledge resources carry breadcrumb, audience, applicability, date, sources and next steps in both locales', () => {
  for (const path of knowledgePaths.slice(1)) {
    for (const [file, locale] of [[`${path.slice(1)}index.html`, 'de'], [`en${path}index.html`, 'en']]) {
      const main = mainOf(readOutput(file));
      assert.match(main, /<nav class="crumbs"/, file);
      for (const label of locale === 'de' ? ['Für', 'Gilt für', 'Stand', 'Quellen', 'Abgerufen am', 'Weiterlesen'] : ['For', 'Applies to', 'Updated', 'Sources', 'Retrieved on', 'Read next']) assert.match(main, new RegExp(`>${label}[ <]`), `${file} ${label}`);
      assert.match(main, /<time datetime="2026-11-26">/, file);
      assert.ok((main.match(/<a class="ext" href="https:\/\//g) ?? []).length >= 2, `${file} cites external sources`);
      assert.doesNotMatch(main, /\b(Lesezeit|reading time)\b/i, `${file} invents no reading time`);
    }
  }
  const de = mainOf(readOutput('knowledge/xrechnung-pruefen/index.html'));
  const en = mainOf(readOutput('en/knowledge/xrechnung-pruefen/index.html'));
  for (const main of [de, en]) {
    assert.match(main, /java -jar validator-1\.6\.3-standalone\.jar -s scenarios\.xml -r \$\{PWD\} -h rechnung\.xml/);
    assert.match(main, /2026-08-31/);
  }
  assert.match(de, /führt den KoSIT-Validator nicht aus/);
  assert.match(en, /does not run the KoSIT validator/);
});

test('every internal link and fragment in the build resolves to an emitted page and element', () => {
  const pages = readdirSync(dist, { recursive: true }).filter((file) => file.endsWith('.html'));
  const ids = new Map(pages.map((file) => [`/${file.replace(/index\.html$/, '')}`, new Set([...readOutput(file).matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]))]));
  const broken = [];
  for (const file of pages) {
    const self = `/${file.replace(/index\.html$/, '')}`;
    for (const [, href] of readOutput(file).matchAll(/<a\b[^>]*\shref="([^"]+)"/g)) {
      if (/^(https?:|mailto:|tel:)/.test(href)) continue;
      const [path, fragment] = href.split('#');
      const target = path === '' ? self : path;
      if (!ids.has(target)) { broken.push(`${file}: ${href}`); continue; }
      if (fragment && !ids.get(target).has(fragment)) broken.push(`${file}: ${href} (no #${fragment})`);
    }
  }
  assert.deepEqual(broken, []);
});

test('sitemap lists exactly the indexable pages: no noindex page, no 404, no missing indexable page', () => {
  const sitemap = readOutput('sitemap-0.xml');
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).sort();
  const expected = indexablePaths.flatMap((path) => [`https://orkaid.de${path}`, `https://orkaid.de/en${path}`]).sort();
  assert.deepEqual(locs, expected);
  for (const route of routes) {
    const html = readOutput(route.file);
    const url = route.locale === 'de' ? `https://orkaid.de${route.path}` : `https://orkaid.de/en${route.path}`;
    const noindex = /<meta name="robots" content="noindex/.test(html);
    assert.equal(locs.includes(url), !noindex, `${route.file}: in sitemap exactly when indexable`);
  }
  assert.doesNotMatch(sitemap, /404/);
  assert.match(readOutput('sitemap-index.xml'), /<loc>https:\/\/orkaid\.de\/sitemap-0\.xml<\/loc>/);
});

test('sitemap check rejects a legal page or a missing indexable page', () => {
  const sitemap = readOutput('sitemap-0.xml');
  const locsOf = (xml) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).sort();
  const expected = indexablePaths.flatMap((path) => [`https://orkaid.de${path}`, `https://orkaid.de/en${path}`]).sort();
  assert.notDeepEqual(locsOf(sitemap.replace('</urlset>', '<url><loc>https://orkaid.de/impressum/</loc></url></urlset>')), expected);
  assert.notDeepEqual(locsOf(sitemap.replace('<loc>https://orkaid.de/knowledge/</loc>', '')), expected);
});

// PR-18: one static recovery page for Cloudflare Pages' native 404 handling.
test('404.html is a noindex recovery page without canonical, hreflang, current state or script, linking both home pages and tool hubs', () => {
  const html = readOutput('404.html');
  assert.match(html, /<html lang="de"/);
  assert.match(html, /<meta name="robots" content="noindex, follow">/);
  assert.doesNotMatch(html, /rel="canonical"|rel="alternate"|hreflang="x-default"|property="og:url"/);
  assert.doesNotMatch(html, /aria-current="page"|class="is-section"/);
  assert.doesNotMatch(html, /<script\b/);
  assert.match(html, /<h1[^>]*>Seite nicht gefunden<br[^>]*><span lang="en"[^>]*>Page not found<\/span><\/h1>/);
  assert.match(html, /<section lang="de"[^>]*>\s*<h2 id="nf-de"[^>]*>Auf Deutsch weiter<\/h2>/);
  assert.match(html, /<section lang="en"[^>]*>\s*<h2 id="nf-en"[^>]*>Continue in English<\/h2>/);
  assert.match(html, /<a href="#nf-en" lang="en"/, 'the English section is reachable from the top on narrow screens');
  for (const href of ['/', '/tools/', '/tools/xrechnung/', '/knowledge/', '/en/', '/en/tools/', '/en/tools/xrechnung/', '/en/knowledge/']) assert.match(mainOf(html), new RegExp(`<a href="${href}"`), href);
  assert.match(html, /<nav class="lang-switch"[\s\S]*?<a href="\/en\/" hreflang="en"/);
  assert.ok(!existsSync(join(dist, '404', 'index.html')), 'emitted as a root 404.html, not a route directory');
});

// PR-19: the origin part of robots.txt only adds the sitemap; Cloudflare's managed rules are served above it and not repeated.
test('robots.txt is plain directives with the sitemap reference and no user-agent rules or HTML', () => {
  const robots = readOutput('robots.txt');
  const directives = robots.split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
  assert.deepEqual(directives, ['Sitemap: https://orkaid.de/sitemap-index.xml']);
  assert.doesNotMatch(robots, /[<>]/, 'no HTML');
  assert.ok(directives.every((line) => !/^(User-agent|Allow|Disallow|Content-Signal)\s*:/i.test(line)), 'no crawler rules of its own');
  assert.ok(existsSync(join(dist, readOutput('robots.txt').match(/sitemap-index\.xml/)[0])), 'the referenced sitemap is emitted');
});
