# docs/design · 设计权威索引

## 现行权威：「仪与匣」The Field Instrument（field-instrument/）

阶段四换代（IX 系列）的设计交付包，**替代**曜光玻璃 Lumen Glass 的视觉层；产品结构、路由、状态矩阵、Web 零差异边界全部继承。

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
- `CLAUDE_CODE_PROMPT.md` — 当年的实施指令存档
