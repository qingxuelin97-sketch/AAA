# 更新日志

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
