# 幻域 · AI 角色扮演社区平台

一个完整的全栈 AI 角色扮演社区。自定义角色、世界书、自定义语言/语音模型，金币钻石经济系统、VIP、付费剧本、社区动态、群聊、以及多人 + 多 AI 的「剧场」。移动端与桌面端自适应。

> 演示账号：**demo / 123456** ｜ 注册邀请码：**HUANYU2026**（赠 2000 金币）、**VIPGIFT**（500 钻 + 30 天 VIP）

## 🌐 在线访问（无需配置环境）

本项目已配置 GitHub Pages 自动部署：推送后 GitHub Actions 会构建**纯浏览器版**并发布，直接点链接即可在手机/电脑浏览器使用：

> **https://qingxuelin97-sketch.github.io/AAA/**

- 纯浏览器版自带一个运行在浏览器内的后端（数据保存在你本地浏览器的 localStorage），首次打开即有完整演示数据。
- AI 对话 / 剧场为**真实模型**：进入「设置 → 语言模型」填入你自己的 API Key（浏览器直连服务商）即可对话。
- 首次启用：仓库 Settings → Pages → Source 选择「GitHub Actions」（若工作流未自动开启），等待 Actions 跑完即可访问。

## 🖥 服务端部署（全栈版 · 含数据库）

GitHub Pages 只能托管纯浏览器版（静态）。要部署带真实数据库的**全栈服务端**（Express + SQLite，单服务同时提供 API 与前端），用本仓库自带的 Docker / Render 配置即可：

- **Docker**：`docker build -t huanyu . && docker run -p 4000:80 -v huanyu-data:/data -e DB_PATH=/data/data.sqlite huanyu` → 打开 `http://localhost:4000`（容器内监听 80）
- **微信云托管 / 腾讯云**：关联本仓库、用根目录 Dockerfile 构建，服务端口填 **80** 即可。
- **Render（一键）**：新建 Blueprint 指向本仓库，自动读取 `render.yaml`（已含持久化磁盘挂载到 `/data`、健康检查 `/api/health`）。
- 任意支持 Docker 的平台（Railway / Fly.io / VPS）同理。容器首启会在数据库为空时自动灌入演示数据，重启保留数据。
- 平台 AI（语言 / 语音 / 生图）在 **GM 控制台 → 平台AI** 配置；服务端密钥仅存于服务器数据库，接口返回一律掩码。

### 🔒 数据永久滚存（防止重新部署丢数据）

临时磁盘的平台（如微信云托管免费档）重新部署会清空容器，SQLite 会重置。设置下面**任一**环境变量即可开启**自动滚存**（启动时回灌、每 2 分钟及优雅退出时快照，数据永久存活）：

- **微信云托管 / 任意 MySQL**：`BACKUP_MYSQL_URL=mysql://用户:密码@主机:3306/库名`
  （在微信云托管「MySQL」面板一键开通后，把连接信息填到该环境变量即可）
- **持久磁盘 / NFS**：`BACKUP_FILE=/data/huanyu-snapshot.json`
- 可选 `BACKUP_INTERVAL_MS`（默认 120000）。未设置则不启用、仅本地存储。

> 另外 GM 控制台「数据保全」可随时手动**导出 / 恢复**整站备份（JSON），作为额外兜底。


## ✨ 功能总览（20+）

**角色与对话**
- 自定义角色：立绘、聊天背景（图片 / GIF / 视频动态背景）、世界书（关键词触发设定）、简介与人设、分类与标签、NSFW 标记
- 沉浸式 1:1 对话，流式输出，角色台词语音朗读，角色收藏
- 自定义语言模型 API（兼容 OpenAI / Anthropic，可接入任意服务商）与语音模型 API
- 🎨 **AI 绘图**：文生图工作室（多风格 / 画幅 / 提示词复用 / 个人绘廊），对话内可一键「生成场景插图」

**剧场与群聊**
- 🎭 剧场：多名玩家 + 多个 AI 角色同台即兴演出，可让指定 AI 接话、旁白推进剧情
- 💬 用户群聊：创建 / 加入群组，实时（轮询）群聊
- 社区动态：发布动态、图片、点赞、评论、关注用户、通知中心

**内容生态**
- 发现广场：分类筛选、搜索、热门 / 最新排序，**「为你推荐」个性化推荐**（依据你的收藏与对话口味）
- 剧本市集：免费 / 金币付费剧本，**购买后 30 分钟内不满意可退款**，一键导入角色卡
- 发布中心：角色卡 / 剧本 / 动态，推送给指定玩家（收件箱）

**账号与经济系统**
- 完整注册登录（**需邀请密钥**，无验证码），JWT + bcrypt
- 💰 双货币：金币（gold）+ 钻石（diamond）；**1 钻石 = 100 金币**
- 钻石充值（多档套餐，演示模拟支付）、钻石兑换金币、交易流水
- 👑 VIP（金币购买，无等级；签到双倍、专属标识等权益）
- 🪙 **按量计费 AI 服务**：平台对话（10/15 金币）、平台语音朗读（10 金币/句）、AI 生图（20 金币/张），**VIP 75 折 / SVIP 5 折**，自备 API Key 则免平台扣费
- 🛠 **GM 平台AI 控制台**：统一配置平台「语言 / 语音 / 生图」服务（服务商、协议、模型、密钥、画幅、全局系统提示词），改后即时对全体无 API 用户生效
- 每日签到（连续奖励，VIP 双倍）、兑换码
- 完整用户中心：资料 / 横幅 / 安全（改密）/ 偏好（NSFW、通知）设置
- 移动端底部导航 + 响应式布局，桌面端侧边栏

## 🛠 技术栈

- 后端：Node.js + Express 5 + better-sqlite3 + JWT + multer
- 前端：React 19 + Vite + React Router + lucide-react 图标 + Inter 字体（自定义深色 UI，无 UI 框架）

## 🚀 本地运行

```bash
npm install        # 安装依赖
npm run build      # 构建前端
npm run seed       # 写入演示数据（账号 demo/123456、剧本、剧场、群聊、动态、美术资源）
npm start          # 启动，访问 http://localhost:4000
```

开发模式：终端 1 `npm run dev:server`，终端 2 `npm run dev:client`（访问 5173）。

## 📁 结构

```
server/
  index.js              入口（静态托管 + API）
  db.js                 SQLite 全部表结构
  wallet.js             货币 / VIP 工具（applyTx 原子扣减 + 流水）
  auth.js               JWT 鉴权
  seed.js               演示数据 + SVG 美术生成
  routes/               auth / characters / chat / settings / community /
                        users / economy / scripts / social / groups / theater / meta
client/src/
  components/Layout.jsx  侧边栏 + 移动端底部导航 + 钱包/通知
  pages/                 Auth / Home(发现) / Library / CharacterEditor / Chat /
                         Scripts / ScriptDetail / ScriptEditor / Community / Groups /
                         GroupRoom / Theater / TheaterRoom / Wallet / Notifications /
                         Favorites / Settings / Profile / Publish / Inbox / PostDetail
```

## 🔌 配置模型

登录后进入「设置 → 语言模型 / 语音模型」，填写 Base URL、API Key、模型名即可开始真实对话与剧场演出。密钥仅保存在服务端。
