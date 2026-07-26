# Quiet Aqua UI baselines

This directory stores reviewed screenshots generated from the HTTP App-shell preview. Product artwork may stay raster when it is the reviewed master asset; interface chrome and layout remain code-native. Release evidence is regenerated from the final PR4 + PR5 stack and is kept separately in `client/dist/quiet-aqua-e2e/`.

## App-shell matrix

Open `/app-controls?app=1` with deterministic seed data and capture:

| Viewport | Theme | Performance | Accent | Required |
|---|---|---|---|---|
| 360 × 800 | light | balanced | teal | yes |
| 390 × 844 | light | balanced | teal | yes |
| 412 × 915 | light | balanced | teal | yes |
| 390 × 844 | dark | balanced | teal | yes |
| 390 × 844 | light | lite | teal | yes |
| 390 × 844 | light | balanced | clay | yes |

Also capture the affected authenticated screens at 390 × 844 in both light and dark themes: Today, Discover, Messages, Profile, Notifications, Wallet, VIP, Settings, Friends, Groups, Search, Announcements, Events, Library, Worldbooks, Atelier, Theater, Achievements, Leaderboard, Gacha, and the Controls Gallery. Capture Auth registration and Chat separately; exercise the software keyboard, Create Sheet, Group Room, Character Editor, Novel Workspace, Worldbook detail, Script detail/editor, and Theater Room as interaction states rather than treating their landing frame as sufficient evidence.

## Web guard

For every affected route, capture the same data and viewport with `?app=0`. Compare against the pre-PR5 Web baseline. PR5 must not add `qa-*` classes, wrapper nodes, inferred ARIA, interactions, or visual changes outside `data-app="1"`.

## Review checklist

- Controls are at least 44 × 44px; authentication submit is at least 48px high.
- There is no horizontal overflow at any required viewport.
- Focus rings are visible and not clipped.
- Disabled anchors cannot navigate and are absent from the Tab order.
- The message badge exposes a numeric accessible name and visually caps at `99+`.
- Liuli v5 contract: Dock / top bars / chat input island report real chrome glass (`backdrop-filter: blur(…)`) on **high and balanced**; content cards stay opaque on balanced; `lite` reports `backdrop-filter: none` on Dock, Create Sheet, and chat input.
- Reduced-motion removes positional motion.
- The Dock and software keyboard do not cover the final actionable control.

Do not treat a single screenshot as release evidence. Store regenerated images with descriptive names such as `controls-390x844-light-balanced-teal.png` only after the matrix passes.

## manual-v6（琉璃 Liuli v5）
- 由重构会话生成：390×844 浅色/深色/lite ×（today/discover/messages/me/wallet/vip/settings/chat），另 360×800 与 412×915 的 today 帧。
- 生成条件：build:static + mock 登录（huanyu_token=tok.1）+ perf=high（lite 组除外）。

## manual-v7（曜光玻璃 Lumen Glass v1.0）
- S1–S6 迁移完成后的 390×844 浅/深基线（today / discover / messages / me / settings / wallet / vip / chat）。
- 生成条件同 v6：build:static + mock 登录（huanyu_token=tok.1）+ perf=high。

## manual-v8（Lumen UI kit 组件对齐）
- 依据 `docs/design/lumen-glass-ui-kit.html`（逐组件 × 逐状态基准）对齐后的重拍：
  AppButton 胶囊 999 / 600 字重 / 焦点环 3px act 55%、secondary=--lg-glass-2、
  danger 1.6px 珊瑚描边、分段胶囊槽 + 选中片、开关 51×31、输入焦点 1.6px act、
  设置行 56 / 会话行 72、气泡 20/20/20/6 + 锚角 6、toast 玻璃胶囊、grabber 38×5、
  Dock 创建钮 50 + act 35% 柔影、沉浸 CTA 白胶囊。
- 路由与生成条件同 v7。
