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

## 资源清单
- `client/public/manifest.webmanifest` — PWA 清单
- `client/public/sw.js` — Service Worker（离线 App 壳）
- `client/public/icons/` — App 图标（192/512/maskable/apple-touch）
- `capacitor.config.json` — 原生壳配置
- `client/src/native.js` — 原生集成（仅在 App 内加载：状态栏随主题、Android 返回键、启动屏）
