# docs/design · 设计权威索引

## 现行权威（一级四页 + 机身条）：「叠印」Overprint（overprint/）

阶段五换代（OV 系列）的设计交付包。与前几代不同，**叠印是局部换代**：它只接管
App 壳的一级四页（今日 / 发现 / 消息 / 我的）与机身条 Dock，其余约 40 条二级与
深层路由继续由「仪与匣」管辖。

叠印**扩展**而非替换 IX —— 圆角五档、间距六档、44/48 触控、Dock 高度、安全区
与全部语义色相一律 `var(--ix-*)` 继承，`overprint/design-tokens.css` 里不重定义
（app-test 断言 `--ov-*` 命名空间内不得出现几何或语义色）。这是刻意的：跨页跳转
会穿过材质接缝，让接缝只落在材质层而不落在几何层，两代才不割裂。

- `overprint/design-tokens.css` — `--ov-*` 令牌**冻结原件**（`:root` 作用域；浅/深/沉浸台/lite 四态）。运行时孪生 `client/src/styles/app-ov-tokens.css` 由 `scripts/sync-ov-tokens.mjs` 生成，只做 `:root` → `html[data-app="1"]` 改写，值逐字节相同，由 app-test 反向改写后断言相等。**不要手抄孪生。**
- `overprint/SPEC.md` — 设计权威 v1.0：世界观 / 与 IX 的边界 / 墨阶 / 零投影 / 表面极性 / 逐屏要点。
- `overprint/HANDOFF_README.md` — 实现纪律：硬约束 10 条、改动流程、不可改动的字面量清单、已知接缝。

叠印补的是 IX 缺失的四件事：**墨阶七档**（一种墨的密度阶梯，前三档才排字）、
**零投影**（边界靠发丝内描边与填充档差）、**媒体遮罩**（唯一允许的装饰性渐变）、
**表面极性**（`data-surface` 由路由声明，沉浸页恒为深台，机身条随之换极性、
图标以 100%/40% 两档不透明度表达激活态）。

运行时三层追加在 `app-ix-pages-d.css` 之后：`app-ov-tokens.css` → `app-ov-dock.css`
→ `app-ov-pages.css`（顺序由 app-test 锁死）。

## 深页权威：「仪与匣」The Field Instrument（field-instrument/）

阶段四换代（IX 系列）的设计交付包，**替代**曜光玻璃 Lumen Glass 的视觉层；产品结构、路由、状态矩阵、Web 零差异边界全部继承。一级四页与机身条的视觉层已由「叠印」接管，其余全部路由仍以本包为权威。

- `field-instrument/design-tokens.css` — 全套 `--ix-*` 令牌**冻结原件**（`:root` 作用域；浅/深/lite/reduced-motion 四态齐全）。client 侧孪生 `client/src/styles/app-ix-tokens.css` 仅做选择器改写（`:root` → `html[data-app="1"]`），值逐字节相同，由 app-test 断言锁死。
- `field-instrument/SPEC.md` — 设计权威 v1.0：材质规则表 / 色彩 / 排版几何 / 组件契约 / 动效 / 无障碍 / 逐屏要点 / lg→ix 迁移对照。
- `field-instrument/HANDOFF_README.md` — 实现说明：硬约束 10 条、动效清单、逐屏要点、验收标准。
- `field-instrument/mockup.dc.html` — 38+ 帧 390×844 高保真屏 × 浅深（`data-screen-label` 检索帧；需同目录 `support.js`）。
- `field-instrument/ui-kit.dc.html` — 逐组件 × 逐状态浅深双列组件契约参照。
- `field-instrument/插画风格板.dc.html` — 内容插画「工作台上的小仪器」生产规范（补产场景照此执行）。
- `field-instrument/插画全集.dc.html` / `tokens-色板校样.dc.html` — 41 个 SVG 画册与色板对比度校样（验收比对）。
- `field-instrument/幻域改版·三方向提案.dc.html` — 三方向提案（选定方向三「仪与匣」）与设计意图。

插画/印章资产落位：`client/src/assets/illos/ix-illo-{scene}-{light|dark}.svg`、`ix-stamp-{tier}.svg`（透明底、零文字、浅深双线色 石墨 #2E3532 / 铝 #C9D2CE）。

实现纪律：货币图标本体（金币/钻石现有 icon）**原样保留不重绘**（用户特批 2026-07-26）；语义色相冻结；触控 ≥44 / 提交 ≥48；玻璃只在导航/临时层 + 表盖；动效一次即止；lite 特效归零。

## 上代归档：曜光玻璃 Lumen Glass（本目录根）

S1–S7 阶段的设计权威，视觉层被「仪与匣」替代后归档保留（S7 的产品结构与后端契约仍然有效）：

- `lumen-glass-tokens.css` — `--lg-*` 令牌冻结件（与 client 孪生，退役前 app-test 仍锁值等）
- `LUMEN_GLASS_SPEC.md` — 规范 + 50 屏逐屏实施表
- `lumen-glass-mockup.html` / `lumen-glass-ui-kit.html` — 50 屏视觉稿与组件库
- `LUMEN_S7_SPEC.md` / `lumen-s7-ui-kit.html` — S7「仪式与相伴」规格与组件家族（**产品契约仍现行**：周报/月历/分享卡/长按系统/本机数据键清单）
- `LUMEN_MIGRATION_PLAN.md` — S1–S6 迁移记录
- `CLAUDE_CODE_PROMPT.md` (archived implementation prompt)

## IX-6 / IX-7 completion

The production App is now frozen on the Field Instrument stack. See
`field-instrument/IX-6-7_STATUS.md` for the machine-readable completion
record, retired runtime layers, SVG media policy, and verification contract.
The Lumen documents listed above remain an archive only; they are not loaded
by the runtime.
