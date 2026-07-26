# 曜光玻璃 Lumen Glass · Web 层设计权威（WEB_LUMEN_SPEC）

状态：`v1.0 / Web 层设计权威 / 仅 Web 壳（html:not([data-app="1"])）`
对偶文档：`LUMEN_GLASS_SPEC.md`（App 壳权威，`html[data-app="1"]`）。材质哲学、色彩纪律、
排版字阶与动效因果全部继承该稿，本稿只写 Web 层**特有**的权威：文件分层、围栏契约、
桌面扩展、控件 dispatch 与验收闸。两稿冲突时，App 壳听 LUMEN_GLASS_SPEC，Web 壳听本稿。
守卫：`client/web-test.mjs`（`npm run test:web`，纯 Node 静态断言，CI 必跑）。

## 0. 一句话定义

同一套冻结的 Lumen 令牌，浇进两个互斥的壳：App 壳与 Web 壳在 DOM 上以 `data-app`
一刀两断，级联零交互；Web 壳在此之上长出桌面专属的第三维 —— 侧栏几何、hover 层、
键盘导航与宽屏布局（`--lgw-*` 扩展段）。

## 1. 权威层级与文件职责

### 1.1 权威链

```
docs/design/lumen-glass-tokens.css          冻结交接稿（字节权威，禁改）
  = client/src/styles/lumen-glass-tokens.css   仓库内同字节副本（App 壳直接消费，禁改）
        ↓ 值 1:1 手抄（核心段字符串相等，web-test §3 同步守卫）
client/src/styles/web-lumen-tokens.css      Web 权威副本：核心段 + Web 扩展段（--lgw-*）
        ↓
web-lumen-bridge.css                        旧 Web 变量家族 → --lg-* 整体重定向
        ↓
web-lumen-materials.css                     .lgw-* 材质组合类（玻璃/内容卡/实体/光晕）
        ↓
shell / controls / pages / states / misc    全站常载层（main.jsx 静态 import）
home / profile / discover / longtail        页面层（随页面 chunk 懒加载 / 长尾统一接线）
```

为什么 Web 侧要另立 `web-lumen-tokens.css` 而不是直接消费冻结文件：冻结文件是
`:root` 作用域、与交接包字节相同、禁止修改；Web 围栏与扩展段都必须写在带
`html:not([data-app="1"])` 前缀的新文件里。**核心段**（canvas/ink/act/glass/blur
的浅深两套）由 web-test §3 与冻结稿逐字符比对，防漂移；**扩展段**（`--lgw-*`）是
Web 自己的权威，允许独立演进，App 令牌无对应物。

### 1.2 十二个文件的职责分层

| 文件 | 前缀/范围 | 职责 | 加载方式 |
|---|---|---|---|
| web-lumen-tokens.css | `--lg-*` 核心段 + `--lgw-*` 扩展段 | 令牌与全部变体块（深色/accent/lite/glass-off/reduced-motion） | main.jsx 静态（第 1 位） |
| web-lumen-bridge.css | 旧变量 ~30 个 | `--bg/--text/--muted/--accent/--gold/--diamond/--ok/--danger…` 钉到 `--lg-*`；body 光晕接管；选区/滚动条覆写 | main.jsx 静态（第 2 位） |
| web-lumen-materials.css | `.lgw-glass-* / .lgw-card / .lgw-entity / .lgw-ambient* / .lgw-seg-sel / .lgw-hoverable` | 材质组合类的唯一定义处 | main.jsx 静态（第 3 位） |
| web-lumen-shell.css | 常驻 chrome | 侧栏四态（expanded/collapsed/hidden/peek）+ 左缘唤出把手、移动顶栏 `.mobile-topbar`、抽屉 `.mnav-*`、底部 dock `.bottom-nav`+`.bn-ink`、命令面板 `.cmdk-*`、Modal/Toast/骨架、滚动进度条、to-top、路由过渡 | main.jsx 静态 |
| web-lumen-controls.css | `.lgw-button / .lgw-icon-button / .lgw-tab-button / .lgw-spinner / .lgw-tone--*` | 控件契约的唯一视觉权威（§5） | main.jsx 静态 |
| web-lumen-pages.css | 存量类逐页覆盖 | 主干页重皮：Auth/Settings/Wallet/Vip/Chat/Messages/Notifications/Friends/Groups/Library/Community/Scripts/Search/Favorites/Leaderboard/Events/Gacha/Achievements/Theater 等，CSS-only | main.jsx 静态 |
| web-lumen-states.css | `.lgw-empty / .lgw-error / .lgw-skel-*` | 三态（载入/空/错）系统化样式 | main.jsx 静态 |
| web-lumen-misc.css | `.lgw-offline / .lgw-cv-call` | 杂项体验：Web 离线条、角色页语音通话按钮补强 | main.jsx 静态 |
| web-lumen-home.css | `.lgwh-*` | WebHome 合体首页（今日仪表盘 × 浏览目录） | WebHome.jsx import（随 chunk） |
| web-lumen-profile.css | `.pfw-*` | Profile 的 Web 分支 + components/profile 四模块 Web 形态 | Profile.jsx import（随 chunk） |
| web-lumen-discover.css | `.lgwd-*` | 沉浸发现流的 Web 形态（桌面舞台 + 右侧信息板 + 历史 sheet） | DiscoverFeed.jsx import（随 chunk） |
| web-lumen-longtail.css | 长尾存量类 | Admin/Insights/Draw/Publish/Tags/Announcements/Parliament 外围 chrome/PublicShell/Gacha·Achievements 缺口 | main.jsx 统一接线 |

加载纪律（web-test §14 断言）：main.jsx **禁止**静态 import 任何 `app-*.css`；
基建三件套必须按 tokens → bridge → materials 顺序加载。其余文件规则全靠围栏特异性
取胜，不依赖精确 import 顺序。

### 1.3 命名规范

- `.lgw-*`：Web 层通用类（控件/材质/状态/杂项）。**不是** `.lg-*` —— app-test 断言
  `.lg-*` 不得逃出 App 围栏，两壳类名分家让 grep 一眼分清归属。
- 页面前缀惯例：`.lgwh-*`（WebHome）、`.pfw-*`（Profile Web）、`.lgwd-*`（Discover Web）。
  新页面层文件应延续「短前缀 + 语义段」的做法，避免与存量类撞名。
- `--lg-*`：冻结核心令牌；`--lgw-*`：Web 扩展令牌（仅 tokens 文件可定义，web-test §2
  断言所有 `var(--lg*)` 引用都能在 web-lumen-tokens.css 内解析）。
- `@keyframes` 一律 `lgw` 前缀（大小写不限），且与 base.css / web-modules.css /
  web-super.css / perf-atelier.css 的存量 keyframes 名零交集（web-test §7）。

## 2. 围栏契约

### 2.1 互斥级联

每一条 Web 层选择器都从 `html:not([data-app="1"])` 开始；App 层则全部从
`html[data-app="1"]` 开始（app-test 守卫反向围栏）。`appmode.js` boot 时把
`data-app` 钉为 `'1'` 或 `'0'`，两个围栏在任何 DOM 上**恰好一真一假** ——
这就是「双壳零波及」的全部机制：不靠 import 顺序、不靠构建分包，纯级联互斥。

围栏本身贡献 (0,1,1) 特异性（1 属性 + 1 元素；`:not()` 计内部最高者），天然压过
存量 `:root` (0,1,0) 与散落的 `[data-theme="dark"]` (0,1,0) 补丁；加一个类即
(0,2,1)，压过 `.btn.primary` (0,2,0)。所以 Web 层不删旧文件、不写深色专块，
深浅两态一律靠 `--lg-*` 令牌在变体块里翻转。

### 2.2 为什么不能挂 `:root`

若 Web 令牌写在 `:root[data-theme="dark"][data-accent="teal"]` 这类选择器上，
特异性 (0,3,0) 会压过 App 基块的 (0,1,1)。而 App 端 rose/clay **刻意无 accent 块**
（回落 iris 基线）—— Web 若在 `:root` 为这些组合定义 `--lg-act`，会直接篡改
App 壳的主动作色。围栏写成 `html:not(...)` 后该组合在 App DOM 上恒为假，隐患归零。

### 2.3 rose / clay 无块契约

强调色 id 集合来自 `accent.js`（clay/dusk/teal/forest/rose/amber，Web 共享契约不可改）：

- `clay` 是基线：`applyAccent` 对 clay **删除** `data-accent` 属性，令牌回落 iris。
  为 clay 写块 = 永远不命中的死代码，还会掩盖漂移 —— web-test §4 断言 tokens 文件
  内不得出现 `data-accent="clay"`。
- `rose` 是内容语义（喜欢/收藏），不作主动作色，同样无块回落 iris。
- `teal/dusk/forest/amber` 四色有块，且浅色块值必须与 `app-lumen-materials.css`
  的 App 别名块**逐字符相同**（web-test §4 奇偶校验）。

### 2.4 变体块契约（web-test §5）

- `[data-theme="dark"]` 必须翻转 `color-scheme: dark`；
- `[data-perf="lite"]` 与 `[data-glass="off"]` 都必须把 `--lg-blur` 置 `none`；
- `prefers-reduced-motion` 必须把六个 `--lg-dur-*` 时长令牌全部清零
  （动画自然瞬时完成，无需逐条写 reduced-motion 覆盖）。

## 3. 材质纪律

### 3.1 玻璃只属于 chrome

真实 `backdrop-filter` 是 GPU 每帧全价的实时模糊，**只允许**出现在 chrome 与浮层。
web-test §9 对全部 web-lumen 文件跑允许名单断言（选择器须命中）：

```
sidebar | sb-peek | mobile-topbar | mnav | bottom-nav | cmdk | modal | welcome-pop
| glass-chrome | glass-2 | glass-3 | chat-input | composer | sheet | backdrop
| island | drawer | fd2-hist | lgwd-(panel|hist) | lgw-discover
```

并且全仓 Web 层真实 blur 规则总数有上限（当前 ≤48）。想给内容卡「玻璃观感」
一律走 3.2 的配方，不是加 blur。材质类里只有 `.lgw-glass-2 / .lgw-glass-3 /
.lgw-glass-chrome` 携带 blur；`.lgw-glass-1` 是**无 blur** 的 L1（保留给 Modal
内部分组这类本就在浮层里的场景）。

### 3.2 `.lgw-card` 内容卡配方

in-flow 内容卡背后只有静态光晕，blur 是视觉无操作但代价全价（app-renov 已验证的
教训，`7ad72a6` 幽灵卡修复的根源）。标准配方：

```css
background: color-mix(in srgb, var(--panel) 86%, transparent);
box-shadow: var(--lg-glass-shadow-1);   /* 发丝边 + 内高光 + 短阴影三件套 */
border-radius: var(--lg-r-card);
```

硬规则同 App：同一对象只允许一层玻璃 + 一层发丝边 + 一道内高光（三者全封装在
shadow 令牌里，因此材质类一律不写 border）。沉浸页（discover）控件走白系玻璃
`rgb(255 255 255 / 10–14%)`，靠卡面压暗遮罩保正文对比。

### 3.3 回落语义（三个开关，三种含义）

| 开关 | 触发 | 行为 |
|---|---|---|
| `data-perf="lite"` | perf.js（用户手选 / LoAF 连续掉帧自动降级 / saveData） | blur 全 none、玻璃回落 `--lg-grouped` 不透明分组底、**光晕全关**；层级/对比度/语义不变 |
| `data-glass="off"` | 用户外观设置 | 只关模糊与玻璃透明度（同样回落 grouped），**光晕保留** —— 是外观偏好，不是性能档 |
| `prefers-reduced-motion` | 系统偏好 | 六个时长令牌清零；无限循环仅剩最简形态的骨架 shimmer / loading 旋转 |

`--lgw-chrome-blur` 在 lite 与 glass-off 下均置 none。三个开关全部走令牌变体，
业务 CSS 不需要（也不应该）自己写 `[data-perf="lite"]` 专块。

### 3.4 颜色与动效红线

- 颜色零新字面量：只允许 `var(--lg-*)`（含桥接家族）、
  `color-mix(令牌, #fff/#000/transparent)`、白系玻璃 `rgb(255 255 255 / x%)`、
  黑系遮罩 `rgb(0 0 0 / x%)`。实底语义色上的墨色统一用 `var(--lg-canvas)`
  （浅色主题近白、深色主题近黑，对比度两头成立且零新字面量）。
- 无限循环动画只允许 loading/骨架（web-test §8 允许名单
  `spin|shimmer|skel|loading|pulse-dot`）；装饰性循环零容忍。
- `qa-*` 类是 App 壳资产，Web 层任何文件不得为其写样式
  （web-test §10；唯一豁免是 controls 文件内的画廊脚手架）。

## 4. 桌面扩展（Web 独有的第三维）

### 4.1 `--lgw-*` 扩展令牌

| 令牌 | 值 | 用途 |
|---|---|---|
| `--lgw-sidebar-w` / `-collapsed` | 248px / 76px | 侧栏展开/图标栏两档宽（对应 Layout.jsx 状态机） |
| `--lgw-content-max` | 1240px | 内容列最大宽 |
| `--lgw-hover-lift` / `--lgw-hover-raise` | 阴影对 / translateY(-2px) | 桌面 hover 升起（深色块有独立阴影值） |
| `--lgw-chrome-blur` | blur(18px) saturate(160%) | 顶栏/底栏等窄条 chrome 的薄玻璃，比 `--lg-blur` 便宜 |

### 4.2 断点

- **860px**：移动/桌面 chrome 分水岭（base.css 的存量契约，Web 层沿用不另立）——
  ≤860px 侧栏让位给移动顶栏 + 底部 dock + 抽屉，侧栏左缘唤出把手也在此隐藏。
- **1024px**：宽屏内容布局 —— WebHome 升双栏（主列 + 320px 右栏）、discover
  桌面舞台展开右侧信息板（`--lgwd-rail`，<1024px 为 0）。

### 4.3 hover 层

移动规范没有 hover 层；Web 的 hover 样式一律包在
`@media (hover: hover) and (pointer: fine)` 内（`.lgw-hoverable` 是标准入口），
触屏设备零表演。

### 4.4 键盘导航

沉浸发现流（DiscoverFeed Web 形态）是键盘一等公民：`j / k` 或 `↓ / ↑` 翻卡
（reduced-motion 下瞬时滚动）、`Enter` 直接开聊、`Escape` 关历史 sheet；
输入框/对话框内按键不劫持；容器暴露 `role="feed"` 语义。
全站 `:focus-visible` 统一 `--lg-focus` 外环（深色画面上叠白系光晕）。

## 5. 控件契约（.lgw-button 三态 dispatch）

`components/AppControls.jsx` 的 AppButton / AppIconButton / AppTabButton 按
运行壳三路分发：

| 条件 | 渲染 | 说明 |
|---|---|---|
| `data-app="1"` | `qa-*` 控件 | App 壳，原样不动 |
| `data-app≠"1"` 且 `data-lumen-web="1"` | `.lgw-*` 真实控件 | 真 ARIA / loading / selected / pressed；保留调用方 className 作兜底 |
| 两者皆否 | LegacyControl 透明穿透 | 逃生阀 |

- **逃生阀**：`appmode.js` 在 Web 壳 boot 时打 `document.documentElement.dataset.lumenWeb = '1'`
  —— 删掉这一行，全站 Web 控件即整体回落 Legacy 形态，独立于 `data-app`，零其他改动。
- **词汇**：`.lgw-button--{primary|secondary|tertiary|danger}` × `--{sm|md|lg}`；
  `.lgw-icon-button--{ghost|secondary|filled}`；`.lgw-tab-button`；`.lgw-spinner`
  （Web 控件层唯一循环动画，reduced-motion 下降级静态三点）；语义染色走
  `.lgw-tone--{gold|dia|coral|jade|azure|violet|rose|danger}`。
- **泄漏中和**：调用方保留了旧类（`btn primary sm` 等），存量 `.btn` 家族会漏进
  同一元素，因此 `.lgw-*` 基块把全部视觉属性写满，靠围栏特异性 (0,2,1) 压过
  (0,2,0)；更高特异性的存量组合逐一点名中和。`fx.js` 的涟漪对
  `.lgw-button, .lgw-icon-button, .lgw-tab-button` 显式跳过（控件自带按压反馈）。
- **e2e 闸**：Web 零差异闸允许状态属性（loading/selected 等）**只**出现在
  `.lgw-*` 控件上，`qa-*` 泄漏仍零容忍（server/quiet-aqua-e2e.mjs）。

## 6. 验收

### 6.1 `npm run test:web`（CI 必跑，纯 Node 静态守卫）

对偶于 app-test.mjs，读源码字符串断言不变量，当前 3700+ 条，14 个断言族：

1. 围栏完整性（逐字符扫描每条顶层选择器）；2. `var(--lg*)` 全部可解析；
3. 核心令牌与冻结稿逐字符同步；4. accent 奇偶校验（四色同值 + rose/clay 无块）；
5. 深色/lite/glass-off/reduced-motion 变体契约；6. 桥接映射 + 衬线不桥接
（Fraunces + Noto Serif SC 是 Web 独有优势）；7. keyframes lgw 前缀 + 零撞名；
8. 无限循环白名单；9. backdrop-filter 允许名单 + 总量上限；10. `qa-*` 零触碰；
11. 路由与壳结构（/discover / /today / /me / 首页分流、RouteErrorBoundary、
侧栏链接、theme-color）；12. 控件三态 dispatch + 涟漪豁免 + 逃生阀在位；
13. 首页/沉浸流/Profile 功能契约（签到 hook、role=feed、键盘、双壳共享模块）；
14. CSS 按模式分包 + 三件套顺序 + 性能自适应覆盖 Web。

### 6.2 截图基线（server/shots.mjs）

需要已 seed 的服务器跑在 :4000（`npm run seed && npm start`）：

```bash
node server/shots.mjs               # 截到 shots/（1440×900 桌面 24 张含深色抽样 + 390×844 移动 9 张）
node server/shots.mjs --baseline    # 截到 shots-baseline/ 作为对比基线
node server/shots.mjs --compare     # 重截并与基线 pixelmatch 逐像素对比，
                                    # 任一页面差异率 > 2%（threshold .12）即报错退出
```

改动前打 `--baseline`、改动后跑 `--compare` 是 Web 视觉改动的标准自查流。

### 6.3 CI 门

`.github/workflows/ci.yml`（Validate，PR 与 main / agent/** push 必跑）：
`npm run build` → `build:static` → 安全/支付/完整性/外链回归 → `test:app` →
`test:web`。任何一环红即挡合入。`npm run test:app:e2e`（本地跑，需构建产物）
额外覆盖 Web 零差异闸与 lite 档 backdrop 断言。

## 7. 红线（继承 App 稿，Web 措辞）

改 `--lg-*` 核心值 / 私增颜色字面量；给内容卡加 blur / 玻璃叠玻璃 / 装饰循环动画；
新选择器不带围栏 / 为 `qa-*` 写样式 / keyframes 不带 lgw 前缀；
波及 App 壳 DOM 或样式（共享渲染路径必须 `app ? 旧 : 新` 门控）；
不带 test:web + 截图对比结果宣布完成。
