# 曜光玻璃 Lumen Glass v1.0 — 迁移执行计划（已确认）

状态：`已确认执行 / 分支 claude/app-frontend-deai-redesign-nx43s3`
权威顺序：`LUMEN_GLASS_SPEC.md` → `lumen-glass-tokens.css`（禁改值）→ `APP_UI_ORACLE.md`（结构/路由/状态矩阵/Web 零差异部分）。
对照帧：`lumen-glass-mockup.html` s01–s50（已渲染验证齐全）。

## 已拍板决策（用户确认走默认）

1. **balanced 档**：完整 Lumen 玻璃（含 L1 内容玻璃），靠 perf.js 现有 LoAF 自适应降级兜底；lite 档按令牌零 blur 零光晕。
2. **强调色 id 映射**（App 围栏别名，值原样引用 Lumen 定义、不新增颜色）：
   `unset(=clay 基线)→iris` · `dusk→violet` · `teal→azure` · `forest→jade` · `amber→clay` · `rose→iris`；
   同时 accent.js 的 **App 默认 id 由 teal 改为 clay（即 unset→iris）**，兑现 Lumen「默认 iris」；Web 默认与行为不变。
3. **PR 形态**：本分支 6 阶段 commit（每阶段独立可验收，可随时 cherry-pick 拆 PR）。

## 继承资产（琉璃阶段成果，全部保留）

去 AI 清残与 app-test.mjs 守卫（infinite 白名单/彩虹/渐变字禁令）、暗色跟随系统、
PNG 素材管线（scripts/render-app-assets.mjs）、Web 零差异像素闸方法、e2e 硬件伪装修复、
输入岛单层玻璃结构（S2 换 L3 材质）。

## 六阶段

### S1 令牌与材质基建
- `lumen-glass-tokens.css` **原样**放入 `client/src/styles/`（一字不改）
- 新建 `client/src/styles/app-lumen-materials.css`（全围栏）：
  `.lg-glass-1/2/3`、`.lg-ambient(-warm/-cool/-rose)`、`.lg-entity`、分段选中片、
  强调色 id 别名块（决策 2 的映射，浅/深两套，值逐字复制自令牌文件）
- `app-quiet-aqua-tokens.css` 改为 **`--qa-*`→`var(--lg-*)` 别名 shim**（S6 退役）：
  canvas/grouped/ink 系→lg 基面；action/brand/focus→lg-act 系；语义色→lg 语义
  （gold/coral/azure/violet/rose/finance）；玻璃族→lg 玻璃族；
  `--qa-control-min:44px`、`--qa-control-submit:48px` 保持字面（测试契约）；
  surface 在 S1 暂映射不透明面（材质逐屏迁移在 S2–S6 做，避免一次性大爆炸）
- `accent.js` App 默认 id：teal→clay（仅 isAppMode 分支）
- `main.jsx` 导入顺序：lumen tokens 在 qa-shim 之前、materials 在 hig 之后（末位权威）
- `app-test.mjs` lockstep：导入顺序链、玻璃断言改指向 lumen 令牌、qa-shim 完整性检查保持

### S2 控件与系统层（SPEC §4；验收 /app-controls?app=1）
AppButton 四态（primary=act 实底胶囊/secondary=L1/tertiary=文字/danger=珊瑚描边→实底）、
AppIconButton、分段控件（L1 槽 + --lg-glass-sel 滑片）、Dock（L3 圆角 26 悬浮条 +
act 实底圆形创建钮 + 珊瑚未读点）、输入岛换 L3、Sheet/Modal（L2 + grabber + 380ms 升起）。

### S3 一级四页 + 创建 Sheet（对照 s01–s05）
环境光晕入 App 壳（页面语义选色：默认 iris、钱包/SVIP/活动 warm、消息/世界书 cool、
剧场/绘图 rose）；今日/发现/消息/我的逐屏换装；未读三重编码；石墨资产仪表。

### S4 沉浸与会话（s06–s12）
角色详情共享媒体转场、私聊玻璃气泡、通话 46px 深模糊、群聊冷白面、
剧场纸墨阅读流（衬线 16–18/1.95–2.05，独立文件避开 hig 禁衬线守卫）、小说阅读器。

### S5 身份/价值/创作（s20–s34）
钱包/充值/SVIP/主页/成就/洞察/排行/三编辑器/书架/工作台/市集/绘图/发布。

### S6 长尾与状态 + 别名退役（s13–s19、s35–s50）
其余页面；骨架/空态/错误/危险确认全局审计（s47–s49 为标准样）；
`var(--qa-*)`→`--lg-*` 全量迁移与 shim 删除**顺延为独立后续 PR**（零视觉影响的纯重构，
约 1700+ 引用点，且 --qa-surface 等复合值需先完成内容面玻璃化语义迁移；本轮 shim 即映射表）；manual-v7 基线；
ORACLE 标注 Lumen 为视觉权威；原生启动色对齐 `--lg-canvas`。

## 每阶段验收

`npm run build` + `build:static` + `test:app` + `test:app:e2e` 全过；
390×844 浅/深截图对照 mockup 对应帧（构图/层级/材质/语义色）；
lite 档无任何 backdrop-filter；Web 零差异闸（与 main 双构建像素对比）。

## 红线（交接包原文，不放松）

改 --lg-* 值 / 私增颜色；玻璃叠玻璃 / 外发光 / 呼吸光 / 循环扫光；
动 Web 视觉与行为；动业务数据/权限/协议；设计稿图作运行时资源；
一次性重写多页的大改；不带验收结果宣布完成。

## Web 移植（web: W1–W7）

App 壳六阶段落地后，同一套冻结令牌向 Web 壳整体移植（围栏
`html:not([data-app="1"])`，与 App 围栏 DOM 互斥）。「动 Web 视觉」红线自此
按新权威解除 —— Web 层权威文档：`WEB_LUMEN_SPEC.md`；守卫：`npm run test:web`。
阶段 ↔ commit 对应：

| 阶段 | 内容 | commit |
|---|---|---|
| W1 | 基建三件套：web-lumen-tokens / bridge / materials | `7eac5d8` |
| W3a | 路由分流：/discover Web 沉浸流、/today /me 重定向、每路由错误边界 | `3dcbe12` |
| W2 | 壳 chrome：侧栏四态 / 移动顶栏与抽屉 / 底部 dock / 命令面板 / Modal / Toast | `1bccfb4` |
| W3 | 功能对齐：WebHome 仪表盘、Profile 双壳合并（components/profile 共享模块）、桌面沉浸流 | `2ff2739` |
| — | 补丁：data-glass 内容卡重定价，消灭幽灵卡失效模式 | `7ad72a6` |
| W6 | 每壳 CSS 分包（main.jsx 不再静态引 app-*.css）+ 自适应性能降级覆盖 Web | `92a0757` |
| W7 | web-test.mjs 静态守卫 + server/shots.mjs 截图基线工具 + CI 门（test:web 入 Validate） | `5d8b8fb` |
| W4 | 控件契约 dispatch：AppControls 三态分发 + data-lumen-web 逃生阀 | `edd4a34` |
| W4+W5 | .lgw-* 控件视觉、存量页面重皮（pages）、深色归一、三态系统（states） | `d01fc2a` |
| — | e2e Web 零差异闸对 W4 控件契约开闸（状态属性只认 .lgw-*） | `9a85fe3` |

执行顺序刻意与编号不同：W3a（路由）先于 W2 落地，让壳 chrome 直接对着最终路由表
开发；W6/W7（分包与守卫）提前到 W4/W5 之前，控件与重皮阶段全程在守卫下推进。
收尾批（本节写作时点未入 commit）：states/misc/longtail 三个补充样式层、
长尾页 JSX 挂类（Achievements/Announcements/Atelier/Draw/Gacha/Insights/
Publish/Tags）、README 对齐与 WEB_LUMEN_SPEC.md 本身。
