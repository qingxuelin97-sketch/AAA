# 幻域 APP · 猫箱风格 + iOS 26 Liquid Glass 改版方案

## 一、调研结论

### 1.1 参考对象分析

**猫箱（MyParallelStory / 字节跳动）**
- 定位：AI 角色互动与情感陪伴平台，MAU 千万级
- 核心交互：抖音式全屏竖滑角色流（上下滑动切换角色）
- UI 特征：
  - 浅色为主（#FFFFFF / #F8F8F8 基底），高对比黑字
  - 强调色：明黄（#FFD600 级）+ 亮蓝点缀
  - 中央大角色卡片：全幅立绘/形象图打底
  - 底部极简 Tab 导航（抖音式：首页/发现/+/消息/我的）
  - 流内直接输入：卡片底部「说点什么...」胶囊，点击即进入对话
  - 快捷括号动作输入：一键插入 `（动作表情）`
  - 卡片右侧竖排互动按钮：点赞/收藏/评论/分享
  - 圆角 8-16px，阴影克制，动效直接快速
- 包名：`com.parallel.odyssey`

**iOS 26 Liquid Glass（WWDC 2025）**
- 核心材质：Liquid Glass 液态玻璃
  - 半透明 + backdrop-filter 模糊（blur + saturate）
  - 动态折射/反射周围内容
  - 镜面高光（inset box-shadow 模拟玻璃边缘反光）
  - 根据内容/环境智能自适应色调
- 交互特征：
  - 滚动时 Tab Bar/Dock 收缩，内容优先
  - 控件同心圆角适配硬件屏幕圆角
  - 流畅的形态变换动画（morphing）
  - 玻璃材质只用于 chrome 层（导航/控件/浮层），内容面不透明
  - 标签栏滚动收缩，上滑回弹

### 1.2 当前幻域 APP 现状

**技术栈**：React 19 + Vite 8 + Capacitor 8（iOS/Android 原生壳）
**现有架构**：
- [AppLayout.jsx](file:///workspace/client/src/components/AppLayout.jsx) — 原生 APP 壳，含 Dock/FAB/CreateSheet/KeepAlive/手势
- [DiscoverFeed.jsx](file:///workspace/client/src/pages/DiscoverFeed.jsx) — 发现页已有全屏竖滑角色流基础
- [app-ix-tokens.css](file:///workspace/client/src/styles/app-ix-tokens.css) — IX 设计令牌（当前为「仪与匣」铝白/石墨工业风，磷光青 #0E7263 主色）
- [app-hig-v5.css](file:///workspace/client/src/styles/app-hig-v5.css) — iOS HIG 重皮层
- [AppControls.jsx](file:///workspace/client/src/components/AppControls.jsx) — 基础控件集
- 已有基础设施：下拉刷新、左右滑切 Tab、SSE 实时推送、路由级代码分割、View Transition

**差距分析**：
| 维度 | 当前状态 | 目标状态 |
|------|----------|----------|
| 设计语言 | 仪与匣工业风（磷光青+铝白+机加工几何） | 猫箱活泼风 + iOS 26 Liquid Glass |
| Dock/底栏 | 不透明白条+墨迹滑块 | Liquid Glass 半透明+滚动收缩 |
| 发现流 | 有竖滑基础，信息层级偏密 | 抖音式大卡片，更沉浸，流内直聊 |
| 主色调 | 磷光青 #0E7263 | 猫箱明黄/暖色调 + Liquid Glass 自适应 |
| 材质 | 内容面不透明+玻璃仅chrome层（已有基础） | 全面升级 Liquid Glass 折射/高光 |
| 输入交互 | 进入聊天页才输入 | 发现流卡片内直接开口 |
| 快捷动作 | 无括号快捷输入 | 聊天页加快捷动作栏 |
| 动效 | 机械感（快进慢停） | 更流畅弹性，玻璃态变换 |

---

## 二、改版范围与模块

### 2.1 核心改版模块（APP 端，`html[data-app="1"]` 作用域）

1. **设计令牌系统** — 新增 Liquid Glass 令牌层，重构主色/材质/圆角/动效
2. **AppLayout 壳层** — Dock 液态玻璃化 + 滚动收缩 + FAB 重设计 + CreateSheet 玻璃化
3. **DiscoverFeed 发现流** — 猫箱式大卡片重构 + 流内输入胶囊 + 竖排互动按钮
4. **Chat 聊天页** — 气泡/输入框玻璃化 + 快捷动作括号栏
5. **通用控件** — AppButton/AppIconButton/AppTabButton 升级 Liquid Glass
6. **导航栏/Sheet/Modal** — 全面液态玻璃材质
7. **今日/消息/我的** 一级 Tab 页适配新风格
8. **暗色模式** — 同步 Liquid Glass 深色版本

### 2.2 不改的部分
- 后端 API/路由/数据模型（零改动）
- Web 端（`html:not([data-app="1"])` 完全隔离，零影响）
- 业务逻辑/状态管理/SSE/推送
- 路由结构与页面集合

---

## 三、详细执行步骤

### Phase 1：设计令牌与基础材质（Foundation）

**文件：新建 [client/src/styles/app-liquid-glass.css](file:///workspace/client/src/styles/app-liquid-glass.css)**

1. **色彩令牌重定义**（从 `--ix-*` 扩展/覆盖为 `--lg-*` 新前缀，保持兼容）：
   - 基底：`--lg-canvas: #F2F2F7`（iOS 26 浅灰底）
   - 内容面：`--lg-surface: rgba(255,255,255,0.92)`（半透明白）
   - 主强调：`--lg-accent: #FFCC00`（猫箱明黄，可调）
   - 次级强调：`--lg-accent-2: #007AFF`（iOS 蓝）
   - 文字三阶调整为更柔和对比度
   - 语义色保留（危险红/成功绿/金币金/钻石蓝）

2. **Liquid Glass 材质令牌**：
   ```css
   --lg-glass-chrome: rgba(255,255,255,0.72);   /* Dock/顶栏 */
   --lg-glass-surface: rgba(255,255,255,0.82);  /* 卡片/Sheet */
   --lg-glass-thin: rgba(255,255,255,0.55);     /* 输入框/薄控件 */
   --lg-blur: blur(28px) saturate(180%);         /* 主模糊 */
   --lg-blur-strong: blur(40px) saturate(200%);  /* 强模糊 */
   --lg-glare: linear-gradient(180deg, rgba(255,255,255,0.6) 0%, rgba(255,255,255,0.1) 100%);
   --lg-edge: 1px solid rgba(255,255,255,0.5);  /* 玻璃上缘高光 */
   --lg-edge-inner: inset 0 1px 0 rgba(255,255,255,0.8);
   --lg-shadow-chrome: 0 8px 32px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.6);
   --lg-shadow-card: 0 4px 20px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.7);
   ```

3. **圆角调整**：更圆润，同心适配
   ```css
   --lg-r-card: 16px;
   --lg-r-control: 12px;
   --lg-r-dock: 20px;  /* Dock 胶囊圆角 */
   --lg-r-pill: 999px;
   ```

4. **动效令牌**：增加弹性缓动
   ```css
   --lg-ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
   --lg-ease-smooth: cubic-bezier(0.32, 0.72, 0, 1);
   --lg-dur-morph: 400ms;
   ```

5. **在 main.jsx / app-entry.js 中引入新 CSS**（在 app-hig-v5.css 之后加载，作为新的末位权威）。

---

### Phase 2：AppLayout 壳层重构

**文件：[client/src/components/AppLayout.jsx](file:///workspace/client/src/components/AppLayout.jsx)** + 对应 CSS（app-shell.css / app-elevated.css）

1. **Dock（底栏）Liquid Glass 化**：
   - 背景改为 `var(--lg-glass-chrome)` + `var(--lg-blur)`
   - 形态改为悬浮胶囊（不贴底，左右各留边距，圆角 20px）
   - 去掉顶部边框，改为内阴影高光
   - 墨迹滑块（dock-ink）改为液态玻璃 pill：半透明主色+模糊
   - 支持滚动收缩：监听 scroll，下滑时 dock 高度缩到 48px、图标缩小，上滑立即回弹（iOS 26 行为）

2. **FAB（中央创建按钮）重设计**：
   - 从描边圆形改为玻璃渐变圆形按钮
   - 背景：`var(--lg-accent)` 实色填充（黄色），带阴影
   - 展开态（sheet open）使用 morph 旋转为 X，缓动 spring
   - 点击时的波纹/缩放反馈升级

3. **CreateSheet（创建菜单）玻璃化**：
   - 背景 `var(--lg-glass-surface)` + `var(--lg-blur-strong)`
   - grip 条更明显（猫箱/抖音风格）
   - 创建项按钮改为玻璃列表项，左侧彩色图标方块
   - 进场动画从硬切改为弹性升起

4. **顶栏（页面内 topbar）**：
   - 背景透明→滚动态玻璃模糊
   - 去掉底线，渐变透明过渡

5. **boot 闪屏页**：更新 Logo 动画（更轻盈）

---

### Phase 3：DiscoverFeed 发现流重构（猫箱核心体验）

**文件：[client/src/pages/DiscoverFeed.jsx](file:///workspace/client/src/pages/DiscoverFeed.jsx)** + CSS

这是最关键的改版，从当前的"介绍卡+互动条+输入胶囊"层级优化为更纯粹的抖音式大卡体验：

1. **卡片布局重构**（每张卡 = 一屏）：
   - 背景：角色立绘图全屏铺底（顶部渐入状态栏，底部延伸至 Dock 下）
   - 底部渐变遮罩：从透明到黑色半透明渐变（40% 高度），保证文字可读
   - **左下信息区**：
     - 角色名（大号粗体白字）
     - 作者名 + 头像（小）
     - 角色标签/分类
     - 可展开的简介文案（点击展开全文）
     - 开场白气泡（小气泡样式，在角色名上方）
   - **右侧竖排互动按钮**（猫箱/抖音风格）：
     - 头像（圆形，可点击进作者主页）
     - 点赞（红心，双击动画爆发）
     - 收藏（星星）
     - 评论
     - 分享
     - 语音通话按钮
   - **底部输入胶囊**（全宽圆角，跨左右区域）：
     - 「和 TA 说点什么...」placeholder
     - 点击输入框 → 直接跳入聊天页并聚焦输入，带入输入内容
     - 右侧麦克风图标（语音输入）

2. **交互细节**：
   - 双击点赞：爱心从点击位置迸发动画（猫箱/抖音样式）
   - 下滑刷新加载：保持现有，但动画换为 Liquid Glass 风格
   - 分类切换条（推荐/新作/关注）：顶部悬浮玻璃胶囊分段控件
   - 搜索/历史按钮：右上角玻璃圆形图标按钮
   - 卡片切换 snap 滚动更顺滑，增加卡片间视差

3. **信息密度调整**：
   - 移除/弱化当前的"使用人数 w"、"标签"等统计项
   - 强化角色形象视觉冲击，减少文字干扰
   - 开场白只显示一行，展开才看全文

---

### Phase 4：Chat 聊天页升级

**文件：[client/src/pages/Chat.jsx](file:///workspace/client/src/pages/Chat.jsx)** + [chat-app.css](file:///workspace/client/src/chat/chat-app.css)

1. **聊天气泡**：
   - AI 气泡：Liquid Glass 白/灰玻璃（用户侧可稍有色调）
   - 用户气泡：实色主色（明黄）气泡
   - 气泡圆角加大（20px），尾巴更柔和
   - 增加 `（动作表情）` 行内样式：斜体灰色小字

2. **输入框区域**：
   - 玻璃输入框：`var(--lg-glass-surface)` + `var(--lg-blur)`
   - **快捷动作栏**（猫箱特色）：输入框上方或展开后显示快捷括号按钮
     - 「（笑）」「（点头）」「（脸红）」「（轻轻...）」等常用动作
     - 点击直接插入 `（xxx）` 到输入框
   - 发送按钮：主色圆形
   - 语音按钮：左侧麦克风

3. **顶部栏**：
   - 角色名+状态（在线/正在输入...）
   - 返回按钮玻璃化
   - 头像圆形

4. **背景**：可使用角色相关模糊图/渐变色（Liquid Glass 折射）

---

### Phase 5：通用控件升级

**文件：[client/src/components/AppControls.jsx](file:///workspace/client/src/components/AppControls.jsx)** + CSS

1. **AppButton**：
   - `variant="filled"`：实色主色+阴影
   - `variant="secondary"`：玻璃材质（背景半透+模糊+高光边）
   - `variant="ghost"`：无背景悬停玻璃
   - 按压反馈：scale(0.96) + 弹性缓动（不再是机械 0.97）

2. **AppIconButton**：
   - 默认：玻璃圆形按钮
   - selected/active 态：主色填充
   - 增加内阴影高光

3. **AppTabButton**（Dock 内）：
   - 图标+文字竖排
   - 选中态：主色染色+药丸背板（液态玻璃）
   - 未选态：灰色

4. **分段控件/开关/滑块**：全部升级 Liquid Glass 材质

---

### Phase 6：一级 Tab 页适配

1. **AppHome（今日）**：
   - 问候区大标题 34px 保留
   - 卡片列表玻璃化
   - 快捷入口按钮玻璃胶囊

2. **Messages（消息）**：
   - 对话列表项玻璃化
   - 未读角标优化
   - 顶部搜索栏玻璃

3. **AppProfile（我的）**：
   - 头像区更大
   - 个人信息卡玻璃化
   - 功能列表 inset-grouped 玻璃分组

4. **Settings（设置）**：
   - 列表项玻璃化
   - 开关控件 Liquid Glass

---

### Phase 7：暗色模式

- 基于现有 `[data-theme="dark"]` 机制
- 玻璃材质在暗色下：`rgba(28,28,30,0.7)` + 更深模糊 + 冷色调高光边
- 主色保留明黄，但稍降饱和
- 测试所有页面深/浅一致性

---

### Phase 8：验证与优化

1. 启动开发服务器 `npm run dev:client`
2. 访问 `?app=1` 预览 APP 形态
3. 测试四个一级 Tab 切换、发现流滑动、聊天、创建菜单
4. 测试下拉刷新、左右滑切 Tab、长按菜单、Sheet/Modal
5. 测试 lite 省电模式（玻璃回落不透明面，不破坏层级）
6. 测试暗色模式切换
7. 检查 safe-area 适配（刘海/灵动岛/底部 home 条）
8. 性能检查：确保 backdrop-filter 不会导致滚动掉帧，必要时优化

---

## 四、文件修改清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `client/src/styles/app-liquid-glass.css` | **新建** | Liquid Glass 设计令牌+材质+组件样式（末位权威） |
| `client/src/styles/app-entry.js` 或 `main.jsx` | 修改 | 引入新 CSS |
| `client/src/components/AppLayout.jsx` | 修改 | Dock 滚动收缩逻辑+FAB 动画+类名 |
| `client/src/styles/app-shell.css` | 修改 | Dock/顶栏/Sheet 玻璃样式 |
| `client/src/styles/app-elevated.css` | 修改 | 浮层层级样式调整 |
| `client/src/pages/DiscoverFeed.jsx` | **大改** | 卡片布局重构+流内输入+竖排按钮 |
| `client/src/styles/web-lumen-discover.css` | 修改 | App 侧选择器隔离，Web 不影响 |
| `client/src/chat/chat-app.css` | 修改 | 聊天气泡/输入框玻璃化+快捷动作栏 |
| `client/src/pages/Chat.jsx` | 修改 | 快捷动作栏组件+UI 调整 |
| `client/src/components/AppControls.jsx` | 修改 | 控件玻璃化+弹性动效 |
| `client/src/pages/AppHome.jsx` | 修改 | 今日页卡片玻璃化 |
| `client/src/pages/Messages.jsx` | 修改 | 消息列表玻璃化 |
| `client/src/pages/AppProfile.jsx` | 修改 | 我的页玻璃化 |
| `client/src/pages/Settings.jsx` | 修改 | 设置页玻璃化 |
| `client/src/components/AppControls.jsx` 相关 CSS | 修改 | 控件样式 |
| `client/src/styles/app-hig-v5.css` | 小幅调整 | 与新令牌兼容（不删除，作为基础层） |
| `client/src/styles/app-ix-tokens.css` | 小幅调整 | 暗色玻璃令牌补充 |

---

## 五、风险与应对

| 风险 | 应对 |
|------|------|
| backdrop-filter 性能问题（低端安卓机） | 保留 `[data-perf="lite"]` 机制，玻璃回落不透明面，层级/间距不变 |
| 新主色（明黄）与现有品牌冲突 | 提供 CSS 变量快速改色，若需要可调整为暖橙或保持青色调 |
| 发现流重构导致交互变化过大 | 保留核心数据/API 不变，仅改布局；保留双击点赞等已熟悉的交互 |
| Web 端样式被污染 | 所有新样式严格围栏在 `html[data-app="1"]` 下，Web 零影响 |
| 暗色模式玻璃可读性差 | 提高暗色玻璃不透明度（0.7~0.8），加强边框高光对比 |
| Dock 滚动收缩与 KeepAlive/pane 滚动冲突 | 监听 window.scrollY 而非内部滚动容器，收缩仅 transform 不 reflow |

---

## 六、不做的事（明确边界）

- 不修改后端 API 或数据库
- 不改变路由结构或新增页面
- 不改 Web 端（非 APP 模式）
- 不改业务逻辑（SSE/推送/支付/鉴权等）
- 不引入新的 npm 依赖（只用现有的 React + lucide-react）
- 不重构非 UI 的工具函数（api.jsx/realtime.jsx/nav.js 等）
- 不重新制作插画/图标资源（沿用现有 illos/，必要时只调整色调）

---

## 七、验证标准

改版完成后，在 `?app=1` 预览模式下：
1. ✅ Dock 为悬浮液态玻璃胶囊，下滑收缩、上滑回弹
2. ✅ FAB 为黄色圆形玻璃按钮，展开弹性动画
3. ✅ 发现流每屏一张大角色卡，竖排互动按钮，底部输入胶囊
4. ✅ 双击角色卡有爱心迸发动画
5. ✅ 聊天页气泡为玻璃材质，输入框上方有快捷动作栏
6. ✅ 所有按钮/卡片/Sheet 均为 Liquid Glass 风格
7. ✅ 四个一级 Tab 切换流畅，KeepAlive 正常
8. ✅ 暗色模式下玻璃材质依然有层次、可读
9. ✅ lite 模式下玻璃回落不透明，可用但不华丽
10. ✅ Web 端访问（无 `?app=1`）样式完全不受影响
