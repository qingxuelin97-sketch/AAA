# 给 Claude Code 的实施 Prompt（复制整段发送即可）

> 使用方式：在 Claude Code（网页版）连接 `qingxuelin97-sketch/AAA` 仓库后，把下面横线内的全部内容粘贴到对话框发送。发送前请先把 `docs/design/lumen-glass-tokens.css` 与 `docs/design/LUMEN_GLASS_SPEC.md` 提交进仓库（或作为附件粘贴在本 prompt 之后）。

---

你是本仓库的前端实施工程师。请把 App 壳（`?app=1`，Capacitor/HTTP 内测壳）的视觉层从「静水青 Quiet Aqua v4.2」迁移到「曜光玻璃 Lumen Glass v1.0」。

## 权威文件（先读，冲突时按此顺序）
1. `docs/design/LUMEN_GLASS_SPEC.md` — 材质系统、组件契约、动效表、50 屏逐屏说明
2. `docs/design/lumen-glass-tokens.css` — 全部 `--lg-*` 令牌（浅/深/强调色/lite/reduced-motion 已写好，禁止改值）
3. `APP_UI_ORACLE.md` — 仍然有效的部分：产品结构、路由注册、状态矩阵、Web 零差异边界、验收门槛。只有「视觉/材质/色彩」章节被 Lumen Glass 取代

## 总原则
- 背景=环境光晕（`--lg-ambient*`），界面=三层液态玻璃（`--lg-glass-1/2/3` + `--lg-blur` + `--lg-glass-shadow-*`），资产仪表/SVIP/阅读稿纸=不透明实体。同一对象只允许一层玻璃+一层发丝边+一道内高光。
- 所有新增/修改 CSS 选择器必须以 `html[data-app="1"]` 开头；普通 Web 的 DOM、类名、文案、行为、截图必须零差异（保持 LegacyControl 透传）。
- 一级导航（今日/发现/消息/我的 + 独立创建）、Route Registry、返回顺序、KeepAlive 策略一律不动。
- 主动作色 `--lg-act` 是唯一随 `data-accent` 漂移的语义；金/钻/珊瑚/玉/蓝/紫/玫瑰是内容语义，任何情况下不得漂移；禁止 nth-child 彩虹与无语义渐变。
- `data-perf="lite"`：零 blur、零光晕、玻璃回落不透明分组底，层级与对比不变。`prefers-reduced-motion`：非必要运动清零。
- 字体 Microsoft YaHei / PingFang SC；不引入、不分发 SF 字体或 SF Symbols。图标继续用 lucide-react（22px / stroke 1.75）。
- 触控 ≥44px、提交 ≥48px、Dock 66px + safe-area、金额 tabular-nums、正文对比 ≥4.5:1、横向溢出 ≤1px（360/390/412 三视口）。

## 分 PR 落地（每个 PR 独立可验收，按序执行）
- **PR1 令牌与材质基建**：把 `lumen-glass-tokens.css` 放入 `client/src/styles/` 并在 App 壳入口引入；新建 `app-lumen-materials.css` 提供 `.lg-glass-1/2/3`、`.lg-ambient(-warm/-cool/-rose)`、`.lg-entity` 等组合类（全部 `html[data-app="1"]` 作用域）；接好 `data-theme` / `data-accent`（iris/azure/violet/jade/clay）/ `data-perf` 三个开关。旧 `--qa-*` 令牌暂时保留别名映射，避免一次性大爆炸。
- **PR2 控件与系统层**：AppControls（按钮/图标按钮/分段/角标）、Dock、输入岛、Sheet/Overlay 按 SPEC §4 换装。验收 `/app-controls?app=1` 全状态 + 焦点环 + aria 契约不回退。
- **PR3 一级四页**：AppHome（#s01）、DiscoverFeed（#s02）、Messages（#s03）、AppProfile（#s04）+ 创建 Sheet（#s05）。
- **PR4 沉浸与会话**：CharacterView、Chat、CallScreen、GroupRoom、TheaterRoom、NovelReader（#s06–#s12）。
- **PR5 身份/价值/创作**：Wallet、充值、Vip、Profile、Achievements、Insights、Leaderboard、编辑器、Atelier、NovelWorkspace、Scripts、Draw、Publish（#s20–#s34）。
- **PR6 长尾与状态**：社区/议会/抽卡/活动/公告/Auth/Settings/Admin/收藏/帮助 + 骨架/空态/错误/危险确认全局审计（#s13–#s19、#s35–#s50），并删除 PR1 的 --qa-* 别名。

## 每个 PR 的验收
```
npm run build
npm run build:static
npm run test:app
npm run test:app:e2e
```
另加人工核对：390×844 浅色+深色截图 vs 设计稿对应帧（构图、层级、材质、语义色，不做像素级对照）；lite 档无任何 backdrop-filter；`?app=0` 与主分支同数据基线 DOM/截图零差异；软键盘、safe-area、Android 返回、脏数据确认不回退。

## 禁止
- 把玻璃叠在玻璃上；给正文加双层玻璃底；外发光；呼吸光/循环扫光。
- 动 Web 分支的任何视觉与行为；动业务数据、权限、后端协议。
- 改 `--lg-*` 令牌值或私自新增颜色；用截图/母版图当运行时资源。
- 一次性重写多页的大 PR；不带验收结果就宣布完成。

先从 PR1 开始，给出计划与涉及文件清单再动手。

---
