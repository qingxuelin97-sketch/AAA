# Quiet Aqua vector trace specification

> Liuli v5 注：本文几何测量仍然有效；色值列已按琉璃调色板同步（权威顺序见 APP_UI_ORACLE.md v5 修订总纲与 app-quiet-aqua-tokens.css）。

These traces translate the four generated design masters into measurable UI geometry. They are implementation references, not flattened production artwork.

- Master input: `853 × 1844` raster mockup.
- Trace coordinate space: `390 × 844`, portrait.
- Horizontal scale: `390 / 853 = 0.45721`.
- Vertical scale: `844 / 1844 = 0.45770`.
- All trace files contain only SVG primitives (`rect`, `circle`, `ellipse`, `path`, `text`, gradients, filters, and local symbol reuse).
- No `<image>`, data URI, embedded bitmap, or remote asset appears in a trace.
- People and illustrated scenes are deliberately schematic and labelled `dynamic media`. The App should render those as real content media behind the traced UI, not bake any master PNG into the bundle.

## Shared coordinate and surface rules

| Rule | Measurement |
|---|---:|
| Canvas | `390 × 844` |
| Primary page gutter | `16–18` |
| Main surface width | `354–358` |
| Header visual control | `40–42` square |
| Header interaction box | minimum `44 × 44` |
| Main card radius | `15–16` |
| Nested control radius | `11–14` |
| Pill radius | half of control height |
| Hairline | `1`, Quiet Aqua border `#E2E5EA` |
| Short shadow | `y 5`, blur approximately `16`, black-green at `9–10%` |
| Dock frame | `x 18`, width `354`, height `62–64`, radius `24` |
| Create accessory | `50` visual disc inside a `64` halo; centre `x 195` |
| Minimum ordinary App target | `44 × 44` |
| Primary CTA | `62` high on immersive Discover; `44–48` minimum elsewhere |

The visible icon plate may be `40–42` while its actual button wrapper remains `44`. Adjacent interaction boxes must not overlap. The centre create accessory is not a fifth navigation tab: Dock semantics remain four tabs (`Today`, `Discover`, `Messages`, `Me`).

## Shared visual language

### Palette

| Role | Value | Use |
|---|---|---|
| Page | `#F6F7F9` / `#FAFBFC` | App background |
| Group | `#EDEFF3` | Recessed groups and icon wells |
| Surface | `#FFFFFF` | Opaque content cards |
| Primary ink | `#16181D` | Titles, values, primary copy |
| Secondary ink | `#607875` / `#6B7E7C` | Supporting copy and metadata |
| Primary action | `#1D5FDB` | Selection, focus, CTA, active tab |
| Pressed action | `#066A66` | Code interaction state |
| Weak selection | `#E7EEFC` | Selected backgrounds, avatar wells |
| Border | `#E2E5EA` | Hairlines |
| Unread | `#EF5A3E` | Badges only |
| Reward | `#EFB73E` | Coin and SVIP semantics only |

Do not introduce cyan-purple gradients or per-shortcut rainbow colours. Teal gradients are permitted only to give one primary action controlled depth. Gold and coral stay semantic.

### Type

Use the App font stack (`Inter`, `PingFang SC`, system sans-serif). The trace uses these optical sizes:

- Page title: `24`, weight `750–760`.
- Immersive character title: `29`, weight `780`.
- Profile identity: `24`, weight `760`.
- Section title: `14–15`, weight `700–720`.
- Primary row title: `14`, weight `700`.
- Body: `11–13`, weight regular.
- Metadata and Dock labels: `9–10`.

Text must remain live text in code. The SVG text is a measuring annotation, not a proposal to outline or rasterise product copy.

### Material and depth

- Content surfaces are opaque white, bordered by a hairline, with one restrained short shadow.
- Translucent material is reserved for the immersive top controls and floating Dock/control layer.
- Never stack multiple shadows or glass layers on the same content card.
- Press state is colour plus at most `scale(.97)`; no glow sweep, breathing animation, or parent/child double scaling.
- Keep the content plane visually quiet so dynamic character media remains the highest-detail layer.

## Today trace

File: `generated/quiet-aqua-today-trace.svg`

| Y range | Region | Key geometry |
|---:|---|---|
| `40–82` | Header | title at `x 20`; search `x 277`; notification `x 328`; controls `42 × 42` |
| `92–212` | Greeting / balance | `x 18`, `354 × 120`, radius `15`; avatar `56`; sign-in visual `69 × 38` within a `44` target |
| `223–369` | Shortcut group | `x 16`, `358 × 146`, radius `16`; three equal columns; two rows about `68` apart |
| `383–602` | Editorial hero | `x 18`, `354 × 219`, radius `15`; bottom text shade begins near `y 468` |
| `619–637` | Continue heading | `x 20`; trailing action aligned near `x 347` |
| `641–757` | Continue rail | height `116`; circular media `50`; item centres about `78` apart |
| `760–824` | Dock | `354 × 64`; create centre `195,779` |

Dynamic media slots:

- Greeting avatar: circular `56 × 56`, centred near `(64,171)`.
- Hero: `354 × 219`, `cover`, focal subject biased right; reserve the left lower quadrant for copy and CTA.
- Continue avatars: circular `50 × 50`; labels remain outside media.

The six shortcuts are one grouped surface, not six floating glass cards. Their conceptual target grid is approximately `112 × 68` per item even though each icon is only about `24`.

## Discover trace

File: `generated/quiet-aqua-discover-trace.svg`

| Y range | Region | Key geometry |
|---:|---|---|
| `0–844` | Dynamic full-bleed media | `390 × 844`, `cover`; preserve bottom legibility shade |
| `50–94` | Back / categories / search | back and search `42 × 44`; selected underline at `y 85` |
| `322–627` | Social rail | centre `x 354`; actions separated by about `62–68`; each wrapper at least `44` |
| `570–729` | Character identity | left gutter `29–30`; title, trait line, two-line premise, creator row |
| `742–804` | Primary controls | chat `x 23`, `269 × 62`, radius `23`; call `x 305`, `62 × 62` |
| `805–844` | Bottom safety | no essential text or tap target below `804` |

The character and background remain one dynamic-media layer with a focal point around `(240,300)`. UI overlays are separate DOM/SVG/CSS layers. The bottom shade transitions from transparent to near-opaque deep blue-green; it is not a baked vignette image.

## Messages trace

File: `generated/quiet-aqua-messages-trace.svg`

| Y range | Region | Key geometry |
|---:|---|---|
| `42–84` | Header | title at `x 21`; search plate `40 × 42` |
| `91–126` | Segmented control | `x 20`, `350 × 35`, radius `15`; selected half inset by `2` |
| `139–327` | System destinations | `354 × 188`, radius `16`; three `62–63` rows; icon wells `42 × 42` |
| `343–353` | Conversation heading | `x 21`, baseline near `352` |
| `362–760` | Conversation list | `354 × 398`, radius `16`; six `66` rows; avatar `50` |
| `766–828` | Dock | `354 × 62`; create centre `195,785` |

Row construction:

- Leading media centre: `x 42` relative to the page, diameter `50`.
- Text origin: about `x 83`; title baseline is `8` above row centre, preview is `15` below.
- Time and unread badge align to the trailing edge near `x 362`.
- Hairlines start after the avatar zone rather than crossing the full card.
- One-line previews truncate; row height does not expand for message content.

## Profile trace

File: `generated/quiet-aqua-profile-trace.svg`

| Y range | Region | Key geometry |
|---:|---|---|
| `50–92` | Utility controls | search, notification, settings; `40 × 42`; `11` gap |
| `97–313` | Identity card | `x 18`, `354 × 216`, radius `16`; avatar about `84`; four equal statistics |
| `323–374` | SVIP surface | `356 × 51`, radius `15`; gold is semantic and low saturation |
| `383–446` | Wallet surface | `356 × 63`; two balances plus a `62 × 43` wallet control |
| `455–528` | Quick destinations | `356 × 73`; five equal columns |
| `537–755` | Role gallery | `356 × 218`; tabs at top; cards `105 × 157`, gap `11` |
| `760–824` | Dock | `354 × 64`; create centre `195,779` |

Dynamic media slots:

- Profile avatar: circular, approximately `84 × 84`.
- Role cards: media region `105 × 90`, top corners radius `11`; titles and subtitles are live text below.
- Status chips sit on top of a card media region but remain native UI, not part of the media.

The profile screen deliberately uses several vertically stacked surfaces, so depth must stay shallow. The identity card alone may contain a pale atmospheric illustration; all subsequent content cards remain opaque and neutral.

## Implementation acceptance

1. Do not import any `*-master-v1.png` or trace SVG as a full-screen App image.
2. Translate trace geometry into semantic React components, CSS tokens, and small code-native SVG icons.
3. Runtime character images may populate only the marked dynamic-media slots.
4. Every interactive wrapper is at least `44 × 44`; visual plates can be smaller.
5. Verify at `360 × 800`, `390 × 844`, and `412 × 915`; scale gutters and flexible regions, not typography indiscriminately.
6. Dock remains fixed above the bottom safe area without covering scroll content.
7. Web rendering remains unchanged; apply these rules only inside the App scope.
8. Light/dark and balanced/lite modes must preserve hierarchy, contrast, and the same geometry.
