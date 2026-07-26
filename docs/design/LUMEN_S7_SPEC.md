# Lumen S7「仪式与相伴」设计规格（含 G10 相伴加深）

> 权威级别：与 `LUMEN_GLASS_SPEC.md` 同级的阶段规格；实现契约以
> `APP_UI_ORACLE.md` §10 与 `client/app-test.mjs` 的机器断言为准，
> 本文负责「为什么长这样」与逐项几何。全部规则只作用于
> `html[data-app="1"]`；Web 是零像素/零行为硬边界。

## 0. 主题：从「界面」到「关系」

S1–S6 解决的是材质与秩序（曜光玻璃），S7 解决的是**归属感**：
打开 App 的第一秒（首启引导）、每天回来的那一下（签到仪式与周报）、
值得留念的时刻（成就与分享卡）、以及长期相处的痕迹（草稿、置顶、
星轨）。设计上遵循三条原则：

1. **仪式必须一次性**——庆祝动效（burst/claimfx）只在状态跃迁瞬间
   发生一次，禁止 infinite 循环；reduced-motion 下全部降为直切。
2. **相伴必须可回看**——连签有月历、本周有周报、旅程有星轨、
   台词有卡片；每一种记录都提供导出出口。
3. **降级必须完整**——lite 档去 blur 回落不透明 grouped 面；
   任何首载失败都有插画 + 重试出口（§7.2 落账表见 ORACLE §10.2）。

## 1. 今日页：仪式动线

```
hero（问候 + 资产 + 签到钮）
└─ .qa-streak 连签行：7 粒 .qa-streak-dot（(streak-1)%7+1 亮起）
   + 文案 + 「日历」入口 → CheckinCalendarSheet
快捷入口（2 × 3）
今日精选 hero-card（186px；≤374px 视口 168px —— 首屏垂直预算，
  保证故事卡 CTA 完整浮出 Dock，e2e 几何闸）
继续你的故事 rail
今日任务（行内领取：.qa-task-main + .qa-task-claim）
本周与你相伴 .qa-weekly（见 §2）
为你挑选
```

- 签到成功：tick(12) 触感 + 按钮矩心 burst + 任务区刷新；
  streak 命中 7 的倍数或 30/100 → `.qa-milestone` 横幅
  （分档印章 + 「生成纪念卡」）。
- 里程碑印章分档（`streakSealForTier`）：
  | 档位 | 印章 | 视觉 |
  |---|---|---|
  | 1–29 | `qa5-streak-seal` | 金环焰章 |
  | 30–99 | `qa5-streak-seal-30` | success 玉环 + 两侧月桂叶 |
  | ≥100 | `qa5-streak-seal-100` | 金冠双环 + 顶部三星 |

## 2. 周报卡 .qa-weekly-card

数据唯一来源 `GET /me/weekly`（北京周界、周一起始；双端同构，
边界回归见 `server/s7-boundary.test.mjs`）。

- 出现条件：`weekly.messages > 0`；请求失败静默隐藏——首页不得
  为辅助卡片引入失败态。
- 条形图：7 根，`height = max(14%, n/max*100%)`，零值 5%；
  今日条 `--lg-act` 实色、余下 32% act 混透明；整图 `role="img"`
  + 逐日全文 aria-label（图形不可读时文字兜底）。
- 统计行：消息数 / 相伴天数 / 签到次数 / 金币 +N（gold 语义色），
  数字 tabular-nums。
- 最相伴行：40px 头像 + 名字 + N 条，点击去角色页；act 8% 软底、
  :active 14%。
- lite：卡面 blur → none、`--lg-grouped` 实底（e2e 用 computed
  backdrop-filter 实测）。

## 3. 分享卡工坊（sharecard.js）

零依赖 canvas 合成；固定 **1080×1440**（3:4）与 DPR 解耦；
`document.fonts.ready`（1.5s 竞速超时）后绘制；CJK 逐簇折行
（ASCII 词整体不拆，超宽硬断，超行截 …）。出口顺序：
`navigator.canShare({files})` 系统分享 → `<a download>` 保存 →
复制链接；AbortError（用户取消系统面板）静默不降级。

共用底盘：
- 画布渐变 白 → #EDEFF6 → 主题软色（iris `#e9eafb` / gold `#f0e9d3`）；
- 环境光晕两层椭圆（α .16/.18）；
- 内容面板 `{x:84, y:120, w:912, h:1120, r:48}`，白 92% + 发丝描边；
- 页脚：月门徽记 88×88 @ (496, H−172) + 「幻域 · HUANYU」600/30 +
  归链域名 26px。

五模板：

| 模板 | 触发入口 | 关键几何 |
|---|---|---|
| character | 角色页动作行 / 消息行长按 | 封面 912×620 r36 + 底部 scrim，无封面则 220r 头像；名字 700/84；分类章胶囊 56h |
| achievement | 成就卡领取后 / 长按 | 奖章环 r200/26w（gold/silver/bronze 调色）+ 五角星 96/44；名字 700/76；达成日期 30px |
| streak | 里程碑横幅 / 钱包 | 分档印章 420×420 @ y+90；天数 700/160；「天连续签到」600/48 |
| quote | 聊天长按 / 剧场段落 | 装饰引号 700/220 Georgia；正文三档自适应 72/5行 → 56/7行 → 44/9行（lh 108/86/68）垂直居中；44r 头像 + 「—— 署名」600/40；旁白段署名「旁白」 |
| insights | 星轨页 hero 入口 | 三圈轨道椭圆（300/104、222/76、150/50，微旋转）+ 4 星点 + 金核 16r；「我的幻域星轨」700/68；2×2 大数 700/64（±190 列距、150 行距）；羁绊署名 600/34 |

媒体边界：分享卡是**运行时用户导出内容**，允许出现活数据文字；
入库 PNG 素材目录维持零文字零按钮红线（ORACLE §6/§10.4）。
不建 canvas 像素基线（文本反走样跨环境不稳），e2e 只验
naturalWidth/Height 与出口可用。

## 4. 长按系统

- 唯一语义源：`chat/hooks.js useLongPress`（450ms / 10px 位移容差）。
- `AppPressMenu`：MENU_W 232 / ITEM_H 48，视口钳制；portal +
  `role="menu"` + 根隔离（inert）+ Escape/遮罩关闭回焦；
  挂载 350ms 内忽略遮罩点击（吞长按抬指后的合成 click，触发行
  同样以 firedRef 抑制导航）；焦点自愈循环（120ms × 12 次上限）。
- 接入面：消息会话行（打开/查看角色/置顶/免打扰/分享卡/删除）、
  群聊气泡（复制 / @提及）、聊天气泡沿用页内 msg-sheet（App 分支
  增「生成台词卡」）、剧场段落操作行（复制/台词卡/朗读/回应）、
  Gallery 演示区。
- 手势互斥：`.qa-onboard / .qa-cal / .qa-share-sheet / .qa-press-menu
  / .qa-ach-wall` 全部登记 NO_TAB_SWIPE + NO_PULL。
- 触感：所有确认类触感统一走 `tick()`；`huanyu_haptics='0'`
  一处闸门全局关闭（设置 → 偏好，App 专属行）。

## 5. 签到月历 CheckinCalendarSheet

- 数据唯一来源 `GET /economy/checkin/calendar?month=YYYY-MM`
  （由 `transactions(kind='checkin')` 推导，不建新表；北京日界
  cnToday 折算；月参数钳最近 12 个月）。
- `role="grid"` + 7 columnheader；lead-pad 以 `Date.UTC` 星期数
  推导；态：`.on` 实心 / `.today` 描环 / `.future` 置灰。
- 头部：streak 印章 54×54 + 连签摘要 + 月导航（当月「下一月」
  disabled）；失败态必须给出重试。

## 6. 首启引导 AppOnboarding

- 弹出 = App 模式 ∧ 已登录 ∧ 无 `huanyu_onboard_done` ∧
  `user.created_at` ≤ 7 天；老账号**静默写键不弹**。
- 完成/跳过同时写 `huanyu_welcome_seen`（防与每日欢迎双弹）。
- 三屏 pager：世界观（月门）→ 玩法（工坊）→ 兴趣 chips
  （上限 6，`PUT /settings {interests}`，尊重 personalize 开关；
  slug 白名单 = meta CATEGORIES，服务端 sanitizeInterests 钳制）。
- 非当前屏 `inert`；reduced-motion 直切；e2e `preparePage` 默认
  预置完成键（基线引导盲），专测显式 `onboard:false`。

## 7. 会话相伴（G10）

- **置顶/免打扰**：`conversations.pinned/muted`（双端迁移列）；
  列表 `ORDER BY pinned DESC, updated_at DESC`；PATCH mark-only
  请求**不 bump updated_at**（置顶不得伪造新鲜度）；行 meta 区
  Pin（act 色）/ BellOff（ink-3）标记。
- **草稿**：`huanyu_draft_<convId>`（300ms 防抖，仅 App）；清空/
  发送即删；列表行「[草稿]」（coral 600）优先于最后一条消息预览；
  发现流一次性预填优先于草稿恢复。

## 8. 素材目录（25 张，全部本地管线）

`scripts/render-app-assets.mjs`：确定性 SVG → Chromium 截图，
Lumen P 调色板，零文字零按钮，单张 <300KB，tmp+rename 原子写。
外网图床在构建环境不可达（实测 CONNECT 403），本轮零外部位图，
版权随项目。

| 组 | 资产 |
|---|---|
| empty ×16 | generic / chat / favorites / friends / library / notifications / search / achievements / theater / atelier / leaderboard / events / worldbooks / insights / noresult / group |
| onboard ×3 | world（月门）/ craft（工坊）/ tune（调谐） |
| seal ×3 | 基础焰章 / 30 天玉桂 / 100 天金冠 |
| 其他 | boot-mark @2x/@3x、vip-weave |

## 9. 后端契约（S7 全量）

| 端点 | 语义 |
|---|---|
| `GET /economy/checkin/calendar?month=` | 签到月历（北京日界、钳 12 个月） |
| `GET /me/weekly` | 周报聚合（北京周界、周一起始、未来天 0） |
| `PUT /settings {interests}` | 兴趣白名单钳 6 去重 |
| `GET /characters/recommended` | personalize 开启时 interests 各 +2 权重 |
| `GET /achievements` | 30 条目录（server/mock 集合等值断言），honor 只铭刻 |
| `POST /economy/recharge` | 410 `PAYMENT_ORDER_REQUIRED`（订单两端点替代） |
| `PATCH /chat/conversations/:id {pinned,muted}` | mark-only 不 bump 排序时间戳 |
| `GET /engage/leaderboard` | 登录附 `me:{rank,score}`（榜外可见自己） |

每一条都有 mock 孪生与 `client/app-test.mjs` 配对断言；
时区/排序语义由 `server/s7-boundary.test.mjs` 验值。

## 10. 验收矩阵增量

- `npm run test:app`：S7/G10 契约全部纳入（计数见收尾行）。
- `npm run test:app:e2e`：新增场景 —— insightsRecovery / onboarding /
  todayRitual / achievements / shareCard / pressMenu / weeklyRecap /
  walletCalendar / quoteCard / galleryS7 / conversationMarks / draft /
  s7DarkTier（深色渲染 + lite 去 blur 实测）。
- `npm run test:server:s7`：北京日界/周界、mark-only、410/荣誉/
  兴趣白名单五组验值。
- `node scripts/appdiff.mjs`：样式/令牌重构时的 0px 自证门
  （9 路由 × light/dark/lite，冻结时钟 + 头像掩膜 + 2px AA 阈）。
- 人工基线：`docs/ui-baselines/manual-v9/`（S7 改动面定向重录）。
