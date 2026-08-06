# 更新日志

## 后端安全加固 · 压力测试 · 防呆（2026-08-06）

一轮针对后端的安全审计 + 压力测试 + 防呆收口。审计结论是底子很扎实
（无鉴权绕过、无刷钱路径、无 SQL 注入、无缺失的 GM 门禁），本次修的是
剩余的真实漏洞与「离谱输入」缺口。

### 安全修复

- **ReDoS（可拖死全站）**：世界书 `regex` 模式的关键词由作者自填、对所有与
  该角色聊天的用户生效，灾难性回溯能把 Node 单线程的事件循环钉死数十秒
  （实测 `(a+)+b` 对 24 个 a 就 >30s 不返回；原有「键 ≤200 字符」护栏对 6 字符
  的攻击模式完全无效）。新增 `validate.js` 的静态分析器（保守白名单：拒绝
  「量词作用在含量词/含 `|` 的分组上」、拒绝字符集相交的相邻量词、拒绝
  前后瞻/反向引用/超大重复）+ 经验探针 + 每请求墙钟预算，三重护栏，
  **不引入 RE2、不新增任何依赖**。写入侧对交互路径直接 400 并点名问题关键词，
  对 fork/另存等派生路径降级为 keyword（避免既有世界书无法复制）；读取侧同样
  设防，覆盖防护上线前就已入库的存量数据。
- **SSRF DNS 重绑定（TOCTOU）**：`safeUrl.js` 校验用的是自己那次 DNS 解析，
  而随后的 `fetch` 会独立再解析一次 —— 攻击者控制的域名可在两次之间切换
  （公网 IP 骗过校验，内网 IP 用于实际连接）。现在把校验通过的地址钉给这次
  连接（仅拦截钉扎中的主机名，其余原样透传），URL 从不改写，因此 Host 头、
  TLS SNI 与证书主机名校验全部保持不变。`SAFE_URL_PIN=0` 可熔断。
- **小说越权读**：删除已发布的剧情线不会清理 `novels.published_run_id`，
  留下悬空指针；`/novels/:id/read` 对非作者会回退到「第一条剧情线」，从而
  泄露作者从未发布的内容。现在删除已发布线即**下架**（fail-closed，作者可见的
  行为变更），读取侧对非作者取消回退，并对存量脏数据做了一次性清理。

### 防呆（离谱输入）

- 一批接口此前把请求体原样写库：传对象会被 better-sqlite3 当成具名参数、
  传数组当成参数列表，直接 500。`/characters`（POST/PUT）、`/scripts`
  （POST/PUT）、`/novels`、`/social/moments`、`/social/.../comments`、
  `/community/push`、`/groups` 全部收敛为「带上限的字符串 + 类型校验」。
- `PUT /settings`：所有字符串字段补齐长度上限（此前 2MB 的 `llm_base_url`
  可直接入库），`llm_temperature` / `llm_max_tokens` 补类型与区间校验，
  `privacy_profile` / `allow_dm` 收敛为枚举并在下次保存时自愈存量脏值。
- 深层嵌套 JSON 打崩接口：`JSON.stringify` 对约 2 万层嵌套抛 `RangeError`、
  对循环引用抛 `TypeError`，此前未捕获即 500。`/community/posts` 的 `payload`
  与 `/novels/runs/:rid` 的 `vars` 改走带上限的 `jsonText()`，统一转 400。
- 单条聊天消息补 16000 字上限（可用 `CHAT_MSG_MAX` 调整），超限返回 400
  而非静默截断用户写的内容。
- `/groups/:id/messages` 与 `/theater/:id/messages` 补分页上限（此前无
  `LIMIT`，`after=0` 可一次拉走全部历史）。客户端轮询按收到的最后一条 id
  推进，截断可自愈。
- `limiters.js` 的三档配额支持环境变量覆盖（`AI_RATE_LIMIT` /
  `CONTENT_RATE_LIMIT` / `UPLOAD_RATE_LIMIT`），与 `index.js` 既有模式一致。

### 测试

- 新增 `npm run test:abuse`（**已加入 CI 门禁**）：1476 组「路由 × 字段 ×
  离谱值」矩阵（类型错乱／超长／NaN／Infinity／代理对／RTL／原型污染／深层
  嵌套）+ 90 组离谱路径参数，核心不变量是「可以拒绝，但绝不 5xx、绝不崩」；
  另含本轮每处修复的具名断言、事件循环阻塞探针，以及「全套件 `server_error`
  计数为 0」的全局不变量。
- 新增 `npm run test:stress`（**按需运行，刻意不进 CI**）：并发突发、
  claim/purchase/refund 全路径并发双花 + 账本对账、SSE 连接翻搅与票据配额、
  事件循环阻塞检测、上传配额与孤儿文件。时延类断言在共享 runner 上会抖动，
  一旦 flaky 就会被加 `continue-on-error` 反而失去意义 —— CI 每次必须守住的
  那条性质（不许有请求钉死事件循环）已用确定性探针放进 `test:abuse`。
- `test:safe-url` 补 3 条断言，**证明**校验通过的 IP 确实被用于连接：将来若
  某个 Node 版本不再经由 `dns.lookup` 出站，CI 会大声失败而不是静默失去防护。

## IX-6 / IX-7「仪与匣」收口（2026-07-28）

- IX-6 完成长尾页面与状态补帧：创作工坊、发布/编辑器保存条、设置详情、
  首启三屏、全局空错态、剧场/群聊语义映射、VIP 舱与我的创作分组。
- IX-7 完成迁移终局：运行时直连 `--ix-*`，折叠 S3–S7 页面层，移除
  Lumen tokens、materials、QA shim、IX bridge 与旧空态/首启/印章/VIP 织纹 PNG。
- 主题与原生启动画布统一为 IX canvas（浅 `#E8EBE9` / 深 `#0F1312`）；
  旧 Lumen 设计文档继续作为归档保留。机器契约见
  `docs/design/field-instrument/IX-6-7_STATUS.md`。

## S7「仪式与相伴」超级更新（2026-07）

App 壳（`html[data-app="1"]`）的产品体验层大版本：首启引导、签到仪式、
成就 2.0、分享卡工坊、周报与会话相伴，后端与静态 mock 双轨同步。
Web 端零像素、零行为变化（webdiff 全程 0px 门禁）。

### 新增

- **首启引导**：三屏世界观引导 + 兴趣画像（`PUT /settings {interests}`
  白名单钳 6，`/characters/recommended` 按兴趣 +2 加权）；仅 7 天内
  新账号弹出，老账号静默标记。
- **签到仪式**：今日页连签周点；签到月历 Sheet（新端点
  `GET /economy/checkin/calendar`，北京日界从流水推导）；7/30/100
  里程碑横幅与分档纪念印章（30 天玉桂环、100 天金冠双环）。
- **今日任务行内领取** 与活动中心 **一键领取全部**。
- **本周与你相伴**：今日页周报卡（新端点 `GET /me/weekly`，北京周界
  周一起始）——逐日消息条形、活跃天数、签到与金币收支、本周最相伴
  角色。
- **成就殿堂 2.0**：金银铜奖章分档、五分类完成环徽章墙、荣誉成就
  （只铭刻不可领取）、领取一次性庆祝；成就目录双端收敛到 30 条。
- **分享卡工坊**：零依赖 canvas 合成，1080×1440 与 DPR 解耦，五种
  卡面 —— 角色、成就、连签、台词（聊天与剧场长按导出）、星轨年鉴；
  系统分享 → 保存 → 复制链接三级出口。
- **会话相伴**：会话置顶与免打扰（服务端 `pinned/muted` 列，
  mark-only PATCH 不改排序时间戳）；会话草稿（300ms 防抖本地持久，
  列表「[草稿]」优先预览）；群聊气泡长按复制 / @提及。
- **空态与错误态铺满**：16 种空态插画覆盖 19 页；所有首载失败统一
  AppErrorState（插画 + 重试 + 次级退路）。
- **微交互**：通用长按菜单（450ms/10px，portal + role=menu + 回焦）；
  资料页统计 CountUp；触感反馈统一 `tick()` 并新增设置开关；
  排行榜「我的名次」常驻行；搜索热门分类 chips；「新功能」Sheet。
- **素材管线**：`render-app-assets.mjs` 原子写入，目录 7→25 张
  （全部本地确定性生成，零外部位图）。

### 变更

- **qa→lg 令牌迁移终局**：62 条纯别名（1,821 处引用）改写为直连
  `--lg-*` 权威；`app-quiet-aqua-tokens.css` 降级为三类非纯残余 shim；
  迁移经 `scripts/appdiff.mjs` 0 changed pixels 自证。
- 旧 `POST /economy/recharge` 双端一致返回 410
  `PAYMENT_ORDER_REQUIRED`（充值走订单端点，mock 入账一次性幂等）。
- e2e `preparePage` 默认预置引导完成键；既有场景与像素基线对引导
  零感知。

### 工程

- 新命令：`npm run test:server:s7`（北京日界/周界、mark-only、
  410/荣誉/兴趣白名单验值）；`node scripts/appdiff.mjs`
  （App 像素自证，`--baseline` 录制）。
- e2e 新增 13 个场景（含深色/lite 巡检与触摸长按流）；app-test
  契约随各阶段锁步增长。
- 设计文档：`docs/design/LUMEN_S7_SPEC.md`（阶段规格）、
  `docs/design/lumen-s7-ui-kit.html`（S7 组件家族静态参考）、
  `APP_UI_ORACLE.md` §10（实现契约与账目）、
  `docs/ui-baselines/manual-v9/`（S7 改动面人工基线）。
- G10 后半补充：角色页「与 TA 的足迹」、我的页「相伴一览」、私信
  长按复制与按好友草稿、群聊 @提及高亮、「新功能」Sheet、搜索热门
  分类、任务一键全领、触感开关、排行榜我的名次、里程碑印章分档。

### G10 终章补充

- 剧场台词卡、群聊 @提及高亮与长按（复制 / @提及）、私信长按复制与
  按好友草稿、AI 画廊瓦片长按（下载 / 复用提示词 / 删除）。
- 签到月历「里程碑地平线」（距最近的 7 倍数 / 30 / 100 天还差几天）
  与分档印章头像；公告 NEW 一次性徽标；群聊「全部 / 我加入的 /
  可加入」分段；收藏与钱包流水筛选 chips；扭蛋结果一键晒卡。
- 消息长按面板「开即被关」真机 bug 修复（遮罩 350ms 挂载守卫，与
  AppPressMenu 同源方案）；台词卡开放到用户自己的台词（署昵称与
  头像）。
- 验证网：app-test 271 条源码契约；e2e 15 个 S7 场景（含两轮新面
  巡检与深色/lite 巡检）；server 边界回归七组验值；appdiff 0px 与
  webdiff Web 零 diff 全程作门。

## Lumen Glass v1.0（S1–S6 + UI kit 对齐）

曜光玻璃视觉系统换装：冻结令牌权威（`--lg-*`）、玻璃三档材质、
逐屏迁移（一级四页 / 沉浸会话 / 身份价值创作）、长尾状态审计与
`docs/design/lumen-glass-ui-kit.html` 逐组件对齐。基线 manual-v7/v8。

## 琉璃 Liuli v5（P1–P7）

App 壳去 AI 味重构：令牌重写、iOS 化 HIG 末位权威层、图标化 chrome、
PNG 素材管线、boot 层原生外观、守卫整合与 manual-v6 基线。
