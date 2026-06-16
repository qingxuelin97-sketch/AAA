# 幻域 · AI 角色扮演社区平台

一个完整的全栈 AI 角色扮演社区。自定义角色、世界书、自定义语言/语音模型，金币钻石经济系统、VIP、付费剧本、社区动态、群聊、以及多人 + 多 AI 的「剧场」。移动端与桌面端自适应。

> 演示账号：**demo / 123456** ｜ 注册邀请码：**HUANYU2026**（赠 2000 金币）、**VIPGIFT**（500 钻 + 30 天 VIP）

## 🌐 在线访问（无需配置环境）

本项目已配置 GitHub Pages 自动部署：推送后 GitHub Actions 会构建**纯浏览器版**并发布，直接点链接即可在手机/电脑浏览器使用：

> **https://qingxuelin97-sketch.github.io/AAA/**

- 纯浏览器版自带一个运行在浏览器内的后端（数据保存在你本地浏览器的 localStorage），首次打开即有完整演示数据。
- AI 对话 / 剧场为**真实模型**：进入「设置 → 语言模型」填入你自己的 API Key（浏览器直连服务商）即可对话。
- 首次启用：仓库 Settings → Pages → Source 选择「GitHub Actions」（若工作流未自动开启），等待 Actions 跑完即可访问。


## ✨ 功能总览（20+）

**角色与对话**
- 自定义角色：立绘、聊天背景（图片 / GIF / 视频动态背景）、世界书（关键词触发设定）、简介与人设、分类与标签、NSFW 标记
- 沉浸式 1:1 对话，流式输出，角色台词语音朗读，角色收藏
- 自定义语言模型 API（兼容 OpenAI，可接入任意服务商）与语音模型 API

**剧场与群聊**
- 🎭 剧场：多名玩家 + 多个 AI 角色同台即兴演出，可让指定 AI 接话、旁白推进剧情
- 💬 用户群聊：创建 / 加入群组，实时（轮询）群聊
- 社区动态：发布动态、图片、点赞、评论、关注用户、通知中心

**内容生态**
- 发现广场：分类筛选、搜索、热门 / 最新排序
- 剧本市集：免费 / 金币付费剧本，**购买后 30 分钟内不满意可退款**，一键导入角色卡
- 发布中心：角色卡 / 剧本 / 动态，推送给指定玩家（收件箱）

**账号与经济系统**
- 完整注册登录（**需邀请密钥**，无验证码），JWT + bcrypt
- 💰 双货币：金币（gold）+ 钻石（diamond）；**1 钻石 = 100 金币**
- 钻石充值（多档套餐，演示模拟支付）、钻石兑换金币、交易流水
- 👑 VIP（金币购买，无等级；签到双倍、专属标识等权益）
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
