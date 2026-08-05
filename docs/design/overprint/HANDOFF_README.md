# 叠印 Overprint · 交付说明

本目录是 App 壳一级四页与机身条的设计交付包。`design-tokens.css` 是**冻结件**，
`SPEC.md` 是设计权威，本文是实现纪律。

## 交付物

| 文件 | 性质 |
|---|---|
| `design-tokens.css` | 冻结原件（`:root` 作用域）。运行时孪生 `client/src/styles/app-ov-tokens.css` 仅做选择器改写，值逐字节相同，由 app-test 锁死 |
| `SPEC.md` | 设计权威 v1.0：世界观、墨阶、极性、逐屏要点 |
| `HANDOFF_README.md` | 本文：硬约束与改动流程 |

## 硬约束 10 条

1. **基准 390×844**，必须在 360×800 与 412×915 同时成立。触控 ≥44×44，提交类 ≥48 高（继承 `--ix-hit-min` / `--ix-hit-submit`）。
2. **一种墨。** 文字、分隔线、胶囊底、按下态全部取自 `--ov-ink-*`，禁止再引入第二种中性灰，禁止一次性 rgba。
3. **只有前三档排字。** `--ov-ink-22` 及以下是填充与线，永不承载文本。第三档是 55% 不是 45%（无障碍修正，见 SPEC §4），不要"还原"。
4. **零投影。** 内容面用 `--ov-ring` 或填充档差表达边界。全系统唯一投影是 `--ov-shadow-float`，仅用于压在媒体上的浮层徽标。
5. **遮罩是唯一装饰性渐变。** 媒体上的文字一律坐在 `--ov-scrim-media` 上。除此之外不得出现渐变，尤其禁止渐变文字（`background-clip: text` 已被 app-test 全局禁）。
6. **几何与语义色继承 IX，不得重定义。** 圆角只有 4/6/10/14/999，间距只有 4/8/12/16/24/32，语义色相冻结。`design-tokens.css` 里出现任何 `--ov-r-*` 或 `--ov-danger` 之类都是错的。
7. **极性由路由声明。** `data-surface="immersive"` 恒为深台，与 `data-theme` 无关。组件不得写死前景色，一律走墨阶。
8. **动效继承 IX。** 时长与缓动只取 `--ix-dur-*` / `--ix-ease*`；禁循环、扫光、呼吸。新增任何 `animation: … infinite` 都会撞上 app-test 的封闭允许名单。
9. **lite 档只关浮层投影。** 遮罩与墨阶是可读性不是特效，`[data-perf="lite"]` 不得关闭它们。机身条玻璃归 IX 管，lite 归零的行为不变。
10. **围栏。** 每条选择器从 `html[data-app="1"]` 起始。`app-ov-*.css` 里出现任何未围栏的顶层类选择器都会被 app-test 拦下。

## 改动流程

**改令牌**：必须同时改 `docs/design/overprint/design-tokens.css`（冻结原件）与
`client/src/styles/app-ov-tokens.css`（运行时孪生），且两者唯一的差异只能是
`:root` → `html[data-app="1"]` 的选择器改写。孪生请用脚本生成，不要手抄：

```bash
node -e "const fs=require('fs');const s=fs.readFileSync('docs/design/overprint/design-tokens.css','utf8');fs.writeFileSync('client/src/styles/app-ov-tokens.css',s.replace(/:root\[data-theme=\"dark\"\]/g,'html[data-app=\"1\"][data-theme=\"dark\"]').replace(/:root\[data-perf=\"lite\"\]/g,'html[data-app=\"1\"][data-perf=\"lite\"]').replace(/:root\[data-surface=\"immersive\"\]/g,'html[data-app=\"1\"][data-surface=\"immersive\"]').replace(/:root(\s*\{)/g,'html[data-app=\"1\"]\$1'))"
```

**改结构契约**：改动 `client/app-test.mjs` 里对应的 `assert.match(...)`，以及
`server/quiet-aqua-e2e.mjs` 的选择器表，与代码同一次提交。

**改设计意图**：先改 `SPEC.md` §7 逐屏要点，再改实现。断言是意图的编码，不是意图本身。

## 不可改动的字面量

这几处被 app-test 用 `indexOf` / 正则直接定位，改了必红：

- `client/src/components/AppLayout.jsx`：`<nav className="app-tabbar"` 与 `className={'app-fab'`（创建键必须是 nav 的兄弟节点，且出现在 `</nav>` 之后）
- `client/src/styles/app-runtime.css`：`.app-tabbar` 的 `var(--ix-blur)` 规则，以及 `[data-perf="lite"] .app-tabbar { backdrop-filter: none }`
- 四个页面根类名：`.apphome` / `.qa-discover-page` / `.qa-messages-page` / `.qa-profile`（e2e 用作 `waitForSelector` 目标）
- 今日页：`className="aht-date"`、`<IxFlip value={fmtNum(user?.gold)}`、`qa-streak`、`qa-weekly-bars` + `role="img"`、`streakSealForTier(milestone)`、`burst(`
- 我的页：`CountUp value={s.n}`、`qa-glance" role="group"`、`pf-whatsnew-dot`、`WhatsNewSheet onClose`
- 消息页：`AppPressMenu` + `useLongPress`、`msgs-draft` + 「草稿」

## 已知接缝

叠印只覆盖一级四页与机身条，约 40 条二级与深层路由仍在 IX 上。从发现页点进角色详情会跨越材质接缝（零投影 → IX 卡片投影）。缓解手段是叠印刻意继承 IX 的全部几何基元与语义色相，让接缝只落在材质层。若评审认为接缝仍明显，后续单独排一期迁移深页，不要在本代里顺手改深页——那会让改动面失控且无法回归。
