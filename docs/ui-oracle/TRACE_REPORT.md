# Quiet Aqua v3 人物 PNG → path-only SVG 追踪报告

核验日期：2026-07-18  
范围：只记录 v3 人物设计源、追踪候选、生产 SVG、运行时接线和中间文件清理计划。三张页面母版没有被整屏矢量化后嵌入产品。

## 1. 结论

生产文件 `client/src/assets/quiet-aqua-character-v3.svg` 是真正的路径 SVG：

| 项目 | 核验值 |
|---|---:|
| 画布 | `941 × 1672` |
| 文件体积 | `628,234 bytes` |
| `<path>` 数 | `2,617` |
| 标签集合 | `svg`, `path` |
| `<image>` | `0` |
| `href` / `xlink:href` | `0` |
| Data URI | `0` |
| SHA-256 | `65ACFA0DF0B232C0435CA9D63AA51FD82C31A9AECB213D22F5A0ED3C34F74EFB` |

它不是把 PNG 以 Base64、`<image>`、远程 URL 或文件引用藏进 SVG。客户端通过 `art.jsx` 的 `QuietAquaCharacterArt` 以 URL `<img>` 方式加载它，仅用于 App 的种子/演示大媒体 fallback；Today、Discover 和 CharacterView 的真实业务媒体优先。

## 2. 可核验的实际管线

仓库证据支持以下管线：

1. 生成并保留人物设计源：`docs/ui-oracle/generated/v3/quiet-aqua-v3-character-source.png`。
2. 使用 visioncortex VTracer `0.6.4` 生成多组路径候选。版本来自每个候选 SVG 的 Generator 注释。
3. 为 balanced、detail、mid、production 四个候选生成同尺寸 PNG 预览，进行人工清晰度/体积取舍；fidelity 候选保留为最高路径密度对照。
4. 选择 `quiet-aqua-v3-character-trace-production.svg`：`2,617` 条路径、`1,539,769 bytes`。
5. 对所选 SVG 做生产规范化：移除 XML 声明、Generator 注释和空白，统一颜色写法，折叠/烘焙 `translate(...)` 到路径坐标并压缩 path data。路径数量和 `941 × 1672` 画布保持不变。
6. 输出 `client/src/assets/quiet-aqua-character-v3.svg`，体积减少 `911,535 bytes`，即相对追踪候选减少 `59.20%`。
7. 由 `client/app-test.mjs` 检查 path-only、无栅格引用、路径细节下限和运行时 PNG 隔离；由页面 E2E 检查可视区无破图。

仓库没有保存 VTracer 的完整命令行参数，也没有记录第 5 步所用规范化器的程序名/版本。本报告不补写无法从文件证明的参数；若需要完全可复现，后续应把命令、版本和参数固化为仓库脚本。

## 3. 输入与设计母版

| 文件 | 尺寸 | 体积 | SHA-256 | 用途 |
|---|---:|---:|---|---|
| `quiet-aqua-v3-character-source.png` | `941 × 1672` | `1,643,660` | `643D7F9C347E277E5345E5CD0666BD963745FCF08FF661666F5DE96C14A3B626` | 人物追踪源，文档证据，不进运行时 |
| `quiet-aqua-v3-primary.png` | `1657 × 949` | `1,951,615` | `61C24048AE4E95FBDD1A089370AF410851CA9363229C4C1432A2931C79F338C6` | 四个一级页面母版 |
| `quiet-aqua-v3-core-flow.png` | `1700 × 925` | `1,935,236` | `A1D84928C86021D505CF3492D2943DECE92E2A6E9196A6B3F0B1C0A23F5088D9` | 详情、会话、群聊、编辑核心流母版 |
| `quiet-aqua-v3-secondary.png` | `1651 × 953` | `1,568,827` | `6DD768E74F2B09405CB89262879FB693381D6B80D4EE8BFE4838D927341FCAF6` | 钱包、会员、创作、设置母版 |

页面母版只用于构图评审。仓库运行时检索未发现 `docs/ui-oracle`、三张 v3 母版或人物源 PNG 的 client/server/build 引用。

## 4. VTracer 候选实测

所有候选均声明 `Generator: visioncortex VTracer 0.6.4`，尺寸均为 `941 × 1672`，标签均只有 `svg/path`。

| 候选文件 | 路径数 | 体积 | SHA-256 |
|---|---:|---:|---|
| `quiet-aqua-v3-character-trace-balanced.svg` | `245` | `169,976` | `B1E2591DEA68D8B26B61ED85B3412F0000D44D4FE1BAA7BA9BAE60B67AC50D68` |
| `quiet-aqua-v3-character-trace-detail.svg` | `212` | `553,848` | `8FB5102E3BC9035D924B545A6A9838A113C32D16E7465A8EB0ABFC8A361E495E` |
| `quiet-aqua-v3-character-trace-mid.svg` | `3,391` | `1,817,421` | `48A538B4F21D3E879657ABF40CB2D4CEDCE8E55C823A1BBD6FC4BE81B4A44E66` |
| `quiet-aqua-v3-character-trace-fidelity.svg` | `13,532` | `5,138,975` | `8A77D293EB98E7D9612611A28942F7BCE5C7E3CCA9B030BF85CB3F4FB8061C66` |
| `quiet-aqua-v3-character-trace-production.svg` | `2,617` | `1,539,769` | `31EF1E74790D8C2F8D28599427A0542DF3966349E90BBBA117D3DFC34868D630` |

文件名是当时的评审标签，不代表路径数必然单调。“detail”虽然路径较少，但单条 path data 更复杂，因此文件更大；不能只用路径数判断视觉细节。

### 4.1 预览文件

| 预览文件 | 尺寸 | 体积 | SHA-256 |
|---|---:|---:|---|
| `quiet-aqua-v3-character-trace-balanced-preview.png` | `941 × 1672` | `105,928` | `A8986F5F5049623104A3FE4F9262FB16EBB7EFF8747EB6713DD6C406602E8FC7` |
| `quiet-aqua-v3-character-trace-detail-preview.png` | `941 × 1672` | `226,817` | `8159A6DBA33B4A8830E0E22808AB248BAEAA139C7BE6D99310818841A6B441DA` |
| `quiet-aqua-v3-character-trace-mid-preview.png` | `941 × 1672` | `409,028` | `F0C06FF5766D64F2382D2981D946CA6B0CCD8722ACCC2CB63C3F8D1F8AFA08CF` |
| `quiet-aqua-v3-character-trace-production-preview.png` | `941 × 1672` | `381,137` | `9C4AE7ED7C4375B9556A89148EEF7C0DC4D3E723036F2A6C3DD3C40370C14685` |

## 5. 生产规范化差异

生产候选与运行时文件有相同画布和相同 `2,617` 条路径。可直接观察到的变换包括：

- `<path d="..." fill="#B7C1C6" transform="translate(...)">` 被规范为小写颜色、属性压缩的 `<path fill="#b7c1c6" d="...">`。
- `translate(...)` 被折叠进路径坐标，运行时文件不再保留成千上万个 transform 字符串。
- XML 声明、Generator 注释、换行、冗余空格和可缩短的路径指令被移除或压缩。
- 标签集合仍只有 `svg/path`；没有用 `<use>`、外链或栅格替代路径。

因此两个文件的 SHA-256 不同是预期结果；路径数、画布、可视结果和运行时安全约束才是派生关系的关键证据。

## 6. 运行时接线与守卫

| 位置 | 当前职责 |
|---|---|
| `client/src/art.jsx` | `import quiet-aqua-character-v3.svg?url`，输出 `QuietAquaCharacterArt`；识别旧 monogram seed |
| `client/src/pages/AppHome.jsx` | 今日精选大媒体缺少合格真实头像时使用生产 SVG |
| `client/src/pages/DiscoverFeed.jsx` | App 发现流的旧 seed 媒体 fallback；首屏 eager、邻屏 lazy |
| `client/src/pages/CharacterView.jsx` | 角色详情缺少合格真实媒体时使用相同人物面，支持媒体连续性 |
| `client/app-test.mjs` | 只允许 `svg/path`；拒绝 `<image>`、Data URI、href 和栅格扩展名；拒绝运行时引用母版 PNG/文档目录 |
| `server/quiet-aqua-e2e.mjs` | 等待可视区图片完成，拒绝 `naturalWidth === 0` 的破图 |

不得把该 SVG 直接内联到重复卡片中，也不得把它用于覆盖真实用户上传媒体。普通 Web 保持既有占位行为。

## 7. 中间文件清理清单

下列 9 个文件已完成候选比较，既不被运行时引用，也不再是最终权威。完成本报告评审、确认无需重跑追踪后可删除：

| 删除候选 | 体积 |
|---|---:|
| `quiet-aqua-v3-character-trace-balanced.svg` | `169,976` |
| `quiet-aqua-v3-character-trace-balanced-preview.png` | `105,928` |
| `quiet-aqua-v3-character-trace-detail.svg` | `553,848` |
| `quiet-aqua-v3-character-trace-detail-preview.png` | `226,817` |
| `quiet-aqua-v3-character-trace-fidelity.svg` | `5,138,975` |
| `quiet-aqua-v3-character-trace-mid.svg` | `1,817,421` |
| `quiet-aqua-v3-character-trace-mid-preview.png` | `409,028` |
| `quiet-aqua-v3-character-trace-production.svg` | `1,539,769` |
| `quiet-aqua-v3-character-trace-production-preview.png` | `381,137` |
| **合计** | **`10,342,899 bytes`（`10.34 MB` 十进制 / `9.86 MiB`）** |

清理后必须保留：

- `quiet-aqua-v3-character-source.png`：来源与未来重追踪依据。
- 三张 v3 页面母版：构图评审证据。
- `client/src/assets/quiet-aqua-character-v3.svg`：唯一生产人物矢量。
- 本报告与 `APP_UI_ORACLE.md`：管线、hash 和验收记录。

`docs/ui-oracle/generated/` 根目录的 v1 母版、手工 trace 和 v2 人物文件属于旧版历史证据，不纳入本次 9 文件清理。是否归档或删除需要单独确认，不能随 v3 中间件一起批量移除。

## 8. 复核命令

以下 PowerShell 检查可以重复生产文件审计：

```powershell
$p = 'client/src/assets/quiet-aqua-character-v3.svg'
$raw = Get-Content -Raw -Encoding UTF8 $p
(Get-Item $p).Length
([regex]::Matches($raw, '<path(?:\s|>)')).Count
([regex]::Matches($raw, '<image(?:\s|>)')).Count
([regex]::Matches($raw, '(?:href|xlink:href)\s*=')).Count
([regex]::Matches($raw, 'data:')).Count
(Get-FileHash -Algorithm SHA256 $p).Hash
```

期望值依次为：`628234`、`2617`、`0`、`0`、`0`、上述 SHA-256。随后运行：

```text
npm run test:app
npm run build:static
npm run test:app:e2e
```

若生产 SVG 的 hash、路径数、尺寸或允许标签集合发生变化，必须先更新本报告并重新完成母版/页面视觉评审，不能只改断言让测试通过。
