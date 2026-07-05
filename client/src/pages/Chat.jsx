import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { api, getToken, useAuth } from '../api.jsx';
import { useToast, Avatar, Modal } from '../ui.jsx';
import { speakBrowser, stripParensForSpeech, playAudioUrl, stopSpeaking, onVoiceStateChange, detectEmotion } from '../voice.js';
import { useKeyboardInsetBar } from '../mobile.js';
import { useAutoGrow, msgPreview } from '../util.js';
import IllustrateModal from '../components/IllustrateModal.jsx';
import CallScreen from '../components/CallScreen.jsx';
import { EmptyArt } from '../art.jsx';
import { applyFrontRegex, looksLikeHtml } from '../frontregex.js';
import { buildPanelDoc, installTavernHost } from '../tavernbridge.js';
import { Send, Volume2, MessageCircle, Plus, X, ArrowLeft, Copy, RotateCcw, PanelLeftClose, PanelLeftOpen, Square, ArrowDown, Pencil, Trash2, Check, Heart, BookOpen, Brain, Smile, MoreVertical, Type, Download, Eraser, Search, Edit3, Wand2, Music, VolumeX, Image as ImageIcon, Sparkles, Bookmark, RefreshCcw, Phone, Dices, Gift, Drama, Zap } from 'lucide-react';

// —— 「+」面板 · 互动添趣素材 ——
// 送礼物：礼物名 + emoji，选中后以 RP 动作发给角色（角色会在剧情里回应）。
const GIFTS = [
  { e: '🌹', n: '一枝红玫瑰' }, { e: '🍰', n: '一块草莓蛋糕' }, { e: '☕', n: '一杯热咖啡' },
  { e: '🧸', n: '一只小熊玩偶' }, { e: '💌', n: '一封手写信' }, { e: '🎁', n: '一份神秘礼物' },
  { e: '🌙', n: '一枚月亮吊坠' }, { e: '🍬', n: '一把水果糖' },
];
// 随机事件：注入一个剧情转折，让 AI 顺着演（互动添趣的核心玩法）。
const RANDOM_EVENTS = [
  '窗外突然下起了倾盆大雨', '远处传来一阵急促的敲门声', '灯光忽然闪烁了几下熄灭了',
  '一只猫不知从哪里跳了进来', '收音机里传来一则奇怪的新闻', '天边划过一道流星',
  '空气中飘来一阵熟悉的香味', '地面轻轻震动了一下', '门缝下被塞进来一张纸条',
  '时钟的指针突然开始倒转',
];

// 触屏设备上不显示「Enter 发送」这类键鼠提示——占位符过长会在窄输入框里折行溢出。
const COARSE = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;

const LIST_KEY = 'huanyu_chatlist_mini';
const FONT_KEY = 'huanyu_chat_font';
const AUTOREAD_KEY = 'huanyu_chat_autoread';
const BGM_KEY = 'huanyu_chat_bgm';
const REACTIONS = ['❤️', '😂', '👍', '😮', '😢', '🔥'];
const STARTERS = ['你好呀～', '很高兴认识你！', '*微笑着向你打招呼*', '今天过得怎么样？', '我们聊点什么好呢？'];
const QUICK_ACTIONS = ['*微笑*', '*点头*', '*脸红*', '*轻笑*', '*歪头*', '*叹气*', '*眨眨眼*', '*沉默不语*', '*牵起你的手*', '*轻轻拥抱*', '😊', '😳', '🥰', '😢'];

// Relationship tiers driven by accumulated affinity (grows ~+3 per exchange).
const AFFINITY_LEVELS = [
  { min: 0, name: '初识', icon: '🌱' }, { min: 10, name: '相识', icon: '🌿' },
  { min: 30, name: '熟悉', icon: '☕' }, { min: 60, name: '友好', icon: '😊' },
  { min: 100, name: '亲近', icon: '💗' }, { min: 160, name: '信赖', icon: '✨' },
  { min: 250, name: '挚爱', icon: '💖' }
];
function affinityInfo(v) {
  v = v || 0; let idx = 0;
  for (let i = 0; i < AFFINITY_LEVELS.length; i++) if (v >= AFFINITY_LEVELS[i].min) idx = i;
  const cur = AFFINITY_LEVELS[idx], next = AFFINITY_LEVELS[idx + 1];
  const pct = next ? Math.min(100, Math.round((v - cur.min) / (next.min - cur.min) * 100)) : 100;
  return { level: idx + 1, name: cur.name, icon: cur.icon, pct, value: v, nextAt: next ? next.min : null };
}

// —— 专家档世界书：[[wbimg:<entryId>]] 标记协议 ——
// 模型在专家世界书触发时嵌入此标记。前端按 wb_image_map[id] 直接展示创建者预注入的图片（不调用 AI 生图）。
const WBIMG_RE = /\[\[wbimg:(\d+)\]\]/g;

// 把一段助手文本拆成 [text | { marker, id, meta }] 交替片段，供气泡按片段渲染。
function splitWbMarkers(text, imageMap) {
  if (!text || !imageMap) return [{ text }];
  const out = [];
  let last = 0, m;
  WBIMG_RE.lastIndex = 0;
  while ((m = WBIMG_RE.exec(text))) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    const id = m[1];
    out.push({ marker: true, id, meta: imageMap[id] || null });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

// —— 角色扮演排版：*动作/神态* 渲染为柔和的斜体强调，与台词在视觉上分层。
// RP 对话的行文约定是「*叹了口气* 你来了。」，纯文本渲染时动作和台词糊成
// 一团；这里把星号段落变成带色斜体，读起来像剧本舞台指示，沉浸感立增。
function renderRp(text, keyBase = 0) {
  if (!text || (text.indexOf('*') === -1 && text.indexOf('（') === -1)) return text;
  const out = [];
  // *动作* 去掉星号后斜体；（神态/动作）保留全角括号并斜体 —— 两种约定都呈现为
  // 柔和的舞台指示，与台词在视觉上分层（沉浸对话里读起来像剧本旁白）。
  const re = /\*([^*\n]{1,120})\*|（([^）\n]{1,120})）/g;
  let last = 0, m2, k = 0;
  while ((m2 = re.exec(text))) {
    if (m2.index > last) out.push(<span key={`${keyBase}-t${k++}`}>{text.slice(last, m2.index)}</span>);
    out.push(<em key={`${keyBase}-a${k++}`} className="rp-act">{m2[1] != null ? m2[1] : m2[0]}</em>);
    last = m2.index + m2[0].length;
  }
  if (last < text.length) out.push(<span key={`${keyBase}-t${k++}`}>{text.slice(last)}</span>);
  return out;
}

// 气泡内容：专家档助手消息可含 [[wbimg:id]] 标记，标记位置直接展示创建者预注入的
// 图片（不调用 AI 生图）；无标记时退化为 RP 排版文本。
// React.memo 是这里的性能关键：流式生成期间线程每帧 setMessages 一次，除最后一条外
// 其余消息的 content 引用都没变，memo 让老消息跳过整段正则解析与片段重建 ——
// 否则解析成本随对话长度线性增长，长对话时打字都会掉帧。
// 专家前端面板：把角色卡里的 HTML 面板渲染进 iframe（blob: 文档，CSP 已在 index.html 放行）。
// 酒馆兼容关键点：
//   · sandbox 含 allow-same-origin —— 卡片前端普遍依赖 localStorage/IndexedDB 存档，
//     且通过 window.parent.TavernHelper.generate(...) 直接调宿主 AI（凡人修仙传等标准用法）。
//     这意味着面板脚本与宿主同权（与酒馆助手的安全模型一致：卡片前端本就是「可信扩展」）。
//   · buildPanelDoc 注入 shim：eventOn/eventEmit、tavern_events、TavernHelper 本地代理、
//     SillyTavern.getContext 最小面 + 高度自适应上报（先于卡片脚本执行）。
// PANEL_CTX 由 Chat 组件维护（角色名/会话 id），供 shim 里 getContext() 使用。
let PANEL_CTX = { characterName: '', conversationId: 0 };
function HtmlPanel({ html }) {
  // 完整 HTML 文档（游戏面板/说明书页）多为 position:fixed 的整页布局：
  //   · scrollHeight 可能「自指」（=iframe 高度）→ 自适应变矮条
  //   · 也可能被隐藏的大尺寸区块（地图画布等）撑到数千 px → iframe 拉超高后，
  //     fixed 居中的开始界面落在 iframe 视口中央 = 屏幕外，肉眼只见黑底
  // 所以整页面板的高度按「一屏游戏视口」处理：下限 72vh、上限 ~86vh，内部自滚动；
  // 片段面板才走高度上报完全自适应。
  const fullDoc = /<!doctype html|<html[\s>]/i.test(String(html || '').slice(0, 400));
  const vh = window.innerHeight || 800;
  const baseH = fullDoc ? Math.max(480, Math.round(vh * 0.72)) : 360;
  const maxH = fullDoc ? Math.max(560, Math.round(vh * 0.86)) : 4000;
  const [h, setH] = useState(baseH);
  const [loaded, setLoaded] = useState(false);
  const frameRef = useRef(null);
  const src = useMemo(() => {
    const doc = buildPanelDoc(html, PANEL_CTX);
    return URL.createObjectURL(new Blob([doc], { type: 'text/html' }));
  }, [html]);
  useEffect(() => () => { try { URL.revokeObjectURL(src); } catch { /* */ } }, [src]);
  useEffect(() => {
    // 撤加载蒙层的时机不能依赖 iframe load 事件：卡片外链 CDN（Google Fonts 等）
    // 在弱网/受限网络下会长时间挂起、load 迟迟不触发，而面板 DOM 其实早已渲染。
    // shim 的高度上报（ResizeObserver 立即触发）就是「已渲染」的可靠信号；再兜一个超时。
    const onMsg = e => {
      const v = e.data && e.data.__hyH;
      if (typeof v !== 'number') return;
      if (frameRef.current && e.source === frameRef.current.contentWindow) setLoaded(true);
      // 整页面板钳制在一屏内（不缩回矮条、也不被撑出屏）；片段面板完全自适应
      setH(prev => Math.min(maxH, Math.max(fullDoc ? Math.max(baseH, prev) : 160, v + 8)));
    };
    window.addEventListener('message', onMsg);
    const t = setTimeout(() => setLoaded(true), 3500);
    return () => { window.removeEventListener('message', onMsg); clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className={'html-panel-wrap' + (loaded ? ' ready' : '')}>
      {/* 加载占位：卡片外链 CDN（字体/库/视频）就绪前面板常呈黑屏，给出可感知的加载态 */}
      {!loaded && (
        <div className="html-panel-loading" aria-hidden="true">
          <span className="hp-spin" /><b>角色前端加载中…</b><i>大型面板首次加载可能需要几秒</i>
        </div>
      )}
      <iframe className="html-panel" ref={frameRef} src={src} onLoad={() => setLoaded(true)}
        sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms allow-modals allow-downloads"
        allow="clipboard-write; clipboard-read; fullscreen"
        style={{ height: h }} title="角色前端面板" />
    </div>
  );
}

// 把含 ```html 面板 / 整段 HTML 的文本拆开：面板走 iframe，其余走 RP 排版。
// 围栏收尾不能用非贪婪 ```：酒馆卡的面板动辄数十万字符，正文里（JS 模板串、
// 说明文档）常夹杂反引号序列，非贪婪会提前收口、把面板后半段当纯文本渲染。
// 策略：内容若是完整 HTML 文档（含 </html>），收尾围栏取 </html> 之后最近的 ```；
// 否则退回最近 ```；找不到则吃到文本结尾。
function splitHtmlFences(text) {
  const out = []; const open = /```html\s*\n?/gi; let m, last = 0;
  while ((m = open.exec(text))) {
    const start = m.index, cs = open.lastIndex;
    let close = -1;
    const endHtml = text.toLowerCase().indexOf('</html>', cs);
    if (endHtml >= 0) close = text.indexOf('```', endHtml);
    if (close < 0) close = text.indexOf('```', cs);
    const html = close < 0 ? text.slice(cs) : text.slice(cs, close);
    const end = close < 0 ? text.length : close + 3;
    out.push({ pre: text.slice(last, start), html });
    last = end; open.lastIndex = end;
  }
  return { blocks: out, tail: text.slice(last) };
}
function renderWithPanels(text) {
  const parts = []; let k = 0;
  const { blocks, tail } = splitHtmlFences(text);
  for (const b of blocks) {
    if (b.pre.trim()) parts.push(<span key={'t' + (k++)}>{renderRp(b.pre, k)}</span>);
    parts.push(<HtmlPanel key={'h' + (k++)} html={b.html} />);
  }
  if (blocks.length === 0 && looksLikeHtml(tail)) return [<HtmlPanel key="h0" html={tail} />];
  if (tail.trim()) parts.push(looksLikeHtml(tail) ? <HtmlPanel key={'h' + k} html={tail} /> : <span key={'t' + k}>{renderRp(tail, k)}</span>);
  return parts;
}

const BubbleContent = React.memo(function BubbleContent({ content, role, imageMap, onPreview, frontRegex }) {
  if (!content) return null;
  // 先应用前端显示正则（酒馆 regex_scripts）：可把标记替换成 HTML 面板等（仅显示层）。
  const text = (frontRegex && frontRegex.length) ? applyFrontRegex(content, frontRegex, role) : content;
  // 助手消息可含面板；用户消息仅当角色带前端正则时才放行（酒馆 placement=1，如表情包/私聊/地图），
  // 避免普通聊天里用户偶然输入的 HTML 被当成面板渲染。
  if ((role === 'assistant' || (frontRegex && frontRegex.length)) && (/```html/i.test(text) || looksLikeHtml(text))) return renderWithPanels(text);
  if (role !== 'assistant' || !imageMap || !WBIMG_RE.test(text)) {
    WBIMG_RE.lastIndex = 0;
    return renderRp(text);
  }
  WBIMG_RE.lastIndex = 0;
  const parts = splitWbMarkers(text, imageMap);
  return parts.map((seg, i) => {
    if (!seg.marker) return <span key={i}>{renderRp(seg.text, i)}</span>;
    const meta = seg.meta;
    if (!meta || !meta.urls || meta.urls.length === 0) {
      return <span key={i} className="wb-img-missing" title="该标记未预注入图片"><ImageIcon size={12} /> 〔未注入图片〕</span>;
    }
    // 多张时堆叠展示，点击任一张进入全屏预览（支持 pinch-zoom 与双指缩放）
    return (
      <span key={i} className="wb-inline-imgs">
        {meta.urls.map((u, j) => (
          <img key={j} className="wb-inline-img" src={u} alt={`场景插图 ${j + 1}（点击放大）`} loading="lazy"
            onClick={() => onPreview(u)} />
        ))}
      </span>
    );
  });
});

export default function Chat() {
  const { id } = useParams();
  const nav = useNavigate();
  const loc = useLocation();
  const toast = useToast();
  const { refreshUser } = useAuth();
  const [convs, setConvs] = useState([]);
  const [conv, setConv] = useState(null);
  const [character, setCharacter] = useState(null);
  // 角色前端显示正则（酒馆 regex_scripts）—— 解析一次，供气泡渲染 HTML 面板等。
  const frontRegex = useMemo(() => { try { return JSON.parse(character?.front_regex || '[]'); } catch { return []; } }, [character?.front_regex]);
  // 备用开场白（酒馆 alternate_greetings）：对话未开始时可切换开场。
  const altGreetings = useMemo(() => { try { const v = JSON.parse(character?.alt_greetings || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } }, [character?.alt_greetings]);
  const [greetIdx, setGreetIdx] = useState(0);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [actionsOpen, setActionsOpen] = useState(false);
  const [plusOpen, setPlusOpen] = useState(false);   // 输入栏「+」对话功能面板
  const [plusPage, setPlusPage] = useState(0);       // 面板分页指示（0=互动 1=工具）
  const [giftOpen, setGiftOpen] = useState(false);   // 送礼物选择条
  const [callOpen, setCallOpen] = useState(false);   // 语音/视频通话
  const plusPagerRef = useRef(null);
  const [streaming, setStreaming] = useState(false);
  const [listMini, setListMini] = useState(() => localStorage.getItem(LIST_KEY) === '1');
  const [atBottom, setAtBottom] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');
  const [affinity, setAffinity] = useState(0);
  const [memories, setMemories] = useState([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [newMem, setNewMem] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  // 消息书签：本地存储（三端通用、不依赖服务端），按会话隔离。
  const [marks, setMarks] = useState(new Set());
  const [marksOpen, setMarksOpen] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [fontSize, setFontSize] = useState(() => localStorage.getItem(FONT_KEY) || 'md');
  const [autoRead, setAutoRead] = useState(() => localStorage.getItem(AUTOREAD_KEY) === '1');
  const [reactFor, setReactFor] = useState(null);
  const [bgmOn, setBgmOn] = useState(() => localStorage.getItem(BGM_KEY) !== '0');
  const [previewImg, setPreviewImg] = useState(null);
  // 当前正在朗读的消息标识（消息 id 或 true）；用于切换「朗读 / 停止」按钮态
  const [playingId, setPlayingId] = useState(null);
  // 已生成的平台语音缓存：消息 id -> blob URL。「再听一遍」直接重放，不重新合成、不再计费。
  const voiceCacheRef = useRef(new Map());
  const [voicedIds, setVoicedIds] = useState(() => new Set());
  const [loadingConv, setLoadingConv] = useState(false);
  const scrollRef = useRef();
  const abortRef = useRef(null);
  const bgmRef = useRef(null);
  const inputRef = useRef(null);
  const inputBarRef = useRef(null);
  // 流式更新 rAF 节流：累积 delta 到缓冲，每帧最多刷新一次，降低低端机渲染压力
  const streamBufRef = useRef(null);
  const streamRafRef = useRef(0);
  const autoReadRef = useRef(autoRead);
  useEffect(() => { autoReadRef.current = autoRead; }, [autoRead]);

  // 发现流「自由输入」带过来的草稿：落地即预填在输入框，用户确认后再发送。
  useEffect(() => {
    const draft = loc.state?.draft;
    if (draft) { setInput(draft); nav(loc.pathname, { replace: true, state: null }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // 移动端软键盘适配：把 fixed 输入栏始终顶在键盘上方（稳健跨浏览器实现见 mobile.js）。
  useKeyboardInsetBar(inputBarRef, [conv]);

  // —— 酒馆助手宿主桥：面板 iframe 通过 window.parent.TavernHelper.generate 静默生成。
  // convRef 跟随路由；消息引用给 getChatMessages 用（酒馆格式：{message, role, ...}）。
  const convIdRef = useRef(null);
  useEffect(() => { convIdRef.current = id; }, [id]);
  const messagesRef = useRef(messages);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => {
    PANEL_CTX = { characterName: character?.name || '', conversationId: Number(id) || 0 };
    const uninstall = installTavernHost(convIdRef, {
      onToast: (m) => toast(m),
      onFee: (fee) => { toast(`平台 AI · 本次消耗 ${fee} 金币`); refreshUser?.(); },
      getLastMessageId: () => Math.max(0, messagesRef.current.length - 1),
      getChatMessages: () => messagesRef.current.map((m, i) => ({
        message_id: i, role: m.role, name: m.role === 'user' ? '我' : (character?.name || ''), message: m.content || ''
      }))
    });
    return uninstall;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, character?.name]);

  // 原生状态栏语境：进入带背景图的沉浸对话时把状态栏刷成深色底
  //（否则 App 浅色主题下状态栏是一条奶白实心条，压在深色聊天页顶端 = 「顶部白屏」）。
  // 离开对话/卸载时撤销，恢复主题默认。
  useEffect(() => {
    const dark = !!(conv && character?.background);
    try {
      window.dispatchEvent(new CustomEvent('huanyu-statusbar', {
        detail: dark ? { color: '#12101a', dark: true } : null
      }));
    } catch { /* */ }
    return () => { try { window.dispatchEvent(new CustomEvent('huanyu-statusbar', { detail: null })); } catch { /* */ } };
  }, [conv, character?.background]);
  // 输入框随内容自动增高（发送清空后回落单行），多行长文不再挤在一行内滚动。
  useAutoGrow(inputRef, input);

  // 订阅全局朗读状态，驱动「朗读 / 停止 / 再听一遍」按钮切换。
  useEffect(() => onVoiceStateChange(setPlayingId), []);
  // 离开对话或卸载时停止朗读，并回收缓存的语音 blob URL，避免叠音与内存泄漏。
  useEffect(() => {
    return () => {
      stopSpeaking();
      for (const url of voiceCacheRef.current.values()) { try { URL.revokeObjectURL(url); } catch { /* */ } }
      voiceCacheRef.current.clear();
      setVoicedIds(new Set());
    };
  }, [id]);

  // 浮层（抽屉/菜单/搜索/反应面板/编辑）拦截浏览器后退键：打开时压栈，后退先关浮层而非跳路由。
  const closeAllOverlays = () => {
    setDrawerOpen(false); setMenuOpen(false); setSearchOpen(false); setSearchQ('');
    setActionsOpen(false); setReactFor(null); setEditingId(null); setPlusOpen(false); setGiftOpen(false);
  };
  const anyOverlayOpen = drawerOpen || menuOpen || searchOpen || actionsOpen || reactFor != null || editingId != null || plusOpen;
  useEffect(() => {
    if (!anyOverlayOpen) return;
    history.pushState({ overlay: true }, '');
    const onPop = closeAllOverlays;
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); closeAllOverlays(); history.state?.overlay && history.back(); } };
    window.addEventListener('popstate', onPop);
    document.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('popstate', onPop); document.removeEventListener('keydown', onKey); if (history.state?.overlay) history.back(); };
  }, [anyOverlayOpen]);
  const setFont = (v) => { setFontSize(v); localStorage.setItem(FONT_KEY, v); };
  const toggleAutoRead = () => setAutoRead(v => { const n = !v; localStorage.setItem(AUTOREAD_KEY, n ? '1' : '0'); return n; });
  const toggleBgm = () => setBgmOn(v => { const n = !v; localStorage.setItem(BGM_KEY, n ? '1' : '0'); return n; });

  // Character background music — loop softly while in the conversation. Browsers
  // may block autoplay until a gesture; the play() rejection is swallowed and
  // the user can tap the music button (a direct gesture) to start it.
  useEffect(() => {
    const el = bgmRef.current;
    if (!el) return;
    if (bgmOn && character?.bgm) { el.volume = 0.45; el.play().catch(() => {}); }
    else { el.pause(); }
  }, [character?.bgm, bgmOn]);
  const syncMessages = () => api('/chat/conversations/' + id).then(d => { setMessages(d.messages); setAffinity(d.conversation.affinity || 0); setMemories(d.conversation.memories || []); }).catch(() => {});

  const addMemory = async () => {
    const c = newMem.trim(); if (!c) return;
    try { const d = await api(`/chat/conversations/${id}/memories`, { method: 'POST', body: { content: c } }); setMemories(d.memories); setNewMem(''); }
    catch (e) { toast(e.message, 'err'); }
  };
  const delMemory = async (mid) => {
    try { const d = await api(`/chat/conversations/${id}/memories/${mid}`, { method: 'DELETE' }); setMemories(d.memories); }
    catch (e) { toast(e.message, 'err'); }
  };

  const startEdit = (msg) => { setEditingId(msg.id); setEditText(msg.content); };
  const saveEdit = async (msg) => {
    const c = editText.trim(); if (!c) return;
    try {
      await api(`/chat/conversations/${id}/messages/${msg.id}`, { method: 'PATCH', body: { content: c } });
      setMessages(ms => ms.map(x => x.id === msg.id ? { ...x, content: c } : x));
      setEditingId(null);
    } catch (e) { toast(e.message, 'err'); }
  };
  const delMsg = async (msg) => {
    if (!msg.id) return;
    if (!confirm('删除这条消息？')) return;
    try { await api(`/chat/conversations/${id}/messages/${msg.id}`, { method: 'DELETE' }); setMessages(ms => ms.filter(x => x.id !== msg.id)); }
    catch (e) { toast(e.message, 'err'); }
  };
  const toggleList = () => setListMini(v => { const n = !v; localStorage.setItem(LIST_KEY, n ? '1' : '0'); return n; });

  const renameConv = async () => {
    const t = window.prompt('重命名对话', conv?.title || ''); if (t == null) return;
    const v = t.trim(); if (!v) return;
    try { await api(`/chat/conversations/${id}`, { method: 'PATCH', body: { title: v } }); setConv(c => ({ ...c, title: v })); loadConvs(); toast('已重命名'); }
    catch (e) { toast(e.message, 'err'); } finally { setMenuOpen(false); }
  };
  const clearConv = async () => {
    setMenuOpen(false);
    if (!confirm('清空本对话的全部消息？将保留角色开场白，好感度归零。')) return;
    try { const d = await api(`/chat/conversations/${id}`, { method: 'PATCH', body: { clear: true } }); setMessages(d.messages); setAffinity(0); toast('对话已清空'); }
    catch (e) { toast(e.message, 'err'); }
  };
  const exportConv = (fmt = 'md') => {
    setMenuOpen(false);
    const msgs = messages.filter(m => m.content);
    let blob, name;
    if (fmt === 'json') {
      // JSON 结构化导出：便于迁移、二次创作或导入其他工具
      const payload = {
        platform: 'huanyu', character: character?.name || null, character_id: character?.id || null,
        conversation_id: id, exported_at: new Date().toISOString(), message_count: msgs.length,
        messages: msgs.map(m => ({ role: m.role, content: m.content, created_at: m.created_at || null, reaction: m.reaction || null }))
      };
      blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
      name = `${character?.name || '对话'}-${id}.json`;
    } else {
      const md = `# 与「${character?.name || '角色'}」的对话\n\n` +
        msgs.map(m => `**${m.role === 'user' ? '我' : (character?.name || '角色')}：**\n\n${m.content}`).join('\n\n---\n\n');
      blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
      name = `${character?.name || '对话'}-${id}.md`;
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast(`已导出 ${fmt === 'json' ? 'JSON' : 'Markdown'}`);
  };
  const react = async (msg, emoji) => {
    setReactFor(null);
    if (!msg.id) return;
    try { const d = await api(`/chat/conversations/${id}/messages/${msg.id}/react`, { method: 'POST', body: { reaction: emoji } });
      setMessages(ms => ms.map(x => x.id === msg.id ? { ...x, reaction: d.message.reaction } : x)); }
    catch (e) { toast(e.message, 'err'); }
  };

  const loadConvs = () => api('/chat/conversations').then(d => setConvs(d.conversations)).catch(() => {});
  useEffect(() => { loadConvs(); }, []);
  // know the user's voice protocol so we can use browser TTS without a server call
  const [voiceCfg, setVoiceCfg] = useState(null);
  useEffect(() => { api('/settings').then(d => setVoiceCfg({ voice_protocol: d.settings.voice_protocol, voice_name: d.settings.voice_name })).catch(() => {}); }, []);
  const [illusOpen, setIllusOpen] = useState(false);
  // Seed the illustration prompt from the latest scene so one tap describes "this moment".
  const illusSeed = () => {
    const lastAsst = [...messages].reverse().find(m => m.role === 'assistant');
    const scene = (lastAsst?.content || '').replace(/[*_>#`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 220);
    return [character?.name && `角色：${character.name}`, character?.tagline, scene].filter(Boolean).join('，');
  };
  // celebrate when the relationship tier rises (ties into 成就 / affinity milestones)
  const prevAffLevel = useRef(null);
  const [afPulse, setAfPulse] = useState(false);   // 好感升级时徽章脉冲动画
  useEffect(() => {
    const info = affinityInfo(affinity); const lvl = info.level;
    if (prevAffLevel.current !== null && lvl > prevAffLevel.current) {
      toast(`${info.icon} 羁绊加深！与${character?.name || 'TA'}的关系进入「${info.name}」`);
      setAfPulse(true);
      setTimeout(() => setAfPulse(false), 1600);
    }
    prevAffLevel.current = lvl;
    /* eslint-disable-next-line */
  }, [affinity]);
  useEffect(() => { prevAffLevel.current = null; }, [id]);

  useEffect(() => {
    if (!id) { setConv(null); setCharacter(null); setMessages([]); return; }
    setDrawerOpen(false);
    setLoadingConv(true);
    api('/chat/conversations/' + id).then(d => {
      setConv(d.conversation); setCharacter(d.character); setMessages(d.messages);
      setAffinity(d.conversation.affinity || 0); setMemories(d.conversation.memories || []);
    }).catch(e => toast(e.message, 'err')).finally(() => setLoadingConv(false));
  }, [id]);

  const scrollToBottom = (behavior = 'smooth') => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior });
  // Only auto-stick to the bottom when the user is already near it (don't yank them
  // away while they scroll back to read history).
  useEffect(() => { if (atBottom) scrollToBottom(); }, [messages, streaming]);
  // 背景视差：滚动聊天时立绘以 6% 速率轻微反向漂移，画面即刻「活」起来。
  // rAF 节流 + 直接写 CSS 变量（不触发 React 渲染），lite 档/减弱动效自动无感（CSS 侧不消费）。
  const bgParaRef = useRef(0);
  const onScroll = () => {
    const el = scrollRef.current; if (!el) return;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
    if (!bgParaRef.current) {
      bgParaRef.current = requestAnimationFrame(() => {
        bgParaRef.current = 0;
        const sc = scrollRef.current; if (!sc) return;
        const main = sc.closest('.chat-main');
        if (main) main.style.setProperty('--chat-para', Math.min(60, sc.scrollTop * 0.06).toFixed(1) + 'px');
      });
    }
  };
  useEffect(() => () => { if (bgParaRef.current) cancelAnimationFrame(bgParaRef.current); }, []);

  // Stream a reply from the given endpoint into the trailing assistant bubble.
  const streamInto = async (endpoint, payload) => {
    setStreaming(true);
    setAtBottom(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify(payload || {}), signal: ctrl.signal
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || '请求失败'); }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        for (const line of lines) {
          const t = line.trim();
          if (!t.startsWith('data:')) continue;
          const payload2 = t.slice(5).trim();
          if (payload2 === '[DONE]') continue;
          try {
            const j = JSON.parse(payload2);
            if (j.error) throw new Error(j.error);
            if (j.delta) {
              // rAF 节流：累积 delta 到缓冲，每帧最多刷新一次，降低低端机渲染压力
              streamBufRef.current = (streamBufRef.current || '') + j.delta;
              if (!streamRafRef.current) {
                streamRafRef.current = requestAnimationFrame(() => {
                  const chunk = streamBufRef.current; streamBufRef.current = ''; streamRafRef.current = 0;
                  setMessages(m => {
                    const copy = [...m]; const last = copy[copy.length - 1];
                    if (last) copy[copy.length - 1] = { ...last, content: (last.content || '') + chunk };
                    return copy;
                  });
                });
              }
            }
          } catch (err) { if (err.message && !err.message.includes('JSON')) throw err; }
        }
      }
      // 收尾前 flush 残留缓冲，避免末尾 delta 丢失
      if (streamRafRef.current) { cancelAnimationFrame(streamRafRef.current); streamRafRef.current = 0; }
      if (streamBufRef.current) {
        const chunk = streamBufRef.current; streamBufRef.current = '';
        setMessages(m => {
          const copy = [...m]; const last = copy[copy.length - 1];
          if (last) copy[copy.length - 1] = { ...last, content: (last.content || '') + chunk };
          return copy;
        });
      }
      setMessages(m => {
        const c = [...m]; const last = c[c.length - 1];
        c[c.length - 1] = { ...last, _streaming: false };
        if (autoReadRef.current && last?.content) setTimeout(() => speak(last.content), 120);
        return c;
      });
      loadConvs();
      refreshUser?.();
      syncMessages(); // pull server IDs so edit/delete work on the new turn
    } catch (err) {
      // User-initiated stop: keep whatever streamed so far, no error toast.
      if (err.name === 'AbortError') {
        setMessages(m => { const c = [...m]; const last = c[c.length - 1];
          if (last?._streaming) c[c.length - 1] = { ...last, content: last.content || '（已停止）', _streaming: false }; return c; });
      } else {
        toast(err.message, 'err');
        setMessages(m => { const c = [...m]; const last = c[c.length - 1];
          if (last?._streaming) c[c.length - 1] = { role: 'assistant', content: '（连接出错）' + err.message, _streaming: false }; return c; });
      }
    } finally {
      // 清理流式缓冲与未完成的 rAF，避免内存泄漏或悬空刷新
      if (streamRafRef.current) { cancelAnimationFrame(streamRafRef.current); streamRafRef.current = 0; }
      streamBufRef.current = null;
      setStreaming(false); abortRef.current = null;
    }
  };

  const stop = () => { abortRef.current?.abort(); };

  const send = async (override) => {
    const text = (override ?? input).trim();
    if (!text || streaming) return;
    if (override === undefined) setInput('');
    setActionsOpen(false);
    setMessages(m => [...m, { role: 'user', content: text }, { role: 'assistant', content: '', _streaming: true }]);
    await streamInto(`/api/chat/conversations/${id}/complete`, { content: text });
  };
  const insertAction = (a) => { setInput(v => (v ? v.replace(/\s*$/, '') + ' ' : '') + a + ' '); setActionsOpen(false); };

  // 切换开场白（仅对话未开始时提供入口；服务端按 greeting_index 重置为对应开场）。
  const switchGreeting = async (gi) => {
    if (streaming || gi === greetIdx) return;
    try {
      const d = await api(`/chat/conversations/${id}`, { method: 'PATCH', body: { clear: true, greeting_index: gi } });
      setMessages(d.messages); setAffinity(0); setGreetIdx(gi);
    } catch (e) { toast(e.message, 'err'); }
  };
  useEffect(() => { setGreetIdx(0); }, [id]);

  const regenerate = async () => {
    if (streaming) return;
    setMessages(m => {
      const c = [...m];
      while (c.length && c[c.length - 1].role === 'assistant') c.pop();
      return [...c, { role: 'assistant', content: '', _streaming: true }];
    });
    await streamInto(`/api/chat/conversations/${id}/regenerate`, {});
  };

  const copyMsg = async (text) => {
    try { await navigator.clipboard.writeText(text); toast('已复制'); }
    catch { toast('复制失败', 'err'); }
  };

  // —— 消息书签：收藏重要段落，随时跳回。纯本地存储，按会话隔离，三端通用。
  useEffect(() => {
    try { setMarks(new Set(JSON.parse(localStorage.getItem('huanyu_chat_marks_' + id) || '[]'))); }
    catch { setMarks(new Set()); }
  }, [id]);
  const toggleMark = (m) => {
    if (!m.id) return;
    setMarks(prev => {
      const n = new Set(prev);
      if (n.has(m.id)) n.delete(m.id); else n.add(m.id);
      try { localStorage.setItem('huanyu_chat_marks_' + id, JSON.stringify([...n])); } catch { /* */ }
      return n;
    });
  };
  const jumpToMark = (mid) => {
    setMarksOpen(false);
    const el = document.getElementById('msg-' + mid);
    if (!el) { toast('未找到该消息（可能已被删除）', 'err'); return; }
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('mark-flash');
    setTimeout(() => el.classList.remove('mark-flash'), 1800);
  };

  // 专家档世界书的预注入图片映射；引用稳定（随 character 一次性到位），
  // 保证 BubbleContent 的 memo 对老消息始终命中。
  const imageMap = character?.wb_image_map;

  // 标记一条助手消息已生成过语音（已生成的不再重新合成，只能停止或再听一遍）。
  const markVoiced = (mid) => { if (mid != null) setVoicedIds(s => { if (s.has(mid)) return s; const n = new Set(s); n.add(mid); return n; }); };

  // 朗读一条消息。mid 为消息 id（用于状态联动与缓存）。
  // 设计要点：单例播放，重复点击不叠加；平台语音首次合成后缓存音频，
  // 「再听一遍」直接重放缓存，绝不重新合成、不再次扣费。
  const speak = async (raw, mid) => {
    // 括号内的内容（动作 / OOC 说明）默认不朗读
    const text = stripParensForSpeech(raw);
    if (!text) return;
    // 从「原文」（含 *动作* 与标点）检测语气，让语音根据情境调试语速/音调/情绪。
    const emotion = detectEmotion(raw);
    // Browser Web Speech needs no server round-trip (offline / no CORS)，免费，重放即可。
    if (voiceCfg?.voice_protocol === 'browser') {
      speakBrowser(text, voiceCfg.voice_name, character?.voice_speed, character?.voice_pitch, mid ?? true, emotion);
      markVoiced(mid);
      return;
    }
    // 平台语音：已有缓存则直接重放，不再请求服务器（省钱、防叠音）。
    const cached = mid != null && voiceCacheRef.current.get(mid);
    if (cached) { playAudioUrl(cached, mid); return; }
    try {
      const res = await fetch('/api/chat/tts', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ text, voice: character?.voice_name || undefined, speed: character?.voice_speed || undefined, pitch: character?.voice_pitch || undefined, emotion, character_id: character?.id })
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || '语音合成失败'); }
      // Platform voice is billed per sentence — the server reports the charge via headers.
      const charged = res.headers.get('X-Gold-Fee');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (mid != null) { voiceCacheRef.current.set(mid, url); markVoiced(mid); }
      playAudioUrl(url, mid ?? true);
      if (charged) { toast(`平台语音 · 本次消耗 ${charged} 金币`); refreshUser?.(); }
    } catch (err) { toast(err.message, 'err'); }
  };

  // 朗读按钮点击：正在播放本条→停止；否则播放（缓存则重放）。
  const toggleSpeak = (m) => {
    if (playingId === m.id) { stopSpeaking(); return; }
    speak(m.content, m.id);
  };

  const delConv = async (e, cv) => {
    e.stopPropagation();
    if (!confirm('删除该对话？')) return;
    try {
      await api('/chat/conversations/' + cv.id, { method: 'DELETE' });
      if (String(cv.id) === String(id)) nav('/chats');
      loadConvs();
    } catch (err) { toast(err.message, 'err'); }
  };

  const onKey = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } };

  return (
    <div className={'chat-layout' + (conv ? ' immersive' : '')}>
      <div className={'chat-list' + (conv ? ' hide-mobile' : '') + (listMini ? ' mini' : '')}>
        <div className="hd">
          {!listMini && <span style={{ flex: 1 }}>对话</span>}
          <button className="btn ghost sm" onClick={toggleList} title={listMini ? '展开对话列表' : '收起对话列表'}>
            {listMini ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
          </button>
          {!listMini && <button className="btn sm" onClick={() => nav('/library')} title="从角色库新建对话"><Plus size={15} /></button>}
        </div>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {convs.length === 0 && !listMini && <div className="empty" style={{ padding: 30, fontSize: 13 }}><EmptyArt kind="chat" size={112} />从「我的角色」开始一段对话</div>}
          {convs.map(cv => (
            <div key={cv.id} className={'conv-item' + (String(cv.id) === String(id) ? ' active' : '')} onClick={() => nav('/chats/' + cv.id)} title={listMini ? cv.character_name : undefined}>
              <Avatar src={cv.character_avatar} name={cv.character_name} size={40} />
              {/* 副标题：优先最近消息摘要（面板消息显示占位标签）；退回标题/引导语 */}
              <div className="tx"><b>{cv.character_name}</b><span>{msgPreview(cv.last_message) || (cv.title && cv.title !== cv.character_name ? cv.title : '点击继续对话')}</span></div>
              <button className="speak" onClick={e => delConv(e, cv)}><X size={14} /></button>
            </div>
          ))}
        </div>
      </div>

      <div className={'chat-main' + (character?.background ? ' has-bg' : '')}>
        {!conv ? (
          <div className="empty" style={{ margin: 'auto' }}>
            <EmptyArt kind="chat" />选择左侧对话，或从角色库开启新对话
          </div>
        ) : (
          <>
            {character?.background && (
              <div className="chat-bg">
                {character.background_type === 'video'
                  ? <video src={character.background} muted loop autoPlay playsInline />
                  : <img src={character.background} alt="" />}
              </div>
            )}
            {!character?.background && <div className="chat-aura" aria-hidden="true"><span /><span /><span /></div>}
            {character?.bgm && <audio ref={bgmRef} src={character.bgm} loop preload="auto" />}
            <div className="chat-head">
              <button className="btn ghost sm mobile-only chat-back" onClick={() => nav('/messages')}><ArrowLeft size={16} /></button>
              {/* 身份胶囊：左上空间有限，不再写角色名（每条消息上方已有名字）；只留头像 + 状态 */}
              <div className="ch-idpill">
                <div className={'ch-av' + (streaming ? ' live' : '')}><Avatar src={character?.avatar} name={character?.name} size={40} /></div>
                {/* 状态文案只留「在线」：长文案在窄屏与好感徽章互相挤压遮挡（实机反馈），
                    沉浸感由头像光环/打字动画传达，不靠字数 */}
                <div className="nm"><span className="ch-status"><i className="ch-dot" />{streaming ? '正在输入…' : '在线'}</span></div>
              </div>
              {(() => { const af = affinityInfo(affinity); return (
                <button className={'affinity-badge' + (afPulse ? ' pulse' : '')} onClick={() => setDrawerOpen(true)} title="角色档案 · 好感度 / 记忆 / 世界书">
                  <span className="af-ic">{af.icon}</span>
                  <span className="af-tx"><b>{af.name}</b><i><em style={{ width: af.pct + '%' }} /></i></span>
                </button>
              ); })()}
              <div className="chat-tools">
                {character?.bgm && (
                  <button className={'speak chat-tool' + (bgmOn ? ' on' : '')} onClick={toggleBgm} title={bgmOn ? '关闭背景音乐' : '播放背景音乐'}>
                    {bgmOn ? <Music size={17} /> : <VolumeX size={17} />}
                  </button>
                )}
                {/* 「生成插图」收进更多菜单 —— 头部一行曾塞下 7 个控件，412px 宽必然
                    互相挤压（用户实机上身份胶囊的状态文字被压到只剩一个字符）。 */}
                <button className={'speak chat-tool' + (searchOpen ? ' on' : '')} onClick={() => { setSearchOpen(o => !o); setSearchQ(''); }} title="对话内搜索"><Search size={17} /></button>
                <div className="chat-menu-wrap">
                  <button className={'speak chat-tool' + (menuOpen ? ' on' : '')} onClick={() => setMenuOpen(o => !o)} title="更多"><MoreVertical size={17} /></button>
                  {menuOpen && (
                    <>
                      <div className="chat-menu-mask" onClick={() => setMenuOpen(false)} />
                      <div className="chat-menu">
                        <button onClick={() => { setIllusOpen(true); setMenuOpen(false); }}><Wand2 size={15} /> 为当前剧情生成插图</button>
                        <button onClick={renameConv}><Edit3 size={15} /> 重命名对话</button>
                        <button onClick={() => exportConv('md')}><Download size={15} /> 导出为 Markdown</button>
                        <button onClick={() => exportConv('json')}><Download size={15} /> 导出为 JSON</button>
                        <button className="danger" onClick={clearConv}><Eraser size={15} /> 清空消息</button>
                        <div className="chat-menu-sep" />
                        <div className="chat-menu-row"><span><Type size={15} /> 字号</span>
                          <div className="seg seg-mini">
                            {[['sm', '小'], ['md', '中'], ['lg', '大']].map(([v, l]) => (
                              <button key={v} className={fontSize === v ? 'active' : ''} onClick={() => setFont(v)}>{l}</button>
                            ))}
                          </div>
                        </div>
                        <button onClick={toggleAutoRead}><Volume2 size={15} /> 自动朗读 <span className={'chat-menu-toggle' + (autoRead ? ' on' : '')}>{autoRead ? '已开启' : '已关闭'}</span></button>
                        <button onClick={() => { setMarksOpen(true); setMenuOpen(false); }}><Bookmark size={15} /> 消息书签{marks.size ? `（${marks.size}）` : ''}</button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
            {character?.background && <span className="chat-ai-mark" aria-hidden="true">内容由 AI 生成</span>}
            {searchOpen && (
              <div className="chat-search">
                <Search size={15} className="muted" />
                <input autoFocus value={searchQ} enterKeyHint="search" autoCapitalize="none" autoCorrect="off" spellCheck={false}
                  onChange={e => setSearchQ(e.target.value)} placeholder="在本对话中搜索…"
                  onKeyDown={e => e.key === 'Escape' && (setSearchOpen(false), setSearchQ(''))} />
                {searchQ && <span className="muted" style={{ fontSize: 12 }}>{messages.filter(mm => mm.content?.toLowerCase().includes(searchQ.toLowerCase())).length} 条</span>}
                <button className="speak" onClick={() => { setSearchOpen(false); setSearchQ(''); }}><X size={15} /></button>
              </div>
            )}

            <div className={'chat-scroll font-' + fontSize} ref={scrollRef} onScroll={onScroll}>
              {/* 专家档世界书：自构对话前端 banner 槽（若 front_schema 含 banner 类型 slot）。
                  注意按 front_schema 是否有数据判定 —— 服务端已不下发 tier 字段，
                  旧的 tier==='expert' 闸门会让 banner 永远不渲染。 */}
              {character?.linked_worldbooks?.some(w => w.front_schema) && (() => {
                let schema = null;
                for (const w of character.linked_worldbooks) {
                  if (!w.front_schema) continue;
                  try { schema = JSON.parse(w.front_schema); break; } catch { /* */ }
                }
                const banner = schema?.slots?.find(s => s.type === 'banner');
                if (!banner) return null;
                return (
                  <div className="wb-front-banner" style={schema.accent ? { ['--wb-accent']: schema.accent } : null}>
                    {banner.src
                      ? <img src={banner.src} alt="场景横幅" />
                      : <div className="wb-front-banner-ph"><Sparkles size={14} /> 专家档自构前端 · {schema.layout} 布局</div>}
                    <div className="wb-front-banner-cap">{banner.id} slot</div>
                  </div>
                );
              })()}
              <div className="chat-thread">
              {loadingConv && messages.length === 0 && (
                <div className="chat-skel">
                  {[0, 1, 2].map(k => (
                    <div key={k} className={'msg assistant' + (k > 0 ? ' run-cont' : ' run-start')}>
                      <div className="skel skel-av" />
                      <div className="msg-col">
                        <div className="skel skel-line" style={{ width: '40%' }} />
                        <div className="skel skel-bubble" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {messages.map((m, i) => {
                const q = searchQ.trim().toLowerCase();
                if (q && !(m.content || '').toLowerCase().includes(q)) return null;
                const firstOfRun = i === 0 || messages[i - 1].role !== m.role;
                return (
                <div key={m.id || i} id={m.id ? 'msg-' + m.id : undefined} className={'msg ' + m.role + (m._streaming ? ' streaming' : '') + (firstOfRun ? ' run-start' : ' run-cont')}>
                  {m.role === 'assistant' && <Avatar src={character?.avatar} name={character?.name} size={38} />}
                  <div className="msg-col">
                    {m.role === 'assistant' && firstOfRun && (
                      <div className="msg-name">{character?.name}
                        {m.created_at && <span className="msg-time">{String(m.created_at).slice(11, 16)}</span>}
                      </div>
                    )}
                    {editingId === m.id ? (
                      <div className="msg-edit">
                        <textarea value={editText} autoFocus autoCapitalize="sentences" autoCorrect="on" spellCheck={false}
                          enterKeyHint="done"
                          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(m); } if (e.key === 'Escape') setEditingId(null); }} />
                        <div className="msg-edit-acts">
                          <button className="btn sm primary" onClick={() => saveEdit(m)}><Check size={13} /> 保存</button>
                          <button className="btn sm ghost" onClick={() => setEditingId(null)}>取消</button>
                        </div>
                      </div>
                    ) : (
                      <div className="bubble" onContextMenu={m.content ? (e) => { e.preventDefault(); copyMsg(m.content); } : undefined}
                        title={m.content ? '长按或右键复制' : undefined}>
                        {m._streaming && !m.content
                          ? <span className="typing"><span></span><span></span><span></span></span>
                          : <BubbleContent content={m.content} role={m.role} imageMap={imageMap} onPreview={setPreviewImg} frontRegex={frontRegex} />}
                        {m.reaction && <span className="msg-reaction" title="我的反应">{m.reaction}</span>}
                      </div>
                    )}
                    {!m._streaming && m.content && editingId !== m.id && (
                      <div className="msg-acts">
                        {m.role === 'assistant' && <>
                          {playingId === m.id
                            ? <button className="speak on" onClick={() => stopSpeaking()} title="停止播放"><Square size={12} fill="currentColor" /> 停止</button>
                            : <button className="speak" onClick={() => toggleSpeak(m)} title={voicedIds.has(m.id) ? '重放已生成的语音（不再重新合成）' : '朗读这段话'}><Volume2 size={13} /> {voicedIds.has(m.id) ? '再听一遍' : '朗读'}</button>}
                          <button className="speak" onClick={() => copyMsg(m.content)}><Copy size={13} /> 复制</button>
                          {i === messages.length - 1 && <button className="speak" onClick={regenerate} disabled={streaming}><RotateCcw size={13} /> 重新生成</button>}
                          {m.id && (
                            <div className="react-wrap">
                              <button className="speak" onClick={() => setReactFor(reactFor === m.id ? null : m.id)}><Smile size={13} /> 反应</button>
                              {reactFor === m.id && (
                                <>
                                  <div className="react-mask" onClick={() => setReactFor(null)} />
                                  <div className="react-pop">
                                    {REACTIONS.map(e => <button key={e} className={m.reaction === e ? 'on' : ''} onClick={() => react(m, e)}>{e}</button>)}
                                  </div>
                                </>
                              )}
                            </div>
                          )}
                        </>}
                        {m.role === 'user' && <button className="speak" onClick={() => startEdit(m)} disabled={streaming}><Pencil size={13} /> 编辑</button>}
                        {m.id && <button className={'speak' + (marks.has(m.id) ? ' on' : '')} onClick={() => toggleMark(m)} title={marks.has(m.id) ? '取消书签' : '加入书签，可从菜单快速跳回'}><Bookmark size={13} /> {marks.has(m.id) ? '已收藏' : '书签'}</button>}
                        {m.id && <button className="speak" onClick={() => delMsg(m)} disabled={streaming}><Trash2 size={13} /> 删除</button>}
                      </div>
                    )}
                  </div>
                </div>
                );
              })}
              </div>
            </div>

            {!atBottom && (
              <button className="scroll-bottom-btn" onClick={() => scrollToBottom()} title="回到底部" aria-label="回到底部">
                <ArrowDown size={18} />
              </button>
            )}
            {messages.length <= 1 && !streaming && (
              <div className="starter-chips">
                {altGreetings.length > 0 && (
                  <span className="greet-switch">
                    <span className="muted">开场：</span>
                    {[0, ...altGreetings.map((_, i) => i + 1)].map(gi => (
                      <button key={gi} className={'starter-chip' + (greetIdx === gi ? ' on' : '')} disabled={streaming}
                        title={gi === 0 ? '主开场白' : `备用开场白 ${gi}（酒馆卡常把「游戏开始」放在这里）`}
                        onClick={() => switchGreeting(gi)}>{gi === 0 ? '主开场' : `开场 ${gi + 1}`}</button>
                    ))}
                  </span>
                )}
                <span className="muted">试试开口：</span>
                {STARTERS.map(s => <button key={s} className="starter-chip" onClick={() => send(s)}>{s}</button>)}
              </div>
            )}
            {/* 输入栏占位：移动端 fixed 输入栏遮挡下方消息，spacer 留出空白避免遮挡 */}
            <div className="chat-input-spacer" aria-hidden="true" />
            {/* 输入栏：移动端 CSS 改 position:fixed 脱离文档流，键盘弹起时 visualViewport
                驱动 bottom 上移到键盘上方。chat-main 布局不动，下方被键盘覆盖是自然的，
                只有输入框被顶上去 —— 不会"拉出半屏原色背景"。 */}
            <div className="chat-input-bar" ref={inputBarRef}>
              {actionsOpen && (
                <div className="action-panel">
                  {QUICK_ACTIONS.map(a => <button key={a} onClick={() => insertAction(a)}>{a}</button>)}
                </div>
              )}
              <div className="box">
                <button className={'act-btn' + (actionsOpen ? ' on' : '')} onClick={() => { setActionsOpen(o => !o); setPlusOpen(false); }} disabled={streaming} title="动作 / 表情"><Smile size={19} /></button>
                <textarea ref={inputRef} rows={1} value={input}
                  placeholder={`对 ${character?.name} 说点什么…` + (COARSE ? '' : '（Enter 发送，Shift+Enter 换行）')}
                  enterKeyHint="send" autoCapitalize="sentences" autoCorrect="on" spellCheck={false}
                  onChange={e => setInput(e.target.value)} onKeyDown={onKey} disabled={streaming} />
                {/* 「+」对话功能面板：把散落在头部菜单里的对话内能力聚合到拇指热区 */}
                <button className={'act-btn plus-btn' + (plusOpen ? ' on' : '')} onClick={() => { setPlusOpen(o => !o); setActionsOpen(false); }} title="对话功能"><Plus size={20} /></button>
                {streaming
                  ? <button className="send-btn stop" onClick={stop} title="停止生成"><Square size={15} fill="currentColor" /></button>
                  : <button className="send-btn" onClick={() => send()} disabled={!input.trim()}><Send size={17} /></button>}
              </div>
              {plusOpen && (() => {
                // 两页 × 6 项（对标一线聊天功能面板）：P1 互动添趣 / P2 实用工具。
                // 导出/清空/搜索/书签等低频项收在右上 ⋮ 菜单，不占面板。
                const P1 = [
                  { ic: Phone, hue: 'call', label: '语音通话', on: () => { setPlusOpen(false); setCallOpen(true); } },
                  { ic: Wand2, hue: 'illus', label: '生成插图', on: () => { setIllusOpen(true); setPlusOpen(false); } },
                  { ic: Dices, hue: 'dice', label: '掷骰子', dis: streaming, on: () => {
                      setPlusOpen(false);
                      send(`*掷出一枚命运骰子……${1 + Math.floor(Math.random() * 20)} 点（1-20）！*`);
                    } },
                  { ic: Gift, hue: 'gift', label: '送礼物', dis: streaming, on: () => setGiftOpen(o => !o) },
                  { ic: Drama, hue: 'narr', label: '旁白推进', dis: streaming, on: () => {
                      setPlusOpen(false);
                      const t = input.trim();
                      if (t) { setInput(''); send(`（旁白：${t}）`); }
                      else send('（旁白：请以第三人称旁白视角推进当前剧情，带来一个自然的转折。）');
                    } },
                  { ic: Zap, hue: 'event', label: '随机事件', dis: streaming, on: () => {
                      setPlusOpen(false);
                      send(`*【突发】${RANDOM_EVENTS[Math.floor(Math.random() * RANDOM_EVENTS.length)]}*`);
                    } },
                ];
                const P2 = [
                  { ic: Heart, hue: 'profile', label: '角色档案', on: () => { setDrawerOpen(true); setPlusOpen(false); } },
                  { ic: RefreshCcw, hue: 'greet', label: '切换开场白', dis: altGreetings.length === 0, on: () => {
                      const gi = (greetIdx + 1) % (altGreetings.length + 1);
                      if (messages.length > 1 && !confirm('切换开场白会清空当前对话，继续？')) return;
                      switchGreeting(gi); setPlusOpen(false);
                    } },
                  { ic: RotateCcw, hue: 'regen', label: '重新生成', dis: streaming || messages.length < 2, on: () => { regenerate(); setPlusOpen(false); } },
                  { ic: Volume2, hue: 'read', label: autoRead ? '自动朗读 开' : '自动朗读 关', on: toggleAutoRead },
                  { ic: bgmOn && character?.bgm ? Music : VolumeX, hue: 'bgm', label: bgmOn ? '背景音乐 开' : '背景音乐 关', dis: !character?.bgm, on: toggleBgm },
                  { ic: Type, hue: 'font', label: `字号 · ${fontSize === 'sm' ? '小' : fontSize === 'md' ? '中' : '大'}`, on: () => setFont(fontSize === 'sm' ? 'md' : fontSize === 'md' ? 'lg' : 'sm') },
                ];
                const renderPage = (items, base) => (
                  <div className="cps-page">
                    {items.map((it, i) => (
                      <button key={it.label} className={'cps-item hue-' + it.hue} style={{ '--i': base + i }}
                        disabled={it.dis} onClick={it.on}>
                        <span className="cps-ic"><it.ic size={20} />{it.badge ? <i className="cps-badge">{it.badge}</i> : null}</span>
                        <span>{it.label}</span>
                      </button>
                    ))}
                  </div>
                );
                return (
                  <div className="chat-plus-sheet paged">
                    {giftOpen && (
                      <div className="cps-gifts">
                        {GIFTS.map(g => (
                          <button key={g.e} onClick={() => {
                            setGiftOpen(false); setPlusOpen(false);
                            send(`*送给${character?.name || '你'}${g.n} ${g.e}*`);
                          }}><b>{g.e}</b><span>{g.n.replace(/^一[枝块杯只封份枚把]/, '')}</span></button>
                        ))}
                      </div>
                    )}
                    <div className="cps-pager" ref={plusPagerRef}
                      onScroll={e => setPlusPage(e.target.scrollLeft > e.target.clientWidth / 2 ? 1 : 0)}>
                      {renderPage(P1, 0)}
                      {renderPage(P2, 0)}
                    </div>
                    <div className="cps-dots" aria-hidden="true">
                      <i className={plusPage === 0 ? 'on' : ''} /><i className={plusPage === 1 ? 'on' : ''} />
                    </div>
                  </div>
                );
              })()}
            </div>

          {drawerOpen && (() => { const af = affinityInfo(affinity); return (
            <>
              <div className="chat-drawer-mask" onClick={() => setDrawerOpen(false)} />
              <aside className="chat-drawer">
                <div className="cd-head">
                  <Avatar src={character?.avatar} name={character?.name} size={36} />
                  <b style={{ flex: 1 }}>{character?.name} · 档案</b>
                  <button className="speak" onClick={() => setDrawerOpen(false)}><X size={16} /></button>
                </div>
                <div className="cd-body">
                  <section>
                    <h4><Heart size={14} /> 好感度</h4>
                    <div className="af-big">{af.icon} Lv.{af.level} · {af.name}</div>
                    <div className="af-bar"><span style={{ width: af.pct + '%' }} /></div>
                    <p className="muted">好感值 {af.value}{af.nextAt ? ` · 距「${AFFINITY_LEVELS[af.level]?.name}」还需 ${af.nextAt - af.value}` : ' · 已是最高羁绊'}</p>
                  </section>
                  <section>
                    <h4><Brain size={14} /> 对话记忆 <span className="muted">角色会始终记住</span></h4>
                    {memories.length === 0 && <p className="muted" style={{ fontSize: 13 }}>还没有记忆。添加后会注入到每次对话，角色将牢记。</p>}
                    {memories.map(mm => (
                      <div className="mem-item" key={mm.id}><span>{mm.content}</span><button onClick={() => delMemory(mm.id)} title="删除"><X size={13} /></button></div>
                    ))}
                    <div className="mem-add">
                      <input className="input" value={newMem} placeholder="如：我叫小明，养了一只叫奶糖的猫" enterKeyHint="done"
                        onChange={e => setNewMem(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addMemory(); } }} />
                      <button className="btn sm primary" onClick={addMemory}><Plus size={14} /> 记住</button>
                    </div>
                  </section>
                  <section>
                    <h4><BookOpen size={14} /> 世界书 / 设定</h4>
                    {(!character?.world || character.world.length === 0)
                      ? <p className="muted" style={{ fontSize: 13 }}>该角色未设置世界书条目。</p>
                      : character.world.map((w, i) => (
                        <div className="wb-item" key={i}>
                          <div className="wb-keys">{(w.keys || '常驻').split(',').map(k => k.trim()).filter(Boolean).map((k, j) => <span key={j}>{k}</span>)}</div>
                          <p>{w.content}</p>
                        </div>
                      ))}
                  </section>
                </div>
              </aside>
            </>
          ); })()}
        </>
      )}
      </div>
      {marksOpen && (
        <Modal onClose={() => setMarksOpen(false)}>
          <h2 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}><Bookmark size={18} /> 消息书签</h2>
          {marks.size === 0 && <div className="empty" style={{ padding: 24 }}>还没有书签 —— 在消息操作里点「书签」收藏重要段落，之后可从这里一键跳回。</div>}
          {messages.filter(mm => mm.id && marks.has(mm.id)).map(mm => (
            <button key={mm.id} className="chat-mark-row" onClick={() => jumpToMark(mm.id)}>
              <b>{mm.role === 'user' ? '我' : (character?.name || '角色')}</b>
              <span>{(mm.content || '').slice(0, 90)}{(mm.content || '').length > 90 ? '…' : ''}</span>
            </button>
          ))}
          <button className="btn block" style={{ marginTop: 12 }} onClick={() => setMarksOpen(false)}>关闭</button>
        </Modal>
      )}
      {illusOpen && <IllustrateModal initialPrompt={illusSeed()} onClose={() => setIllusOpen(false)} />}
      {callOpen && character && <CallScreen character={character} onClose={() => setCallOpen(false)} />}
      {previewImg && (
        <div className="img-lightbox" onClick={() => setPreviewImg(null)}>
          <img src={previewImg} alt="预览" />
          <button className="img-lightbox-close" onClick={(e) => { e.stopPropagation(); setPreviewImg(null); }} title="关闭"><X size={22} /></button>
        </div>
      )}
    </div>
  );
}
