// App 壳样式包（W6 CSS 按模式分包）—— IX App 层只在 App 模式加载，
// import 顺序即级联权威，禁止重排。
// main.jsx 在 isAppMode() 时于 render 前 await import 本模块；Web 用户不再
// 下载 App 层 CSS。App 有启动闪屏遮盖，无 FOUC。
//
// APP 端沉浸对话皮肤（白+青玻璃深度进化）—— 在 styles.css 之后引入，import 顺序即级联
// 顺序，故此文件为 app 对话皮肤的唯一权威来源（覆盖 styles.css 里历史层叠的 chat 规则）。
import '../chat/chat-app.css';
// PR4 native material and balanced-performance overrides. Quiet Aqua loads
// immediately after it and preserves the same balanced/lite performance gate.
import './app-runtime.css';
// IX runtime authority: every App layer consumes the frozen --ix-* namespace.
import './app-ix-tokens.css';
import './app-ix-accents.css';
import './app-controls.css';
import './app-pages-quiet-aqua.css';
// Shared App composition and HIG rules remain fenced; IX pages are the final cascade.
import './app-experience-v3.css';
import './app-hig-v5.css';
// Historical S3-S7 composition is folded into the IX page tail.
import './app-ix-core.css';
import './app-ix-pages-a.css';
import './app-ix-pages-b.css';
import './app-ix-pages-c.css';
// IX-6/IX-7 tail: long-tail pages, states, and migrated stage composition.
import './app-ix-pages-d.css';
// 彩虹系色彩层：青蓝玻璃基面覆盖 + 彩虹令牌与全部静态彩虹落点。
import './app-rainbow.css';
// 彩虹系动效层：keyframes / 呼吸循环 / 浮层退场 / 降级闸门。
import './app-rainbow-motion.css';
// 对话框雾态玻璃收口（参考稿 1:1）：必须最后引入，覆盖上面各层的 chat 输入岛规则。
import './chat-glass.css';
