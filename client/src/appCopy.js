// Liuli v5 — App/Web 文案分支的唯一通道。
// 规则：只做「风格」分支（如 App 端去掉 emoji 装饰字符），不改动语义文字；
// 所有调用点可通过 `rg "appCopy|\\bt\\("` 一键盘点。Web 值永远原样返回。
import { isAppMode } from './appmode.js';

export function t(webValue, appValue) {
  return isAppMode() ? appValue : webValue;
}
