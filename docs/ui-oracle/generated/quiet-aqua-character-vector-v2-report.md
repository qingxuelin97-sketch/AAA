# Quiet Aqua 人物矢量样片 v2

- 源稿：`quiet-aqua-character-source-v2.png`，仅作设计阶段追踪输入，不进入 `client/src` 或生产运行时。
- 工具：Visioncortex VTracer `0.6.4` 官方 Windows Release；`vtracer.exe` SHA-256 为 `4AD8D35E566CD15CAF582063B8349BD082B8FA2BD461E99D116FC63AD8FDECA0`。
- 选型：直接使用原始 841×1870 源稿和 `photo` 预设；`path_precision=1` 在肉眼无可辨差异的前提下，比两位小数版本减少约 14.5% 文件体积。
- 产物：`quiet-aqua-character-vector-v2.svg`，997,525 bytes，SHA-256 为 `854F31031807338C488F97A298E3A5EB6DA09DD51E41FC36198AC93EE06234F9`。
- 结构：XML 可解析；根元素具有 `viewBox="0 0 841 1870"`；597 个 `<path>`、593 种填充色；标签集合严格为 `svg,path`。
- 位图审计：`<image>`、`data:image`、`href=`、`.png/.jpg/.jpeg/.webp` 命中数均为 0。几何内容为纯 path，不包含滤镜、外链、字体或运行时依赖。

复现命令：

```powershell
vtracer.exe `
  --input docs/ui-oracle/generated/quiet-aqua-character-source-v2.png `
  --output docs/ui-oracle/generated/quiet-aqua-character-vector-v2.svg `
  --preset photo `
  --path_precision 1
```

VTracer 生成后，仅在根 `<svg>` 上补充响应式 `viewBox` 与 `preserveAspectRatio="xMidYMid slice"`；没有人工重绘路径或嵌入源位图。
