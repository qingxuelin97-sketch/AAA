# APP 前端去 AI 化与模块分色重构方案

## 1. Summary

对 APP 壳前端进行「去 AI 化」重构：去除显式 AI 文案标签，打破白+青单一色调，建立「不同模块不同色、设计语言统一」的配色体系，并在二三级页面排查修复因样式变更引发的前端 bug。

## 2. Current State Analysis

- **隔离良好**：APP 端全部样式与组件以 `html[data-app="1"]` 作用域隔离，核心文件为 `app-shell.css` / `app-elevated.css` / `app-renov.css` / `app-runtime.css`。
- **文案问题**：底栏中央 FAB 标有「AI」字样；创建面板含「AI 绘图」「AI 协作长篇创作」等；发现流有「由 AI 生成」水印；VIP、设置、聊天、功能介绍等多处显式出现「AI」字样。
- **视觉问题**：`theme.js` 在 APP 端把 `system` 强制解析为 light，并配青白色状态栏 `#eefbfd`；`app-elevated.css` / `app-renov.css` / `app-runtime.css` 中存在大量硬编码青/蓝/cyan 色值（`#22d3ee`、`#0e7490`、`rgba(13,74,88,…)`、`rgba(14,156,184,…)`），导致所有模块都被刷成同一冷色调，工具感过重。
- **Accent 资源闲置**：`accent.js` 提供 6 套强调色（黏土橙、暮霭紫、松石青、苔原绿、蔷薇红、琥珀金），但 APP 端在 light 模式下被白+青系统覆盖，accent 色未真正按模块释放。

## 3. Proposed Changes

### Task 1 — 文案去 AI 化

| 文件 | 位置/内容 | 改后 |
|---|---|---|
| `client/src/components/AppLayout.jsx` | FAB 按钮内 `<i>AI</i>` | `<i>创作</i>` |
| `client/src/components/AppLayout.jsx` | CREATE 数组 label/hint | `AI 绘图` → `绘图工作室`；`AI 协作长篇创作` → `小说工坊`；`多人多 AI 即兴演出` → `剧场联机` |
| `client/src/pages/DiscoverFeed.jsx` | `.feed-ai-mark` 水印 | `由 AI 生成` → `模型生成` |
| `client/src/pages/AppProfile.jsx` | 快捷入口 label | `AI 绘图` → `绘图工作室` |
| `client/src/pages/Vip.jsx` | 权益描述 | `AI 对话 75 折` → `对话 75 折`；`平台 AI 全线 5 折` → `平台服务全线 5 折`；`多人多 AI 无限开场` → `多人联机无限开场` |
| `client/src/pages/Chat.jsx` | 水印 + Toast | `内容由 AI 生成` → `内容由模型生成`；`平台 AI · 本次消耗` → `平台服务 · 本次消耗` |
| `client/src/pages/Insights.jsx` | 入口 label | `AI 绘图` → `绘图工作室` |
| `client/src/features.js` | 功能标题/描述 | `AI 角色聊天` → `角色聊天`；`AI 辅助润色人设` → `辅助润色人设`；`AI 共写工作台` → `共写工作台`；`AI 一致性检查` → `一致性检查`；`AI 自动插图` → `自动插图`；`AI 协作完成长篇小说` → `协作完成长篇小说` |
| `client/src/pages/Settings.jsx` | 设置描述 | 「AI 模型服务商」「AI 服务」等统一改为「模型服务商」「对话服务」「创作服务」 |

### Task 2 — 建立模块分色体系

**核心策略**：在 `AppLayout.jsx` 的 `.app-main` 容器上根据当前路由注入 `data-module`，在 `app-runtime.css` 追加模块→accent 映射；把所有硬编码 cyan 色全面替换为基于 `var(--accent)` 的 `color-mix`，让 glass、shadow、glow 全部跟随模块色。

**模块色映射表**：

| 模块路由 | data-module | accent（主） | accent-2（辅） | 情绪 |
|---|---|---|---|---|
| /today | today | #d97757 (clay) | #c25a38 | 温暖欢迎 |
| / (discover) | discover | #7c5cbf (dusk) | #6a4caf | 探索神秘 |
| /chats, /messages | chat | #2f8f9d (teal) | #1e7a87 | 沟通冷静 |
| /studio, /draw, /atelier | studio | #b3892f (amber) | #9a7324 | 艺术创作 |
| /theater, /events | theater | #c25573 (rose) | #a84260 | 戏剧情感 |
| /me, /settings | me | #5c8a63 (forest) | #4a754f | 沉静个人 |
| /wallet, /vip | wallet | #b3892f (amber) | #d4a03a | 尊贵价值 |
| fallback | — | #d97757 (clay) | #c25a38 | 安全回退 |

**文件级改动**：

1. **`client/src/components/AppLayout.jsx`**
   - 新增 `resolveModule(path)` 函数，按 pathname 前缀返回对应 `data-module` 值。
   - 在 `mainRef` 对应的 `.app-main` div 上动态设置 `data-module={resolveModule(loc.pathname)}`。
   - 创建面板（`CreateSheet`）的 `.app-sheet` 上设置 `data-module="create"`，保持默认 clay 色或继承触发页颜色。

2. **`client/src/styles/app-runtime.css`**（模块分色权威层）
   - 追加 `:where([data-module="today"]) { --accent: #d97757; --accent-2: #c25a38; }` 等映射规则。
   - 把 `:where(.btn.primary, .send-btn)` 的渐变从固定 `linear-gradient(140deg, var(--app-cyan), var(--app-ink))` 改为 `linear-gradient(140deg, var(--accent), var(--accent-2))`。
   - 把 `.section-title::before` 装饰条从固定 `var(--app-coral)` 改为 `var(--accent)`。
   - 保留 `--app-cyan` / `--app-ink` 变量本身不删，避免未知引用报错，但不再作为默认主色。

3. **`client/src/styles/app-renov.css`**（去毛坯层）
   - 全局搜索 `rgba(13,74,88,` → 替换为 `color-mix(in srgb, var(--accent) 8%, rgba(0,0,0,相同透明度))` 或更简洁的纯黑透明度阴影。
   - 全局搜索 `rgba(14,156,184,` → 替换为 `color-mix(in srgb, var(--accent) 28%, transparent)` 的等效光晕。
   - `.tabs-bar button.active` 的 `box-shadow` 和 `.btn.primary` 的 `box-shadow` 全部基于 `var(--accent)`。

4. **`client/src/styles/app-elevated.css`**（Liquid Glass 系统）
   - 浅色主题 `--gl-border`：当前 `color-mix(in srgb, #22d3ee 30%, transparent)` → 改为 `color-mix(in srgb, var(--accent) 22%, transparent)`，让玻璃边缘透出模块色而非固定青色。
   - `--gl-halo-b` 中的 `#22d3ee` → 改为 `color-mix(in srgb, var(--accent) 24%, transparent)`。
   - `.app-tabbar` 的「白+青」清透底（`rgba(240,253,255,0.82)` 等）改回中性暖白底 `rgba(250,249,245,0.88)`，消除全局青色烙印。
   - `.app-tab.active` 色从 `#0e7490` 改回 `var(--accent)`。
   - `.app-fab` 的 border-color / color 从 `#0e7490` 改回 `var(--text)` 或 `var(--accent)`。
   - `.app-dot` 在浅色底上的 shadow 环保持白/灰，不强制青。

5. **`client/src/theme.js`**
   - APP 端 light 模式状态栏颜色：从 `#eefbfd`（青白）改为 `#f4f2ec`（与 Web 端一致的暖白），彻底移除启动时的青色第一印象。

### Task 3 — 全局硬编码 cyan 清理

通过 Grep 在 `client/src/styles/` 下定位所有 `html[data-app="1"]` 作用域内的硬编码青/蓝/cyan 色值，按以下策略替换：

| 原值 | 替换策略 |
|---|---|
| `#22d3ee` | `color-mix(in srgb, var(--accent) 55%, #fff)` 或中性高光 `rgba(255,255,255,0.7)` |
| `#0e7490` | `var(--accent)` |
| `rgba(13,74,88,X)` | `color-mix(in srgb, var(--accent) 12%, rgba(0,0,0,X))` 或简化 `rgba(0,0,0,X*0.6)` |
| `rgba(14,156,184,X)` | `color-mix(in srgb, var(--accent) 30%, transparent)` |
| `#eefbfd` | `#f4f2ec` 或 `var(--bg)` |
| `rgba(8,145,178,X)` | `color-mix(in srgb, var(--accent) 35%, transparent)` |
| `rgba(8,90,108,X)` | `rgba(0,0,0,X*0.8)` |

### Task 4 — 二三级页面前端 Bug 排查与修复

重构后按以下路径广度验证并修复明显前端缺陷：

1. **对比度与可读性**
   - 在 `discover`（暮霭紫）和 `theater`（蔷薇红）模块下，检查 `.btn.primary` 的白字对比度是否仍满足 WCAG 4.5:1；若不满足，微调对应模块的 `accent-2` 加深或按钮字色改为 `#fff` 并加 text-shadow。
   - 在 `wallet`（琥珀金）模块下，检查浅色卡片上的 tag、进度条、badge 是否仍清晰可读。

2. **Glass 层残留 cyan**
   - 在「我的」「钱包」「设置」等非 cyan 模块中，抽查 `.topbar` / `.app-tabbar` / `.chat-input-bar .box` / `.toast` 是否仍残留青色边框或青色背景 tint。

3. **布局与合成层**
   - 确认 `app-elevated.css` 中 `transform: translateX(-50%) translateZ(0)` 与 ink 滑块动画的叠加是否仍然正常。
   - 确认 `will-change: backdrop-filter` 列表中的元素在模块色变更后没有因 specificity 变化导致玻璃失效。

4. **Dark 模式兼容**
   - 切换深色模式后，确认每个模块的 accent 色在 dark 背景下不会过亮刺眼（利用现有 `color-mix` 机制，通常 dark 模式下的面板底本身会吸收过强饱和度）。
   - 检查 `app-runtime.css` 的 `html[data-app="1"][data-theme="dark"]` 变量是否仍正确覆盖新规则。

5. **全局文案回归**
   - 对 `client/src/` 下的 `.jsx` / `.js` 执行 `Grep -i "AI"`，确认展示层无遗漏；保留 API 协议字段（`llm_protocol`、`openai` 等）与后端对接参数不动。

## 4. Assumptions & Decisions

- **保持 glass 体系不动**：不删除毛玻璃，只改玻璃折射出的色调，维持「一线 App」质感。
- **Dock 底栏保持中性**：Dock 是全局 chrome，不随模块变色，避免彩虹感；默认回归黏土橙或中性灰，active 态跟随 `var(--accent)`。
- **创建面板继承触发模块色**：从哪个模块点开创建，sheet 的强调色就跟谁；若直接通过 FAB 打开，则使用默认 clay 色。
- **不碰 Web 端**：所有改动严格在 `html[data-app="1"]` 作用域内，Web 端 zero impact。
- **不改动后端/法律/协议文本**：`legal.js` 与 `mock/backend.js` 中涉及合规、计费、API 协议的「AI」字样保持原样，仅改前端 UI 展示层。
- **Fallback 安全**：若某页面未匹配到 module，fallback 到 clay orange，避免无色可显。
- **不改动画时序与 shadow 结构**：只替换 shadow/glow 的颜色值，不动 `box-shadow` 的偏移量、模糊半径、动画 keyframes，防止级联动画 bug。

## 5. Verification Steps

1. **模块色切换验证**：本地构建后，用 `?app=1` 预览模式逐个切换一级 tab（今日→发现→消息→我的），确认每个模块的主按钮 / active 态 / 进度条 / 标签颜色正确且不同。
2. **二三级页染色验证**：进入钱包、VIP、设置、角色编辑器、剧场、小说工坊、绘图页，确认对应模块色正确渲染，且无任何 cyan 残留。
3. **深色模式验证**：在每个模块下切换 dark 模式，确认 accent 色自动适配，无刺眼或过暗。
4. **Glass 与性能验证**：在 Chrome DevTools 移动端模拟中，检查 `.app-tabbar`、`.topbar`、`.chat-input-bar` 的玻璃边框不再呈现青色；lite 档与 balanced 档的降级规则仍然生效。
5. **文案回归验证**：对 `client/src/pages/`、`client/src/components/`、`client/src/features.js` 全局搜索 `AI`，确认所有用户可见文案已替换，仅剩 API/协议/法律字段保留。
6. **真机/模拟器检查**（如有条件）：确认状态栏颜色与页头一致，无青白状态栏残留。
