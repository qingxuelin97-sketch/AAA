# 幻域 · Android App 构建

PWA 仍可作为网页安装；正式 Android App 则只连接构建时指定的 HTTPS 后端。APK 不再内置明文 IP，也不允许 cleartext 或把整站改成远程 `server.url`。

## GitHub Actions 构建

在 Actions 中运行 **Build Android APK**，必须填写：

- `server_url`：正式后端地址，例如 `https://api.example.com`；只接受 HTTPS。
- `play_cloud_project_number`：已启用 Play Integrity API 的 Google Cloud 数字项目编号。

工作流会构建随包 Web 资源、生成 Android 工程、安装 Play Integrity 原生桥、关闭明文网络和 Android 备份，然后输出 debug APK。

## 本地首次生成 Android 工程

复制配置模板：

```bash
cp client/.env.example client/.env
```

填写：

```dotenv
VITE_API_BASE=https://api.example.com
PLAY_INTEGRITY_CLOUD_PROJECT_NUMBER=123456789012
```

然后执行：

```bash
npm ci
npm run app:add:android
```

后续同步并打开 Android Studio：

```bash
npm run app:android:remote
```

构建脚本会拒绝 HTTP、带凭据、查询参数或 fragment 的后端地址。`android/app/src/main/AndroidManifest.xml` 会被强制写入 `usesCleartextTraffic=false` 与 `allowBackup=false`。

## 后端 Play Integrity 配置

生产服务器至少需要：

```dotenv
PLAY_INTEGRITY_PACKAGE_NAME=ai.huanyu.app
PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON={...服务账号 JSON...}
CORS_ORIGINS=https://localhost,https://你的网页域名
```

服务账号必须获准调用 Play Integrity API，应用还需在 Play Console 与对应 Cloud 项目关联。注册请求会绑定邮箱和用户名的 SHA-256 `requestHash`；后端只接受包名匹配、`PLAY_RECOGNIZED`、`LICENSED` 且包含 `MEETS_DEVICE_INTEGRITY` 的新鲜 verdict。

> debug APK 侧载后通常没有 `LICENSED` verdict，因此调试注册请使用白名单或邀请密钥。正式公开注册路径应从 Google Play 安装测试轨道或生产版本验证。

## 后端与网络要求

- App WebView 来源是 `https://localhost`，生产环境请将它加入 CORS 白名单。
- 反向代理必须正确转发 `/api` 与 `/uploads`；SSE 需关闭代理缓冲。
- 当前后端 URL 若仍只有裸 IP/HTTP，先配置域名和 TLS，再构建 APK。构建系统不会为兼容旧地址重新开启明文网络。
- 服务账号 JSON 是服务器机密，绝不能放入 `client/.env`、Capacitor 配置或 GitHub workflow 输入；应使用部署平台 secret。

## 相关文件

- `.github/workflows/android-apk.yml`：云端构建
- `scripts/configure-android.mjs`：输入验证与原生工程加固
- `.github/native/android/PlayIntegrityPlugin.java`：原生标准令牌桥
- `client/src/playIntegrity.js`：请求哈希与前端调用
- `capacitor.config.json`：安全的本地 WebView 配置
