# 琉璃 Liuli v5 — App 前端设计先知稿（承接静水青 Quiet Aqua v4.2）

> **视觉权威变更（Lumen Glass v1.0）**：App 壳的视觉/材质/色彩层现由
> `docs/design/LUMEN_GLASS_SPEC.md` 与 `docs/design/lumen-glass-tokens.css`（--lg-*，值冻结）接管；
> 本稿的产品结构、路由注册、状态矩阵、无障碍与 Web 零差异边界继续有效。
> 迁移记录见 `docs/design/LUMEN_MIGRATION_PLAN.md`。

文档状态：`v5 / Liuli authority / HTTP App-shell preview`  
适用边界：通过 `http(s)://<host>/?app=1` 启用的 Capacitor App 壳与 HTTP 内测壳。  
非适用边界：普通 Web（`?app=0` 或未进入 App 模式）不得被本稿改变。

## v5 「琉璃 Liuli」修订总纲（本轮重构的最高约束）

v5 在 v4.2 的结构、控件契约与防 AI 约束全部保留的前提下，完成三件事：

1. **全新配色**：品牌与动作色从青绿松石改为**群青**（浅 `#1D5FDB` / 深 `#7AA5FF`），
   页面底/分组底/内容面/文字全部改为**纯中性瓷白与墨灰阶**（不再带青偏）：
   canvas `#F6F7F9`、grouped `#EDEFF3`、surface `#FFFFFF`、ink `#16181D`、
   hairline `#E2E5EA`；暗色域 canvas `#0A0C10`、surface `#161A20`、ink `#F2F4F7`。
   语义色（金/珊瑚/靛/蓝/玫瑰/石墨/成功/危险）保持语义并按新灰阶重调；
   金融石墨实体为 `#23272E`。令牌**改值不改名**（`--qa-*` 为遗留命名空间）。
2. **玻璃 chrome 契约**：玻璃只属于导航与临时层（Dock、顶栏、聊天输入岛、
   Sheet、Modal、FAB），由 `--qa-glass-chrome/sheet/thin` 三档材质令牌驱动
   （blur 20/28/14px + saturate + 发丝边 + 1px 顶高光）。**high 与 balanced 档
   chrome 玻璃常开**；内容面永远不透明；lite 档在令牌层将全部 blur 归零。
3. **暗色跟随系统**：App 的「跟随系统」真正跟随系统深浅色（v4.2 强制浅色的
   特例废除）；暗色玻璃用墨色 tint，所有层级/对比契约与浅色等价。

其余 v5 事实：App 内标题一律 UI 字体（新增大标题字阶 `34px`）；永久装饰动画
白名单只含状态循环（loading/骨架/流式光标/打字点，`app-test.mjs` 断言守护）；
内容媒体 PNG 由 `scripts/render-app-assets.mjs` 确定性生成（空态 ×7、开机月门
徽记、SVIP 织纹、原生图标源图），全部零文字；原生启动色为琉璃画布 `#F6F7F9`，
沉浸状态栏语境色 `#0E1013`。下文 v4.2 正文中的具体色值以本节与
`app-quiet-aqua-tokens.css` 为准。

本稿是 PR5 的设计、实现与验收权威。它规定的是产品结构、动态反馈和质量门槛，不是要求把生图稿的假文字逐像素烘焙进产品。业务数据、权限和后端协议不因本稿改变。

## 0. v4.2 母版、复合渲染与防 AI 风格约束

本轮新增的高保真母版位于 `docs/ui-oracle/wallet-deep-pages-reference-v4.png`。它用于钱包、充值、角色详情和世界书编辑四条深层路径的构图核对；`client/dist/quiet-aqua-e2e/` 与 `docs/ui-baselines/manual-v4/` 保存 390×844 实测帧。钱包专项还可用 `node server/quiet-aqua-e2e.mjs --wallet-only` 单独重生成浅/深色钱包与充值截图。核对顺序是：先看信息层级与操作因果，再看媒体裁切和材质，最后才看颜色数值。

- UI 采用复合渲染：活文本、按钮、Tab、账本和弹层保持 React/CSS/可访问 DOM；角色照片这类极难可靠矢量化的内容允许使用经过审阅的 PNG。PNG 只能是内容媒体，不能包含产品文字、按钮、导航或状态。
- `client/src/assets/quiet-aqua-character-v3.png` 是当前 App 的审阅媒体 fallback，来自母版人物源图；Web 分支不读取它。改用 PNG 是为了保留头发、布料和光照细节，避免低保真路径临摹产生“塑料/AI 贴纸”观感。
- 色彩从“单一青色主题”改为“中性内容底 + 语义强调”：金币/会员使用暖金，钻石使用冷蓝，成就使用麦金，未读/危险使用珊瑚，编辑与正文使用纸白/石墨；青色只负责主动作和选中反馈。禁止把每个卡片都染成青色、禁止彩虹 `nth-child`、禁止无因果呼吸/扫光。
- 资产仪表使用石墨/森林黑的独立实体面；它不是品牌青的放大版。消息入口固定为珊瑚（互动）、蓝（私信）和靛蓝（群聊），创作工作台固定为靛蓝/珊瑚/金，用户强调色不得改写这些内容语义。
- 视觉验收基准为 `390×844`，并必须在 `360×800`、`412×915` 成立。当前发现页实测：`app-main/feed=390×844`、Dock `x=18..372/y=770..836`、通话按钮 `52×52` 完整可见、文档高度 `844` 无白色底板。

当前没有把 v3 页面写入可编辑 Figma 画布，也不把任何 Figma 文件声明为已交付成果。三张 v3 母版、本文、代码令牌、控件联系表和可由 E2E 重生成的浏览器截图共同构成证据链；未来若同步到 Figma，Figma 只是评审镜像，不能反向覆盖已经验收的代码契约。

## 1. 权威层级与设计证据

发生冲突时按以下顺序处理：

1. 本稿：产品原则、页面原型、交互语义和发布门槛。
2. `client/src/styles/app-quiet-aqua-tokens.css`：公开的 `--qa-*` 语义令牌。
3. `client/src/components/AppControls.jsx` 与 `client/src/styles/app-controls.css`：按钮、图标按钮、Tab、Dock 与浮层控件契约。
4. `client/src/styles/app-pages-quiet-aqua.css`：App 全路由兼容层；`client/src/styles/app-experience-v3.css`：v3 的页面空间原型、内容层级与因果动效。
5. `/app-controls?app=1`、`client/app-test.mjs`、`server/quiet-aqua-e2e.mjs`：可执行状态联系表与验收事实。
6. `docs/ui-oracle/generated/v3/` 下的母版：构图与材质证据，不是运行时页面。

三张 v3 母版的角色如下：

| 文件 | 尺寸 | 负责回答的问题 |
|---|---:|---|
| `quiet-aqua-v3-primary.png` | `1657 × 949` | 今日、发现、消息、我的四个一级目的地如何各自成立，而不是共享同一张卡片模板 |
| `quiet-aqua-v3-core-flow.png` | `1700 × 925` | 角色详情、私聊、群聊、角色编辑如何保持内容连续性和明确操作重心 |
| `quiet-aqua-v3-secondary.png` | `1651 × 953` | 钱包、SVIP、创作工坊、设置如何使用不同的实体隐喻与空间结构 |

母版中的人物、文案、数量和状态仅作构图示意。真实产品必须使用实时数据、可访问的 DOM 文本和真实交互状态。`TRACE_SPEC.md` 保留早期四屏的坐标测量价值，但 v3 构图与本稿优先于其中的 v1 视觉结论。

## 2. Apple 设计原则的本项目化

静水青借鉴 Apple 对内容、层级、直接操纵、反馈、材质和平台惯例的处理方式；不复制 Apple Logo、SF 字体、SF Symbols、营销资产或受许可限制的设计资源。

### 2.1 内容谦让

- 角色、故事、对话和创作正文是第一视觉层；导航与控件应在需要时清楚出现，不与内容争夺注意力。
- 沉浸页允许媒体占满画面，信息通过安全的遮罩与留白叠加；普通列表和表单不得假装成沉浸页。
- 真实用户媒体优先。路径化人物只用于缺少合格媒体的种子或演示位。

### 2.2 清晰而非贫乏

- 标题、主要动作、次要动作和元数据必须一眼分级；“极简”不能删除必要的身份、状态、返回路径或失败处理。
- 产品文字全部是活文本，不烘焙进截图或人物 SVG。
- 图标只辅助含义；不熟悉的图标需要文字或可访问名称。

### 2.3 深度表达关系

- 深度用于说明“内容、导航、临时操作”三层关系，而不是给每个容器加阴影。
- 内容面以不透明表面、发丝边和短阴影为主；玻璃用于 Dock、工具条、输入岛、Sheet、Modal 等临时控制层，也允许用于钱包的资产仪表、快捷操作和充值结算条——这些层必须表达“可操作的金融仪表”，而不是把整页套成玻璃。
- 共享媒体转场、Sheet 升起和返回方向负责解释“从哪里来、到哪里去”。

### 2.4 直接操纵与即时反馈

- 横向项目轨、纵向沉浸流、下拉刷新和 Sheet 拖动必须跟随手势，而不是延迟到抬手后才突然跳变。
- 每次触控都要有即时按压或状态反馈；每次异步动作都要有 loading、成功或错误闭环。
- 触控反馈不等于装饰动画。没有用户动作、数据变化或导航因果时，不应自行运动。

### 2.5 平台惯例优先

- Dock 只承载目的地，创建是独立动作；返回键、键盘、系统安全区、焦点与脏数据确认遵守 App 导航契约。
- 危险操作使用明确文案和确认层；不依赖颜色单独传达风险。
- 深色、性能档和 reduced-motion 是同一产品的等价模式，不是降级后可以失去语义的皮肤。

## 3. 静水青视觉语言

### 3.1 语义色

以下值以 `app-quiet-aqua-tokens.css` 为准。`app-experience-v3.css` 中的 `--qa3-*` 是页面组合的内部别名，不是第二套公共主题 API。

| 语义 | 浅色 | 深色 | 规则 |
|---|---:|---:|---|
| 页面底 | `#F6F7F9` | `#0A0C10` | 最底层背景 |
| 分组底 | `#EDEFF3` | `#11141A` | 分段、弱选中、凹层 |
| 内容面 | `#FFFFFF` | `#161A20` | 列表、表单、正文面 |
| 主文字 | `#16181D` | `#F2F4F7` | 标题、正文、关键数值 |
| 次文字 | `#5B6470` | `#A6AEB9` | 说明、时间、元数据 |
| 品牌群青 | `#1D5FDB` | `#7AA5FF` | 品牌基调与默认动作色 |
| 危险 | `#B42318` | `#FF8B83` | 删除、停止、不可逆动作 |
| 成功 | `#1E7A50` | `#69C79D` | 完成、在线、签到成功 |
| 奖励 | `#8A6200` | `#E0B95C` | 金币、稀有度、会员金 |
| 未读 | `#C6483C` | `#FF8077` | 未读与待处理角标 |
| 社交蓝 | `#33758F` | `#86C4DB` | 私信、关系与社交信息（与品牌群青拉开明度饱和差） |
| 创作靛蓝 | `#4E5D9D` | `#A8B4E8` | 编辑、拆解、创作工具 |
| 收藏玫瑰 | `#A8546E` | `#E2A0B8` | 喜欢、收藏；不替代危险红 |
| 金融石墨 | `#23272E` | `#1A1E26` | 钱包/账户仪表实体，不用于普通内容卡 |

用户强调色 clay、dusk、teal、forest、rose、amber 只改变动作、选中和焦点。危险、成功、奖励、未读不得随主题漂移；不得用 `nth-child` 为快捷入口制造彩虹配色。

允许的渐变只有三类：媒体可读性遮罩、具有明确实体隐喻的钱包/SVIP 材质、单次状态反馈。禁止青紫/群紫霓虹、无语义多色渐变、呼吸光、永久扫光和“AI 感”背景。

### 3.2 字体与排版

- UI 字体使用 `Inter`、`PingFang SC`、`Microsoft YaHei`、系统无衬线回退；不使用或分发 SF 字体。
- 大标题 `34px`（一级 Tab 页），展示标题约 `28px`，页面标题 `22px`，分区标题 `17px`，正文 `15px`，元数据 `13px`；小屏优先换行和重排，不整体缩小字体。
- 叙事阅读面可以使用项目已有中文衬线字体，但导航、按钮、状态仍使用 UI 字体。
- 数字资产应对齐、稳定宽度；长标题、动态数字和系统字体放大不得造成横向溢出。

### 3.3 几何、表面与安全区

- 基准视口为 `390 × 844`；同时必须在 `360 × 800` 和 `412 × 915` 成立。
- 页面主边距通常为 `16px`，紧凑屏可降至 `14px`；间距以 `4/8/12/16/20/24` 为节奏。
- 普通触控目标最小 `44 × 44px`；认证提交最小 `48px`。可见图标板可以更小，但交互盒不能缩小或重叠。
- 卡片圆角通常 `18px`，面板 `20px`，Sheet `24px`；圆角随层级变化，不为所有对象使用同一胶囊形。
- 内容卡使用一层发丝边与短阴影；浮层使用更高阴影。禁止在同一对象上叠加多层玻璃、描边和外发光。
- 顶部、底部、键盘和刘海区域使用 `env(safe-area-inset-*)`；固定 Dock、输入岛和保存条不得遮挡最后一个可操作项。
- `lite` 关闭 Dock、Sheet、输入岛、工具栏等模糊并回落为不透明表面；层级和对比度保持不变。

### 3.4 钱包与充值材质

- `/wallet` 根页使用“资产仪表 → 四项快捷操作 → 奖励/签到 → 线性账本”的顺序；不再叠加一个与母版无关的“钱包/充值”分段器。
- 资产仪表可以使用带 blur/saturate 的双层蓝青玻璃，并用一处暖金光点区分会员与金币；玻璃边缘、内高光和阴影各只出现一层。
- 金币和钻石、六档充值套餐属于高细节产品媒体，运行时使用 `client/src/assets/wallet-products/*.png`（以及同一母版裁出的货币 PNG）；不能把这些切面产品图强行简化成 SVG。
- 套餐卡、支付列表和结算条保留透明度与背景模糊，但文字、金额、禁用原因必须是活文本；充值未通过供应商健康检查前，结算按钮可见但明确禁用，不创建订单。
- `lite` 档关闭模糊并回落到不透明表面，产品 PNG、金额语义和操作顺序不变。

## 4. 七种页面空间原型

七种原型共享令牌和控件行为，但不共享同一套页面骨架。新页面先选择一个原型，再根据内容发散；禁止把所有信息重新塞进相同白色圆角卡片。

| 原型 | 代表路由 | 空间与操作重心 | 不允许 |
|---|---|---|---|
| 1. 编排式内容首页 | `/today` | 大标题、连续身份区、成组快捷入口、编辑精选媒体、横向续读轨；从“今天做什么”自然下行 | 仪表盘卡片海、六个独立玻璃入口、无重点瀑布流 |
| 2. 沉浸式角色媒体 | `/`、`/character/:id` | 全幅媒体是第一层；文字和动作沿安全区叠加；发现到详情共享人物媒体连续性 | 把人物压进普通卡片、遮罩不足、边缘热区过小、进入详情后仍显示一级 Dock |
| 3. 索引与消息列表 | `/messages`、`/notifications`、`/friends`、`/groups`、`/search`、`/library`、`/worldbooks` | 原生感分组列表、稳定行高、发丝分隔、清楚的时间/未读/尾随动作；滚动效率优先 | 每行悬浮成卡、预览撑高行、仅靠颜色表达未读、跨行热区重叠 |
| 4. 会话流 | `/chats/:id`、`/group/:id` | 顶部身份、连续消息日志、单层输入岛；私聊可保留低对比人物气氛，群聊使用冷白内容面和成员条 | 双层输入框、卡片汤、背景压过正文、挂断或离页后迟到音频继续播放 |
| 5. 身份与价值 | `/me`、`/wallet`、`/vip` | Profile 是身份与内容陈列；Wallet 是一块石墨资产仪表加线性账本；SVIP 是单一金属实体加权益清单 | 三页套同一模板、金币/SVIP 金铺满全页、持续扫光、金额与主动作争抢层级 |
| 6. 表单与设置 | `/auth`、`/settings` | Auth 直接进入任务，不摆宣传舞台；Settings 使用 inset group、通知摘要和逐层详情；标签、帮助和错误紧邻字段 | 表单被装饰遮挡、提交失败无解释、全部设置平铺一页、Web 注册能力被 App 文案覆盖 |
| 7. 创作与叙事工作台 | `/character/new`、`/character/:id/edit`、`/atelier`、`/atelier/:id`、`/theater/:id` | 编辑器是聚焦步骤与可见草稿状态；书架是可直接操纵的横轨；小说工作台突出稿纸和工具；剧场是连续纸/墨阅读流 | 套用聊天气泡表现叙事、保存动作漂移、失败载入仍可覆盖数据、工具栏遮挡正文 |

### 4.1 一级导航

- `<nav>` 内只有今日、发现、消息、我的四个目的地。
- 创建按钮位于 `<nav>` 之外，是 Dock 的同级动作，不是假装成第五个 Tab。
- 一级页面可以 KeepAlive；详情页、编辑页、会话页和阅读页按 Route Registry 隐藏 Dock。
- 返回顺序为：顶层浮层 → 键盘/焦点 → 未保存确认 → 上级页面 → 默认 Tab → 二次返回退出。

### 4.2 浮层

- Sheet、Modal、命令面板、成员列表和创建面板统一使用 OverlayProvider。
- App 浮层必须 Portal 到 `body`，具备 `role="dialog"`、`aria-modal="true"`、焦点锁、背景 `inert/aria-hidden`、滚动锁、Escape/Android 返回关闭和焦点归还。
- 警告型删除使用 `alertdialog` 或等价明确语义，并提供取消与危险动作；点击遮罩关闭不能绕过脏数据或进行中动作保护。

## 5. 因果动效规范

静水青必须“会动”，但每段运动都要回答“是什么变化导致的”。持续装饰动画为零；加载旋转和骨架是仅有的必要循环，并在状态结束时停止。

| 原因 | 允许的运动 | 时间预算 | 约束 |
|---|---|---:|---|
| 手指按下 | 颜色/阴影变化，最多缩放至 `.97` | `80ms` | 父子不得双重缩放；抬手立即复位 |
| 选中、开关、焦点 | 底色、下划线、焦点环平滑切换 | `180–380ms` | `selected` 与 `pressed` 语义不得混用 |
| 页面 push/pop | 与导航方向一致的短位移和淡入 | `220–460ms` | 返回不能像前进；未知路由不猜测方向 |
| 发现 → 角色详情 → 对话 | 人物媒体共享连续性、控件退场/接管 | `440–720ms`，一次 | 不延迟内容可用性；背景不得无限漂移 |
| Sheet/Modal 打开 | 从操作来源附近升起并稳定落位 | 约 `380ms` | 打开即转移焦点，关闭后归还焦点 |
| 新消息/新项目 | 沿列表或轨道方向进入 | `300–420ms`，一次 | 历史内容首次挂载不得长时间依次表演 |
| 下拉刷新 | 高度、阻尼、图标角度跟手，释放后回弹 | 跟手；回弹约 `260ms` | 横向轨道不能误触刷新；`touchcancel` 不提交动作 |
| 资产/SVIP 实体出现 | 轻微落位或一次材质光线通过 | `540–820ms`，一次 | 不循环扫光；不能阻碍金额和 CTA 阅读 |
| 保存、发送、签到 | 原位 loading → 明确成功/错误反馈 | 状态驱动 | 防重复提交；失败不伪装成功，不清空用户输入 |

支持滚动时间线时，今日精选媒体可以做幅度很小的滚动视差；`lite` 或 reduced-motion 必须关闭。`prefers-reduced-motion: reduce` 下取消位移、缩放、视差与非必要过渡，必要进度只保留最简状态反馈。

## 6. SVG 与生成图约束

### 6.1 设计源与运行时严格分离

- `quiet-aqua-v3-primary.png`、`quiet-aqua-v3-core-flow.png`、`quiet-aqua-v3-secondary.png` 和源图只允许作为设计证据存在于 `docs/ui-oracle/`；整屏母版不得被客户端 import、fetch、CSS `url()` 或运行时请求。
- 禁止把母版整屏转成 SVG 后作为页面嵌入。页面 UI 必须由 React、CSS、活文本、语义控件和小型代码原生图标实现。
- 人物生产资产为 `client/src/assets/quiet-aqua-character-v3.png`，通过 `art.jsx` 的 `QuietAquaCharacterArt` 作为缺少真实媒体时的 App fallback 使用；它是内容媒体，不承载任何 UI 文本或控件。

### 6.2 生产人物 SVG 契约

- 允许标签集合只有 `<svg>` 与 `<path>`。
- UI SVG 禁止 `<image>`、`href/xlink:href`、Data URI、脚本、`foreignObject` 和远程资源。内容媒体可以是经过审阅的 PNG/JPEG/WebP，但不得把整屏 UI 截图当作运行时背景。
- 固定画布 `941 × 1672`；当前核验为 `2,617` 条路径、`628,234` 字节。
- 当前 SHA-256 为 `65ACFA0DF0B232C0435CA9D63AA51FD82C31A9AECB213D22F5A0ED3C34F74EFB`。任何有意修改都必须重新视觉评审并更新 `TRACE_REPORT.md`；无意变化直接阻断。
- 大 SVG 以 URL 形式作为 `<img>` 复用浏览器缓存，不把 2,617 条路径重复内联到页面 DOM。
- 首屏必要媒体可 eager；邻屏和长轨媒体 lazy。真实头像/立绘始终优先，Web 保留原占位策略。

实际追踪管线、候选文件和清理清单见 `docs/ui-oracle/TRACE_REPORT.md`。

## 7. 控件、状态与无障碍

### 7.1 控件契约

- `AppButton` 只使用 `primary / secondary / tertiary / danger`；`AppIconButton` 只使用 `ghost / secondary / filled`。
- 普通按钮和图标按钮不小于 `44px`；认证提交不小于 `48px`。
- 图标按钮必须有显式可访问名称。数字角标视觉上封顶 `99+`，辅助技术仍读取真实数量。
- `selected` 仅控制视觉选择；真正二态控件通过 `pressed` 输出 `aria-pressed`。目的地 Tab 使用 `aria-current="page"`。
- loading 保持原宽并输出 `aria-busy`；disabled 不可点击、不可导航、不可留在 Tab 顺序。非 button 控件还必须阻止默认导航和事件冒泡。
- `focus-visible` 必须有可见外环，且不被父容器裁切。

### 7.2 页面状态矩阵

| 状态 | 必须呈现 | 交互要求 | 禁止 |
|---|---|---|---|
| 初始载入 | 与最终结构相近的骨架或 `role="status"`；必要时 `aria-busy` | 返回仍可用；不能提交空数据 | 永久白屏、骨架遮住系统返回 |
| 增量刷新 | 保留已有内容，显示局部进度 | 单飞；失败可重试 | 为刷新清空整页、重复请求叠加 |
| 空内容 | 说明为什么为空，并给一个合理下一步 | CTA 进入创建/发现/邀请等真实路径 | 伪造数据、只有插画没有解释 |
| 首次载入失败 | `role="alert"`、清楚错误、重试和返回/替代路径 | 重试恢复同一任务 | 展示可保存的空表单、把失败当空数据 |
| 提交中 | 原位 loading、相关输入和动作锁定 | operation 单飞；离页时取消或忽略迟到回调 | 双击重复创建、关闭后迟到成功写入 |
| 提交失败 | 保留用户输入，错误靠近任务 | 可继续修正和重试 | 清空草稿、显示成功色、静默失败 |
| 成功 | 状态、余额、列表或草稿标记立即一致 | 焦点留在合理位置；必要时提供撤销 | 只有 toast 而页面仍是旧状态 |
| 不可用 | 降低权重并保留原因 | 不响应、不进 Tab 序列 | 仅用低透明度但仍可点击 |
| 危险确认 | 明确对象、后果、取消和危险动作 | 焦点锁定；默认焦点不落在危险动作 | 含糊“确定吗”、点击穿透背景 |
| 离线/服务错误 | 保留会话和本地草稿，提供重试 | 只有 `401/403` 才按认证规则处理 | 因断网或 `5xx` 清除登录 |

### 7.3 内容与阅读辅助

- 消息容器使用日志语义并保持合理 live region；不可让整页每次刷新都被重复朗读。
- 头像和装饰图区分：有信息的图片提供有效替代文本，纯装饰使用空 `alt`/`aria-hidden`。
- 文本与背景目标对比度：正文至少 `4.5:1`，大号文字和必要图形至少 `3:1`；焦点、错误、成功不能只靠颜色。
- 键盘可完成 Tab 切换、表单、消息发送、浮层关闭与返回；软件键盘不能遮住输入和提交动作。
- 动态字体、中文长词、英文 URL 和大数值必须换行或截断，不产生超过 `1px` 的横向溢出。

## 8. Web 零视觉/行为差异

PR5 只改 App。普通 Web 是硬边界，不是“尽量不变”。

- 所有新增 CSS 选择器必须从 `html[data-app="1"]` 开始；禁止用全局规则补 App。
- App JSX 结构、文案、状态和导航参数必须由 `isAppMode()`/等价 App 分支隔离。
- AppControls 在 Web 必须走透明 `LegacyControl`：不增加 `qa-*` 类、内部 wrapper、默认 `type`、推导 ARIA、loading/selected 数据属性或额外交互。
- App 空态、错误态、删除 Sheet、返回上下文和 SVG fallback 不得覆盖 Web 原有文案、失败回退、确认方式或占位图。
- Web 不得请求 `docs/ui-oracle` 中的 PNG，也不得渲染生产人物 fallback 取代原有 Web 媒体策略。
- 对相同 URL、数据和视口执行 `?app=0` 基线比较。DOM、可访问树、文案、键盘行为、导航结果或截图任何非授权差异都阻断发布。

当前自动化已对 Auth 和 CharacterEditor 做明确 Web DOM 守卫；这不等于全局 Web 已有完整自动像素保护。所有受影响路由仍需按 `docs/ui-baselines/README.md` 生成并评审 Web 基线。

## 9. 验收矩阵与发布门槛

### 9.1 必跑命令

```text
npm run build
npm run build:static
npm run test:app
npm run test:app:e2e
node scripts/appdiff.mjs   # 样式/令牌重构时：改前 --baseline 录基线，改后对比须 0 changed pixels
```

`test:app:e2e` 会先重建 static 包。截图输出位于 `client/dist/quiet-aqua-e2e`，而后续 Vite build 会清空 `client/dist`，因此评审或归档必须在下一次构建前完成。

### 9.2 自动矩阵

| 维度 | 当前自动覆盖 | 通过标准 |
|---|---|---|
| 视口 | `360×800`、`390×844`、`412×915` | 横向溢出不超过 `1px`；控件不小于 `43.5px` 实测阈值 |
| 主题 | 390 浅色/深色 | 不出现浅色硬编码表面；层级与可读性等价 |
| 性能 | balanced、lite | lite 的 Dock、Sheet、输入岛和相关工具层无 blur |
| 动效 | `prefers-reduced-motion` | 非必要 transition/animation 接近 `0s`，无位移残留 |
| 控件 | Controls Gallery | 44/48px、focus-visible、selected/pressed、loading、disabled link、数字角标 |
| 浮层 | Create Sheet、群成员、阅读设置、创作工具等 | Portal、dialog 语义、背景隔离、焦点锁和关闭后焦点归还 |
| 核心页 | 22 个列表/一级/次级页面，390 浅色与深色 | 无浏览器错误、无破图、无小控件、无横向溢出 |
| 详情流 | CharacterView、GroupRoom、TheaterRoom、NovelWorkspace | 身份、正文/日志、工具/输入存在；详情页无 Dock |
| 编辑器 | 360 浅色四段、390 深色媒体段 | 正确 Tab/tabpanel、固定保存条、无小控件、无溢出 |
| 错误态 | CharacterView、TheaterRoom、CharacterEditor、NovelWorkspace fallback | alert/重试/返回可用；失败编辑器不暴露保存 |
| SVG/媒体 | `client/app-test.mjs` | 控件与装饰 SVG 保持代码原生；人物内容媒体使用审阅 PNG；运行时代码不引用整屏母版或文档目录 |
| Web | Auth、CharacterEditor 明确守卫 | 无 App 类、wrapper、状态属性或 App 文案泄漏 |

### 9.3 人工与截图门槛

- 浅色/深色都要核对中文长文案、动态数字、真实头像、无头像、慢网、断网、空态和错误态。
- 必测软件键盘、刘海/状态栏、底部手势区、Android 返回、脏编辑退出、浮层堆叠、下拉刷新和横向轨道冲突。
- 必测 teal 与 clay；语义危险/成功/奖励/未读不得随强调色改变。
- 对比三张 v3 母版评审“层级、构图、材质和动作因果”，不做生图伪文字的像素复制。
- `docs/ui-baselines/manual-v4/` 已归档发现、钱包/充值、世界书与剧本深页的人工评审帧；`client/dist/quiet-aqua-e2e/` 每次构建重生成主屏、深页、深色与错误态截图。自动化已覆盖几何、控件、溢出、焦点和 Web 守卫，但主屏尚未全部接入 pixelmatch，因此“脚本跑完”仍不能替代母版人工对照。
- Web 对所有受影响路由执行同数据基线；任何 App-only DOM、文案或行为泄漏都阻断。

只有当代码、状态、无障碍、动效、SVG、截图和 Web 守卫同时通过，PR5 才能声明完成。Figma 是否同步不构成发布门槛，也不能替代上述证据。

## 10. S7「仪式与相伴」附录（阶段三收口记录）

本节记录阶段三（Lumen S7）新增的组件契约、素材账目与令牌迁移终局，与 §0–§9 同级生效；冲突时以红线（§0、§8）优先。

### 10.1 新组件契约

- **AppErrorState**（`.qa-error-state`）：首载失败的唯一合法出口。`role="alert"`；art 必须来自 `APP_EMPTY_ART` 目录 kind；重试为主按钮（≥44px，busy 态防重入），可选次级导航退路。禁止裸文字失败或死路空屏。
- **AppOnboarding**（`.qa-onboard`）：三屏首启引导。弹出条件 = App 模式 ∧ 已登录 ∧ 无 `huanyu_onboard_done` ∧ `user.created_at` 距今 ≤7 天；老账号静默写键不弹。完成/跳过同时写 `huanyu_welcome_seen` 防双弹。兴趣 chips 上限 6，落 `PUT /settings {interests}` 且尊重 personalize 开关。非当前屏 `inert`；reduced-motion 直切无位移。e2e `preparePage` 默认预置该键，专测用 `onboard:false` 退出。
- **CheckinCalendarSheet**（`.qa-cal`）：签到月历。`role="grid"` + 星期表头；数据唯一来源 `GET /economy/checkin/calendar`；月导航钳最近 12 个月；今日描环、已签实心、未来置灰；失败必须给出重试。
- **ShareCardSheet**（`.qa-share-sheet`）：分享卡出口。`sharecard.js` 动态 import，不入首屏 chunk；`document.fonts.ready` 后绘制；出口顺序 = `navigator.canShare({files})` 系统分享 → `<a download>` 保存 → 复制链接兜底；用户取消（AbortError）静默。
- **AppPressMenu**（`.qa-press-menu`）：长按上下文菜单。`useLongPress` 450ms/10px；portal + isolate + `role="menu"`；挂载 350ms 内忽略 mask 点击（吞长按尾随合成 click，行级同样抑制）；Escape/mask 关闭并把焦点还给触发行。

以上浮层全部登记进 `appgestures.js` 的 NO_TAB_SWIPE/NO_PULL（含 `.qa-ach-wall`），与 Tab 横滑、下拉刷新互斥。

### 10.2 空态/错误态落账表（§7.2 补全）

19 处 icon-only/裸空态已全部接入 art 空态，首载错误接 AppErrorState 带重试：Achievements、Theater、Atelier、NovelWorkspace（列表/角色/世界书三面）、Leaderboard、Events、Announcements、GroupRoom、Worldbooks 与 WorldbookView、Search 无结果、Insights（含错误态补重试）、Parliament、Community、Tags、Draw。既有已达标页（Messages/Friends/Library/Favorites 等）维持原契约不动。

### 10.3 素材目录与许可

- `client/src/assets/app/` 共 23 张 PNG，全部由 `scripts/render-app-assets.mjs` 确定性本地生成（SVG→Chromium 截图，Lumen P 调色板，零文字零按钮，单张 <300KB），原子写入（tmp 目录 + rename，杜绝半成品目录）。
- 本轮未引入任何外部位图：环境网关封锁全部图床（实测 CONNECT 403），改道本地管线为主路径；无第三方许可负担，版权随项目。
- 目录：empty ×16（generic/chat/favorites/friends/library/notifications/search/achievements/theater/atelier/leaderboard/events/worldbooks/insights/noresult/group）、onboard ×3（world/craft/tune）、streak-seal、vip-weave、boot-mark @2x/@3x。

### 10.4 分享卡媒体边界

- 分享卡是**运行时 canvas 合成的用户导出内容**（character/achievement/streak 三模板，固定 1080×1440 与 DPR 解耦），允许出现活数据文字——这不违反「入库 PNG 零文字」红线，因为它不入库、不进素材目录。
- 不建 canvas 像素基线（文本反走样跨环境不稳定）；e2e 只验预览 naturalWidth/Height、出口可用与无 console error。

### 10.5 qa→lg 令牌迁移终局（G8）

- 62 条纯别名（全部定义恒等于同一 `var(--lg-X)`）由 `scripts/migrate-qa-tokens.mjs` 批量改写 **1,821 处**引用为直连 `--lg-*` 权威：pages 1490 / controls 119 / hig 107 / v3 75 / runtime 9 / elevated 6 / s5 6 / renov 3 / shell 2 / s6 2 / chat-app 1 / ui.jsx 1。
- `app-quiet-aqua-tokens.css` 降级为**残余 shim**，仅存三类非纯定义：① 迁移期字面值（--qa-surface 系不透明内容面、44/48px 触控契约、语义 ink 黑白字面、玻璃 specular/阴影字面、编辑器 chrome 高度）；② color-mix 派生（pressed 与各 -soft 软底）；③ lite 条件回落面（chrome/overlay/玻璃底 → --lg-grouped）。纯别名禁止回填（app-test 反向断言）。
- 证据链：`scripts/appdiff.mjs`（9 路由 × light/dark/lite、冻结时钟、头像掩膜、2px AA 噪声阈）迁移前后 **0 changed pixels**；app-test 闭包断言「全 App 层 `var(--qa-*)` 引用 ⊆ 残余 shim 定义集」。令牌重构类改动此后一律先录 `--baseline` 再过 appdiff 0px 门。

### 10.6 后端契约同步（G1）

- `GET /economy/checkin/calendar?month=YYYY-MM`：由 `transactions(kind='checkin')` 推导（不建新表），北京日界 `cnToday`，月参数钳最近 12 个月；server 与 mock 双端同构（app-test 配对断言）。
- `settings.interests`：slug 白名单 = meta CATEGORIES、上限 6、逗号串存储；`/characters/recommended` 在 personalize 开启时对 interests 命中各 +2 权重（双端孪生）。
- 成就目录双端 30 条集合等值断言（matchAll id 提取 deepEqual）；honor 成就（creator_hall）reward 0、只铭刻不可领取，领取请求双端一致拒绝。
- 旧 `POST /economy/recharge` 双端一致返回 410 `PAYMENT_ORDER_REQUIRED`；充值走订单两端点，mock 入账一次性幂等（credited 标记）。支付路由本阶段零改动。

### 10.7 G10「相伴加深」增补（阶段三后半）

- **新端点/新列**：`GET /me/weekly`（北京周界周一起始）；
  `conversations.pinned/muted` 迁移列 + mark-only PATCH（不 bump
  `updated_at`，置顶不得伪造新鲜度）；`/engage/leaderboard` 登录附
  `me:{rank,score}`。三者均有 mock 孪生 + app-test 配对断言 +
  `server/s7-boundary.test.mjs` 验值（含旧充值 410、荣誉拒领、
  兴趣白名单钳制）。
- **新组件**：周报卡 `.qa-weekly-card`（role=img 全文替代、lite 去
  blur 实测）；`WhatsNewSheet`（S7 特性清单，我的页页脚入口）；
  分享卡新增 quote（聊天/剧场长按导出，旁白段署名「旁白」）与
  insights（星轨年鉴）两模板 —— 媒体边界同 §10.4。
- **会话草稿**：`huanyu_draft_<id>` 仅 App 壳生效（Web 行为零变化
  红线）；清空/发送即删；列表「[草稿]」优先预览。
- **触感闸门**：全部触感调用统一 `tick()`；`huanyu_haptics='0'`
  一处关断（设置 → 偏好 App 专属行）。
- **里程碑印章分档**：`streakSealForTier`（≥100 金冠双环 / ≥30
  玉桂环 / 基础焰章），素材目录 23→25，管线与许可同 §10.3。
- **Gallery S7 展区**：空态/错误演示、连签与月历状态样板、奖章
  三档、周报条形、长按菜单与示例台词卡活演示 —— 新组件家族的
  评审面（e2e galleryS7Assertions 锁定）。
- **e2e 增量**：weeklyRecap / walletCalendar（含流水筛选）/
  quoteCard / galleryS7 / conversationMarks / draft / s7DarkTier
  七场景；app-test 以场景名清单守卫接线。
- 阶段规格详见 `docs/design/LUMEN_S7_SPEC.md`；用户可见变更见
  根目录 `CHANGELOG.md`。

### 10.8 G10 追溯表（功能 → 契约 → 验证）

| 功能 | 关键实现 | 机器契约（app-test） | 行为验证 |
|---|---|---|---|
| 周报卡 | AppHome `.qa-weekly` + `GET /me/weekly` | 双轨字段配对 / 静默失败 / role=img 全文替代 | e2e weeklyRecap + boundary 周界/未来天 0 |
| 台词卡 | sharecard `renderQuoteCard` + Chat/Theater 入口 | App-only / 双侧署名 / 旁白署名 | e2e quoteCard + 手测用户侧 1080×1440 |
| 星轨卡 | `renderInsightsCard` + Insights hero 入口 | App-only / 羁绊载荷 | 手测合成 + e2e shareCard 家族 |
| 会话整理 | conversations.pinned/muted + PATCH mark-only | 排序 / mark-only 双端 / 迁移列 | e2e conversationMarks + boundary 组 3 |
| 会话草稿 | `huanyu_draft_<id>`（App 门控） | 门控 / 清空即删 / 行预览优先 | e2e draft 全环 |
| 私信草稿+长按 | `huanyu_dmdraft_<id>` + AppPressMenu 复制 | 门控 / 清空即删 / App-only 绑定 | 手测三步全环 |
| 群聊 @提及 | 长按插入 + `.gr-mention` 高亮 | Web 零泄漏 | 手测菜单 + 插入 |
| 触感开关 | tick() 闸门 + 设置行 | 闸门语义 / App-only 行 | e2e g10Surface 默认开 |
| 我的名次 | leaderboard `me:{rank,score}` 双端 | 公式双端配对 / UI 常驻行 | boundary 组 5（公式一致+单调） |
| 热门分类 | Search cats chips + tabOverride | App-only / 角色搜索直达 | e2e g10Surface 点击直达 |
| 一键全领 | Events claimAllTasks | 容错语义 / ≥2 才现 | 手测 + 行内领取 e2e（today） |
| 新功能 Sheet | WhatsNewSheet + 未读点 | 隔离契约 / 版本键 | e2e g10Surface（≥8 行 + Escape） |
| 相伴一览/足迹 | `.qa-glance` / `.qa-bond` | allSettled 降级 / 最高好感续聊 | e2e g10Surface 真实导航链 |
| 里程碑分档 | streakSealForTier + 三档印章 | 阈值 / 管线双变体 / 双消费点 | 视觉审阅（印章成图） |
| 阅读进度 | `huanyu_read_<id>` + 2px 进度条 | 门控 / 端点复位 / 字号域校验 | 手测 0.50 往返恢复 |
| 长按开即关修复 | msg-sheet 遮罩 350ms 挂载守卫 | 守卫源码断言 | 手测居中气泡开-留-关全环 |

每行的 e2e 场景名都在 app-test 的场景守卫清单里锁死；boundary 指
`server/s7-boundary.test.mjs`（七组验值）。

（10.8 表补行）| 抽卡晒卡 | Gacha 结果第三动作 → character 模板 | App-only / 模板路由 | 手测 + 分享卡族 e2e |
| 收藏筛选 | Favorites `.qa-fav-cats`（分类自推导） | App-only / ≥2 类 / 空档说明 | 手测切换 |
| 公告 NEW | `huanyu_ann_seen` 账本（钳 100） | App 门控 / 有界 / 徽标 App-only | 手测两次进入 |
| 阅读进度 | NovelReader `huanyu_read_<id>` + 2px 条 | 门控 / 端点复位 / 字号域 | 手测 0.50 往返 |

（10.8 表再补行）| 画廊长按 | Draw 瓦片 → 下载/复用/删除 | App-only 绑定 / 删除 danger | 手测菜单三项 |
| 群聊分段 | Groups 全部/我加入的/可加入 | 两侧并存才现 / joined 划分 | 手测切换 |
| 排序端到端 | 置顶 > 新鲜度 | —— | e2e 浏览器层 + boundary 第 7 组 API 层双镜像 |
