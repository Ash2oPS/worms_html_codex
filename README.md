# worms_html_codex

Worms-like browser prototype built with Vite + TypeScript + Pixi + Rapier.

## Requirements

- Node.js 20+
- npm 10+

## Setup

```bash
npm install
```

Install browser binaries once for local QA automation:

```bash
npm run qa:install-browsers
```

## Run locally

```bash
npm run dev
```

Dev URL:

- http://127.0.0.1:5173

## Build and preview

```bash
npm run build
npm run serve
```

Preview URL:

- http://127.0.0.1:41783

Production builds now split gameplay bootstrap, Pixi, Rapier JS, and the Rapier `.wasm` asset into separate files so the app code itself no longer ships as one fat monolith.

## Reproducible validation

```bash
npm run verify
```

`verify` runs:

1. Typecheck and production build
2. Inline local static serve on `127.0.0.1:41783`
3. Headless smoke check for `window.render_game_to_text` + `window.advanceTime`

## QA scripts

- `npm run qa` or `npm run qa:smoke`: fast hook/runtime smoke check on the latest `dist/` build with an inline static server
- `npm run qa:install-browsers`: install Playwright Chromium runtime
- `npm run qa:ai`: AI-vs-AI headless batch probe on the latest `dist/` build with an inline static server
- `npm run qa:backjump`: back-jump event probe on the latest `dist/` build with an inline static server
- `npm run qa:double-jump`: manual jump vs double-tap behavior probe on the latest `dist/` build with an inline static server
- `npm run qa:double-jump:capture`: screenshot capture in `output/double-jump-captures` on the latest `dist/` build with an inline static server

Reusable scripts live in `scripts/qa/`.

## Output folder policy

- `output/` is local and generated.
- Only `output/.gitkeep` is versioned.
- Screenshots, JSON snapshots, and temporary QA logs should stay in `output/`.
