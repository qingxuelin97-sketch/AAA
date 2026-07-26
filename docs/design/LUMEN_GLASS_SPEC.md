# 曜光玻璃 Lumen Glass v1.0 — App 全局设计规范

状态：`v1.0 / 设计权威 / 仅 App 壳（?app=1）`
替代对象：`静水青 Quiet Aqua v4.2` 的视觉层（产品结构、路由注册、状态矩阵与 Web 零差异边界全部继承，不重复推翻）。
视觉稿：`幻域 App 设计稿.dc.html`（50 屏，浅/深/lite 全部可切换预览）。
令牌：`docs/design/lumen-glass-tokens.css`（--lg-*，可直接放入 `client/src/styles/`）。

## 0. 一句话定义

背景是一层**环境光晕**（ambient glow），一切界面是浮在光上的**液态玻璃**。玻璃分三层 + 一种实体面；层级、深度、手势因果对标 Apple 的处理方式，不使用 SF 字体 / SF Symbols / 任何 Apple 品牌资产。

## 1. 材质系统（本稿核心，覆盖 QA v4.2 §2.3/§3）

| 层 | 令牌 | 用途 | 配方 |
|---|---|---|---|
| BG 光晕 | `--lg-ambient(-warm/-cool/-rose)` | 页面最底层；媒体沉浸页除外 | canvas 底色 + 2–3 个 oklch 径向光斑 |
| L1 承载 | `--lg-glass-1` + `--lg-blur` + `--lg-glass-shadow-1` | 列表组、表单、动态卡、气泡 | 玻璃最淡，一层发丝边 + 一道内高光 + 短阴影 |
| L2 浮起 | `--lg-glass-2` + `--lg-glass-shadow-2` | Sheet、Modal、菜单、选中卡、编辑焦点卡 | 更亮更高阴影，从操作源升起 |
| L3 系统 | `--lg-glass-3` + `--lg-glass-shadow-3` | Dock、导航条、输入岛、指挥芯片、保存条 | 永不承载正文 |
| L0 实体 | `--lg-finance` / `--lg-grouped` | 资产仪表、SVIP 金卡、小说稿纸/阅读面 | 不透明；需要绝对可读或“重量”的地方 |

硬规则：
- 同一对象只允许 **一层玻璃 + 一层发丝边（含在 shadow 里）+ 一道内高光**。禁止玻璃叠玻璃、外发光、呼吸光、永久扫光。
- 输入岛是**单层**：外层玻璃条 + 内层普通 inset 输入位，不做双层玻璃。
- 沉浸页（发现/私聊/通话/抽卡）媒体是第一层，控件是白系玻璃 `rgb(255 255 255/10–14%)` + blur，遮罩保证正文 4.5:1。
- 光晕按页面语义选色：默认 iris、钱包/SVIP/活动 warm、消息/世界书 cool、剧场/绘图 rose。lite 档光晕与 blur 全部关闭。

## 2. 色彩

- 中性底 + 语义强调（继承 QA 的纪律）：主动作 `--lg-act`（唯一随用户 accent 漂移），内容语义固定：金=金币/会员、钻蓝=钻石、珊瑚=未读/危险/重要、玉=成功/在线/免费、蓝=私信/世界书、紫=创作/AI 生成、玫瑰=收藏。
- 全部强调色在 oklch 同一 L/C 平面（深色 L≈.78 C≈.12 / 浅色 L≈.53 C≈.14），天然和谐；禁止 nth-child 彩虹、无语义渐变。
- 允许的渐变仅三类：媒体可读性遮罩、钱包/SVIP 实体材质、一次性状态反馈。

## 3. 排版与几何

- UI：Microsoft YaHei / PingFang SC。叙事正文（小说、剧场、阅读器）：中文衬线 `--lg-font-serif`，16–18px / 行高 1.95–2.05。
- 字阶：34 大标题（一级页，700/-2%）· 28 展示 · 22 页面 · 17 分区 · 15 正文 · 13 元数据。小屏换行不缩字。
- 圆角阶：控件 12 / 行 14 / 卡 18 / 面板 20 / Sheet 26 / 胶囊 999；随层级递增。
- 间距 4/8/12/16/20/24；页边距 16（紧凑 14）；触控 ≥44、提交 ≥48；Dock 66 + safe-area；金额一律 `font-variant-numeric: tabular-nums`。
- 图标：lucide-react，22px / stroke 1.75 / 圆头；Dock 24px；图标按钮必须有可访问名称。
- 基准 390×844，必须在 360×800 与 412×915 成立；横向溢出 ≤1px。

## 4. 组件契约（AppControls）

- AppButton：primary（--lg-act 实底胶囊）/ secondary（L1 玻璃）/ tertiary（纯文字 act 色）/ danger（珊瑚描边，确认后实底）。pressed = scale .97 + 提亮/压暗，80ms；loading = 原位 spinner + 保持原宽 + aria-busy；disabled = 55% 透明 + **写明原因**，不进 Tab 序。
- AppIconButton：ghost / secondary（玻璃）/ filled（act）。44×44 起。
- 分段控件：胶囊槽（L1）+ 选中片（--lg-glass-sel + shadow-1）滑动切换，180–380ms。
- Dock：L3 玻璃圆角 26 悬浮条，四目的地 + 分离的圆形创建钮（act 实底）；选中 = act 色 + 600 字重 + aria-current="page"；未读 = 珊瑚点。详情/会话/编辑/阅读页隐藏 Dock（Route Registry 不变）。
- 列表行：行高 56（设置）/ 62–76（会话），发丝分隔，行内不再套卡；未读三重编码（珊瑚点 + 数字角标 + 标题加粗）；左滑动作跟手（静音石墨 / 删除珊瑚）。
- Sheet：圆角 26 顶部 grabber，L2 玻璃，从操作源升起 ≈380ms；Portal 到 body，role=dialog/alertdialog，焦点锁、背景 inert + scrim `--lg-scrim`、Escape/Android 返回关闭、焦点归还。危险确认默认焦点在取消。
- 状态矩阵沿用 QA v4.2 §7.2 十行，全数适用（视觉稿 47–49 帧为标准样）。

## 5. 动效（因果驱动，装饰为零）

统一缓动 `cubic-bezier(.2,.8,.2,1)`。按下 80ms ≤.97 / 选中 180–380 / push-pop 220–460 方向一致 / 共享媒体转场（发现→详情→对话）440–720 一次 / Sheet ≈380 / 新消息沿方向 300–420 / 下拉刷新跟手 + 260 回弹 / 资产·SVIP 光线通过 540–820 一次不循环 / 保存·发送·签到 = 状态驱动。仅骨架 shimmer 与 loading 旋转允许循环，状态结束即停。reduced-motion 与 lite 规则见令牌文件。

## 6. 逐屏实施说明（50 屏 ↔ 仓库文件）

> 编号对应视觉稿锚点 #s01–#s50。「改动」= 从静水青迁到曜光玻璃时该屏的关键工作。

| # | 屏 | 路由 | 主要文件 | 关键改动 |
|---|---|---|---|---|
| 01 | 今日 | /today | pages/AppHome.jsx | 加环境光晕层；签到岛/快捷组/精选/续读轨换 L1 玻璃；大标题 34 |
| 02 | 发现 | / | pages/DiscoverFeed.jsx | 沉浸流不变；顶部分段与右侧动作换白系玻璃；底部信息遮罩梯度 |
| 03 | 消息 | /messages | pages/Messages.jsx | 分组列表整组一层玻璃；行高 76；未读三重编码 |
| 04 | 我的 | /me | pages/AppProfile.jsx | 石墨资产仪表(带一处暖金光点) + 四计数玻璃卡 + 创作分组 |
| 05 | 创建 Sheet | Dock 动作 | components/QuickCreate.jsx, overlay.jsx | L2 玻璃 Sheet；四入口用创作紫/蓝/金/珊瑚图标位 |
| 06 | 角色详情 | /character/:id | pages/CharacterView.jsx | 共享媒体转场；简介/世界书行换玻璃；白胶囊主 CTA |
| 07 | 私聊 | /chats/:id | pages/Chat.jsx, chat/* | 背景压暗 60–78%；气泡=单层玻璃；斜体动作文降亮；建议芯片 |
| 08 | 通话 | CallScreen | components/CallScreen.jsx | 背景=同立绘 46px 深模糊；字幕玻璃卡；挂断珊瑚 64px |
| 09 | 群聊 | /group/:id | pages/GroupRoom.jsx | 冷白内容面；成员条进导航玻璃；发言人名固定语义色映射 |
| 10 | 剧场房间 | /theater/:id | pages/TheaterRoom.jsx | 纸/墨阅读流（衬线 16/1.95）+ 指挥芯片横轨 + 输入岛 |
| 11 | 剧场大厅 | /theater | pages/Parliament.jsx(剧场列表部分) | LIVE 主舞台卡 + 分段 + 行列表 |
| 12 | 小说阅读 | /atelier/read/:id | pages/NovelReader.jsx | 阅读面不透明；玻璃工具条可隐藏；Aa Sheet |
| 13 | 通知 | /notifications | pages/Notifications.jsx | 按日分组；可操作通知行内 34px 动作 |
| 14 | 会话管理 | /chats | pages/Messages.jsx | 左滑跟手动作；编辑模式批量选 |
| 15 | 好友 | /friends | pages/Friends.jsx | 在线玉点 + 行尾私信；请求入口珊瑚计数 |
| 16 | 群组 | /groups | pages/Groups.jsx | 语义色群头像底；加入/申请胶囊 |
| 17 | 搜索 | /search | pages/Search.jsx | 键盘常驻布局；命中词 act 色 |
| 18 | 资料库 | /library | pages/Library.jsx | 两列陈列卡；状态徽：公开玉/草稿金/私有石墨 |
| 19 | 世界书列表 | /worldbooks | pages/*(worldbooks) | 卷分布小标签；导入中降权重 + 进度 |
| 20 | 钱包 | /wallet | pages/Wallet(经 routes/economy) | 仪表→快捷→签到→账本固定顺序；金额 tabular |
| 21 | 充值 | /wallet Sheet | server/payment.js 对接页 | 六档产品卡(assets/wallet-products PNG)；石墨结算条；健康检查禁用态 |
| 22 | SVIP | /vip | pages/Vip | 单一金属实体 + 权益 inset 清单；光线一次 |
| 23 | 主页 | /profile, /user/:id | pages/Profile.jsx | 横幅渐隐；他人页无资产 |
| 24 | 成就 | /achievements | pages/Achievements.jsx | 金=已解锁；进行中走内容语义色 |
| 25 | 洞察 | /insights | pages/Insights.jsx | 单色柱状(act 色阶)；无网格装饰 |
| 26 | 排行 | /leaderboard | pages/Leaderboard.jsx | 领奖台 + 「你的位置」act 软底行 |
| 27 | 角色编辑 | /character/:id/edit | pages/CharacterEditor.jsx | 五段 tabpanel；固定保存条；草稿时间常显 |
| 28 | 世界书编辑 | /worldbook/:id/edit | components/NovelWorldEditor.jsx 等 | 当前条目 L2 浮起；测试触发原位预览 |
| 29 | 书架 | /atelier | pages/Atelier.jsx | 横轨书脊卡 200 高；长按拖动排序 |
| 30 | 小说工作台 | /atelier/:id | pages/NovelWorkspace.jsx | 稿纸不透明；AI 段落紫高亮可整段撤销 |
| 31 | 剧本市集 | /scripts | pages/Scripts.jsx | 价格=金点+tabular；免费玉色；退款政策卡内可见 |
| 32 | 剧本详情 | /script/:id | pages/ScriptDetail.jsx | 封面渐隐 + 常驻结算条；余额不足改「去充值·还差 N」 |
| 33 | AI 绘图 | /draw | pages/Draw.jsx | 画布队列位/预估；按钮原位 loading + 费用明示 |
| 34 | 发布中心 | /publish | pages/Publish.jsx | 内容→渠道→行内检查清单；禁用写原因 |
| 35 | 社区 | /community | pages/Community.jsx | 动态卡 L1；点赞玫瑰仅激活着色 |
| 36 | 动态详情 | /post/:id | pages/PostDetail | 正文+评论+常驻评论岛 |
| 37 | 议会 | /parliament | pages/Parliament.jsx | 投票条 act(多数)+石墨；BGM 一次可静音 |
| 38 | 抽卡 | /gacha | pages/Gacha.jsx | 单主卡+保底进度+概率公示常显；结算入流水 |
| 39 | 活动 | /events | pages/Events.jsx | 主横幅+任务清单玉勾；结束活动降权重 |
| 40 | 公告 | /announcements | pages/Announcements.jsx | 重要珊瑚徽置顶展开；已读降权重 |
| 41 | 登录 | /auth | pages/Auth.jsx | 直接进任务；错误紧邻字段 role=alert；提交 52px |
| 42 | 设置 | /settings | pages/Settings.jsx | inset group+摘要值；强调色 swatch；性能档分段 |
| 43 | 模型配置 | /settings 深页 | pages/Settings.jsx | Key 掩码+「仅存服务端」；测试结果行内玉/珊瑚 |
| 44 | GM 控制台 | /admin | pages/Admin.jsx | 移动端只读监控+轻操作；健康点+文字 |
| 45 | 收藏 | /favorites | pages/Favorites.jsx | 混类型统一行高；取消收藏行内 Undo |
| 46 | 帮助 | /help | pages/Help.jsx, help.js | 手风琴；答案写清可执行路径 |
| 47 | 骨架+空态 | 全局 | components/*, styles | 骨架同形 shimmer；空态=原因+两个真实下一步 |
| 48 | 首载失败 | 全局 | RouteErrorBoundary.jsx | 人话+错误码；重试同任务；编辑器失败不出空表单 |
| 49 | 危险确认 | 全局 | overlay.jsx | 对象+后果；默认焦点=取消；遮罩不可绕过 |
| 50 | lite 档 | 全局 | perf.js + tokens | 零 blur 零光晕；层级/语义/间距不变 |

## 7. 边界（继承 QA v4.2，不放松）

- 所有新 CSS 从 `html[data-app="1"]` 开始；Web（?app=0）DOM、文案、行为、截图零差异。
- 一级导航四目的地 + 独立创建不变；Route Registry、返回顺序、KeepAlive 策略不变。
- 媒体：真实用户媒体优先；缺媒体用现有审阅 PNG fallback；整屏母版/设计稿图不得被运行时引用。
- 验收命令：`npm run build`、`npm run build:static`、`npm run test:app`、`npm run test:app:e2e`；三视口 + 深浅 + lite + reduced-motion 全过。
