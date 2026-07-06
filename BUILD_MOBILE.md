# 幻域 · 打包为手机应用

本项目已经做好两种「手机 App」形态，**都不需要服务器**（业务逻辑跑在浏览器内置后端 + localStorage）。

---

## 方式一：PWA（现在就能装，零配置）

应用已是可安装的 PWA：含 `manifest.webmanifest`、App 图标、Service Worker（离线可用）、随主题变化的状态栏色。

**手机安装：**
1. 用手机浏览器打开站点（线上：`https://qingxuelin97-sketch.github.io/AAA/`）。
2. **Android Chrome**：右上角菜单 →「安装应用 / 添加到主屏幕」。也可在左上角 ☰ 菜单里点「安装到桌面」。
3. **iOS Safari**：分享按钮 →「添加到主屏幕」。
4. 桌面会出现「幻域」图标，点开即全屏运行，**无浏览器地址栏**，可离线打开。

> 说明：PWA 的安装提示（beforeinstallprompt）只有在 **HTTPS** 下才会出现；本地 `http://localhost` 也可。

---

## 方式二：原生 App（APK / IPA，用 Capacitor）

已集成 [Capacitor](https://capacitorjs.com/)：`capacitor.config.json` + 原生插件（状态栏 / 返回键 / 启动屏 / 键盘）已就绪，构建产物目录为 `client/dist`。

> 需要本机有 **Android Studio**（出 APK）或 **macOS + Xcode**（出 IPA）。在没有这些 SDK 的环境（如本仓库的云端）无法直接产出安装包，但工程配置已完成，按下面命令即可一键生成。

### 首次生成原生工程
```bash
npm install                 # 安装依赖（含 @capacitor/*）
npm run build:static        # 产出 client/dist（静态、内置后端）
npm run app:add:android     # = npx cap add android  → 生成 android/ 工程
# 如需 iOS（仅 macOS）：
npm run app:add:ios         # = npx cap add ios
```

### 打包 / 调试
```bash
npm run app:android   # 构建 + 同步 + 打开 Android Studio，然后点 Run / Build APK
npm run app:ios       # 构建 + 同步 + 打开 Xcode（仅 macOS）
# 仅同步网页改动到原生工程：
npm run app:build     # = build:static + npx cap sync
```
- 在 Android Studio 里 `Build → Build Bundle(s)/APK(s) → Build APK` 即得安装包。
- 应用图标/启动屏：把 `client/public/icons/` 里的图标用 Android Studio 的 *Image Asset* 或 `@capacitor/assets` 生成各分辨率资源。

### 将来接入服务器
现在前端通过 `VITE_STATIC=1` 用浏览器内置后端（`client/src/mock/backend.js`）。等你部署了真实后端：
1. 改用 `npm run build`（不带 `VITE_STATIC`），让 `/api` 走真实接口；或在 `capacitor.config.json` 配 `server.url` 指向你的后端。
2. 重新 `npm run app:build` 同步即可，无需改动业务代码。

---

## 让 App 连接真实服务器（重点）

打包成原生 App 后，webview 运行在 `https://localhost`，前端代码里的相对路径 `/api/...`
会请求到 **localhost 本地**而非你的服务器——表现为 App 能打开但登录、数据全部失败。
必须让前端在打包时把后端地址写死成绝对地址。

### 一、配置后端地址

复制环境变量模板并填入你的后端域名：

```bash
cp client/.env.example client/.env
# 编辑 client/.env，填入后端完整 HTTPS 地址，例如：
#   VITE_API_BASE=https://api.your-domain.com
```

要求：
- **优先 `https://`**；使用 `http://`（裸 IP / 无证书部署，如内网 `http://172.22.139.18:4000`、
  公网 `http://120.27.249.73:4000`）时需允许明文流量，见下方「明文 HTTP（裸 IP 服务器）」。
- 前后端同域（由 Nginx 反代分流 `/api`）就填主域名；后端独立子域就填子域。
- REST 请求和 SSE 长连接都会自动用这个地址（见 `client/src/api.jsx` 的 `API_BASE`）。

> 也可以**不在构建期写死地址**：直接打「离线版」APK，装好后在 App 内
> 「设置 → 服务器连接」点官方预设（内网 / 公网服务器）或手填地址并测速，保存后
> 全部数据（账号 / 角色 / 私信 / 群聊，含 SSE 秒级推送）即切到该服务器。

### 明文 HTTP（裸 IP 服务器）

仓库已默认打开的开关 + 需要工程侧补齐的一处，缺一不可：

1. `capacitor.config.json` → `server.cleartext: true`（已默认开启）；
2. `capacitor.config.json` → `android.allowMixedContent: true`（已默认开启。webview 来源是
   `https://localhost`，向 `http://` 后端发请求属于混合内容，需显式放行）；
3. Android 清单 `android/app/src/main/AndroidManifest.xml` 的 `<application>` 需加
   `android:usesCleartextTraffic="true"`。云端打包（GitHub Actions）已自动补丁；
   本地 `npx cap add android` 生成工程后请手动加上，或执行：
   ```bash
   sed -i 's/<application /<application android:usesCleartextTraffic="true" /' android/app/src/main/AndroidManifest.xml
   ```
4. iOS 如需 http，向 `ios/App/App/Info.plist` 加 ATS 例外：
   ```xml
   <key>NSAppTransportSecurity</key>
   <dict><key>NSAllowsArbitraryLoads</key><true/></dict>
   ```

### 二、后端 CORS 放行 App 来源

App 的 webview 来源是 `https://localhost`，后端需放行它：

```bash
# 启动后端时设置环境变量
CORS_ORIGINS=https://localhost node server/index.js
```

或若你的后端供应商支持环境变量配置，加上 `https://localhost`。不配 `CORS_ORIGINS`
时后端默认允许所有来源（开发友好），生产建议显式配白名单：`https://localhost,https://你的网站域名`。

### 三、用「连服务器」脚本打包

```bash
npm run app:android:remote   # 构建（注入后端地址）+ 同步 + 打开 Android Studio
# 或 iOS（仅 macOS）：
npm run app:ios:remote
```

这组 `*:remote` 脚本用 `npm run build`（**不带** `VITE_STATIC`），读取 `client/.env`
里的 `VITE_API_BASE`，产出连真实后端的 `client/dist`，再 `cap sync` 进原生工程。

> 对比：`app:android`（不带 `:remote`）用的是 `build:static`，产物走浏览器内置 mock
> 后端，**不连服务器**，适合离线演示。两套脚本对应两种用途，别用混。

### 四、在 Android Studio 出 APK

1. `npm run app:android:remote` 会自动打开 Android Studio。
2. 菜单 `Build → Build Bundle(s)/APK(s) → Build APK`。
3. 装到手机测试：登录、聊天、收发消息应全部正常，SSE 秒级推送生效。

### 常见问题

- **App 打开白屏 / 登录一直转圈**：99% 是 `VITE_API_BASE` 没填或填成了 http。
- **登录失败但页面能开**：后端 CORS 没放行 `https://localhost`，看后端日志有无跨域拒绝。
- **改了后端地址没生效**：`.env` 改完必须重新 `npm run app:android:remote`，Vite 在构建时把环境变量编译进 JS。
- **真机调试看日志**：`chrome://inspect` 连手机 webview，或 Android Studio Logcat 过滤 `Capacitor`。
- **SSE 不通**：确认反代/Nginx 没缓冲 SSE 流，需加 `proxy_buffering off;`（Nginx）让 `text/event-stream` 实时下发。

---

## 资源清单
- `client/public/manifest.webmanifest` — PWA 清单
- `client/public/sw.js` — Service Worker（离线 App 壳）
- `client/public/icons/` — App 图标（192/512/maskable/apple-touch）
- `capacitor.config.json` — 原生壳配置
- `client/src/native.js` — 原生集成（仅在 App 内加载：状态栏随主题、Android 返回键、启动屏）
