# 幻域 · AI 角色扮演聊天平台

一个完整的全栈 AI 角色扮演聊天平台。自定义角色（立绘 / 动态背景 / 世界书 / 简介）、接入你自己的语言与语音模型、社区广场发布与推送剧本/角色卡。

> 演示账号：**demo / 123456**

## ✨ 功能

- **自定义角色**：上传角色立绘、聊天背景图（支持 GIF / 视频等**动态背景**）、**世界书**（关键词触发的设定库）、角色简介与人设。
- **自定义语言模型 API**：兼容 OpenAI Chat Completions 格式，可自由填写 Base URL / API Key / 模型名，接入平台外任意服务商（OpenAI、DeepSeek、Moonshot、OpenRouter、Groq、自定义…），支持流式输出。
- **自定义语音模型 API**：兼容 OpenAI `/audio/speech`，对话中可朗读角色台词。
- **完整账号系统**：注册 / 登录，**无需验证码**，JWT 鉴权，密码 bcrypt 加密。
- **完整用户菜单**：个人中心、资料编辑、改密、对话历史、收件箱等。
- **社区广场**：上传剧本 / 角色卡到主页，点赞、搜索、一键导入到自己的角色库，并可**推送给指定玩家**（收件箱）。

## 🛠 技术栈

- 后端：Node.js + Express 5 + better-sqlite3 + JWT + multer
- 前端：React 19 + Vite + React Router（自定义深色 UI，无 UI 框架依赖）

## 🚀 本地运行

```bash
npm install            # 安装依赖
npm run build          # 构建前端
npm run seed           # （可选）写入演示数据
node server/enrich.js  # （可选）补充 demo 账号角色与示例对话
node server/art.js     # （可选）生成演示用立绘/背景
npm start              # 启动，访问 http://localhost:4000
```

开发模式（前端热更新）：终端 1 `npm run dev:server`，终端 2 `npm run dev:client`（访问 5173）。

## 📁 结构

```
server/            Express 后端
  index.js         入口（静态托管 + API）
  db.js            SQLite 表结构
  auth.js          JWT 鉴权中间件
  routes/          auth / characters / chat / settings / community / users / upload
client/src/        React 前端
  pages/           Auth / Home / Library / CharacterEditor / Chat / Settings / Profile / Publish / Inbox / PostDetail
  components/      Layout（侧边栏）
```

## 🔌 配置模型

登录后进入「设置」，填写语言模型的 Base URL、API Key、模型名即可开始对话；语音模型同理（用于朗读）。密钥仅保存在服务端，不会回传前端。
