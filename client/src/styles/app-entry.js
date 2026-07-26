// App 壳样式包（W6 CSS 按模式分包）—— 原 main.jsx 里的 App 层 CSS 静态 import
// 整体搬入本模块，import 顺序逐行保持原序（顺序即级联权威，禁止重排）。
// main.jsx 在 isAppMode() 时于 render 前 await import 本模块；Web 用户不再
// 下载 ~700KB 的 App 层 CSS。App 有启动闪屏遮盖，无 FOUC。
//
// APP 端沉浸对话皮肤（白+青玻璃深度进化）—— 在 styles.css 之后引入，import 顺序即级联
// 顺序，故此文件为 app 对话皮肤的唯一权威来源（覆盖 styles.css 里历史层叠的 chat 规则）。
import '../chat/chat-app.css';
// PR4 native material and balanced-performance overrides. Quiet Aqua loads
// immediately after it and preserves the same balanced/lite performance gate.
import './app-runtime.css';
// Lumen Glass v1.0 token authority (verbatim from docs/design, values frozen),
// followed by the --qa-* compatibility shim that maps the legacy namespace.
import './lumen-glass-tokens.css';
import './app-quiet-aqua-tokens.css';
import './app-controls.css';
import './app-pages-quiet-aqua.css';
// V3 experience layer: page composition and motion only. It is App-scoped and
// intentionally loads last so legacy page rules cannot flatten the new shell.
import './app-experience-v3.css';
// Liuli v5 HIG re-skin: typography, grouped lists, segmented controls, sheets,
// causal motion and dark parity. App-fenced only.
import './app-hig-v5.css';
// Lumen Glass per-stage screen layers (S3 primary tabs / S4 immersive+chat /
// S5 identity+creation), then the material composition layer as final authority.
import './app-lumen-s3.css';
import './app-lumen-s4.css';
import './app-lumen-s5.css';
// Lumen Glass material composition layer: glass classes, ambient washes and
// legacy accent-id aliasing. Loads last as the final App authority.
import './app-lumen-materials.css';
