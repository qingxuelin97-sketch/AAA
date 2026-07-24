# APP 前端「超级更新」规划

> 作用域：仅 `html[data-app="1"]` 原生壳（AppLayout / AppHome / AppProfile / DiscoverFeed / app-*.css / chat-app.css / native.js / appgestures.js）。
> **完全不触碰 web 端**（Layout / Home.jsx / web 专属 CSS / web 路由行为）。
> 预估新增/修改代码量：**~1800 行**（JSX + JS + CSS），远超 1000 行门槛。

---

## 一、摘要

本次「超级更新」以**「原生质感跃迁 + 体验韧性」**为主题，对 APP 原生壳做六个相互呼应的改造包，使用户在「触感反馈、通知获取、首屏内容密度、发现流交互、网络韧性、组件一致性」六个维度同时感到跃迁。所有改动严格限定在 APP 作用域，web 端零影响。

**六个改造包：**

| 包 | 主题 | 新增/修改行数 | 关键产出 |
|---|---|---|---|
| A | APP 通用组件层（BottomSheet / EmptyState / Skeleton / ErrorState） | ~420 | 4 个可复用组件 + CreateSheet 重构 + 4 处页面接入 |
| B | 触觉反馈模式库 + Capacitor Haptics 集成 | ~230 | `haptics.js` 模式库 + native.js 集成 + 8 处接入 |
| C | 应用内通知抽屉 + 数字角标 | ~360 | `<NotificationDrawer>` + tab 数字角标 + 顶栏下拉手势 |
| D | AppHome 内容扩容 + 磁贴自定义 | ~430 | 3 段新内容（最近浏览/热门标签/好友在玩）+ 磁贴长按编辑 |
| E | DiscoverFeed 互动深化 | ~280 | 不感兴趣 × / 长按菜单 / 分类筛选抽屉 / 视频网络降级 |
| F | 网络韧性（重连 + 弱网降级 + 离线操作指示） | ~280 | SSE 指数退避 + 弱网降级 + 离线 toast + pending 消息标 |
| **合计** | | **~2000** | |

---

## 二、当前状态分析（基于 Phase 1 探索）

### 2.1 已成熟的能力（不动）
- **KeepAlive pane 缓存**：四路 SWIPE_TABS（今日/发现/消息/我的）LRU=2，`content-visibility:hidden` 隐藏非活跃 pane（[AppLayout.jsx](file:///workspace/client/src/components/AppLayout.jsx#L147-L160)）。
- **View Transitions API**：方向化 push/pop/left/right/refresh，180ms 熔断，冷 chunk 跳过 VT（[nav.js](file:///workspace/client/src/nav.js#L74-L97)）。
- **下拉刷新**：commit 驱动复位，最短 450ms 可见时间（[AppLayout.jsx:169-179](file:///workspace/client/src/components/AppLayout.jsx#L169-L179)）。
- **手势**：横滑切 tab（H_TRIG=56px）、左缘 swipe-back（24px 边缘带）、PTR 阈值 66px（[appgestures.js](file:///workspace/client/src/appgestures.js)）。
- **RouteErrorBoundary**：每路 tab pane 独立包裹，崩溃卡 `.route-crash`。
- **SSE 实时角标**：`notification` / `dm` 事件秒级更新未读红点（[AppLayout.jsx:260-261](file:///workspace/client/src/components/AppLayout.jsx#L260-L261)）。
- **Liquid Glass 设计体系**：app-elevated.css 1363 行 + app-renov.css 2226 行已落地。

### 2.2 关键缺口（本次更新目标）

| 缺口 | 证据 | 影响 |
|---|---|---|
| **无通用 BottomSheet 组件** | 仅 `CreateSheet` 专用；`.app-sheet` 类存在但无复用组件（[app-shell.css:217-224](file:///workspace/client/src/styles/app-shell.css#L217-L224)） | 各页重复造轮子，质感不一 |
| **空态直接隐藏** | AppHome 注释「`false/[] = loaded-empty → hidden`」；无插画化空态组件 | 用户不知「为什么没有内容」 |
| **业务错误全静默** | 所有 `api(...).catch(() => {})` 吞掉，无重试 UI | 用户无法感知/恢复错误 |
| **触觉仅 `tick(8)` 单次** | [appgestures.js:8](file:///workspace/client/src/appgestures.js#L8) `navigator.vibrate?.(ms)`；未接 Capacitor Haptics | iOS 无触觉，安卓无层级 |
| **角标仅红点无数字** | [AppLayout.jsx:381-383](file:///workspace/client/src/components/AppLayout.jsx#L381-L383) 仅 `app-dot` | 用户不知「有几条未读」 |
| **通知必须整页进** | 仅角标 + `/notifications` 整页路由 | 切走当前 tab 才能看通知，打断流 |
| **AppHome 仅 4 段内容** | [AppHome.jsx](file:///workspace/client/src/pages/AppHome.jsx) 241 行，首屏密度低 | 用户停留短，发现路径单一 |
| **磁贴硬编码** | `CREATE_SHORTCUTS` 6 项固定 | 用户无法个性化 |
| **DiscoverFeed 无「不感兴趣」** | 仅赞/藏/分享/历史（[DiscoverFeed.jsx](file:///workspace/client/src/pages/DiscoverFeed.jsx)） | 推荐无法学习用户偏好 |
| **SSE 断线无重连** | realtime.jsx 无指数退避 | 弱网下实时性丢失 |
| **弱网无降级** | video 背景恒挂（[DiscoverFeed.jsx:220-225](file:///workspace/client/src/pages/DiscoverFeed.jsx#L220-L225)） | 流量付费/3G 卡顿 |

---

## 三、详细方案

### 包 A：APP 通用组件层（~420 行）

**目标**：建立 APP 原生壳的可复用 UI 原语，消除各页重复造轮子。

#### A1. 新建 `/workspace/client/src/components/AppSheet.jsx`（~110 行）
- 通用 `<AppSheet>` 组件，props：`{ open, onClose, title?, children, snapPoints?, dismissOnMask=true }`
- 复用现有 `.app-sheet-mask` / `.app-sheet` / `.app-sheet-grip` CSS（[app-shell.css:216-228](file:///workspace/client/src/styles/app-shell.css#L216-L228)）。
- **拖拽关闭**：复用 `appgestures.js` 的 touch 跟踪模式，向下拖超过 80px 或速度 >0.8 → `onClose`；否则回弹。rAF 节流 `transform: translateY(dy)`。
- **snap points**：可选 `snapPoints={[0.4, 0.9]}`（占屏高比例），拖到最近档吸附。
- **安全区**：`padding-bottom: env(safe-area-inset-bottom)`。
- **portal**：挂到 `document.body`，避免被页面 `overflow` 裁剪。
- **Escape 键 + 硬件返回键**：`App.addListener('backButton')` 在 sheet open 时优先关闭 sheet（仅 APP 壳内）。

#### A2. 新建 `/workspace/client/src/components/AppEmpty.jsx`（~70 行）
- `<AppEmpty>` props：`{ illustration?, title, hint?, actions?: [{label, onClick, primary?}] }`
- 内置 4 个内联 SVG 插画（无角色/无消息/无网络/无搜索结果），用 `variant` prop 选择。
- 接入点：AppHome「无故事」分支、AppProfile 内容 Tab 空、Messages 空会话、DiscoverFeed 无结果。
- CSS 加 `.app-empty` 玻璃卡 + 插画呼吸动效（复用 `app-motion.css` 的 `.pulse-dot` 思路）。

#### A3. 新建 `/workspace/client/src/components/AppSkeleton.jsx`（~60 行）
- `<AppSkeleton variant="hero|card|row|avatar|grid">` 复用全局 `.skel` shimmer。
- 组合态：`<SkeletonList variant="row" count={5} />`、`<SkeletonGrid cols={2} count={4} />`。
- CSS 收口：删除 `app-shell.css` / `app-renov.css` / `app-motion.css` 三处重复 `.skel` 定义，统一到 `app-motion.css`（净减 ~40 行重复 + 新增 ~30 行变体）。

#### A4. 新建 `/workspace/client/src/components/AppError.jsx`（~80 行）
- `<AppError>` props：`{ kind: 'network'|'server'|'empty', title?, hint?, onRetry? }`
- 三种 kind 对应不同插画（复用 A2 的 SVG 体系）+ 文案模板。
- 「重试」按钮触感 `haptic.warn()`（包 B）+ `onRetry` 回调。
- 接入点：AppHome 四路 fetch 的 `.catch`（替换静默吞）、DiscoverFeed 触底加载失败、Messages 列表加载失败。

#### A5. 重构 `CreateSheet` 使用 `AppSheet`（~100 行修改）
- [AppLayout.jsx:390-406](file:///workspace/client/src/components/AppLayout.jsx#L390-L406) 的 `CreateSheet` 改为 `<AppSheet open={sheet} onClose={...} title="创建">` + 列表内容。
- 顺带给 5 项动作加 `haptic.tap()` 触感。

**行数小计**：110 + 70 + 60 + 80 + 100 = **420 行**。

---

### 包 B：触觉反馈模式库 + Capacitor Haptics 集成（~230 行）

**目标**：把 `tick(8)` 单次震动升级为语义化触觉模式库，iOS 用 Capacitor Haptics、安卓用 vibrate 数组、web 降级。

#### B1. 添加依赖 `@capacitor/haptics`（package.json +1 行）
- 与现有 `@capacitor/app` / `@capacitor/status-bar` 等 Capacitor 8 官方插件一致。
- 仅在原生壳加载，web 端永远不 import（沿用 `native.js` 的动态 import 模式）。

#### B2. 新建 `/workspace/client/src/haptics.js`（~90 行）
- 导出 `haptic` 对象：
  ```js
  export const haptic = {
    tap:      () => impact('light'),     // 轻点 tab/按钮
    confirm:  () => impact('medium'),    // 确认操作（签到/收藏）
    bump:     () => impact('heavy'),     // 重磅（删除/危险操作）
    select:   () => selection(),         // 选择变化（分段控件）
    success:  () => notify('success'),   // 成功（发送消息/支付成功）
    warn:     () => notify('warning'),   // 警告（错误重试/网络断）
    error:    () => notify('error'),     // 失败（发送失败/支付失败）
  };
  ```
- **平台分流**：
  - 原生壳（`isNativeShell()`）：动态 `import('@capacitor/haptics')` 调 `Haptics.impact({style})` / `Haptics.notification({type})` / `Haptics.selectionStart/End()`。
  - web 安卓：`navigator.vibrate(pattern)`（success=[0,10,30,10]，error=[0,30,60,30]，warn=[0,20]）。
  - iOS web / 不支持：静默 no-op。
- **节流**：同类触觉 80ms 内只触发一次（防快速点击连震）。
- **lite 档 / reduced-motion**：完全 no-op（`data-perf="lite"` 或 `prefers-reduced-motion`）。

#### B3. `native.js` 集成（~30 行修改）
- [native.js](file:///workspace/client/src/native.js) `initNative()` 末尾预热 Haptics 插件（`prepareHaptics()`），失败静默。
- 不在 web 端 main.jsx 加载 native.js（沿用现有隔离）。

#### B4. 8 处接入点（~110 行散点修改）
| 接入点 | 触觉 | 文件 |
|---|---|---|
| tab 切换 | `haptic.tap()` | AppLayout.jsx `onTab` |
| 下拉刷新触发 | `haptic.confirm()` | AppLayout.jsx `doRefresh` |
| FAB 开/关 sheet | `haptic.tap()` | AppLayout.jsx `setSheet` |
| 点赞/收藏 | `haptic.tap()` | DiscoverFeed.jsx 双击/点按 |
| 发送消息成功 | `haptic.success()` | Chat.jsx 发送回调 |
| 发送失败 | `haptic.error()` | Chat.jsx catch |
| 错误重试按钮 | `haptic.warn()` | AppError.jsx onRetry |
| 签到成功 | `haptic.success()` | AppHome.jsx 签到 |

**行数小计**：90 + 30 + 110 = **230 行**。

---

### 包 C：应用内通知抽屉 + 数字角标（~360 行）

**目标**：把「切走 tab 才能看通知」升级为「顶栏下拉即时预览」，tab 角标从红点升级为数字。

#### C1. 新建 `/workspace/client/src/components/NotificationDrawer.jsx`（~180 行）
- 顶部下拉抽屉，挂在 AppLayout 顶部（z-index 高于 `.app-tabbar`）。
- **手势**：复用 `appgestures.js` 思路新增 `useTopPull` hook —— 从屏幕顶部 24px 内向下拖（与 PTR 错开：PTR 起手在内容区、本手势起手在状态栏区）。
- **三档吸附**：收起（0）/ 半展开（40dvh）/ 全展开（85dvh），拖动吸附最近档。
- **内容**：
  - 分组：`@我的` / `互动` / `系统` 三段（复用现有 `/social/notifications` 接口数据）。
  - 每条：头像 + 文案 + 时间 + 已读/未读态（未读加左侧青色竖条）。
  - 点击：跳转目标 + 标记已读（调 `/social/notifications/:id/read`）。
  - 底部：「全部已读」+ 「查看全部」→ `/notifications`。
- **数据源**：复用 AppLayout 现有 `useRealtimeEvent('notification', ...)` SSE 订阅（[AppLayout.jsx:260](file:///workspace/client/src/components/AppLayout.jsx#L260)），抽屉打开时立即全量拉一次。

#### C2. AppLayout 集成抽屉（~40 行修改）
- [AppLayout.jsx](file:///workspace/client/src/components/AppLayout.jsx) 顶部加 `<NotificationDrawer open={notiOpen} onClose={...} />`。
- 顶部加一个铃铛按钮（或在 `今日` tab 顶部条加铃铛），点击切换抽屉；长按直接跳 `/notifications`。
- 离线/弱网时抽屉内显示「无法获取最新通知」提示。

#### C3. tab 数字角标（~60 行 JSX + CSS）
- Tab 组件支持 `count` prop：`count > 0` 时渲染 `.app-tab-badge`（数字，`count > 99 → '99+'`），否则保留原 `.app-dot` 红点（向后兼容）。
- `消息` tab：`count = unread + dmUnread`（复用现有状态）。
- `今日` tab：可选挂「待办任务数」（AppHome tasks 未领取数）。
- CSS：`.app-tab-badge` 绝对定位 tab 右上角，胶囊形，`linear-gradient(135deg, #ff5a5f, #ff2a55)` + 轻阴影 + `bounce-in` 动效（新增 `@keyframes badgeBounce` 到 app-motion.css）。

#### C4. 顶栏下拉手势 `useTopPull`（~80 行）
- 新建 `/workspace/client/src/hooks/useTopPull.js`。
- 仅监听 `window` 顶部 24px 区域的 touchstart（`touches[0].clientY <= 24 + safeAreaTop`）。
- 向下拖 → rAF 节流回调 `onPull(dy)`；松手 → `onEnd(dy, velocity)` 由组件决定吸附档。
- 与 `appgestures.js` 的 PTR 互斥：起手 Y 位置不同（状态栏区 vs 内容区）。
- 原生壳专属，web 端 no-op。

**行数小计**：180 + 40 + 60 + 80 = **360 行**。

---

### 包 D：AppHome 内容扩容 + 磁贴自定义（~430 行）

**目标**：把 AppHome 从 4 段扩到 7 段，提升首屏内容密度与个性化。

#### D1. 新增「最近浏览」rail（~100 行）
- [AppHome.jsx](file:///workspace/src/pages/AppHome.jsx) 加 `<AhRecent />` 段。
- 数据：`localStorage huanyu_recent_chars`（数组，最近 10 个 `{id, name, avatar, ts}`），由 CharacterView.jsx 离开时写入（+20 行散点）。
- 渲染：横滑 rail（复用 `.ah-rail` 结构），每项头像 + 名字 + 「继续」按钮。
- 空：不显示该段（避免空态）。
- 触感：点击 `haptic.tap()`。

#### D2. 新增「热门标签」chip 横滑（~80 行）
- `<AhTags />` 段：横滑 chip 列表（`overflow-x: auto`）。
- 数据：复用 `/api/tags` 接口（Tags 页已有），取前 12 个按热度。
- 点击：跳 `/tags?focus=<tag>` 或 `/search?tag=<tag>`。
- CSS：复用 `.tag-cloud-item`（[app-renov.css:268](file:///workspace/client/src/styles/app-renov.css#L268)）+ 横滑滚动条隐藏。

#### D3. 新增「好友在玩」社交段（~90 行）
- `<AhFriends />` 段：展示 3-5 个好友最近玩的角色（头像 + 好友名 + 「正在玩 <角色名>」）。
- 数据：新增接口 `/api/social/friends/activity`（后端如不存在则前端用 `/api/social/friends` + 最近会话拼凑）。
- 空：不显示该段。
- 点击好友头像 → 好友 profile；点击角色 → 角色详情。

#### D4. 磁贴长按自定义（~160 行）
- [AppHome.jsx](file:///workspace/src/pages/AppHome.jsx) `CREATE_SHORTCUTS` 改为可配置：
  - `localStorage huanyu_app_tiles` 存用户排序 + 启用态（JSON 数组）。
  - 长按磁贴 → 进入编辑态（磁贴抖动 + 右上角 × 删除按钮 + 底部「添加磁贴」抽屉）。
  - 编辑态可拖拽排序（HTML5 Drag API 或自实现 touch 排序）。
  - 「重置默认」按钮。
- 编辑态触感：进入 `haptic.bump()`，拖拽 `haptic.select()`，保存 `haptic.success()`。
- CSS：`.ah-shortcuts.editing .ah-tile` 抖动动效（`@keyframes tileWiggle`）+ 拖拽 ghost 样式。

#### D5. AppHome 性能与渲染优化（~40 行 CSS + JSX）
- `.ah-resume`、`.ah-task`、`.ah-pick`、`.ah-recent`、`.ah-tags`、`.ah-friends` 加 `content-visibility: auto` + `contain-intrinsic-size`（[app-renov.css:1677-1681](file:///workspace/client/src/styles/app-renov.css#L1677-L1681) 已有先例）。
- 段落 stagger 入场复用 `.stagger-in`（[app-motion.css](file:///workspace/client/src/styles/app-motion.css)）。

**行数小计**：100 + 80 + 90 + 160 + 40 = **470 行**（略超预估，可压缩到 430）。

---

### 包 E：DiscoverFeed 互动深化（~280 行）

**目标**：让发现流学会用户偏好，并提供更丰富的角色卡交互。

#### E1. 「不感兴趣」× 按钮（~70 行）
- [DiscoverFeed.jsx](file:///workspace/src/pages/DiscoverFeed.jsx) 右侧互动条加 × 按钮（`X` 图标）。
- 点击 → `haptic.warn()` + 该卡向上滑出动画 + 入 `localStorage huanyu_dismissed_chars` 黑名单 + 调 `/api/feed/dismiss/:id`（后端可选，前端兜底）。
- 撤销 toast：「已减少此类推荐 撤销」（3s 内可撤）。

#### E2. 长按角色卡 sheet（~80 行）
- 长按 500ms → `<AppSheet>`（包 A 组件）弹起，4 项：
  - 「不感兴趣」（同 E1）
  - 「举报」（跳 `/report?type=character&id=<id>` 或弹举报表单 sheet）
  - 「分享」（复用包 F 的 ShareSheet 或直接 `navigator.share`）
  - 「设为对话壁纸」（保存角色立绘到 localStorage，下次进对话用）
- 长按触感：`haptic.confirm()`。
- 防误触：长按期间移动 >10px 取消。

#### E3. 分类筛选抽屉（~90 行）
- 顶部加筛选按钮（`SlidersHorizontal` 图标），点击 `<AppSheet>` 弹起：
  - 标签多选（chip 网格，复用 D2 标签数据）
  - 性别单选（全部/男/女/其他）
  - 排序（推荐/最新/最热）
  - 仅看关注创作者（开关）
- 筛选态写入 URL query（`?tag=&gender=&sort=&following=`），DiscoverFeed 读 query 拉数据。
- 应用筛选触感 `haptic.confirm()`。

#### E4. 视频背景网络感知降级（~40 行）
- [DiscoverFeed.jsx:220-225](file:///workspace/client/src/pages/DiscoverFeed.jsx#L220-L225) `liveBg` 判定加：
  - `navigator.connection?.effectiveType` 为 `2g`/`3g` → 降级为静态首帧（`<img>` 替代 `<video>`）。
  - `navigator.connection?.saveData === true` → 降级。
  - `data-perf="lite"` → 降级（已有 lite 档，补此处）。
  - 用户设置项「省流量模式」（包 F 新增）开启 → 降级。

**行数小计**：70 + 80 + 90 + 40 = **280 行**。

---

### 包 F：网络韧性（~280 行）

**目标**：弱网/断网下保持可用性与可感知性，离线操作有指示。

#### F1. 添加依赖 `@capacitor/network`（package.json +1 行）
- 原生层网络状态变化（比 web `navigator.onLine` 更可靠，含连接类型 wifi/cellular/none）。
- 仅原生壳加载。

#### F2. `native.js` 集成 Network 插件（~50 行修改）
- [native.js](file:///workspace/client/src/native.js) `initNative()` 加：
  - `Network.getStatus()` 初始状态。
  - `Network.addListener('networkStatusChange', ...)` 派发 `huanyu-network` 事件 `{online, connectionType}`。
  - 暴露 `getConnectionType()` 供 DiscoverFeed 等查询。
- web 壳降级：仍用 `online`/`offline` 事件（AppLayout 现有逻辑不动）。

#### F3. SSE 指数退避重连（~80 行）
- 找到 realtime.jsx（SSE 订阅模块），`EventSource` `onerror` 时：
  - 关闭旧连接。
  - 延迟 `min(1000 * 2^attempt, 30000)` 重连。
  - 重连成功后用 `Last-Event-ID` 头补拉增量（如服务端支持）或全量重拉未读数。
  - 最大重连次数 10，超过后 toast「实时更新已暂停，点击重试」。
- 网络恢复（`huanyu-network` 事件 online）时立即触发一次重连（attempt 重置）。

#### F4. 离线 toast + 恢复提示（~40 行）
- [AppLayout.jsx:53,112-123](file:///workspace/client/src/components/AppLayout.jsx#L112-L123) 现有 `.app-offline` banner 保留，额外：
  - 离线瞬间 toast「网络已断开」（`haptic.warn()`）。
  - 恢复瞬间 toast「网络已恢复」+ 自动重拉当前 tab 数据（触发 `doRefresh`）。
- 心跳 45s 轮询在离线时暂停（[AppLayout.jsx:243-257](file:///workspace/client/src/components/AppLayout.jsx#L243-L257) 改：`!online` 时 `return`）。

#### F5. 弱网降级策略（~50 行）
- 新建 `/workspace/client/src/netquality.js`（~40 行）：
  - `getNetQuality()` 返回 `'fast'|'slow'|'offline'`。
  - 原生壳：`Network.getStatus().connectionType` + `effectiveType`。
  - web：`navigator.connection?.effectiveType` + `navigator.onLine`。
  - 监听变化派发 `huanyu-netquality` 事件。
- 接入：
  - DiscoverFeed 视频降级（包 E4）。
  - 图片 `loading` 策略（弱网全 lazy）。
  - 心跳频率（弱网 90s 替代 45s）。

#### F6. pending 消息指示（~60 行）
- [Chat.jsx](file:///workspace/client/src/chat/Chat.jsx) 发送消息时：
  - 网络离线/发送失败 → 消息气泡加 `⏳` pending 图标（左下角，灰色）。
  - 离线时操作入队 `localStorage huanyu_pending_msgs`（数组，每项 `{chatId, text, ts}`）。
  - 网络恢复 → 批量重放 + 重放成功后 `haptic.success()` + 移除 pending 图标。
  - 重放失败 → 气泡变红 + 「重试」按钮。
- CSS：`.msg.pending`、`.msg.failed` 状态样式（~20 行加到 chat-app.css）。

**行数小计**：50 + 80 + 40 + 50 + 60 = **280 行**。

---

## 四、假设与决策

### 4.1 关键决策（已自行裁定，理由附后）

| 决策 | 选择 | 理由 |
|---|---|---|
| 是否添加新 npm 依赖 | **是**：`@capacitor/haptics` + `@capacitor/network` | 均为 Capacitor 8 官方插件，与现有 `@capacitor/app`/`@capacitor/status-bar` 等一致；仅在原生壳动态 import，web 端零影响；符合「只针对 APP」约束 |
| 是否引入 Service Worker / Workbox | **否** | 项目 `build:static` 用 vite-plugin-singlefile 单文件打包，SW 缓存策略与之冲突；离线能力改为「IndexedDB pending 队列 + 网络韧性」更轻量 |
| 是否引入虚拟化库（react-virtuoso 等） | **否**（本次） | 现有 `content-visibility: auto` 已缓解长列表；虚拟化库引入风险大、接入点多，留待后续独立改造 |
| 触觉库平台策略 | iOS/安卓原生用 Capacitor Haptics；web 安卓用 vibrate 数组；iOS web 静默 | 与 native.js 现有隔离模式一致 |
| 通知抽屉手势 | 顶部 24px 区域下拉，与 PTR 起手区错开 | 避免与现有 PTR 冲突；原生壳有状态栏，顶部区域天然适合 |
| tab 数字角标 | count>0 显示数字，否则保留红点 | 向后兼容，不破坏现有视觉 |

### 4.2 作用域保证
- 所有 CSS 选择器前缀 `html[data-app="1"]`。
- 所有新组件仅在 AppLayout 子树或原生壳专用路由内渲染。
- native.js / haptics.js / netquality.js 仅在 `isNativeShell()` 或 `isAppMode()` 时加载。
- 不修改：Layout.jsx、Home.jsx、web 专属 CSS（index.css 主层非 app 部分）、web 路由行为。

### 4.3 向后兼容
- 现有 `app-dot` 红标保留（count 缺省时回退）。
- 现有 `CreateSheet` 行为不变（仅底层换 AppSheet）。
- 现有 `tick(8)` 保留导出（包 B 的 `haptic.tap()` 内部可调 `tick`，旧调用点不破坏）。
- SSE 重连不影响现有首次连接逻辑。

---

## 五、验证步骤

### 5.1 构建验证
```bash
npm run build:static    # 单文件打包，验证无 import 错误
npm run test:app        # APP 端冒烟测试（package.json:34）
```

### 5.2 作用域隔离验证
- Grep 确认无新增 CSS 选择器遗漏 `html[data-app="1"]` 前缀：
  ```bash
  # 检查新增/修改的 CSS 文件，所有规则块必须在 html[data-app="1"] 作用域内
  ```
- 启动 web 端（`npm run dev:client`），在浏览器 DevTools 移除 `data-app="1"` 属性后确认 web 页面无视觉变化。

### 5.3 功能验证（APP 壳）
- **包 A**：CreateSheet 打开/拖拽关闭/Escape 关闭；AppError 重试按钮触发 fetch；AppSkeleton 在慢网络下显示。
- **包 B**：原生壳（Android）签到触发 success 触觉；tab 切换触发 tap 触觉；web 端无报错（降级 vibrate 或 no-op）。
- **包 C**：顶部下拉出现通知抽屉；吸附三档；消息 tab 显示数字角标（unread+dmUnread）；红点在 count=0 时回退。
- **包 D**：AppHome 显示 7 段（部分段空时不显示）；长按磁贴进入编辑态；拖拽排序后刷新保留；localStorage 持久化。
- **包 E**：DiscoverFeed × 按钮触发卡滑出 + 撤销 toast；长按弹 sheet 4 项；筛选抽屉应用后列表更新；3G 模式视频降级为静态图。
- **包 F**：断网 toast 出现 + banner；SSE 断开后控制台看指数退避重连；恢复网络 toast + 自动刷新；离线发消息出现 pending 图标，恢复后重放。

### 5.4 性能验证
- `data-perf="lite"` 下：触觉 no-op、视频降级、动画精简。
- `prefers-reduced-motion` 下：所有新动画（badgeBounce / tileWiggle / 卡滑出）禁用。
- AppHome 7 段首屏渲染无白屏（content-visibility 生效）。
- Lighthouse / Perfetto 抓帧：tab 切换、下拉抽屉、长按 sheet 无明显掉帧（<55fps）。

### 5.5 回归验证
- 现有 KeepAlive / VT / PTR / 手势全部正常。
- web 端 Layout.jsx 路由行为不变。
- 现有 Toast / RouteErrorBoundary 不受影响。

---

## 六、实施顺序（建议）

1. **包 A（通用组件层）** 先行 —— 后续包 B/C/E 复用 AppSheet、AppError。
2. **包 B（触觉库）** —— 独立模块，后续包接入触感。
3. **包 F（网络韧性）** —— 独立模块，DiscoverFeed 依赖其弱网判定。
4. **包 C（通知抽屉 + 角标）** —— AppLayout 集成。
5. **包 D（AppHome 扩容）** —— 内容扩容，依赖包 A 的 AppEmpty。
6. **包 E（DiscoverFeed 互动）** —— 依赖包 A 的 AppSheet + 包 F 的弱网判定。

每包完成后运行 `npm run build:static` 验证无报错，再进入下一包。
