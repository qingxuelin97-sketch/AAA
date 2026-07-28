# 仪与匣 IX-6 / IX-7 completion record

status: complete
owner: qingxuelin97-sketch/AAA
branch: claude/app-frontend-deai-redesign-nx43s3
ix6_commit: 5987000
ix7_commit: self

## Runtime authority

- `client/src/styles/app-ix-tokens.css` is the App-fenced byte twin of
  `field-instrument/design-tokens.css`.
- `client/src/styles/app-ix-pages-d.css` owns the folded S3-S7 composition and
  the IX-6 long-tail pages (library, publish, atelier, editors, settings,
  onboarding, empty/error states, and share-card shell).
- Runtime imports and source contain zero `var(--lg-*)` / `var(--qa-*)`
  references. The Lumen token files, S3-S7 layers, materials layer, QA shim,
  and IX bridge are retired from `client/src/styles/`.

## Media and native surfaces

- Empty states, onboarding, and milestone stamps use the 41 reviewed
  light/dark SVG assets in `client/src/assets/illos/`.
- The retired `qa5-*` empty/onboarding/stamp/boot/VIP-weave PNG catalog is
  removed. The reviewed character master, currency icons, and live brand
  media remain.
- Capacitor canvas colors are IX light `#E8EBE9` and dark `#0F1312`; Web
  colors and route/API contracts are unchanged.

## Verification contract

`npm run test:app` locks the import order, App fence, frozen token twin,
legacy-token absence, folded page tail, semantic group tones, SVG catalog,
native asset pipeline, and share-card dimensions. The archived Lumen design
documents remain available for historical comparison and are not runtime
dependencies.
