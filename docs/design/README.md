# Lumen Glass 设计交接包 · 上传说明

这个文件夹（docs/design/）应完整放入仓库 `qingxuelin97-sketch/AAA` 的相同路径下。

## 内容
- `lumen-glass-mockup.html` — 50 屏可交互视觉稿（单文件离线版，双击即开）
- `lumen-glass-ui-kit.html` — UI 组件库（每个控件 × 每个状态，单文件离线版）
- `lumen-glass-tokens.css` — 全套 --lg-* 设计令牌（浅/深/强调色/lite）
- `LUMEN_GLASS_SPEC.md` — 设计规范 + 50 屏逐屏实施表
- `CLAUDE_CODE_PROMPT.md` — 给 Claude Code 的实施指令（复制横线内整段发送）
- `LUMEN_S7_SPEC.md` — S7「仪式与相伴」阶段规格（周报卡/分享卡五模板/长按系统/月历/后端契约）
- `lumen-s7-ui-kit.html` — S7 组件家族静态参考（周报卡/连签月历/奖章印章/足迹一览/长按菜单等，单文件离线版）
- `LUMEN_MIGRATION_PLAN.md` — S1–S6 迁移记录

## 最快上传方式（GitHub 网页，免命令行）
1. 打开 https://github.com/qingxuelin97-sketch/AAA
2. 点 `Add file → Upload files`
3. 把解压后的 `design` 文件夹整个拖进去（GitHub 会保留文件夹结构；若仓库还没有 docs/，先在上传界面把路径写成 `docs/design/`）
4. Commit message 填：`docs: add Lumen Glass v1.0 design handoff`，提交到 main

## 命令行方式
```bash
cd AAA
mkdir -p docs/design
# 把解压出的三个文件放进 docs/design/ 后：
git add docs/design
git commit -m "docs: add Lumen Glass v1.0 design handoff"
git push origin main
```

## 之后
打开 claude.ai/code → 连接 AAA 仓库 → 把 `CLAUDE_CODE_PROMPT.md` 横线内整段粘贴发送即可开工。
