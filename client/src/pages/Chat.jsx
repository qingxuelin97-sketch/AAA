import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { useNav } from '../nav.js';
import { api, getToken, useAuth, getApiBase, assetUrl } from '../api.jsx';
import { useToast, Avatar, Modal, CoinIcon } from '../ui.jsx';
import { speakBrowser, stripParensForSpeech, playAudioUrl, stopSpeaking, onVoiceStateChange, detectEmotion } from '../voice.js';
import { useKeyboardInsetBar } from '../mobile.js';
import { useAutoGrow, msgPreview, cnToday } from '../util.js';
import ShareCardSheet from '../components/ShareCardSheet.jsx';
import IllustrateModal from '../components/IllustrateModal.jsx';
import CallScreen from '../components/CallScreen.jsx';
import { AppIconButton } from '../components/AppControls.jsx';
import { EmptyArt } from '../art.jsx';
import { installTavernHost } from '../tavernbridge.js';
import { streamSSE } from '../chat/sse.js';
import { BubbleContent, setPanelCtx } from '../chat/BubbleContent.jsx';
import { useOverlayBack, useBookmarks, useLongPress } from '../chat/hooks.js';
import ChatSearchBar from '../chat/ChatSearchBar.jsx';
import { isAppMode } from '../appmode.js';
import { useAppOverlay } from '../overlay.jsx';
import {
  GIFTS, GIFT_ART, AFFINITY_ART, RANDOM_EVENTS, COARSE, LIST_KEY, FONT_KEY, AUTOREAD_KEY, BGM_KEY, BUBBLE_ALPHA_KEY,
  REACTIONS, STARTERS, QUICK_ACTIONS, AFFINITY_LEVELS, affinityInfo, timeDivider,
} from '../chat/constants.js';
import { Send, Volume2, Plus, X, ArrowLeft, ArrowUp, Copy, RotateCcw, PanelLeftClose, PanelLeftOpen, Square, ArrowDown, Pencil, Trash2, Check, Heart, BookOpen, Brain, Smile, MoreVertical, Type, Download, Eraser, Search, Edit3, Wand2, Music, VolumeX, Sparkles, Bookmark, RefreshCcw, Phone, Dices, Gift, Drama, Zap, CornerUpLeft, ImagePlus, Blend, LayoutTemplate } from 'lucide-react';

// 声波键（参考稿 1:1）：外圈 + 声源点 + 朝右上放射的两道弧。
function WaveIcon({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <circle cx="10.3" cy="13.7" r="1.25" fill="currentColor" stroke="none" />
      <g transform="rotate(-45 10.3 13.7)">
        <path d="M13.1 10.9 a3.05 3.05 0 0 1 0 5.6" />
        <path d="M15.1 8.9 a5.85 5.85 0 0 1 0 9.6" />
      </g>
    </svg>
  );
}

// App 端好感等级徽记：用户提供的 3D 徽章 PNG（AFFINITY_ART 按等级 1-7 对位，
// Web 保留 emoji 徽章）。128px 源图透明底，任意小尺寸展示都清晰。
function AffinityIcon({ level, size }) {
  const src = AFFINITY_ART[(level || 1) - 1] || AFFINITY_ART[0];
  return <img src={src} width={size} height={size} alt="" aria-hidden="true" draggable="false"
    style={{ display: 'block', objectFit: 'contain' }} />;
}

// D3 桌面三栏：角色档案正文（.cd-head + .cd-body）抽成本地组件，App 抽屉与
// Web ≥1280px 常驻侧列共用同一份 JSX —— 类名/结构/文案零改动，纯代码搬家，
// App 端抽屉渲染输出与抽取前逐字节等价。
function CharPanelBody({ app, character, affinity, memories, newMem, setNewMem, addMemory, delMemory, onClose }) {
  const af = affinityInfo(affinity);
  return (
    <>
      <div className="cd-head">
        <Avatar src={character?.avatar} name={character?.name} size={36} />
        <b style={{ flex: 1 }}>{character?.name} · 档案</b>
        <button className="speak" onClick={onClose}><X size={16} /></button>
      </div>
      <div className="cd-body">
        <section>
          <h4><Heart size={14} /> 好感度</h4>
          <div className="af-big">{app ? <AffinityIcon level={af.level} size={16} /> : af.icon} Lv.{af.level} · {af.name}</div>
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
    </>
  );
}

// 礼物目录会话级缓存：服务端 /chat/gifts 是价格与好感增量的权威（本地 GIFTS
// 只是离线兜底镜像，不含 affinity），首开礼物面板拉一次全程复用。
let giftCatalogCache = null;

// —— 单条消息 ——
// 独立出来并 React.memo：流式回复每帧都会 setMessages，若整份列表在同一个组件里
// 展开，每帧都要重新协调全部消息节点。这里把「会随流变化的东西」拆成标量 prop
// （memo 能逐个比较），把回调统一放进一个 ref 容器（身份恒定，不参与比较），
// 于是流式期间只有最后一条真正重渲染。
//
// row 里的 firstOfRun / isLast / divider 都是在**完整**消息数组上算好的：
// 渲染窗口只决定画哪一段，不参与这些判定。此前它们直接依赖 map 的下标
// （firstOfRun 取 messages[i-1]、「重新生成」按钮取 i === messages.length-1），
// 一旦切片就会错位——窗口首条永远多一个头像、按钮跑到窗口第一条上。
const MessageRow = React.memo(function MessageRow({
  row, h, character, imageMap, frontRegex, streaming,
  isEditing, editText, isReacting, isPlaying, isVoiceLoading, isVoiced, isMarked,
}) {
  const { m, firstOfRun, divider, isLast } = row;
  return (
    <>
      {divider && <div className="msg-daydivider" aria-hidden="true"><span>{divider}</span></div>}
      <div id={m.id ? `msg-${m.id}` : undefined} className={`msg ${m.role}${m._streaming ? ' streaming' : ''}${firstOfRun ? ' run-start' : ' run-cont'}`}>
        {m.role === 'assistant' && <Avatar src={character?.avatar} name={character?.name} size={38} />}
        <div className="msg-col">
          {m.role === 'assistant' && firstOfRun && (
            <div className="msg-name">{character?.name}
              {m.created_at && <span className="msg-time">{String(m.created_at).slice(11, 16)}</span>}
            </div>
          )}
          {isEditing ? (
            <div className="msg-edit">
              <textarea value={editText} autoFocus autoCapitalize="sentences" autoCorrect="on" spellCheck={false}
                enterKeyHint="done"
                onChange={e => h.current.setEditText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); h.current.saveEdit(m); } if (e.key === 'Escape') h.current.setEditingId(null); }} />
              <div className="msg-edit-acts">
                <button className="btn sm primary" onClick={() => h.current.saveEdit(m)}><Check size={13} /> 保存</button>
                <button className="btn sm ghost" onClick={() => h.current.setEditingId(null)}>取消</button>
              </div>
            </div>
          ) : (
            <div className="bubble" {...h.current.bindLongPress(m)}
              onContextMenu={m.content ? (e) => {
                // 触屏长按会触发 contextmenu：只拦默认菜单，操作交给长按面板
                //（此前这里直接 copyMsg = 长按即自动复制，真机反馈的 bug）。
                // 桌面鼠标右键保留「右键即复制」。
                e.preventDefault();
                if (!COARSE) h.current.copyMsg(m.content);
              } : undefined}
              onDoubleClick={m.role === 'assistant' && m.id ? () => h.current.react(m, '❤️') : undefined}
              title={m.content ? '长按操作 · 双击喜欢' : undefined}>
              {m._streaming && !m.content
                ? <span className="typing"><span></span><span></span><span></span></span>
                : <BubbleContent content={m.content} role={m.role} imageMap={imageMap} onPreview={h.current.setPreviewImg} frontRegex={frontRegex} />}
              {m.reaction && <span className="msg-reaction" title="我的反应">{m.reaction}</span>}
            </div>
          )}
          {/* 变体翻页器：重新生成不再吃掉旧回复，这里让用户左右翻看历次版本。
              热区 ≥44px，否则 pageQualityAssertions 会判触达不达标。 */}
          {!m._streaming && m.variant_count > 1 && !isEditing && (
            <div className="msg-variants" role="group" aria-label="回复版本">
              <button className="variant-nav" disabled={streaming || m.variant_index <= 0}
                onClick={() => h.current.pickVariant(m, m.variant_index - 1)} aria-label="上一个版本">‹</button>
              <span className="variant-count" aria-live="polite">{(m.variant_index ?? 0) + 1}/{m.variant_count}</span>
              <button className="variant-nav" disabled={streaming || m.variant_index >= m.variant_count - 1}
                onClick={() => h.current.pickVariant(m, m.variant_index + 1)} aria-label="下一个版本">›</button>
            </div>
          )}
          {!m._streaming && m.content && !isEditing && (
            <div className="msg-acts">
              {m.role === 'assistant' && <>
                {isPlaying || isVoiceLoading
                  ? <button className="speak on" onClick={() => { h.current.cancelPendingVoice(); h.current.stopSpeaking(); }} title="停止播放"><Square size={12} fill="currentColor" /> 停止</button>
                  : <button className="speak" onClick={() => h.current.toggleSpeak(m)} title={isVoiced ? '重放已生成的语音（不再重新合成）' : '朗读这段话'}><Volume2 size={13} /> {isVoiced ? '再听一遍' : '朗读'}</button>}
                <button className="speak" onClick={() => h.current.copyMsg(m.content)}><Copy size={13} /> 复制</button>
                {isLast && <button className="speak" onClick={h.current.regenerate} disabled={streaming}><RotateCcw size={13} /> 重新生成</button>}
                {m.id && (
                  <div className="react-wrap">
                    <button className="speak" onClick={() => h.current.setReactFor(isReacting ? null : m.id)}><Smile size={13} /> 反应</button>
                    {isReacting && (
                      <>
                        <div className="react-mask" onClick={() => h.current.setReactFor(null)} />
                        <div className="react-pop">
                          {REACTIONS.map(e => <button key={e} className={m.reaction === e ? 'on' : ''} onClick={() => h.current.react(m, e)}>{e}</button>)}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </>}
              {m.role === 'user' && <button className="speak" onClick={() => h.current.startEdit(m)} disabled={streaming}><Pencil size={13} /> 编辑</button>}
              {/* 引用只是往输入框放素材，不写库 —— 流式期间照样可用 */}
              <button className="speak" onClick={() => h.current.quote(m)} title="引用这条消息回复"><CornerUpLeft size={13} /> 引用</button>
              {m.id && <button className={`speak${isMarked ? ' on' : ''}`} onClick={() => h.current.toggleMark(m)} title={isMarked ? '取消书签' : '加入书签，可从菜单快速跳回'}><Bookmark size={13} /> {isMarked ? '已收藏' : '书签'}</button>}
              {m.id && <button className="speak" onClick={() => h.current.delMsg(m)} disabled={streaming}><Trash2 size={13} /> 删除</button>}
            </div>
          )}
        </div>
      </div>
    </>
  );
});

// —— 失败分型卡片 ——
// 改造前所有失败都表现为气泡里一行「（连接出错）+ 原始错误文本」：解释不了原因，
// 也不给任何下一步。服务端现在带回 code，这里按 code 给出真正能点的动作。
// 尤其是「金币不足」——它是撞墙时刻，用户此刻最需要的是四个按钮而不是一句抱怨。
function FailureSheet({ failure, onClose, nav }) {
  if (!failure) return null;
  const { code, message, fee, balance } = failure;
  const PLANS = {
    INSUFFICIENT_GOLD: {
      title: '金币不够了',
      desc: fee != null && balance != null ? `本次对话需要 ${fee} 金币，你还有 ${balance} 金币。` : message,
      actions: [
        { label: '每日签到领金币', to: '/wallet' },
        { label: '转一次幸运转盘', to: '/gacha' },
        { label: '看看新人礼包', to: '/events' },
        { label: '用我自己的 Key（永久免费）', to: '/settings' },
      ],
    },
    ECONOMIC_HOLD: {
      title: '账户经济功能已暂停',
      // 刻意不给「去充值」——充值解决不了债务冻结，指过去只会浪费用户的时间和钱。
      desc: message,
      actions: [{ label: '查看钱包明细', to: '/wallet' }],
    },
    NO_MODEL: {
      title: '平台 AI 暂时不可用',
      desc: '这是平台侧的问题，不是你的配置有误。你可以填入自己的 API Key 继续对话，自带 Key 永久免费。',
      actions: [{ label: '去设置填 Key', to: '/settings' }],
    },
    USER_KEY_FAILED: {
      title: '你的模型配置调用失败',
      desc: message,
      actions: [{ label: '检查语言模型设置', to: '/settings' }],
    },
    WALLET_ERROR: { title: '扣费失败', desc: message, actions: [] },
  };
  const plan = PLANS[code] || { title: '这次没能发出去', desc: message, actions: [] };
  const canRetry = code !== 'INSUFFICIENT_GOLD' && code !== 'ECONOMIC_HOLD';
  return (
    <div className="fail-mask" onClick={onClose}>
      <div className="fail-sheet" role="alertdialog" aria-label={plan.title} onClick={e => e.stopPropagation()}>
        <div className="fail-title">{plan.title}</div>
        <div className="fail-desc">{plan.desc}</div>
        <div className="fail-acts">
          {plan.actions.map(a => (
            <button key={a.to} className="fail-act" onClick={() => { onClose(); nav(a.to); }}>{a.label}</button>
          ))}
          {canRetry && failure.retry && (
            <button className="fail-act primary" onClick={() => { onClose(); failure.retry(); }}>重试一次</button>
          )}
        </div>
        <button className="fail-close" onClick={onClose}>知道了</button>
      </div>
    </div>
  );
}

export default function Chat() {
  const app = isAppMode();
  const withAppClass = (base, hook) => app ? [base, hook].filter(Boolean).join(' ') : base;
  const ChatHeader = app ? 'header' : 'div';
  const ChatComposer = app ? 'footer' : 'div';
  const { id } = useParams();
  const nav = useNav();
  const loc = useLocation();
  const toast = useToast();
  const { user, refreshUser } = useAuth();
  const [convs, setConvs] = useState([]);
  const [conv, setConv] = useState(null);
  const [character, setCharacter] = useState(null);
  // 角色前端显示正则（酒馆 regex_scripts）—— 解析一次，供气泡渲染 HTML 面板等。
  const frontRegex = useMemo(() => { try { return JSON.parse(character?.front_regex || '[]'); } catch { return []; } }, [character?.front_regex]);
  // 备用开场白（酒馆 alternate_greetings）：对话未开始时可切换开场。
  const altGreetings = useMemo(() => { try { const v = JSON.parse(character?.alt_greetings || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } }, [character?.alt_greetings]);
  // 角色感知开场建议：从 tagline + 世界书关键词派生几条贴合角色的开场，补足通用开场。
  const charStarters = useMemo(() => {
    const out = [];
    const tag = (character?.tagline || '').trim();
    if (tag && tag.length <= 16) out.push(`聊聊「${tag}」`);
    const keys = [];
    for (const w of (character?.world || [])) {
      for (const k of String(w.keys || '').split(',')) { const kk = k.trim(); if (kk && kk.length <= 8 && !keys.includes(kk)) keys.push(kk); }
      if (keys.length >= 3) break;
    }
    for (const k of keys.slice(0, 2)) out.push(`说说${k}`);
    for (const s of STARTERS) { if (out.length >= 5) break; if (!out.includes(s)) out.push(s); }
    return out.slice(0, 5);
  }, [character?.tagline, character?.world]);
  const [greetIdx, setGreetIdx] = useState(0);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [actionsOpen, setActionsOpen] = useState(false);
  const [plusOpen, setPlusOpen] = useState(false);   // 输入栏「+」对话功能面板
  const [inputFocused, setInputFocused] = useState(false); // App 壳：（ ）括号键随聚焦浮现
  const [plusPage, setPlusPage] = useState(0);       // 面板分页指示（0=互动 1=工具）
  const [giftOpen, setGiftOpen] = useState(false);   // 送礼物选择条
  const [giftCatalog, setGiftCatalog] = useState(() => giftCatalogCache);
  useEffect(() => {
    if (!giftOpen || giftCatalog) return;
    api('/chat/gifts').then(d => {
      if (Array.isArray(d.gifts) && d.gifts.length) { giftCatalogCache = d.gifts; setGiftCatalog(d.gifts); }
    }).catch(() => { /* 离线/失败退回本地镜像 */ });
  }, [giftOpen, giftCatalog]);
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
  // D3 桌面三栏：≥1280px 时角色档案常驻右列（Web 壳专属，全部 !app 短路；
  // 常驻列不是浮层，不纳入 anyOverlayOpen / 滚动锁 / Esc 逻辑）。
  const [panelPinned, setPanelPinned] = useState(() => { try { return localStorage.getItem('huanyu_chat_panel') !== '0'; } catch { return true; } });
  const [wide, setWide] = useState(() => !app && typeof window !== 'undefined' && window.matchMedia('(min-width: 1280px)').matches);
  useEffect(() => {
    if (app || typeof window === 'undefined') return;
    const mq = window.matchMedia('(min-width: 1280px)');
    const onChange = (e) => setWide(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const docked = !app && wide && panelPinned;
  // 窄屏开着抽屉时拉宽到三栏：抽屉被 docked 隐藏但 drawerOpen 残留会吃掉一次
  // 浏览器后退（anyOverlayOpen 误判），且缩窄回去抽屉突然重现 —— 常驻列接管时
  // 顺手关掉抽屉态。App 壳 docked 恒 false，零波及。
  useEffect(() => { if (docked && drawerOpen) setDrawerOpen(false); }, [docked, drawerOpen]);
  const [newMem, setNewMem] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  // 长按操作面板（触屏取代 hover 操作行）：sheetFor = 目标消息或 null。
  const [sheetFor, setSheetFor] = useState(null);
  const [quoteShare, setQuoteShare] = useState(null); // App 台词分享卡（长按面板入口）
  // 引用回复：replyTo = 被引用的消息或 null；发送时以 markdown 引用块前置。
  const [replyTo, setReplyTo] = useState(null);
  // 消息书签：本地存储（三端通用、不依赖服务端），按会话隔离。
  const [marksOpen, setMarksOpen] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [fontSize, setFontSize] = useState(() => localStorage.getItem(FONT_KEY) || 'md');
  // 气泡透明度三档（实/半透/极透）：不同立绘明暗差异大，交给用户调 —— 玻璃化的自由度
  const [bubbleAlpha, setBubbleAlpha] = useState(() => localStorage.getItem(BUBBLE_ALPHA_KEY) || 'mid');
  const cycleBubbleAlpha = () => setBubbleAlpha(v => {
    const n = v === 'solid' ? 'mid' : v === 'mid' ? 'clear' : 'solid';
    localStorage.setItem(BUBBLE_ALPHA_KEY, n);
    return n;
  });
  const [autoRead, setAutoRead] = useState(() => localStorage.getItem(AUTOREAD_KEY) === '1');
  const [reactFor, setReactFor] = useState(null);
  // 失败分型卡片：{ code, message, fee, balance, retry }
  const [failure, setFailure] = useState(null);
  const [bgmOn, setBgmOn] = useState(() => localStorage.getItem(BGM_KEY) !== '0');
  const [previewImg, setPreviewImg] = useState(null);
  // 当前正在朗读的消息标识（消息 id 或 true）；用于切换「朗读 / 停止」按钮态
  const [playingId, setPlayingId] = useState(null);
  const [voiceLoadingId, setVoiceLoadingId] = useState(null);
  // 已生成的平台语音缓存：消息 id -> blob URL。「再听一遍」直接重放，不重新合成、不再计费。
  const voiceCacheRef = useRef(new Map());
  const voiceRequestRef = useRef(null);
  const autoReadTimerRef = useRef(0);
  const [voicedIds, setVoicedIds] = useState(() => new Set());
  const [loadingConv, setLoadingConv] = useState(false);
  const scrollRef = useRef();
  const abortRef = useRef(null);
  const bgmRef = useRef(null);
  const inputRef = useRef(null);
  const inputBarRef = useRef(null);
  const menuRef = useRef(null);
  const menuTriggerRef = useRef(null);
  const searchPanelRef = useRef(null);
  const searchTriggerRef = useRef(null);
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

  // S7-G10 会话草稿（仅 App 壳，Web 行为零变化）：输入按会话持久化
  //（300ms 防抖，清空/发送即删），换会话或杀进程回来草稿仍在；
  // 发现流带入的一次性预填优先。
  useEffect(() => {
    if (!app || !id || loc.state?.draft) return;
    try { setInput(localStorage.getItem('huanyu_draft_' + id) || ''); } catch { /* */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  useEffect(() => {
    if (!app || !id) return;
    const t = setTimeout(() => {
      try {
        if (input.trim()) localStorage.setItem('huanyu_draft_' + id, input);
        else localStorage.removeItem('huanyu_draft_' + id);
      } catch { /* */ }
    }, 300);
    return () => clearTimeout(t);
  }, [app, id, input]);

  // 移动端软键盘适配：把 fixed 输入栏始终顶在键盘上方（稳健跨浏览器实现见 mobile.js）。
  useKeyboardInsetBar(inputBarRef, [conv]);

  // —— 酒馆助手宿主桥：面板 iframe 通过 window.parent.TavernHelper.generate 静默生成。
  // convRef 跟随路由；消息引用给 getChatMessages 用（酒馆格式：{message, role, ...}）。
  const convIdRef = useRef(null);
  useEffect(() => { convIdRef.current = id; }, [id]);
  const messagesRef = useRef(messages);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => {
    setPanelCtx({ characterName: character?.name || '', conversationId: Number(id) || 0 });
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

  // 输入框随内容自动增高（发送清空后回落单行），多行长文不再挤在一行内滚动。
  useAutoGrow(inputRef, input);

  // 订阅全局朗读状态，驱动「朗读 / 停止 / 再听一遍」按钮切换。
  useEffect(() => onVoiceStateChange(setPlayingId), []);
  // 离开对话或卸载时停止朗读，并回收缓存的语音 blob URL，避免叠音与内存泄漏。
  useEffect(() => {
    setStreaming(false);
    return () => {
      const stream = abortRef.current;
      stream?.abort();
      if (abortRef.current === stream) abortRef.current = null;
      if (streamRafRef.current) cancelAnimationFrame(streamRafRef.current);
      streamRafRef.current = 0;
      streamBufRef.current = null;
      clearTimeout(autoReadTimerRef.current);
      autoReadTimerRef.current = 0;
      voiceRequestRef.current?.controller?.abort();
      voiceRequestRef.current = null;
      stopSpeaking();
      for (const url of voiceCacheRef.current.values()) { try { URL.revokeObjectURL(url); } catch { /* */ } }
      voiceCacheRef.current.clear();
      setVoicedIds(new Set());
    };
  }, [id]);

  const cancelPendingVoice = () => {
    clearTimeout(autoReadTimerRef.current);
    autoReadTimerRef.current = 0;
    voiceRequestRef.current?.controller?.abort();
    voiceRequestRef.current = null;
    setVoiceLoadingId(null);
  };

  // 浮层（抽屉/菜单/搜索/反应面板/编辑）拦截浏览器后退键：打开时压栈，后退先关浮层而非跳路由。
  const closeAllOverlays = () => {
    setDrawerOpen(false); setMenuOpen(false); setSearchOpen(false); setSearchQ('');
    setActionsOpen(false); setReactFor(null); setEditingId(null); setPlusOpen(false); setGiftOpen(false);
    setSheetFor(null);
  };
  const anyOverlayOpen = drawerOpen || actionsOpen || reactFor != null || editingId != null || plusOpen || sheetFor != null;
  useOverlayBack(anyOverlayOpen, closeAllOverlays);
  useAppOverlay(menuOpen, () => setMenuOpen(false), {
    rootRef: menuRef,
    returnFocusRef: menuTriggerRef,
  });
  useAppOverlay(searchOpen, () => setSearchOpen(false), {
    rootRef: searchPanelRef,
    returnFocusRef: searchTriggerRef,
  });
  const setFont = (v) => { setFontSize(v); localStorage.setItem(FONT_KEY, v); };
  const toggleAutoRead = () => setAutoRead(v => {
    const n = !v;
    if (!n) { clearTimeout(autoReadTimerRef.current); autoReadTimerRef.current = 0; }
    localStorage.setItem(AUTOREAD_KEY, n ? '1' : '0');
    return n;
  });
  const toggleBgm = () => setBgmOn(v => { const n = !v; localStorage.setItem(BGM_KEY, n ? '1' : '0'); return n; });
  const onChatMenuKeyDown = (event) => {
    if (!app || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = [...event.currentTarget.querySelectorAll(
      '[role="menuitem"]:not([disabled]), [role="menuitemradio"]:not([disabled]), [role="menuitemcheckbox"]:not([disabled])',
    )];
    if (!items.length) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement);
    let next = 0;
    if (event.key === 'End') next = items.length - 1;
    else if (event.key === 'ArrowUp') next = current <= 0 ? items.length - 1 : current - 1;
    else if (event.key === 'ArrowDown') next = current < 0 || current === items.length - 1 ? 0 : current + 1;
    items[next]?.focus();
  };

  // Character background music — loop softly while in the conversation. Browsers
  // may block autoplay until a gesture; the play() rejection is swallowed and
  // the user can tap the music button (a direct gesture) to start it.
  useEffect(() => {
    const el = bgmRef.current;
    if (!el) return;
    if (bgmOn && character?.bgm) { el.volume = 0.45; el.play().catch(() => {}); }
    else { el.pause(); }
  }, [character?.bgm, bgmOn]);

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
  // 背景视差（--chat-para）：仅 Web 壳保留。APP 壳已移除 —— 真机审查发现它与
  // Ken-Burns 争用同一 transform，滚动时背景层被双重驱动持续 invalidate，上方
  // 每条玻璃气泡的 backdrop-filter 被迫每帧重采样，是 865 级机型掉帧主因之一；
  // APP 壳的背景生命感由进入时的单次 Ken-Burns 承担（chat-app.css）。
  const bgParaRef = useRef(0);
  const onScroll = () => {
    const el = scrollRef.current; if (!el) return;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
    if (!isAppMode() && !bgParaRef.current) {
      bgParaRef.current = requestAnimationFrame(() => {
        bgParaRef.current = 0;
        const sc = scrollRef.current; if (!sc) return;
        const main = sc.closest('.chat-main');
        if (main) main.style.setProperty('--chat-para', Math.min(60, sc.scrollTop * 0.06).toFixed(1) + 'px');
      });
    }
  };
  useEffect(() => () => { if (bgParaRef.current) cancelAnimationFrame(bgParaRef.current); }, []);

  // 把服务端收尾事件带回的 id 贴到本轮的乐观消息上。
  // 编辑 / 删除 / 书签 / 表情反应都要用真实 id，此前是靠重拉整个会话拿到的。
  const setIds = ({ user, assistant, variantCount, variantIndex }) => {
    setMessages(m => {
      const copy = [...m];
      for (let i = copy.length - 1; i >= 0; i--) {
        if (copy[i].role === 'assistant') {
          // 重新生成时消息 id 不变（服务端追加变体而非新建），这里一并更新变体计数，
          // 气泡上的 ‹ 2/3 › 翻页器才能立刻出现。
          copy[i] = { ...copy[i], id: assistant, variant_count: variantCount, variant_index: variantIndex };
          break;
        }
      }
      if (user != null) {
        for (let i = copy.length - 1; i >= 0; i--) {
          if (copy[i].role === 'user' && copy[i].id == null) { copy[i] = { ...copy[i], id: user }; break; }
        }
      }
      return copy;
    });
  };

  // Stream a reply from the given endpoint into the trailing assistant bubble.
  // 解析循环收敛到 chat/sse.js（与 CallScreen / tavernbridge 共用，内置 getApiBase 前缀）；
  // 这里只保留 rAF 节流的增量落地逻辑（每帧最多一次 setMessages，降低低端机渲染压力）。
  const streamInto = async (endpoint, payload) => {
    clearTimeout(autoReadTimerRef.current);
    autoReadTimerRef.current = 0;
    setStreaming(true);
    setAtBottom(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const isCurrent = () => abortRef.current === ctrl;
    try {
      const full = await streamSSE(endpoint, {
        body: payload, signal: ctrl.signal,
        // 平台计费事件：聊天次数卡（转盘奖品）抵扣时明示告知并刷新余额显示
        onJson: (j) => {
          if (j.credit_used) { toast(`已用 1 张聊天次数卡抵扣本次对话（剩 ${j.chat_credits} 张）`); refreshUser?.(); }
          else if (j.fee) refreshUser?.();
          // 收尾事件：服务端把本轮产生的消息 id 直接带回来了，就地贴到乐观消息上。
          // 此前这两个 id 要靠再 GET 一次整个会话来取（连角色和世界书一起重拉，
          // 400 条消息的会话每轮约 180KB），而真正需要的只有两个整数。
          if (j.assistant_message_id) {
            setIds({ user: j.user_message_id ?? null, assistant: j.assistant_message_id,
              variantCount: j.variant_count ?? 0, variantIndex: j.variant_index ?? 0 });
            if (typeof j.affinity === 'number') setAffinity(j.affinity);
          }
        },
        onDelta: (delta) => {
          if (!isCurrent()) return;
          streamBufRef.current = (streamBufRef.current || '') + delta;
          if (!streamRafRef.current) {
            streamRafRef.current = requestAnimationFrame(() => {
              const chunk = streamBufRef.current; streamBufRef.current = ''; streamRafRef.current = 0;
              if (!isCurrent()) return;
              setMessages(m => {
                const copy = [...m]; const last = copy[copy.length - 1];
                if (last) copy[copy.length - 1] = { ...last, content: (last.content || '') + chunk };
                return copy;
              });
            });
          }
        },
      });
      if (!isCurrent()) return;
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
        return c;
      });
      if (autoReadRef.current && full) {
        autoReadTimerRef.current = setTimeout(() => {
          autoReadTimerRef.current = 0;
          speak(full);
        }, 120);
      }
      loadConvs();
      refreshUser?.();
      // 不再 syncMessages()：id / 好感 / 变体计数都已由收尾事件带回（见 onJson）。
    } catch (err) {
      if (!isCurrent()) return;
      // User-initiated stop: keep whatever streamed so far, no error toast.
      if (err.name === 'AbortError') {
        setMessages(m => { const c = [...m]; const last = c[c.length - 1];
          if (last?._streaming) c[c.length - 1] = { ...last, content: last.content || '（已停止）', _streaming: false }; return c; });
      } else {
        // 失败分型：把服务端带回的 code 转成一张可操作的半屏卡片，而不是在气泡里
        // 留一句「（连接出错）」——后者既解释不了原因，也不给用户任何下一步。
        // 撤掉那颗空的 assistant 气泡，失败不该在对话里留下残骸。
        setMessages(m => { const c = [...m]; const last = c[c.length - 1];
          if (last?._streaming && !last.content) c.pop();
          else if (last?._streaming) c[c.length - 1] = { ...last, _streaming: false };
          return c; });
        setFailure({ code: err.code || 'UNKNOWN', message: err.message, fee: err.fee, balance: err.balance, retry: () => streamInto(endpoint, payload) });
      }
    } finally {
      if (isCurrent()) {
        // 清理流式缓冲与未完成的 rAF，避免内存泄漏或悬空刷新
        if (streamRafRef.current) { cancelAnimationFrame(streamRafRef.current); streamRafRef.current = 0; }
        streamBufRef.current = null;
        setStreaming(false); abortRef.current = null;
      }
    }
  };

  const stop = () => { abortRef.current?.abort(); };

  const send = async (override) => {
    let text = (override ?? input).trim();
    if (!text || streaming) return;
    // 引用回复：以 markdown 引用块前置（BubbleContent 解析为引用卡）。仅手动输入时附带，
    // 骰子/礼物/旁白等 override 动作不带引用。
    if (replyTo && override === undefined) {
      const who = replyTo.role === 'user' ? '我' : (character?.name || '角色');
      const quoted = (replyTo.content || '').replace(/\s+/g, ' ').trim().slice(0, 60);
      text = `> ${who}：${quoted}\n\n${text}`;
      setReplyTo(null);
    }
    if (override === undefined) setInput('');
    setActionsOpen(false);
    setMessages(m => [...m, { role: 'user', content: text }, { role: 'assistant', content: '', _streaming: true }]);
    await streamInto(`/api/chat/conversations/${id}/complete`, { content: text });
  };
  // 送礼物：真金币消耗。服务端单事务「扣款 + RP 消息 + 加好感」，成功后
  // 让角色顺着礼物剧情回应（complete 空内容 = 只续写不再插用户消息，好感
  // 已由礼物发放、AI 回复不会再 +3）。
  const sendGift = async (g) => {
    setGiftOpen(false); setPlusOpen(false);
    if (streaming) return;
    try {
      const d = await api(`/chat/conversations/${id}/gift`, { method: 'POST', body: { gift_id: g.id } });
      if (d.affinity) setAffinity(d.affinity.affinity);
      toast(`已送出 ${g.e} ${g.n} · -${g.price} 金币${d.affinity?.granted ? ` · 好感 +${d.affinity.granted}` : ''}`);
      refreshUser?.();
      setMessages(m => [...m, d.message, { role: 'assistant', content: '', _streaming: true }]);
      await streamInto(`/api/chat/conversations/${id}/complete`, { content: '' });
    } catch (e) { toast(e.message, 'err'); }
  };
  const insertAction = (a) => { setInput(v => (v ? v.replace(/\s*$/, '') + ' ' : '') + a + ' '); setActionsOpen(false); };
  // （ ）键：在光标处插入全角括号，光标落在括号中间（动作/心理描写速记）。
  const insertParens = () => {
    const el = inputRef.current;
    const start = el?.selectionStart ?? input.length;
    const end = el?.selectionEnd ?? input.length;
    setInput(input.slice(0, start) + '（）' + input.slice(end));
    requestAnimationFrame(() => {
      try { el.focus(); el.setSelectionRange(start + 1, start + 1); } catch { /* 键盘收起时静默 */ }
    });
  };

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

  // 触屏长按消息 → 打开操作面板（hover 操作行在触屏不可用，已由 CSS 在 coarse pointer 隐藏）。
  // 长按抬指后浏览器会补发一次 click：若落在刚展开的遮罩上会「开即被关」
  //（与 AppPressMenu 同源问题；居中气泡必现，贴底气泡恰好点进面板所以偶发）。
  // 记录展开时刻，350ms 内忽略遮罩点击。
  const sheetOpenedAtRef = useRef(0);
  const bindLongPress = useLongPress((m) => {
    if (!m.content) return;
    sheetOpenedAtRef.current = performance.now();
    setSheetFor(m);
  });

  // 消息书签（收藏段落随时跳回，纯本地存储、按会话隔离）—— 逻辑收敛到 chat/hooks.js。
  const { marks, toggleMark, jumpToMark: jumpToMarkRaw } = useBookmarks(id, () => toast('未找到该消息（可能已被删除）', 'err'), messages);
  const jumpToMark = (mid) => { setMarksOpen(false); jumpToMarkRaw(mid); };

  // 专家档世界书的预注入图片映射；引用稳定（随 character 一次性到位），
  // 保证 BubbleContent 的 memo 对老消息始终命中。
  const imageMap = character?.wb_image_map;

  // —— 渲染窗口 ——
  // 只限制**渲染**多少条，messages 数组本身始终全量在内存里：会话内搜索、导出、
  // 书签跳转都依赖完整数组，做成数据窗口会一并弄坏这三件事。
  // 搜索时自动全开，否则搜到窗口外的内容会「搜得到但跳不过去」。
  const RENDER_WINDOW = 60;
  const [showAllMessages, setShowAllMessages] = useState(false);
  useEffect(() => { setShowAllMessages(false); }, [id]);   // 换会话时收回窗口

  // 所有依赖相邻关系的标记都在**完整**数组上算好，切片只决定画哪一段。
  const allRows = useMemo(() => {
    const q = searchQ.trim().toLowerCase();
    const rows = messages.map((m, i) => ({
      m,
      key: m.id ?? `i${i}`,
      firstOfRun: i === 0 || messages[i - 1].role !== m.role,
      // 时间分隔：与上一条间隔 > 10min（或会话首条）时插入居中时间胶囊。
      divider: q ? null : timeDivider(messages[i - 1]?.created_at, m.created_at),
      isLast: i === messages.length - 1,
    }));
    return q ? rows.filter(r => (r.m.content || '').toLowerCase().includes(q)) : rows;
  }, [messages, searchQ]);

  const searching = !!searchQ.trim();
  const windowStart = (showAllMessages || searching) ? 0 : Math.max(0, allRows.length - RENDER_WINDOW);
  const visibleRows = useMemo(() => allRows.slice(windowStart), [allRows, windowStart]);

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
      cancelPendingVoice();
      speakBrowser(text, voiceCfg.voice_name, character?.voice_speed, character?.voice_pitch, mid ?? true, emotion);
      markVoiced(mid);
      return;
    }
    // 平台语音：已有缓存则直接重放，不再请求服务器（省钱、防叠音）。
    const cached = mid != null && voiceCacheRef.current.get(mid);
    if (cached) { cancelPendingVoice(); playAudioUrl(cached, mid); return; }
    cancelPendingVoice();
    const controller = new AbortController();
    const requestId = mid ?? true;
    voiceRequestRef.current = { controller, id: requestId };
    setVoiceLoadingId(requestId);
    try {
      const res = await fetch(getApiBase() + '/api/chat/tts', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ text, voice: character?.voice_name || undefined, speed: character?.voice_speed || undefined, pitch: character?.voice_pitch || undefined, emotion, character_id: character?.id }),
        signal: controller.signal,
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || '语音合成失败'); }
      // Platform voice is billed per sentence — the server reports the charge via headers.
      const charged = res.headers.get('X-Gold-Fee');
      const blob = await res.blob();
      if (controller.signal.aborted || voiceRequestRef.current?.controller !== controller) return;
      const url = URL.createObjectURL(blob);
      if (mid != null) { voiceCacheRef.current.set(mid, url); markVoiced(mid); }
      // ID-backed clips remain in the conversation cache for replay. Auto-read
      // runs before the server ID sync, so its anonymous clip is one-shot and
      // must be revoked as soon as playback ends or is interrupted.
      playAudioUrl(url, mid ?? true, { revoke: mid == null });
      if (charged) { toast(`平台语音 · 本次消耗 ${charged} 金币`); refreshUser?.(); }
    } catch (err) {
      if (err?.name !== 'AbortError') toast(err.message, 'err');
    } finally {
      if (voiceRequestRef.current?.controller === controller) {
        voiceRequestRef.current = null;
        setVoiceLoadingId(null);
      }
    }
  };

  // 朗读按钮点击：正在播放本条→停止；否则播放（缓存则重放）。
  const toggleSpeak = (m) => {
    if (playingId === m.id || voiceLoadingId === m.id) { cancelPendingVoice(); stopSpeaking(); return; }
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

  // 切换到某条消息的另一个版本（重新生成产生的变体）。乐观更新后再落库，
  // 失败则回滚——翻页应当是零延迟的手感。
  const pickVariant = async (msg, index) => {
    if (!msg.id || index < 0 || index >= (msg.variant_count || 0)) return;
    const prev = { content: msg.content, variant_index: msg.variant_index };
    setMessages(ms => ms.map(x => (x.id === msg.id ? { ...x, variant_index: index, _switching: true } : x)));
    try {
      const d = await api(`/chat/conversations/${id}/messages/${msg.id}/variant`, { method: 'POST', body: { index } });
      setMessages(ms => ms.map(x => (x.id === msg.id
        ? { ...x, content: d.message.content, variant_index: d.variant_index, variant_count: d.variant_count, _switching: false }
        : x)));
    } catch (e) {
      setMessages(ms => ms.map(x => (x.id === msg.id ? { ...x, ...prev, _switching: false } : x)));
      toast(e.message, 'err');
    }
  };

  // MessageRow 是 memo 组件：把回调收进一个身份恒定的 ref 容器，让 memo 的比较
  // 只落在真正会变的标量 prop 上。每次渲染刷新 .current 以保证闭包不过期；
  // 子组件在同一渲染批次内读取，赋值必须在返回 JSX 之前。
  const handlersRef = useRef({});
  handlersRef.current = {
    setEditText, saveEdit, setEditingId, bindLongPress, copyMsg, react, setPreviewImg,
    pickVariant, cancelPendingVoice, stopSpeaking, toggleSpeak, regenerate, setReactFor,
    startEdit, toggleMark, delMsg,
    quote: (m) => { setReplyTo(m); inputRef.current?.focus(); },
  };

  return (
    <div className={withAppClass('chat-layout' + (conv ? ' immersive' : '') + (docked && conv ? ' has-side' : ''), 'qa-chat-page')}>
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

      <div className={withAppClass('chat-main' + (character?.background ? ' has-bg' : '') + ' ba-' + bubbleAlpha, 'qa-chat-main')}>
        {!conv ? (
          <div className="empty" style={{ margin: 'auto' }}>
            <EmptyArt kind="chat" />选择左侧对话，或从角色库开启新对话
          </div>
        ) : (
          <>
            {character?.background && (
              <div className="chat-bg">
                {character.background_type === 'video'
                  ? <video src={assetUrl(character.background)} muted loop autoPlay playsInline />
                  : <img src={assetUrl(character.background)} alt="" style={app ? { viewTransitionName: 'qa-character-art' } : undefined} />}
              </div>
            )}
            {!character?.background && <div className="chat-aura" aria-hidden="true"><span /><span /><span /></div>}
            {character?.bgm && <audio ref={bgmRef} src={assetUrl(character.bgm)} loop preload="auto" />}
            {/* 菜单遮罩挂 .chat-main 层级：塞进 .chat-menu-wrap 会缩成按钮
                大小的方形模糊块（见 TheaterRoom 同注释） */}
            {menuOpen && <div className="chat-menu-mask" onClick={() => setMenuOpen(false)} />}
            <ChatHeader className={withAppClass('chat-head', 'qa-chat-header')}>
              <AppIconButton className={withAppClass('btn ghost sm mobile-only chat-back', 'qa-chat-back')} label="返回消息" onClick={() => nav('/messages')}><ArrowLeft size={16} /></AppIconButton>
              {/* App keeps identity in the navigation chrome where people expect
                  it. Message rows can then stay visually quiet instead of
                  repeating a dark name badge above every response. */}
              <div className={withAppClass('ch-idpill', 'qa-chat-identity')}>
                <div className={'ch-av' + (streaming ? ' live' : '')} style={{ '--af': affinityInfo(affinity).pct }}><Avatar src={character?.avatar} name={character?.name} size={40} /></div>
                <div className="nm">
                  {app && <b>{character?.name}</b>}
                  <span className="ch-status"><i className="ch-dot" />{streaming ? '正在输入…' : '在线'}</span>
                </div>
              </div>
              {/* 好感等级徽记（App 恢复展示：服务端权威等级 + 进度，点击开档案抽屉）。
                  app-shell.css 936-946 的顶栏布局本就为「身份胶囊 + 好感徽章 + 工具组」
                  设计，1229-1235 的 App 玻璃化样式一直保留着。 */}
              {(() => { const af = affinityInfo(affinity); return (
                <button className={'affinity-badge' + (afPulse ? ' pulse' : '')} onClick={() => {
                  // 宽屏 Web：徽章切换常驻侧列的钉住态；窄屏 Web / App：原样开抽屉。
                  if (!app && wide) setPanelPinned(p => { const n = !p; try { localStorage.setItem('huanyu_chat_panel', n ? '1' : '0'); } catch { /* */ } return n; });
                  else setDrawerOpen(true);
                }} title="角色档案 · 好感度 / 记忆 / 世界书">
                  <span className="af-ic">{app ? <AffinityIcon level={af.level} size={16} /> : af.icon}</span>
                  <span className="af-tx"><b>{af.name}</b><i><em style={{ width: af.pct + '%' }} /></i></span>
                </button>
              ); })()}
              <div className={withAppClass('chat-tools', 'qa-chat-header-actions')}>
                {!app && character?.bgm && (
                  <AppIconButton
                    className={withAppClass('speak chat-tool' + (bgmOn ? ' on' : ''), 'qa-chat-header-button')}
                    label={bgmOn ? '关闭背景音乐' : '播放背景音乐'}
                    pressed={bgmOn}
                    onClick={toggleBgm}
                    title={bgmOn ? '关闭背景音乐' : '播放背景音乐'}
                  >
                    {bgmOn ? <Music size={17} /> : <VolumeX size={17} />}
                  </AppIconButton>
                )}
                {/* 「生成插图」收进更多菜单 —— 头部一行曾塞下 7 个控件，412px 宽必然
                    互相挤压（用户实机上身份胶囊的状态文字被压到只剩一个字符）。 */}
                <AppIconButton
                  ref={searchTriggerRef}
                  className={withAppClass('speak chat-tool' + (searchOpen ? ' on' : ''), 'qa-chat-header-button')}
                  label="对话内搜索"
                  pressed={searchOpen}
                  onClick={() => {
                    if (app) setMenuOpen(false);
                    setSearchOpen(o => !o);
                    setSearchQ('');
                  }}
                  title="对话内搜索"
                  aria-expanded={app ? searchOpen : undefined}
                  aria-controls={app ? 'chat-search-panel' : undefined}
                ><Search size={17} /></AppIconButton>
                <div className="chat-menu-wrap">
                  <AppIconButton
                    ref={menuTriggerRef}
                    className={withAppClass('speak chat-tool' + (menuOpen ? ' on' : ''), 'qa-chat-header-button')}
                    label="更多"
                    onClick={() => {
                      if (app) { setSearchOpen(false); setSearchQ(''); }
                      setMenuOpen(o => !o);
                    }}
                    title="更多"
                    aria-haspopup={app ? 'menu' : undefined}
                    aria-expanded={app ? menuOpen : undefined}
                    aria-controls={app ? 'chat-more-menu' : undefined}
                  ><MoreVertical size={17} /></AppIconButton>
                  {menuOpen && (
                    <>
                      <div ref={menuRef} className={withAppClass('chat-menu', 'qa-chat-more-menu')}
                        id={app ? 'chat-more-menu' : undefined} role={app ? 'menu' : undefined}
                        aria-label={app ? '对话更多操作' : undefined} tabIndex={app ? -1 : undefined}
                        onKeyDown={onChatMenuKeyDown}>
                        <button type="button" role={app ? 'menuitem' : undefined} onClick={() => { setIllusOpen(true); setMenuOpen(false); }}><Wand2 size={15} /> 为当前剧情生成插图</button>
                        <button type="button" role={app ? 'menuitem' : undefined} onClick={renameConv}><Edit3 size={15} /> 重命名对话</button>
                        <button type="button" role={app ? 'menuitem' : undefined} onClick={() => exportConv('md')}><Download size={15} /> 导出为 Markdown</button>
                        <button type="button" role={app ? 'menuitem' : undefined} onClick={() => exportConv('json')}><Download size={15} /> 导出为 JSON</button>
                        <button type="button" role={app ? 'menuitem' : undefined} className="danger" onClick={clearConv}><Eraser size={15} /> 清空消息</button>
                        <div className="chat-menu-sep" role={app ? 'separator' : undefined} />
                        <div className="chat-menu-row" role={app ? 'group' : undefined} aria-labelledby={app ? 'chat-font-label' : undefined}>
                          <span id={app ? 'chat-font-label' : undefined}><Type size={15} /> 字号</span>
                          <div className="seg seg-mini">
                            {[['sm', '小'], ['md', '中'], ['lg', '大']].map(([v, l]) => (
                              <button type="button" key={v} className={fontSize === v ? 'active' : ''}
                                role={app ? 'menuitemradio' : undefined} aria-checked={app ? fontSize === v : undefined}
                                onClick={() => setFont(v)}>{l}</button>
                            ))}
                          </div>
                        </div>
                        <button type="button" role={app ? 'menuitemcheckbox' : undefined} aria-checked={app ? autoRead : undefined}
                          onClick={toggleAutoRead}><Volume2 size={15} /> 自动朗读 <span className={'chat-menu-toggle' + (autoRead ? ' on' : '')}>{autoRead ? '已开启' : '已关闭'}</span></button>
                        <button type="button" role={app ? 'menuitem' : undefined} onClick={() => { setMarksOpen(true); setMenuOpen(false); }}><Bookmark size={15} /> 消息书签{marks.size ? `（${marks.size}）` : ''}</button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </ChatHeader>
            {character?.background && <span className="chat-ai-mark" aria-hidden="true">内容由 AI 生成</span>}
            {/* APP 壳：悬浮玻璃胶囊，高亮 + 上/下条跳转（不过滤，保留上下文）。
                Web 壳：维持原过滤式搜索不动。 */}
            {searchOpen && (app
              ? <div ref={searchPanelRef} id="chat-search-panel" style={{ display: 'contents' }}><ChatSearchBar messages={messages} onClose={() => setSearchOpen(false)} /></div>
              : (
              <div className="chat-search">
                <Search size={15} className="muted" />
                <input autoFocus value={searchQ} enterKeyHint="search" autoCapitalize="none" autoCorrect="off" spellCheck={false}
                  onChange={e => setSearchQ(e.target.value)} placeholder="在本对话中搜索…"
                  onKeyDown={e => e.key === 'Escape' && (setSearchOpen(false), setSearchQ(''))} />
                {searchQ && <span className="muted" style={{ fontSize: 12 }}>{messages.filter(mm => mm.content?.toLowerCase().includes(searchQ.toLowerCase())).length} 条</span>}
                <button className="speak" onClick={() => { setSearchOpen(false); setSearchQ(''); }}><X size={15} /></button>
              </div>
            ))}

            <div className={'chat-scroll font-' + fontSize} ref={scrollRef} onScroll={onScroll} role={app ? 'log' : undefined} aria-live={app ? 'polite' : undefined} aria-relevant={app ? 'additions text' : undefined} aria-label={app ? '对话消息' : undefined}>
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
                      ? <img src={assetUrl(banner.src)} alt="场景横幅" />
                      : <div className="wb-front-banner-ph">{app ? <LayoutTemplate size={14} /> : <Sparkles size={14} />} 专家档自构前端 · {schema.layout} 布局</div>}
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
              {windowStart > 0 && (
                <button className="load-earlier" onClick={() => setShowAllMessages(true)}>
                  查看更早的 {windowStart} 条消息
                </button>
              )}
              {visibleRows.map(row => (
                <MessageRow
                  key={row.key}
                  row={row}
                  h={handlersRef}
                  character={character}
                  imageMap={imageMap}
                  frontRegex={frontRegex}
                  streaming={streaming}
                  isEditing={editingId === row.m.id}
                  editText={editingId === row.m.id ? editText : ''}
                  isReacting={reactFor === row.m.id}
                  isPlaying={playingId === row.m.id}
                  isVoiceLoading={voiceLoadingId === row.m.id}
                  isVoiced={voicedIds.has(row.m.id)}
                  isMarked={marks.has(row.m.id)}
                />
              ))}
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
                {charStarters.map(s => <button key={s} className="starter-chip" onClick={() => send(s)}>{s}</button>)}
              </div>
            )}
            {/* 输入栏占位：移动端 fixed 输入栏遮挡下方消息，spacer 留出空白避免遮挡 */}
            <div className="chat-input-spacer" aria-hidden="true" />
            {/* 输入栏：移动端 CSS 改 position:fixed 脱离文档流，键盘弹起时 visualViewport
                驱动 bottom 上移到键盘上方。chat-main 布局不动，下方被键盘覆盖是自然的，
                只有输入框被顶上去 —— 不会"拉出半屏原色背景"。 */}
            <ChatComposer className={withAppClass('chat-input-bar', 'qa-chat-composer')} ref={inputBarRef} aria-label={app ? '消息编辑器' : undefined}>
              {replyTo && (
                <div className={withAppClass('reply-bar', 'qa-chat-reply')}>
                  <div className="rb-body">
                    <div className="rb-who">回复 {replyTo.role === 'user' ? '我' : (character?.name || '角色')}</div>
                    <div className="rb-text">{(replyTo.content || '').replace(/\s+/g, ' ').trim()}</div>
                  </div>
                  <button className="speak rb-close" onClick={() => setReplyTo(null)} title="取消引用"><X size={15} /></button>
                </div>
              )}
              {actionsOpen && (
                <div className={withAppClass('action-panel', 'qa-chat-actions-panel')} id={app ? 'chat-actions-panel' : undefined} role={app ? 'group' : undefined} aria-label={app ? '动作与表情' : undefined}>
                  {QUICK_ACTIONS.map(a => <button key={a} onClick={() => insertAction(a)}>{a}</button>)}
                </div>
              )}
              <div className={withAppClass('box', 'qa-chat-input-island')}>
                {/* 流式期间不再禁输入：可以照常打字、开表情面板、组织下一句 ——
                    「AI 说话时我被冻住」是二次交互延迟的大头。发送本身仍被 send()
                    的 streaming 守卫拦住（发送键此刻也是停止键），写库类操作
                    （编辑/删除/重生成）维持锁定。 */}
                {/* App 壳（雾态玻璃稿）：左电话；Web 壳保留表情/动作面板入口。 */}
                {app ? (
                  <AppIconButton
                    className={withAppClass('act-btn call-btn', 'qa-chat-call')}
                    label="语音通话" onClick={() => setCallOpen(true)} title="语音通话"
                  ><Phone size={20} /></AppIconButton>
                ) : (
                  <AppIconButton
                    className={withAppClass('act-btn' + (actionsOpen ? ' on' : ''), 'qa-chat-action-toggle')}
                    label="动作与表情"
                    pressed={actionsOpen}
                    onClick={() => { setActionsOpen(o => !o); setPlusOpen(false); }}
                    title="动作 / 表情"
                  ><Smile size={19} /></AppIconButton>
                )}
                <textarea className={app ? 'qa-chat-textarea' : undefined} ref={inputRef} rows={1} value={input}
                  aria-label={app ? '输入消息' : undefined}
                  placeholder={app ? '自由输入...' : `对 ${(character?.name || '').length > 5 ? (character.name.slice(0, 5) + '…') : (character?.name || 'TA')} 说点什么…` + (COARSE ? '' : '（Enter 发送，Shift+Enter 换行）')}
                  enterKeyHint="send" autoCapitalize="sentences" autoCorrect="on" spellCheck={false}
                  onFocus={app ? () => setInputFocused(true) : undefined}
                  onBlur={app ? () => setInputFocused(false) : undefined}
                  onChange={e => setInput(e.target.value)} onKeyDown={onKey} />
                {/* （ ）动作括号：聚焦/有草稿时浮现，插入全角括号并把光标落在中间 */}
                {app && (inputFocused || input) && (
                  <button type="button" className="paren-btn" aria-label="插入动作括号" title="插入动作括号"
                    onMouseDown={e => e.preventDefault()} onClick={insertParens}>( )</button>
                )}
                {/* 声波：自动朗读开关（有草稿时让位给发送键） */}
                {app && !input.trim() && (
                  <AppIconButton
                    className={withAppClass('act-btn wave-btn' + (autoRead ? ' on' : ''), 'qa-chat-wave')}
                    label={autoRead ? '自动朗读 开' : '自动朗读 关'}
                    pressed={autoRead} onClick={toggleAutoRead} title="自动朗读"
                  ><WaveIcon size={22} /></AppIconButton>
                )}
                {/* 「+」对话功能面板：把散落在头部菜单里的对话内能力聚合到拇指热区。
                    App 壳：有草稿时此槽位切换成白圆发送键（参考稿 1:1）。 */}
                {(!app || (!input.trim() && !streaming)) && (
                  <AppIconButton
                    className={withAppClass('act-btn plus-btn' + (plusOpen ? ' on' : ''), 'qa-chat-tools-toggle')}
                    label="对话功能"
                    pressed={plusOpen}
                    onClick={() => { setPlusOpen(o => !o); setActionsOpen(false); }}
                    title="对话功能"
                    aria-expanded={app ? plusOpen : undefined}
                    aria-controls={app ? 'chat-tools-panel' : undefined}
                  >{app && plusOpen ? <X size={20} /> : <Plus size={20} />}</AppIconButton>
                )}
                {streaming
                  ? <AppIconButton className={withAppClass('send-btn stop', 'qa-chat-send qa-chat-stop')} label="停止生成" variant="filled" tone="danger" onClick={stop} title="停止生成"><Square size={15} fill="currentColor" /></AppIconButton>
                  : (!app || input.trim())
                    ? <AppIconButton className={withAppClass('send-btn', 'qa-chat-send')} label="发送消息" variant="filled" onClick={() => send()} disabled={!input.trim()}>{app ? <ArrowUp size={21} strokeWidth={2.4} /> : <Send size={17} />}</AppIconButton>
                    : null}
              </div>
              {plusOpen && (() => {
                // 两页 × 6 项（对标一线聊天功能面板）：P1 互动添趣 / P2 实用工具。
                // 导出/清空/搜索/书签等低频项收在右上 ⋮ 菜单，不占面板。
                const P1 = [
                  { ic: Phone, hue: 'call', label: '语音通话', on: () => { setPlusOpen(false); setCallOpen(true); } },
                  { ic: app ? ImagePlus : Wand2, hue: 'illus', label: '生成插图', on: () => { setIllusOpen(true); setPlusOpen(false); } },
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
                  // 「重新生成」在消息操作行已有，这里换成玻璃化专属的透明度调节
                  { ic: app ? Blend : Sparkles, hue: 'regen', label: `气泡 · ${bubbleAlpha === 'solid' ? '实底' : bubbleAlpha === 'mid' ? '半透' : '极透'}`, on: cycleBubbleAlpha },
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
                  <div className={withAppClass('chat-plus-sheet paged', 'qa-chat-tools-panel')} id={app ? 'chat-tools-panel' : undefined} role={app ? 'region' : undefined} aria-label={app ? '对话工具' : undefined}>
                    {giftOpen && (
                      <div className="cps-gifts">
                        {(giftCatalog || GIFTS).map(g => (
                          <button key={g.id} onClick={() => sendGift(g)}>
                            {GIFT_ART[g.id]
                              ? <img className="cps-gift-img" src={GIFT_ART[g.id]} alt="" draggable="false" />
                              : <b>{g.e}</b>}
                            <span>{g.n.replace(/^一[枝块杯只封份枚把]/, '')}</span>
                            <i className="cps-gift-price"><CoinIcon size={9} /> {g.price}{g.affinity ? <em className="cps-gift-aff">♥+{g.affinity}</em> : null}</i>
                          </button>
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
            </ChatComposer>

          {drawerOpen && !docked && (
            <>
              <div className="chat-drawer-mask" onClick={() => setDrawerOpen(false)} />
              <aside className="chat-drawer">
                <CharPanelBody app={app} character={character} affinity={affinity} memories={memories}
                  newMem={newMem} setNewMem={setNewMem} addMemory={addMemory} delMemory={delMemory}
                  onClose={() => setDrawerOpen(false)} />
              </aside>
            </>
          )}
        </>
      )}
      </div>
      {/* D3 桌面三栏：≥1280px 且钉住时，角色档案常驻为第三列（非浮层）。 */}
      {docked && conv && (
        <aside className="chat-side">
          <CharPanelBody app={app} character={character} affinity={affinity} memories={memories}
            newMem={newMem} setNewMem={setNewMem} addMemory={addMemory} delMemory={delMemory}
            onClose={() => { setPanelPinned(false); try { localStorage.setItem('huanyu_chat_panel', '0'); } catch { /* */ } }} />
        </aside>
      )}
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
      {/* 长按操作面板（触屏）：承载原 hover 操作行的全部能力 */}
      {sheetFor && (() => { const m = sheetFor; const isLast = messages[messages.length - 1]?.id === m.id || messages[messages.length - 1] === m; const close = () => setSheetFor(null); return (
        <>
          <div className="msg-sheet-mask" onClick={() => { if (performance.now() - sheetOpenedAtRef.current < 350) return; close(); }} />
          <div className="msg-sheet" role="menu">
            <div className="ms-preview">{(m.content || '').replace(/^>\s.*\n+/, '').slice(0, 120)}</div>
            {/* 表情反应行已按真机反馈移除（面板保持纯操作列表）；
                双击气泡点 ❤️ 与 Web 壳 hover 反应仍在。 */}
            {m.role === 'assistant' && (playingId === m.id || voiceLoadingId === m.id
              ? <button className="ms-row on" onClick={() => { cancelPendingVoice(); stopSpeaking(); close(); }}><Square size={18} fill="currentColor" /> 停止播放</button>
              : <button className="ms-row" onClick={() => { toggleSpeak(m); close(); }}><Volume2 size={18} /> {voicedIds.has(m.id) ? '再听一遍' : '朗读'}</button>)}
            <button className="ms-row" onClick={() => { copyMsg(m.content); close(); }}><Copy size={18} /> 复制</button>
            <button className="ms-row" onClick={() => { setReplyTo(m); close(); inputRef.current?.focus(); }}><CornerUpLeft size={18} /> 引用回复</button>
            {app && !!m.content && (
              <button className="ms-row" onClick={() => { setQuoteShare(m); close(); }}><ImagePlus size={18} /> 生成台词卡</button>
            )}
            {m.role === 'assistant' && isLast && <button className="ms-row" onClick={() => { close(); regenerate(); }} disabled={streaming}><RotateCcw size={18} /> 重新生成</button>}
            {m.role === 'user' && <button className="ms-row" onClick={() => { startEdit(m); close(); }} disabled={streaming}><Pencil size={18} /> 编辑</button>}
            {m.id && <button className={'ms-row' + (marks.has(m.id) ? ' on' : '')} onClick={() => { toggleMark(m); close(); }}><Bookmark size={18} /> {marks.has(m.id) ? '取消书签' : '加入书签'}</button>}
            {m.id && <button className="ms-row danger" onClick={() => { close(); delMsg(m); }} disabled={streaming}><Trash2 size={18} /> 删除</button>}
          </div>
        </>
      ); })()}
      {quoteShare && character && (
        <ShareCardSheet
          kind="quote"
          payload={{
            text: (quoteShare.content || '').replace(/^>\s.*\n+/, '').replace(/\*+/g, '').trim(),
            speaker: quoteShare.role === 'user' ? (user?.display_name || user?.username || '我') : character.name,
            avatar: quoteShare.role === 'user'
              ? (user?.avatar ? assetUrl(user.avatar) : '')
              : (character.avatar ? assetUrl(character.avatar) : ''),
            date: cnToday(),
            path: '/character/' + character.id,
          }}
          onClose={() => setQuoteShare(null)}
        />
      )}
      {illusOpen && <IllustrateModal initialPrompt={illusSeed()} onClose={() => setIllusOpen(false)} />}
      <FailureSheet failure={failure} onClose={() => setFailure(null)} nav={nav} />
      {callOpen && character && <CallScreen character={character} onClose={() => setCallOpen(false)} />}
      {previewImg && (
        <div className="img-lightbox" onClick={() => setPreviewImg(null)}>
          <img src={assetUrl(previewImg)} alt="预览" />
          <button className="img-lightbox-close" onClick={(e) => { e.stopPropagation(); setPreviewImg(null); }} title="关闭"><X size={22} /></button>
        </div>
      )}
    </div>
  );
}
