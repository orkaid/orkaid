# Orkaid

Open-source tools for finance, accounting and compliance, built in public.

Orkaid is a practitioner-led project by Mihai-Adrian Mateescu at the intersection of professional domain expertise and software engineering.

This repository currently contains the local-only Astro platform bootstrap for the future tool hub. The XRechnung generator is not part of this bootstrap.

## Current status

The Orkaid public site is live.

The repository currently contains a local-only Astro platform bootstrap. The XRechnung generator is planned and is not included here.

## Links

- Website: [https://orkaid.de](https://orkaid.de)
- Publication / build log: [https://orkaid.substack.com](https://orkaid.substack.com)

## Local preview

```bash
npm ci
npm run dev
```

Then open:

`http://localhost:4321`

## Development checks

Use Node `24.20.0` and npm `11.19.0`.

```bash
npm run check
npm test
npm run build
npm audit
```

The production build is written to `dist/`.

## Attribution

Orkaid software is open source and may be used, modified and redistributed under the MIT License.

If Orkaid code materially contributes to another public implementation, visible attribution to Orkaid is appreciated but not required.

Suggested optional credit:

`Based on Orkaid — https://orkaid.de`

or:

`Built with Orkaid — https://orkaid.de`

Attribution is voluntary and is NOT an additional condition of the MIT License.

## License

Software in this repository is licensed under the MIT License unless otherwise stated.

Orkaid brand assets are excluded from the MIT software license; see `BRAND_ASSETS.md`.

Third-party fonts retain their own licenses under `public/fonts/`.
