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
// 触达下限兜底：全仓没有任何全局 44px 规则，未被单独照顾的控件一直是桌面尺寸。
import './app-tap.css';
// 焦点环收口：主按钮的 CTA 投影（app-rainbow.css）晚于焦点规则加载，把环挤掉了。
// 必须排在 app-rainbow* 之后，详见文件头注释。
import './app-focus.css';
// 顶部安全区收口：各页面层的顶栏漏了负 margin，导致刘海机上安全区被算两次。
// 必须在所有页面层（renov / quiet-aqua / experience-v3 / hig-v5 / ix-*）之后，
// 否则会被那些 (0,2,1) 的页面规则盖掉。
// 排在 chat-glass 之前：chat-glass 是「恒最后」的冻结层（app-test.mjs:603 有断言），
// 且它只管对话输入岛的底部内边距，与本层的 14 个吸顶顶栏零交集。
import './app-safearea.css';
// 对话框雾态玻璃收口（参考稿 1:1）：必须最后引入，覆盖上面各层的 chat 输入岛规则。
import './chat-glass.css';
