# 前端 UI 灵动化焕新 Spec

## Why
当前前端采用 Anthropic 风暖色编辑器主题（ivory + clay `#d97757` Claude 橙），整体气质偏沉静、克制、规整——这是典型的「AI 助手」视觉语言，与产品本身「幻域」是一个 **创作/角色/剧场/小说** 玩乐向内容 App 的定位错位。现有 `app-motion.css` 动效层虽已建立 stagger/pressable/flow-sheen 基础，但仅覆盖入场与按压，缺少氛围层、微交互、内容揭示等「活气」。本次只动 UI（样式 + 动画），不动任何业务逻辑、接口、路由、状态管理，让界面从「Anthropic 助手感」转向「灵动内容 App」感。

## What Changes
- **新增 `app-lively.css` 灵动层**（级联最后一位，在 `app-motion.css` 之后导入），所有视觉焕新集中于此，老层零改动，可整体回滚。
- **品牌色相微调**：在保留暖色基调的前提下，把 `--accent` 由 Claude 橙 `#d97757` 偏移为更具品牌辨识度的「珊瑚橘 + 余晖粉」复合渐变；新增 `--lively-1/2/3` 三档灵动辅色（蜜桃 / 杏黄 / 暮紫），用于装饰与点缀，主文本色不动。
- **氛围背景层**：在 `body` 与 `.app-root` 上叠加可关闭的低频浮动光斑（aurora blobs），仅 transform/opacity 动画，挡位 lite 与 reduced-motion 自动静止。
- **卡片灵动化**：卡片悬停轻微上浮 + 阴影柔化 + 内部高光扫过；列表项进入时按 stagger 已有节奏，但每项加入轻微旋转入场（±1.5deg）打破规整。
- **按钮/控件微交互**：主按钮 hover 内发光 + 微缩放；胶囊 tab 切换时活跃 pill 沿轨迹滑动（已有 `.dock-ink` 形态，扩展到 `.tabs-bar`）；开关、复选框、单选加入 spring 反弹。
- **数字与计数**：钱包余额、签到连签、排行榜分数等数值变化时以 count-up 动画呈现（CSS-only via `@property` + transition，无 JS 计时器）。
- **Toast / Dialog / Sheet 入场**：从当前简单淡入升级为 spring + 微过冲弹入，关闭时反向回缩。
- **加载态人格化**：在 `.skel` 基础上叠加「呼吸光晕」与轻微 y 偏移，让骨架屏「有呼吸感」而非死板闪烁；FAB/中央 +AI 钮空闲时极低频呼吸光圈。
- **手绘装饰元素**：在欢迎卡 hero、空状态、章节标题处引入手绘下划线 / 角标 SVG（描边风，非填充），打破「AI 网格感」。
- **字重节奏**：标题字重由当前统一 540 调整为更跳脱的对比（h1 加重至 600、副标 400 偏轻），但保留 `--serif` 字族不变。
- **滚动揭示**：新增 `.reveal` 工具类，IntersectionObserver 已有（`web-super.css` 滚动揭示）基础上扩展变体（左入、右入、缩放进入）。
- **去 AI 感**：移除/淡化「Claude 橙」单色覆盖，全部改为珊瑚橘→余晖粉的双色渐变；移除过于规整的 4px 网格圆角对齐，关键卡片采用非对称圆角（如 hero 卡 28/24/24/26）；引入极轻噪点纹理（SVG turbulence 内联，opacity 0.025）增加「手作」质感。

## Impact
- **Affected specs**: 无既有 spec 文件（`.trae/specs/` 此前为空），本次为首份。
- **Affected code**:
  - 新增：`client/src/styles/app-lively.css`（唯一新增文件，集中所有改动）
  - 修改：`client/src/styles.css`（在 `@import './styles/app-motion.css';` 之后追加 `@import './styles/app-lively.css';` 一行）
  - 不修改：任何 `.jsx` / `.js` / 服务端 / 路由 / 状态 / API 文件（除非确需挂新工具类名到现有元素，且仅限 className 追加，不动逻辑）
- **Risk**: 新增层在级联末位，按现有架构铁律可安全覆盖前层；所有动画 transform/opacity-only，挡位门控与 reduced-motion 已有体系可直接复用；如出现性能回退，移除 `styles.css` 末行 import 即整体回滚。

## ADDED Requirements

### Requirement: 灵动视觉语言层
系统 SHALL 在现有级联末尾追加 `app-lively.css`，作为唯一视觉焕新入口，所有改动集中于该文件，不修改任何既有 CSS 文件内容（仅 `styles.css` 追加一行 import）。

#### Scenario: 灵动层加载
- **WHEN** 应用启动并加载 `styles.css`
- **THEN** `app-lively.css` 在 `app-motion.css` 之后被导入
- **AND** 灵动层的所有规则仅在 `html[data-app="1"]` 或全站 `.lively-*` 工具类作用域内生效
- **AND** 不影响 web/mobile-web 既有观感（除非显式全站类）

### Requirement: 去AI感品牌色相
系统 SHALL 把品牌主色从单色 Claude 橙调整为「珊瑚橘 → 余晖粉」双色渐变体系，并新增三档灵动辅色。

#### Scenario: 主色应用于按钮与高亮
- **WHEN** 用户查看主按钮、活跃 tab、品牌标识等主色场景
- **THEN** 这些元素采用 `linear-gradient(135deg, #ff8a6b, #f56b8e)` 灵动主渐变
- **AND** 文本主色 `--text`、次文本 `--muted` 保持不变，确保可读性不回退
- **AND** 老的 `var(--accent)` 变量继续可用（被新值覆盖），不破坏既有引用

### Requirement: 氛围背景动效
系统 SHALL 在主背景叠加低频浮动光斑营造氛围感，并尊重性能档位与无障碍设置。

#### Scenario: 普通设备展示氛围层
- **WHEN** 用户在标准设备上打开任意页面
- **THEN** 背景出现 2-3 个柔焦光斑以 18-28s 周期缓慢漂移
- **AND** 光斑仅使用 transform 与 opacity，不触发 layout/paint

#### Scenario: 低端机或减弱动效
- **WHEN** `html[data-perf="lite"]` 或 `prefers-reduced-motion: reduce` 命中
- **THEN** 光斑动画静止、opacity 降至 0，背景回归纯色

### Requirement: 卡片与列表项灵动入场
系统 SHALL 为卡片与列表项加入更具生命力的入场与悬停反馈。

#### Scenario: 卡片悬停
- **WHEN** 用户悬停可点击卡片
- **THEN** 卡片上浮 2-4px，阴影柔化，内部高光在 1.2s 内扫过一次
- **AND** 移动端（无 hover）按下时同样触发上浮，松手弹回

#### Scenario: 列表项 stagger 入场
- **WHEN** 列表容器挂 `.stagger-in` 类
- **THEN** 子项按现有 30ms 步进依次浮现
- **AND** 每项加入 ±1.5deg 的轻微旋转（交替方向），打破绝对规整
- **AND** 第 9 项起不再追加延迟（沿用现有规则）

### Requirement: 微交互与控件反馈
系统 SHALL 为按钮、tab、开关、复选等控件加入 spring 弹性反馈与状态过渡。

#### Scenario: 胶囊 tab 切换
- **WHEN** 用户在 `.tabs-bar` 中切换 tab
- **THEN** 活跃 pill 以 spring 曲线滑动到新位置（如不支持滑动则淡入淡出）
- **AND** pill 内文字色平滑过渡

#### Scenario: 开关切换
- **WHEN** 用户切换 `.switch` 开关
- **THEN** 滑块沿 spring 曲线滑到对侧并轻微过冲
- **AND** 轨道背景同步渐变

### Requirement: 数值变化动画
系统 SHALL 为关键数值（钱包余额、签到连签、分数）提供 count-up 动画。

#### Scenario: 余额更新
- **WHEN** 钱包余额数值变化
- **THEN** 数字以 ~0.6s 缓动从旧值滚动到新值
- **AND** 减弱动效模式下直接显示最终值

### Requirement: Toast/Sheet/Dialog 弹性入场
系统 SHALL 为浮层组件加入 spring 弹性入场与回缩退场。

#### Scenario: Toast 弹出
- **WHEN** Toast 被触发
- **THEN** Toast 从顶部以 spring 曲线弹入并轻微过冲
- **AND** 关闭时反向回缩淡出

#### Scenario: 底部 Sheet 与 Dialog
- **WHEN** 用户打开底部 Sheet 或 Dialog
- **THEN** Sheet 从底部 spring 上推，Dialog 从中心 scale 弹入
- **AND** 关闭时反向播放

### Requirement: 加载态人格化
系统 SHALL 在骨架屏与空闲态加载元素上叠加「呼吸」感。

#### Scenario: 骨架屏呼吸
- **WHEN** 数据加载中显示 `.skel`
- **THEN** 骨架屏在原有光泽扫描基础上叠加轻微 y 偏移（±2px）与 opacity 呼吸
- **AND** 周期与现有 1.4s 协调，不冲突

#### Scenario: FAB 空闲呼吸
- **WHEN** 中央 +AI 钮或快速创建 FAB 处于空闲态
- **THEN** 钮周围出现极低频光圈呼吸（4s 周期）
- **AND** 用户按下或菜单展开时静止

### Requirement: 手绘装饰元素
系统 SHALL 在关键位置引入手绘描边装饰以打破 AI 网格感。

#### Scenario: Hero 卡装饰
- **WHEN** 用户查看欢迎/hero 卡
- **THEN** 卡片角落或标题下方出现手绘描边下划线/角标 SVG
- **AND** 装饰元素颜色采用灵动辅色之一，不喧宾夺主

#### Scenario: 空状态
- **WHEN** 列表为空显示空状态
- **THEN** 空状态插画采用手绘描边风（如现有空态已有插画则替换其颜色为灵动辅色）

### Requirement: 滚动揭示变体
系统 SHALL 扩展滚动揭示动画，提供多种入场方向。

#### Scenario: 揭示变体可用
- **WHEN** 元素挂 `.reveal`、`.reveal-left`、`.reveal-right`、`.reveal-scale` 之一
- **THEN** 元素在进入视口时按对应方向（上/左/右/缩放）入场
- **AND** 已在视口内的元素不重复触发
- **AND** reduced-motion 命中时直接显示

### Requirement: 性能与可访问性门控
系统 SHALL 复用现有 perf.js 挡位体系与 prefers-reduced-motion，所有新增动画可被静默降级。

#### Scenario: 挡位降级
- **WHEN** `html[data-perf="lite"]` 或 `html[data-page-hidden]` 命中
- **THEN** 灵动层所有装饰性动画（氛围光斑、呼吸、流光、count-up）静止
- **AND** 交互反馈动画（按压、tab 切换）保留但时长压缩到 0.05s

#### Scenario: 减弱动效
- **WHEN** `prefers-reduced-motion: reduce` 命中
- **THEN** 所有新增动画静止，元素直接显示终态
- **AND** 不影响功能可用性

## MODIFIED Requirements

### Requirement: 既有 `app-motion.css` 工具类
[不改] 既有 `.stagger-in / .pressable / .flow-sheen / .skel / .pulse-dot` 语义保持不变，灵动层仅扩展行为，不重写定义。如确需扩展（如 `.stagger-in` 加旋转），通过在灵动层覆盖 `@keyframes motionRise` 实现，原名保留。
