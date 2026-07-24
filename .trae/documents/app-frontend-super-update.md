# APP 前端超级更新 · 视觉精修 v2

> 主题：**幻域 APP · 沉浸质感进化** —— 把 APP 壳的每一个像素摁到一线水准。
>
> 边界：所有新增样式严格作用域 `html[data-app="1"]`，Web 端零变化；新增组件默认服务 APP，但写成可复用形态（Web 端暂不接入也不受影响）。
>
> 规模预估：约 **1250–1400 行**净新增代码（CSS ~700 行 + JSX ~450 行 + 新组件 ~150 行）。

---

## 一、Current State Analysis（现状基线）

### 已有架构（探索结论）
- **壳层分流**：`App.jsx` 的 `Protected` 在渲染期按 `isAppMode()` 选 `AppLayout`（APP 壳）或 `Layout`（Web 壳），两套 chrome 永不混用。
- **APP 五个一级 tab**：`/today`（AppHome）· `/`（DiscoverFeed）· `[+AI]`（CreateSheet）· `/messages`（Messages）· `/me`（AppProfile）。
- **样式分层与级联顺序**（关键，决定新层应插在哪里）：
  - `client/src/styles.css` 末尾按序 `@import`：`base → web-modules → web-super → perf-atelier → app-shell → app-elevated → app-renov → app-motion`。
  - `client/src/main.jsx` 在 `styles.css` 之后另 `import './chat/chat-app.css'`，最后 `import './styles/app-runtime.css'`（注释明确写 "Must remain last"）。
  - **结论**：`app-runtime.css` 是当前真正的级联最后一层。新增「超级更新」视觉层必须 `import` 在它**之后**，否则会被它覆盖。
- **已有视觉基础设施**（避免重复造轮子）：
  - 玻璃系统：`--hy-glass-bg / --hy-glass-b / --hy-hairline`（app-elevated.css）。
  - 深度阴影：`--app-depth-shadow / --app-depth-shadow-raised / --app-surface`（app-runtime.css）。
  - 动效 tokens：`--dur-fast/base/slow`、`--hy-ease / --hy-spring`（app-motion.css）。
  - 工具类：`.stagger-in`、`.pressable`、`.flow-sheen`、`.skel`（app-motion.css）。
  - 性能挡位：`[data-perf="lite"|"balanced"]` 与 `prefers-reduced-motion` 已有完整门控惯例。
- **页面级 JSX 现状**：AppHome / DiscoverFeed / Messages / AppProfile 均为函数组件，类名驱动样式，已有 skeleton / empty state / SSE 实时刷新等基础。视觉上整体偏「功能毛坯」，离一线内容 App 还有可量化的精修空间。

### 可复用但暂不接入 Web 的边界落实方式
- 新组件文件放在 `client/src/components/`，导出普通 React 组件（无 `isAppMode` 硬判断）。
- 仅在 APP 壳的页面（AppHome / DiscoverFeed / Messages / AppProfile / AppLayout）里 `import` 它们 —— Web 路由分支（`Layout` 下的页面）不引入，故 Web bundle 不加载。
- 组件根类名统一加 `appv2-` 前缀，CSS 选择器统一 `html[data-app="1"] .appv2-...` 双重门控，物理上不可能 leak 到 Web。

---

## 二、Proposed Changes（变更清单）

### Phase A · 新增「超级更新」视觉层 CSS（最大头，~450 行）

**新文件**：`client/src/styles/app-visual-v2.css`

级联位置：在 `main.jsx` 中 `import './styles/app-runtime.css'` **之后**追加 `import './styles/app-visual-v2.css'`，使其成为新的最后一层。

内容分块：
1. **玻璃系统 v2**（~80 行）
   - `--appv2-glass-1/2/3`：三档玻璃（浮层 / 卡片 / 内嵌），每档定义 `background` + `backdrop-filter` + 内高光 `box-shadow inset` + 边缘 1px 发丝。
   - `.appv2-glass` / `.appv2-glass-raised` / `.appv2-glass-inset` 工具类。
   - `[data-perf="balanced"|"lite"]` 退化：`backdrop-filter:none` + 实底降级色。
2. **环境光氛围**（~70 行）
   - `.appv2-ambient`：内容驱动的环境光晕（用 `radial-gradient` + `::before` 叠加），用于 hero 卡 / VIP 横幅。
   - `.appv2-ambient-warm` / `-cool` / `-dusk` 三色温变体。
   - `prefers-reduced-motion` 与 `lite` 档关闭呼吸动画。
3. **卡片系统 v2**（~90 行）
   - `.appv2-card`：圆角 22px + 双层阴影（近场 + 远场）+ 顶边 1px 高光。
   - `.appv2-card-interactive`：`:active` 缩放 0.975 + 阴影收紧（即时反馈）。
   - `.appv2-card-glass`：玻璃卡变体（结合 `.appv2-glass`）。
   - 覆盖现有 `.ah-pick` / `.msgs-conv` / `.pf-cc` / `.ah-resume` 的卡片底，统一到 v2 语言。
4. **顶栏 / 分段 / 列表行精修**（~80 行）
   - `.appv2-pill-tabs`：胶囊分段，活跃态加内高光 + 微阴影，非活跃态去灰。
   - `.appv2-list-row`：统一列表行（圆角 18 + 左色条 + 右箭头微旋转）。
   - 覆盖 `.msgs-tabs` / `.feed-modes` / `.pf-quick` 的活跃态。
5. **微交互与动效**（~80 行）
   - `.appv2-magnetic`：按钮按下时 `translate` 跟手偏移（CSS-only，用 `:active` 模拟）。
   - `.appv2-reveal`：滚动入场（`@keyframes appv2Reveal`，opacity + translateY 12px + 微缩放 0.98）。
   - `.appv2-shimmer-v2`：多阶段骨架（亮带 + 暗带交替，比现有 `.skel` 更立体）。
   - `.appv2-tap-burst`：点按涟漪 v2（径向扩散 + 淡出，0.4s）。
6. **排版精修**（~50 行）
   - `.appv2-display`：大标题（`--serif` + 字重 800 + 字间距 -0.01em + 文字阴影）。
   - `.appv2-eyebrow`：小标眉（大写字间距 0.08em + 弱化色）。
   - `.appv2-num`：数字字体（tabular-nums + 字重 700）。
   - 覆盖 `.ah-name` / `.fd2-name` / `.pf-id b` / `.ah-coin b`。

**变更文件**：`client/src/main.jsx`（+1 行 import，紧跟 `app-runtime.css` 之后）。

---

### Phase B · 新增可复用视觉组件（~150 行）

**新文件**：`client/src/components/AppVisual.jsx`

聚合导出 4 个可复用组件（单文件降低 import 散落），均带 `appv2-` 前缀类名：

1. **`<GlassPanel variant="raised|inset" ambient="warm|cool|dusk" />`**（~40 行）
   - 通用玻璃面板容器，组合 `appv2-glass-*` + `appv2-ambient-*`。
   - 接收 `as` prop 渲染为 `div / section / button`。
2. **`<RevealGroup stagger delay=0>`**（~35 行）
   - 包裹一组子元素，挂 `.appv2-reveal` 并按 `stagger` 步进写入 `--i` CSS 变量驱动 `animation-delay`。
   - 用 `IntersectionObserver` 一次性触发（滚出再回不重放）。
3. **`<ShimmerCard variant="card|row|hero" />`**（~30 行）
   - 多阶段骨架占位，复用 `.appv2-shimmer-v2`。
   - 替代现有 `.ah-hero-skel` / `.ah-pick-skel` / `.msgs-skel-row` 的零散实现。
4. **`<PillTabs tabs=[{key,label,badge?}] value onChange />`**（~45 行）
   - 胶囊分段控件，复用 `.appv2-pill-tabs`。
   - 替代 `.feed-modes` / `.msgs-tabs` / `.pf-tabs` 三处各自实现。

---

### Phase C · AppLayout chrome 视觉精修（~120 行）

**变更文件**：`client/src/components/AppLayout.jsx`（+~40 行 JSX）

- 启动闪屏 `.app-boot`：增加品牌光晕呼吸 + 星尘飘移轨迹（追加 2 个 `.app-boot-star` + 调整关键帧）。
- 底栏 `.app-tabbar`：FAB `+AI` 增加按需发光（活跃 tab 切换时短暂高亮一次）。
- PTR 指示器：增加双层圆环（外圈进度环 + 内圈旋转图标）。
- `offline` / `perfNote` 横幅：加左侧色条 + 关闭按钮触感。

**变更文件**：`client/src/styles/app-shell.css`（+~80 行 CSS，追加到末尾「v2 精修」段）

- `.app-boot` 系列关键帧扩展（星尘轨迹 / 光晕呼吸）。
- `.app-ptr` 双层圆环样式。
- `.app-offline` / `.app-perfnote` 色条 + 关闭按钮精修。
- 注意：不修改已有规则，只追加 v2 覆盖段（级联在 app-visual-v2.css 之前，故这里只做不依赖 v2 tokens 的增量）。

---

### Phase D · 五个 tab 页视觉精修（~450 行）

#### D1. AppHome.jsx（+~130 行）
**变更文件**：`client/src/pages/AppHome.jsx`

- 顶部 `.aht` 品牌行：用 `<PillTabs>` 风格重做品牌胶囊（保留品牌字 + 搜索 + 通知）。
- 问候卡 `.ah-hero`：加 `<GlassPanel ambient>` 包裹，天色渐变叠加环境光晕；天体 `.ah-celestial` 加柔光拖尾。
- 快捷磁贴 `.ah-shortcuts`：图标配 `.appv2-card-interactive`，按下缩放 + 阴影变化。
- 今日精选 `.ah-hero-card`：加 `.appv2-ambient-warm`，CTA 按钮换 `.appv2-magnetic`。
- 继续故事 `.ah-rail` / `.ah-resume`：用 `<RevealGroup stagger>` 包裹，逐张浮入。
- 任务 `.ah-tasks`：进度条加流光 `.flow-sheen`，完成态加对勾弹跳。
- 为你挑选 `.ah-picks`：卡片换 `.appv2-card`，骨架换 `<ShimmerCard>`。
- 区块标题统一 `<SectionHeader>` 风格（图标 + 大标题 + 「更多」胶囊）。

#### D2. DiscoverFeed.jsx（+~110 行）
**变更文件**：`client/src/pages/DiscoverFeed.jsx`

- 顶部分段 `.feed-modes`：换 `<PillTabs>`，活跃态加内高光。
- 角色卡 `.feed-card`：scrim 渐变精修（顶部加柔光带，底部加深）。
- 互动条 `.fd2-acts`：玻璃圆钮加 `.appv2-glass-inset`，按下涟漪。
- 介绍卡 `.fd2-intro`：换 `.appv2-glass`，展开时加高度过渡。
- 开场白 `.fd2-greet`：加纸张纹理（内联 SVG noise）+ 边角折痕细节。
- 名字行 `.fd2-name`：换 `.appv2-display`。
- 双击爱心 `.feed-heart`：粒子尾迹（追加 3 个小粒子 span）。
- 历史 sheet `.fd2-hist-row`：换 `.appv2-list-row`。

#### D3. Messages.jsx（+~90 行）
**变更文件**：`client/src/pages/Messages.jsx`

- 顶部分段 `.msgs-tabs`：换 `<PillTabs>`，带未读数 badge。
- 聚合入口 `.msgs-entry`：换 `.appv2-list-row`，左侧色条按类型分色（noti/dm/grp）。
- 会话行 `.msgs-conv`：换 `.appv2-card-interactive`，头像加在线点（如有 `cv.online`），未读加左侧色条。
- 骨架 `.msgs-skel-row`：换 `<ShimmerCard variant="row">`。
- 空态 `.msgs-empty`：加环境光 `.appv2-ambient-cool`。

#### D4. AppProfile.jsx（+~120 行）
**变更文件**：`client/src/pages/AppProfile.jsx`

- 顶部图标行 `.pf-top`：按钮加 `.appv2-magnetic`，搜索图标按下涟漪。
- 资料头 `.pf-id`：头像加柔光环 + 等级徽章微动；UID 胶囊换玻璃风。
- 统计 `.pf-stats`：数字换 `.appv2-num`，按下卡片缩放。
- VIP 横幅 `.pf-vip`：加 `.appv2-ambient-warm` + 流光 `.flow-sheen`，SVIP 加金粉飘落（2 个粒子 span）。
- 资产卡 `.pf-assets`：余额数字换 `.appv2-num`，加 `.appv2-shimmer-v2` 占位（加载中）。
- 快捷条 `.pf-quick`：磁贴换 `.appv2-card-interactive`。
- 内容 Tab `.pf-tabs`：换 `<PillTabs>`。
- 内容卡 `.pf-cc`：换 `.appv2-card`，骨架换 `<ShimmerCard>`。
- 功能宫格 `.pf-cell`：按下涟漪 + 图标微弹。

---

### Phase E · 接线与收尾（~30 行）

**变更文件**：
- `client/src/main.jsx`：+1 行 `import './styles/app-visual-v2.css'`（紧跟 `app-runtime.css`）。
- `client/src/components/AppLayout.jsx`：在 `<CommandPalette />` 后挂一个全局 `<RevealGroup>` 不需要 —— RevealGroup 在各页面局部使用，不在壳层全局挂。
- 无需改 `styles.css`（新层走 main.jsx import，保持 app-runtime 「曾是最末层」的注释不变，仅在其后追加）。

---

## 三、Assumptions & Decisions（假设与决策）

1. **级联位置决策**：新层 `app-visual-v2.css` 必须在 `app-runtime.css` **之后** import，否则后者的 `!important` 退化规则会覆盖 v2 的玻璃/阴影。已确认 main.jsx 的 import 顺序是权威，styles.css 的 `@import` 链止于 app-motion.css。
2. **不重写已有 CSS 规则**：app-shell / app-elevated / app-renov / app-runtime 的现有规则保留不动，v2 一律以追加段 + 类名前缀 `.appv2-` 方式叠加，便于回滚与 review。
3. **性能挡位继承**：所有 v2 玻璃/动效必须写 `[data-perf="balanced"|"lite"]` 与 `prefers-reduced-motion` 的退化分支，与现有惯例一致（参考 app-runtime.css L80-98、app-motion.css 的写法）。
4. **组件复用边界**：`AppVisual.jsx` 导出的组件不内嵌 `isAppMode()` 判断 —— 它们是无状态纯视图组件，由调用方（APP 页面）决定是否使用。Web 端不 import 即不受影响。
5. **不改路由 / 不改后端 / 不改 Web 页面**：本次纯前端视觉精修，无新接口、无新路由、无 Web 端改动。
6. **图标库**：沿用 `lucide-react`（已是依赖），不引入新图标库。
7. **字体**：沿用 `--serif`（Fraunces / Noto Serif SC）与 Inter，不引入新字体。
8. **图片资源**：本次不新增 `<img>` 资源；氛围/纹理全部用 CSS 渐变 + 内联 SVG 实现，不增加打包体积。

---

## 四、Verification Steps（验证步骤）

1. **构建验证**：
   - `npm run build:static`（APP 使用的静态构建）成功，无 CSS/JS 报错。
   - 产物大小变化合理（CSS 增量 < 30KB gzip，JS 增量 < 8KB gzip）。
2. **Web 端零影响验证**：
   - `npm run dev:client` 后用 `?app=0` 访问，确认 Web 壳页面（Home / Profile / Chat 等）视觉无任何变化。
   - grep 确认 `appv2-` 类名只在 APP 页面 JSX 中出现，Web 页面未引入。
3. **APP 壳视觉验证**（`?app=1` 浏览器预览 + 真机 APK）：
   - 五个 tab 切换：玻璃 / 阴影 / 入场动效符合预期，无闪烁。
   - 深色 / 浅色主题切换：v2 玻璃与阴影在两套主题下均成立。
   - `[data-perf="lite"]` 与 `prefers-reduced-motion`：玻璃退化为实底、动效退化为立即就位。
4. **性能验证**：
   - Chrome DevTools Performance：五个 tab 首屏滚动 FPS ≥ 55（balanced 档 ≥ 50）。
   - 玻璃 backdrop-filter 不在长列表滚动容器上叠加（仅固定 chrome 与短卡片用）。
5. **回归验证**：
   - 现有 `.ah-` / `.fd2-` / `.msgs-` / `.pf-` 类名的原有视觉不被破坏（v2 是叠加增强，不是替换）。
   - 启动闪屏 / 底栏 / FAB / PTR / offline 横幅功能正常。
6. **测试脚本**：`npm run test:app`（client/app-test.mjs）通过。

---

## 五、文件清单（一图收尾）

| 类型 | 路径 | 变更 |
|---|---|---|
| 新建 | `client/src/styles/app-visual-v2.css` | +~450 行 |
| 新建 | `client/src/components/AppVisual.jsx` | +~150 行 |
| 修改 | `client/src/main.jsx` | +1 行 import |
| 修改 | `client/src/components/AppLayout.jsx` | +~40 行 |
| 修改 | `client/src/styles/app-shell.css` | +~80 行 |
| 修改 | `client/src/pages/AppHome.jsx` | +~130 行 |
| 修改 | `client/src/pages/DiscoverFeed.jsx` | +~110 行 |
| 修改 | `client/src/pages/Messages.jsx` | +~90 行 |
| 修改 | `client/src/pages/AppProfile.jsx` | +~120 行 |
| **合计** | | **~1170 行净新增**（含少量调整，预期落在 1250–1400 区间） |

Web 端文件（`Layout.jsx` / `Home.jsx` / `Profile.jsx` / `web-*.css` / `base.css` / `web-modules.css` / `web-super.css`）**完全不动**。
