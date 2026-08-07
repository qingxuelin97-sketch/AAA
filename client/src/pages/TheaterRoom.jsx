import React, { useEffect, useRef, useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useNav as useNavigate } from '../nav.js';
import { api, useAuth, assetUrl } from '../api.jsx';
import { useRealtimeEvent, useRealtimeFeat } from '../realtime.jsx';
import { useToast, Avatar, Modal, CoinIcon } from '../ui.jsx';
import { useKeyboardInsetBar } from '../mobile.js';
import { speakBrowser, stopSpeaking, onVoiceStateChange, currentVoiceId } from '../voice.js';
import StageEditor from '../components/StageEditor.jsx';
import NovelWorldEditor from '../components/NovelWorldEditor.jsx';
import { AppButton, AppIconButton } from '../components/AppControls.jsx';
import ShareCardSheet from '../components/ShareCardSheet.jsx';
import { cnToday } from '../util.js';
import { isAppMode } from '../appmode.js';
import { Send, Sparkles, ArrowLeft, Feather, Users, LogOut, BookOpen, Zap, ZapOff, ChevronRight,
  Palette, Image as ImageIcon, MoreVertical, RotateCcw, Copy, Download, Type, Shuffle, ArrowDown,
  List, Wand2, Smile, Volume2, Square, BookmarkPlus, Music, Clapperboard, Flag, Trash2, X, RefreshCw } from 'lucide-react';

// 互动小说阅读器：以你为主角的即兴叙事。你写下行动 / 台词，旁白续写后果，
// 也可点登场角色让其接话。整体按「小说阅读」体验打造 —— 旁白为文学化散文、
// 角色对白带署名、玩家行动单独成段、段落淡入；支持重写、随机接话、导出、
// 自动续写，以及字号 / 字体的阅读排版设置。后端沿用 /theater 既有接口。
//
// 本版新增：章节系统（分章 + 目录跳转 + 全书统计）、命运抉择（AI 生成三个
// 候选行动）、段落 emoji 反应、段落朗读、阅读进度记忆、导演台（文风 / 密令 /
// 完结 / BGM）与完结态展示。

const ACTION_HINTS = ['环顾四周', '继续向前', '开口询问', '保持沉默', '回忆起什么', '伸手触碰'];
const FONT_KEY = 'inovel_font', SERIF_KEY = 'inovel_serif';
const REACT_EMOJI = ['❤️', '🔥', '😂', '😮', '👏', '😢'];
const STYLE_PRESETS = ['古典雅致', '轻快幽默', '悬疑紧张', '热血激昂', '温柔治愈', '黑暗残酷', '武侠古风', '赛博科幻'];
const posKey = (id) => 'inovel_pos_' + id;

const parseReactions = (r) => {
  if (!r) return {};
  if (typeof r === 'object') return r;
  try { return JSON.parse(r) || {}; } catch { return {}; }
};

export default function TheaterRoom() {
  const { id } = useParams();
  const { user } = useAuth();
  const appMode = isAppMode();
  const nav = useNavigate();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [acting, setActing] = useState(false);
  const [sending, setSending] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [autoFlow, setAutoFlow] = useState(() => localStorage.getItem('inovel_autoflow') !== '0');
  const [atBottom, setAtBottom] = useState(true);
  const [fontSize, setFontSize] = useState(() => localStorage.getItem(FONT_KEY) || 'md');
  const [serif, setSerif] = useState(() => localStorage.getItem(SERIF_KEY) !== '0');
  // 舞台背景设定 + 小说专属世界书（创作者自定义）
  const [stageConfig, setStageConfig] = useState({ charAuto: true, charBg: {}, scenes: [] });
  const [novelWb, setNovelWb] = useState([]);
  const [stageOpen, setStageOpen] = useState(false);
  const [stageTab, setStageTab] = useState('stage');       // stage | world | director
  const [savingStage, setSavingStage] = useState(false);
  // 导演台字段（仅作者）
  const [director, setDirector] = useState({ style: '', directive: '', status: 'ongoing', bgm: '' });
  // 命运抉择：null 关闭 | 'loading' | string[]
  const [choices, setChoices] = useState(null);
  const [tocOpen, setTocOpen] = useState(false);
  const [reactFor, setReactFor] = useState(null);          // 打开 emoji 选择器的段落 id
  const [quoteShare, setQuoteShare] = useState(null);      // App 台词卡（剧场段落导出）
  const [speakingId, setSpeakingId] = useState(null);
  const [bgmOn, setBgmOn] = useState(false);
  const scrollRef = useRef();
  const barRef = useRef();
  const bgmRef = useRef();
  const lastId = useRef(0);
  const atBottomRef = useRef(true);
  const restoredRef = useRef(false);                       // 已按保存的进度定位，首屏别再跳底部
  const actionLockRef = useRef(false);
  const autoFlowTimerRef = useRef(0);
  const joinedRef = useRef(false);

  // 移动端软键盘适配：输入栏顶在键盘上方（与对话页同一套稳健实现）。
  useKeyboardInsetBar(barRef, [id]);

  useEffect(() => onVoiceStateChange(() => setSpeakingId(currentVoiceId())), []);
  useEffect(() => () => stopSpeaking(), [id]);
  useEffect(() => () => {
    clearTimeout(autoFlowTimerRef.current);
    autoFlowTimerRef.current = 0;
    actionLockRef.current = false;
  }, [id]);

  const leave = async () => {
    setMenuOpen(false);
    if (!confirm('确定离开这部互动小说？')) return;
    try { await api('/theater/' + id + '/leave', { method: 'POST' }); toast('已离开'); nav('/theater'); }
    catch (e) { toast(e.message, 'err'); }
  };
  const removeWork = async () => {
    setMenuOpen(false);
    if (!confirm('删除整部作品？全部段落与读者记录将一并清除，不可恢复。')) return;
    try { await api('/theater/' + id, { method: 'DELETE' }); toast('作品已删除'); nav('/theater'); }
    catch (e) { toast(e.message, 'err'); }
  };

  const load = async () => {
    setLoadError('');
    try {
      const d = await api('/theater/' + id);
      setData(d);
      setMessages(d.messages);
      if (d.theater?.stage_config) setStageConfig({ charAuto: true, charBg: {}, scenes: [], ...d.theater.stage_config });
      if (Array.isArray(d.theater?.worldbook)) setNovelWb(d.theater.worldbook);
      setDirector({
        style: d.theater?.style || '', directive: d.theater?.directive || '',
        status: d.theater?.status || 'ongoing', bgm: d.theater?.bgm || ''
      });
      lastId.current = d.messages.length ? d.messages[d.messages.length - 1].id : 0;
      joinedRef.current = !!d.joined;
    } catch (e) {
      setLoadError(e.message || '故事载入失败');
      toast(e.message, 'err');
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  // 其他读者 / AI 的新段落经 SSE 秒达（服务端 theater_msg 事件；removedId
  // 覆盖「重写」的旧段替换）。轮询自适应：推送能力在 → 放宽为兜底，
  // 否则（后端未升级 / SSE 断开）维持密轮询。
  const live = useRealtimeFeat('theater_msg');
  useRealtimeEvent('theater_msg', (d) => {
    if (!d || Number(d.theater_id) !== Number(id)) return;
    setMessages(list => {
      let next = d.removedId ? list.filter(x => x.id !== d.removedId) : list;
      const m = d.message;
      if (m && m.id > lastId.current) { lastId.current = m.id; next = [...next, m]; }
      return next;
    });
  });
  useEffect(() => {
    const t = setInterval(async () => {
      try {
        const d = await api('/theater/' + id + '/messages?after=' + lastId.current);
        if (d.messages.length) {
          setMessages(m => [...m, ...d.messages.filter(x => x.id > lastId.current)]);
          lastId.current = d.messages[d.messages.length - 1].id;
        }
      } catch { /* */ }
    }, live ? 15000 : 4000);
    return () => clearInterval(t);
  }, [id, live]);

  // 智能跟随：仅当读者已在底部附近时自动滚到最新，避免回看历史被强行拉走。
  const scrollToBottom = (behavior = 'smooth') => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior });
  useEffect(() => { atBottomRef.current = atBottom; }, [atBottom]);
  useEffect(() => { if (atBottomRef.current && !restoredRef.current) scrollToBottom(); restoredRef.current = false; }, [messages, acting, sending]);
  const onScroll = () => {
    const el = scrollRef.current; if (!el) return;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 120);
  };
  const stick = () => { atBottomRef.current = true; setAtBottom(true); };

  // —— 阅读进度记忆（修缮⑫回流服务端）：离开时保存滚动比例（原绝对像素
  // 换比例，跨设备高度不同也能还原；旧像素值直接废弃，损失一次位置），
  // 回来时本机与服务端取较新者恢复；写入双写（本机即时 + 服务端 PUT）。
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !data) return;
    let saved = 0, savedAt = 0;
    try {
      const loc = JSON.parse(localStorage.getItem(posKey(id)) || 'null');
      if (loc && typeof loc === 'object') { saved = loc.ratio || 0; savedAt = loc.at || 0; }
    } catch { /* 旧版绝对像素（纯数字字符串）：无法跨高度换算，废弃 */ }
    const sp = data.progress;
    if (sp && sp.ratio > 0) {
      const spAt = Date.parse(String(sp.updated_at || '').replace(' ', 'T') + 'Z') || 0;
      if (spAt >= savedAt) saved = sp.ratio;
    }
    const max0 = el.scrollHeight - el.clientHeight;
    if (saved > 0.02 && saved < 0.98 && max0 > 500) {
      restoredRef.current = true;
      el.scrollTop = saved * max0;
      setAtBottom(false);
    }
    const save = () => {
      const max = el.scrollHeight - el.clientHeight;
      const ratio = max > 0 ? Math.round(Math.min(1, el.scrollTop / max) * 1000) / 1000 : 0;
      try { localStorage.setItem(posKey(id), JSON.stringify({ ratio, at: Date.now() })); } catch { /* */ }
      api(`/theater/${id}/progress`, { method: 'PUT', body: { ratio } }).catch(() => {});
    };
    const onHide = () => { if (document.hidden) save(); };
    document.addEventListener('visibilitychange', onHide);
    return () => { save(); document.removeEventListener('visibilitychange', onHide); };
    // eslint-disable-next-line
  }, [data?.theater?.id]);

  // 测量底部行动区高度 → CSS 变量，移动端 fixed 输入栏据此留白，避免遮挡末段。
  useEffect(() => {
    const bar = barRef.current;
    if (!bar || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => document.documentElement.style.setProperty('--inovel-bar-h', bar.offsetHeight + 'px'));
    ro.observe(bar);
    return () => { ro.disconnect(); document.documentElement.style.removeProperty('--inovel-bar-h'); };
  }, [data]);

  const push = (msg) => { setMessages(m => [...m, msg]); lastId.current = Math.max(lastId.current, msg.id); };
  const toggleAuto = () => setAutoFlow(v => { const n = !v; localStorage.setItem('inovel_autoflow', n ? '1' : '0'); return n; });
  const setFont = (v) => { setFontSize(v); localStorage.setItem(FONT_KEY, v); };
  const toggleSerif = () => setSerif(v => { const n = !v; localStorage.setItem(SERIF_KEY, n ? '1' : '0'); return n; });

  const ensureJoined = async () => {
    if (joinedRef.current) return;
    await api('/theater/' + id + '/join', { method: 'POST' });
    joinedRef.current = true;
    setData(current => current ? { ...current, joined: true } : current);
  };

  const beginAction = () => {
    if (actionLockRef.current) return false;
    clearTimeout(autoFlowTimerRef.current);
    autoFlowTimerRef.current = 0;
    actionLockRef.current = true;
    return true;
  };

  const endAction = () => { actionLockRef.current = false; };
  const operationId = () => {
    try { return crypto.randomUUID(); }
    catch { return `theater-${id}-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
  };

  // 平台计费披露同步：走平台模型时服务端每次返回本段实际费用（随剧情长度
  // 档位变化），常驻提示以此保持准确；自带 key 的响应 fee=0，不动披露。
  const syncFee = (d) => {
    if (d && d.fee > 0) setData(prev => prev ? { ...prev, llm: { ...(prev.llm || {}), platform: true, fee: d.fee } } : prev);
  };

  // 让旁白 / 某个角色续写一段。
  const advance = async (body, label) => {
    if (!beginAction()) return false;
    stick(); setActing(label || '旁白');
    try {
      await ensureJoined();
      const d = await api('/theater/' + id + '/act', {
        method: 'POST',
        body: { ...(body || { narrator: true }), operation_id: operationId() },
      });
      push(d.message);
      syncFee(d);
      return true;
    }
    catch (e) { toast(e.message, 'err'); return false; }
    finally { setActing(false); endAction(); }
  };
  // 随机挑一位登场角色接话，制造意外。
  const randomCharacter = () => {
    if (!cast.length || actionLockRef.current) return;
    const c = cast[Math.floor(Math.random() * cast.length)];
    advance({ character_id: c.id }, c.name);
  };
  // 重写最近一段 AI 续写（不满意时换一种写法）。
  const retry = async () => {
    if (!beginAction()) return;
    stick(); setActing('重写');
    try {
      await ensureJoined();
      const d = await api('/theater/' + id + '/retry', { method: 'POST', body: { operation_id: operationId() } });
      setMessages(m => [...m.filter(x => x.id !== d.removedId), d.message]);
      lastId.current = Math.max(lastId.current, d.message.id);
      syncFee(d);
    } catch (e) { toast(e.message, 'err'); } finally { setActing(false); endAction(); }
  };

  // 你写下一段行动 / 台词；可选地自动让旁白续写后果，形成「行动 → 后果」的互动循环。
  const say = async (textArg) => {
    const content = (textArg ?? input).trim();
    if (!content || !beginAction()) return;
    if (textArg == null) setInput('');
    stick(); setSending(true);
    let sent = false;
    try {
      await ensureJoined();
      const d = await api('/theater/' + id + '/say', { method: 'POST', body: { content, operation_id: operationId() } });
      push(d.message);
      sent = true;
    } catch (e) {
      if (textArg == null) setInput(current => current.trim() ? current : content);
      toast(e.message, 'err');
    } finally {
      setSending(false);
      endAction();
    }
    if (sent && autoFlow) {
      autoFlowTimerRef.current = setTimeout(() => {
        autoFlowTimerRef.current = 0;
        void advance(undefined, '旁白');
      }, 180);
    }
  };

  // —— 命运抉择：AI 生成三个候选行动，选中即作为「你」的行动发出。
  const fetchChoices = async () => {
    if (actionLockRef.current || choices === 'loading') return;
    setChoices('loading');
    try { const d = await api('/theater/' + id + '/choices', { method: 'POST', body: {} }); setChoices(d.choices); syncFee(d); }
    catch (e) { toast(e.message, 'err'); setChoices(null); }
  };
  const pickChoice = (c) => { setChoices(null); say(c); };

  // —— 段落反应：同一 emoji 再点一次取消；服务器返回最新计数。
  const react = async (m, emoji) => {
    setReactFor(null);
    try {
      const d = await api(`/theater/${id}/messages/${m.id}/react`, { method: 'POST', body: { emoji } });
      setMessages(ms => ms.map(x => x.id === d.id ? { ...x, reactions: d.reactions } : x));
    } catch (e) { toast(e.message, 'err'); }
  };

  // —— 段落朗读（浏览器 TTS，随点随停）。
  const speakPassage = (m) => {
    const pid = 'th-' + m.id;
    if (speakingId === pid) { stopSpeaking(); return; }
    speakBrowser(m.content, undefined, 1, 1, pid);
  };

  // —— 章节：作者在当前进度处落下一枚章节标记。
  const insertChapter = async () => {
    setMenuOpen(false);
    const title = prompt('新章节标题（例如：第二幕 · 雾中来客）');
    if (!title || !title.trim()) return;
    try { const d = await api('/theater/' + id + '/chapter', { method: 'POST', body: { title: title.trim() } }); push(d.message); toast('已分章'); }
    catch (e) { toast(e.message, 'err'); }
  };

  const copyPassage = async (text) => {
    try { await navigator.clipboard.writeText(text); toast('已复制'); } catch { toast('复制失败', 'err'); }
  };
  const exportAs = (fmt) => {
    setMenuOpen(false);
    const md = fmt === 'md';
    const lines = md ? [`# ${theater.name}`, ''] : [theater.name, ''];
    if (theater.scene) lines.push(md ? `> ${theater.scene}` : theater.scene, '');
    let chapterN = 0;
    for (const m of messages) {
      if (m.sender_type === 'chapter') { chapterN += 1; lines.push(md ? `\n## 第${chapterN}章 ${m.content}\n` : `\n—— 第${chapterN}章 ${m.content} ——\n`); continue; }
      if (m.sender_type === 'narrator') lines.push(m.content, '');
      else if (m.sender_type === 'user' && m.sender_id === user.id) lines.push(md ? `**你：** ${m.content}` : `你：${m.content}`, '');
      else lines.push(md ? `**${m.name}：** ${m.content}` : `${m.name}：${m.content}`, '');
    }
    const blob = new Blob([lines.join('\n')], { type: (md ? 'text/markdown' : 'text/plain') + ';charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `${theater.name || '互动小说'}.${md ? 'md' : 'txt'}`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast(md ? '已导出 Markdown' : '已导出 TXT');
  };

  const saveStage = async () => {
    setSavingStage(true);
    try {
      const d = await api('/theater/' + id, { method: 'PATCH', body: { stage_config: stageConfig, worldbook: novelWb, ...director } });
      if (d.theater?.stage_config) setStageConfig({ charAuto: true, charBg: {}, scenes: [], ...d.theater.stage_config });
      if (Array.isArray(d.theater?.worldbook)) setNovelWb(d.theater.worldbook);
      setDirector({ style: d.theater?.style || '', directive: d.theater?.directive || '', status: d.theater?.status || 'ongoing', bgm: d.theater?.bgm || '' });
      setData(prev => prev ? { ...prev, theater: { ...prev.theater, ...d.theater } } : prev);
      toast('设定已保存');
      setStageOpen(false);
    } catch (e) { toast(e.message, 'err'); } finally { setSavingStage(false); }
  };

  // —— BGM：作者配置了背景音乐 URL 时提供悬浮开关（默认关闭，尊重自动播放策略）。
  const toggleBgm = () => {
    const el = bgmRef.current; if (!el) return;
    if (bgmOn) { el.pause(); setBgmOn(false); }
    else { el.volume = 0.35; el.play().then(() => setBgmOn(true)).catch(() => toast('浏览器阻止了自动播放，请再试一次', 'err')); }
  };

  // 当前舞台背景：按时间顺序折叠每条消息 —— 命中场景关键词→切场景背景；
  // 重要角色（设了背景）发言→切其背景；最近一次触发持续生效，直到下一次触发。
  const stageBg = useMemo(() => {
    const cfg = stageConfig || {};
    const scenes = (cfg.scenes || []).filter(s => s.image && s.keys);
    const charAuto = cfg.charAuto !== false;
    const charBg = cfg.charBg || {};
    const list = data?.cast || [];
    const byId = {};
    list.forEach(c => { byId[c.id] = c; });
    let url = data?.theater?.cover || null, label = null, kind = 'cover';
    for (const msg of messages) {
      const text = (msg.content || '').toLowerCase();
      let hit = false;
      for (const s of scenes) {
        const ks = s.keys.split(/[，,]/).map(k => k.trim().toLowerCase()).filter(Boolean);
        if (ks.some(k => k && text.includes(k))) { url = s.image; label = s.name || '场景'; kind = 'scene'; hit = true; break; }
      }
      if (hit) continue;
      if (charAuto && msg.sender_type === 'ai') {
        const ch = byId[msg.sender_id];
        const cb = charBg[msg.sender_id] || charBg[String(msg.sender_id)] || ch?.background;
        if (cb) { url = cb; label = ch?.name || null; kind = 'char'; }
      }
    }
    return { url, label, kind };
  }, [messages, stageConfig, data]);

  // 章节目录 + 全书统计（字数只计正文段落）。
  const toc = useMemo(() => {
    const chapters = [];
    let chars = 0, passages = 0;
    messages.forEach((m, i) => {
      if (m.sender_type === 'chapter') chapters.push({ id: m.id, title: m.content, index: i, n: chapters.length + 1 });
      else { chars += (m.content || '').length; passages += 1; }
    });
    return { chapters, chars, passages };
  }, [messages]);

  // 首个旁白段落用于首字下沉装饰。
  const firstNarrIdx = useMemo(() => messages.findIndex(m => m.sender_type === 'narrator'), [messages]);

  if (!data) {
    if (appMode) {
      return (
        <main className={'qa-theater-room-loading' + (loadError ? ' is-error' : '')} role={loadError ? 'alert' : 'status'} aria-label={loadError ? '故事载入失败' : '正在翻开故事'}>
          <header className="qa-theater-room-head">
            <AppIconButton label="返回故事书架" onClick={() => nav('/theater')}><ArrowLeft size={21} /></AppIconButton>
            <div className="qa-theater-room-head-title"><b>互动小说</b><span>{loadError ? '载入遇到问题' : '正在翻开书页'}</span></div>
            <span className="qa-theater-room-head-spacer" aria-hidden="true" />
          </header>
          {loadError ? (
            <section className="qa-theater-room-load-error">
              <RefreshCw size={24} aria-hidden="true" />
              <h1>暂时无法翻开这部故事</h1>
              <p>{loadError}</p>
              <AppButton variant="primary" onClick={load}><RefreshCw size={16} /> 重试</AppButton>
            </section>
          ) : (
            <div className="qa-theater-room-loading-body" aria-hidden="true">
              <span className="skel qa-theater-room-loading-kicker" />
              <span className="skel qa-theater-room-loading-title" />
              <span className="skel qa-theater-room-loading-line" />
              <span className="skel qa-theater-room-loading-passage" />
              <span className="skel qa-theater-room-loading-passage is-short" />
            </div>
          )}
        </main>
      );
    }
    return loadError
      ? <div className="empty" style={{ paddingTop: 120 }}>{loadError}<button className="btn" onClick={load}>重试</button></div>
      : <div className="empty" style={{ paddingTop: 120 }}>翻开书页…</div>;
  }
  const { theater, cast } = data;
  const isOwner = user && theater.owner_id === user.id;
  const finished = (director.status || theater.status) === 'finished';
  const lastMsg = messages[messages.length - 1];
  const canRetry = !finished && !!lastMsg && (lastMsg.sender_type === 'ai' || lastMsg.sender_type === 'narrator');
  const actionBusy = !!acting || sending;

  const reactionBar = (m) => {
    const rx = parseReactions(m.reactions);
    const entries = Object.entries(rx).filter(([, arr]) => arr?.length);
    if (!entries.length && reactFor !== m.id) return null;
    return (
      <div className="inovel-rx">
        {entries.map(([e, arr]) => (
          <button key={e} className={'inovel-rx-chip' + (arr.includes(user.id) ? ' on' : '')} onClick={() => react(m, e)}>
            {e} <i>{arr.length}</i>
          </button>
        ))}
      </div>
    );
  };
  const passageActs = (m) => {
    if (appMode) {
      return (
        <div className="inovel-acts qa-theater-passage-actions">
          <AppButton variant="tertiary" size="sm" onClick={() => copyPassage(m.content)}><Copy size={14} /> 复制</AppButton>
          <AppButton variant="tertiary" size="sm" onClick={() => setQuoteShare(m)}><Clapperboard size={14} /> 台词卡</AppButton>
          <AppButton variant="tertiary" size="sm" onClick={() => speakPassage(m)}>
            {speakingId === 'th-' + m.id ? <><Square size={13} /> 停止</> : <><Volume2 size={14} /> 朗读</>}
          </AppButton>
          <span className="inovel-rx-wrap">
            <AppButton variant="tertiary" size="sm" selected={reactFor === m.id} onClick={() => setReactFor(reactFor === m.id ? null : m.id)}><Smile size={14} /> 回应</AppButton>
            {reactFor === m.id && (
              <>
                <span className="react-mask" onClick={() => setReactFor(null)} />
                <span className="react-pop inovel-react-pop qa-theater-reaction-pop" role="menu" aria-label="选择回应">
                  {REACT_EMOJI.map(e => {
                    const rx = parseReactions(m.reactions);
                    return <button key={e} className={(rx[e] || []).includes(user.id) ? 'on' : ''} onClick={() => react(m, e)} aria-label={`回应 ${e}`}>{e}</button>;
                  })}
                </span>
              </>
            )}
          </span>
        </div>
      );
    }

    return (
      <div className="inovel-acts">
        <button onClick={() => copyPassage(m.content)} title="复制本段"><Copy size={12} /> 复制</button>
        <button onClick={() => speakPassage(m)} title={speakingId === 'th-' + m.id ? '停止朗读' : '朗读本段'}>
          {speakingId === 'th-' + m.id ? <><Square size={11} /> 停止</> : <><Volume2 size={12} /> 朗读</>}
        </button>
        <span className="inovel-rx-wrap">
          <button onClick={() => setReactFor(reactFor === m.id ? null : m.id)} title="回应本段"><Smile size={12} /> 回应</button>
          {reactFor === m.id && (
            <>
              <span className="react-mask" onClick={() => setReactFor(null)} />
              <span className="react-pop inovel-react-pop">
                {REACT_EMOJI.map(e => {
                  const rx = parseReactions(m.reactions);
                  return <button key={e} className={(rx[e] || []).includes(user.id) ? 'on' : ''} onClick={() => react(m, e)}>{e}</button>;
                })}
              </span>
            </>
          )}
        </span>
      </div>
    );
  };

  let chapterCounter = 0;

  return (
    <div className={appMode ? 'chat-layout immersive inovel qa-theater-room' : 'chat-layout immersive inovel'}>
      <div className="chat-main">
        <div className="chat-bg inovel-bg" aria-hidden="true">
          {stageBg.url
            ? <img key={stageBg.url} src={assetUrl(stageBg.url)} alt="" className="inovel-bg-img" />
            : <div className="inovel-bg-fallback" />}
        </div>
        {stageBg.label && stageBg.kind !== 'cover' && (
          <div className="inovel-scene-tag" key={stageBg.kind + stageBg.label + stageBg.url}>
            {stageBg.kind === 'scene' ? <ImageIcon size={12} /> : <Feather size={12} />}
            {stageBg.label}
          </div>
        )}

        {/* 菜单的点击遮罩必须挂在 .chat-main 层级（全屏），不能塞进
            .chat-menu-wrap —— wrap 是 38px 按钮的相对定位容器，inset:0 的
            遮罩会缩成按钮大小的一块，APP 壳的 blur(6px) 让它变成盖在按钮上
            的「方形模糊块」（实机 bug）。 */}
        {!appMode && menuOpen && <div className="chat-menu-mask" onClick={() => setMenuOpen(false)} />}

        {appMode ? (
          <header className="qa-theater-room-head">
            <AppIconButton label="返回故事书架" onClick={() => nav('/theater')}><ArrowLeft size={21} /></AppIconButton>
            <div className="qa-theater-room-head-title">
              <b>{theater.name}</b>
              <span>{finished ? '已完结' : sending ? '正在发送你的行动' : acting ? `${acting}正在续写` : '互动阅读'}</span>
            </div>
            <div className="qa-theater-room-head-actions">
              <AppIconButton label="打开目录" selected={tocOpen} pressed={tocOpen} onClick={() => { setTocOpen(true); setShowMembers(false); setMenuOpen(false); }}><List size={20} /></AppIconButton>
              <AppIconButton label="查看读者" selected={showMembers} pressed={showMembers} onClick={() => { setShowMembers(true); setTocOpen(false); setMenuOpen(false); }}><Users size={20} /></AppIconButton>
              <AppIconButton label="更多阅读设置" selected={menuOpen} pressed={menuOpen} onClick={() => { setMenuOpen(true); setTocOpen(false); setShowMembers(false); }}><MoreVertical size={20} /></AppIconButton>
            </div>
          </header>
        ) : (
          /* 取消整条标题栏：功能键悬浮成独立 UI，阅读区直通到顶，空间更宽阔。标题已在封面区呈现。 */
          <div className="inovel-topbar">
            <button className="inovel-fab" onClick={() => nav('/theater')} title="返回"><ArrowLeft size={17} /></button>
            <div className="inovel-topbar-actions">
              {theater.bgm && (
                <button className={'inovel-fab' + (bgmOn ? ' on' : '')} onClick={toggleBgm} title={bgmOn ? '关闭背景音乐' : '播放背景音乐'}>
                  <Music size={16} />
                </button>
              )}
              <button className={'inovel-fab' + (tocOpen ? ' on' : '')} onClick={() => setTocOpen(o => !o)} title="目录"><List size={16} /></button>
              <button className={'inovel-fab' + (autoFlow ? ' on' : '')} onClick={toggleAuto} title={autoFlow ? '自动续写：开' : '自动续写：关'}>
                {autoFlow ? <Zap size={16} /> : <ZapOff size={16} />}
              </button>
              <div className="chat-menu-wrap">
                <button className={'inovel-fab' + (menuOpen ? ' on' : '')} onClick={() => setMenuOpen(o => !o)} title="更多"><MoreVertical size={17} /></button>
                {menuOpen && (
                  <>
                    <div className="chat-menu">
                      <div className="chat-menu-row"><span><Type size={15} /> 字号</span>
                        <div className="seg seg-mini">
                          {[['sm', '小'], ['md', '中'], ['lg', '大']].map(([v, l]) => (
                            <button key={v} className={fontSize === v ? 'active' : ''} onClick={() => setFont(v)}>{l}</button>
                          ))}
                        </div>
                      </div>
                      <button onClick={toggleSerif}><Feather size={15} /> 衬线字体 <span className={'chat-menu-toggle' + (serif ? ' on' : '')}>{serif ? '已开启' : '已关闭'}</span></button>
                      <div className="chat-menu-sep" />
                      <button onClick={() => { setShowMembers(v => !v); setMenuOpen(false); }}><Users size={15} /> 读者列表（{data.members.length}）</button>
                      {isOwner && !finished && <button onClick={insertChapter}><BookmarkPlus size={15} /> 插入章节分隔</button>}
                      <button onClick={() => exportAs('md')}><Download size={15} /> 导出为 Markdown</button>
                      <button onClick={() => exportAs('txt')}><Download size={15} /> 导出为 TXT</button>
                      {isOwner && <button onClick={() => { setStageOpen(true); setStageTab('director'); setMenuOpen(false); }}><Clapperboard size={15} /> 导演台 · 舞台设定</button>}
                      <div className="chat-menu-sep" />
                      {isOwner
                        ? <button className="danger" onClick={removeWork}><Trash2 size={15} /> 删除整部作品</button>
                        : <button className="danger" onClick={leave}><LogOut size={15} /> 离开故事</button>}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
        {!appMode && showMembers && (
          <>
            <div className="chat-menu-mask" onClick={() => setShowMembers(false)} />
            <div className="inovel-members">
              <div className="inovel-members-hd"><Users size={13} /> 读者（{data.members.length}）</div>
              {data.members.map((mb, i) => (
                <div key={i} className="gm-row">
                  <Avatar src={mb.avatar} name={mb.display_name} size={28} />
                  <span>{mb.display_name || '读者'}</span>
                  {mb.id === theater.owner_id && <span className="gm-owner">作者</span>}
                </div>
              ))}
            </div>
          </>
        )}

        {/* —— 目录抽屉：章节导航 + 全书统计 —— */}
        {!appMode && tocOpen && (
          <>
            <div className="chat-menu-mask" onClick={() => setTocOpen(false)} />
            <div className="inovel-toc">
              <div className="inovel-toc-hd">
                <List size={14} /> 目录
                <button className="inovel-toc-x" onClick={() => setTocOpen(false)}><X size={15} /></button>
              </div>
              <div className="inovel-toc-stats">
                {toc.chapters.length > 0 && <span>{toc.chapters.length + 1} 卷章</span>}
                <span>{toc.passages} 段</span>
                <span>{toc.chars >= 10000 ? (toc.chars / 10000).toFixed(1) + ' 万' : toc.chars} 字</span>
                {finished && <span className="inovel-toc-fin"><Flag size={11} /> 已完结</span>}
              </div>
              <button className="inovel-toc-item" onClick={() => { setTocOpen(false); scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' }); }}>
                <i>序</i> 序章{theater.scene ? ' · ' + theater.scene.slice(0, 14) : ''}
              </button>
              {toc.chapters.map(c => (
                <button key={c.id} className="inovel-toc-item" onClick={() => {
                  setTocOpen(false);
                  document.getElementById('pass-' + c.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}>
                  <i>{c.n}</i> {c.title}
                </button>
              ))}
              {toc.chapters.length === 0 && <div className="inovel-toc-empty">尚未分章{isOwner ? ' —— 可在菜单里「插入章节分隔」' : ''}</div>}
            </div>
          </>
        )}

        {appMode && tocOpen && (
          <Modal onClose={() => setTocOpen(false)} className="qa-theater-sheet qa-theater-toc-sheet" backdropClassName="qa-theater-sheet-backdrop">
            <header className="qa-theater-sheet-head">
              <div><span><List size={14} /> 阅读导航</span><h2>目录</h2></div>
              <AppIconButton label="关闭目录" onClick={() => setTocOpen(false)}><X size={20} /></AppIconButton>
            </header>
            <div className="qa-theater-toc-stats">
              {toc.chapters.length > 0 && <span>{toc.chapters.length + 1} 卷章</span>}
              <span>{toc.passages} 段</span>
              <span>{toc.chars >= 10000 ? (toc.chars / 10000).toFixed(1) + ' 万' : toc.chars} 字</span>
              {finished && <span className="is-finished"><Flag size={12} /> 已完结</span>}
            </div>
            <nav className="qa-theater-toc-list" aria-label="章节目录">
              <AppButton variant="tertiary" onClick={() => { setTocOpen(false); scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' }); }}>
                <i>序</i><span>序章{theater.scene ? ' · ' + theater.scene.slice(0, 14) : ''}</span><ChevronRight size={17} />
              </AppButton>
              {toc.chapters.map(chapter => (
                <AppButton key={chapter.id} variant="tertiary" onClick={() => {
                  setTocOpen(false);
                  document.getElementById('pass-' + chapter.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}>
                  <i>{chapter.n}</i><span>{chapter.title}</span><ChevronRight size={17} />
                </AppButton>
              ))}
              {toc.chapters.length === 0 && <p className="qa-theater-sheet-empty">尚未分章{isOwner ? '，可从更多菜单插入章节。' : '。'}</p>}
            </nav>
          </Modal>
        )}

        {appMode && showMembers && (
          <Modal onClose={() => setShowMembers(false)} className="qa-theater-sheet qa-theater-members-sheet" backdropClassName="qa-theater-sheet-backdrop">
            <header className="qa-theater-sheet-head">
              <div><span><Users size={14} /> 共读</span><h2>读者 · {data.members.length}</h2></div>
              <AppIconButton label="关闭读者列表" onClick={() => setShowMembers(false)}><X size={20} /></AppIconButton>
            </header>
            <div className="qa-theater-members-list">
              {data.members.map((member, index) => (
                <div className="qa-theater-member" key={member.id || index}>
                  <Avatar src={member.avatar} name={member.display_name} size={40} />
                  <span>{member.display_name || '读者'}</span>
                  {member.id === theater.owner_id && <small>作者</small>}
                </div>
              ))}
              {data.members.length === 0 && <p className="qa-theater-sheet-empty">暂时没有其他读者。</p>}
            </div>
          </Modal>
        )}

        {appMode && menuOpen && (
          <Modal onClose={() => setMenuOpen(false)} className="qa-theater-sheet qa-theater-more-sheet" backdropClassName="qa-theater-sheet-backdrop">
            <header className="qa-theater-sheet-head">
              <div><span><MoreVertical size={14} /> 阅读工具</span><h2>更多</h2></div>
              <AppIconButton label="关闭更多设置" onClick={() => setMenuOpen(false)}><X size={20} /></AppIconButton>
            </header>

            <section className="qa-theater-setting-group" aria-labelledby="qa-theater-font-setting">
              <div className="qa-theater-setting-label" id="qa-theater-font-setting"><Type size={17} /> 正文字号</div>
              <div className="qa-theater-font-segment" role="group" aria-label="正文字号">
                {[['sm', '小'], ['md', '中'], ['lg', '大']].map(([value, label]) => (
                  <AppButton key={value} variant="tertiary" selected={fontSize === value} pressed={fontSize === value} onClick={() => setFont(value)}>{label}</AppButton>
                ))}
              </div>
              <AppButton className="qa-theater-setting-row" variant="tertiary" selected={serif} pressed={serif} onClick={toggleSerif}>
                <Feather size={18} /><span>衬线字体</span><small>{serif ? '已开启' : '已关闭'}</small>
              </AppButton>
              <AppButton className="qa-theater-setting-row" variant="tertiary" selected={autoFlow} pressed={autoFlow} onClick={toggleAuto}>
                {autoFlow ? <Zap size={18} /> : <ZapOff size={18} />}<span>行动后自动续写</span><small>{autoFlow ? '已开启' : '已关闭'}</small>
              </AppButton>
              {theater.bgm && (
                <AppButton className="qa-theater-setting-row" variant="tertiary" selected={bgmOn} pressed={bgmOn} onClick={toggleBgm}>
                  <Music size={18} /><span>背景音乐</span><small>{bgmOn ? '播放中' : '已关闭'}</small>
                </AppButton>
              )}
            </section>

            <section className="qa-theater-tool-list" aria-label="作品工具">
              {isOwner && !finished && <AppButton variant="secondary" onClick={insertChapter}><BookmarkPlus size={18} /> 插入章节分隔</AppButton>}
              <AppButton variant="secondary" onClick={() => exportAs('md')}><Download size={18} /> 导出 Markdown</AppButton>
              <AppButton variant="secondary" onClick={() => exportAs('txt')}><Download size={18} /> 导出 TXT</AppButton>
              {isOwner && <AppButton variant="secondary" onClick={() => { setStageOpen(true); setStageTab('director'); setMenuOpen(false); }}><Clapperboard size={18} /> 导演台与舞台设定</AppButton>}
              {isOwner
                ? <AppButton variant="danger" tone="danger" onClick={removeWork}><Trash2 size={18} /> 删除整部作品</AppButton>
                : <AppButton variant="danger" tone="danger" onClick={leave}><LogOut size={18} /> 离开故事</AppButton>}
            </section>
          </Modal>
        )}

        <div className="chat-scroll inovel-scroll" ref={scrollRef} onScroll={onScroll}>
          <div className={'inovel-book font-' + fontSize + (serif ? ' serif' : ' sans')}>
            <div className="inovel-cover-block">
              <div className="inovel-kicker"><Feather size={13} /> 互动小说{theater.style ? <span className="inovel-style-tag">{theater.style}</span> : null}{finished && <span className="inovel-fin-tag"><Flag size={10} /> 完结</span>}</div>
              <h1 className="inovel-title">{theater.name}</h1>
              {theater.scene && <p className="inovel-logline">{theater.scene}</p>}
              <div className="inovel-cast-strip">
                {cast.map(c => (
                  <span key={c.id} className="inovel-cast-tag"><Avatar src={c.avatar} name={c.name} size={20} /> {c.name}</span>
                ))}
              </div>
              <div className="inovel-rule"><span>序章</span></div>
            </div>

            {messages.map((m, i) => {
              const isChapter = m.sender_type === 'chapter';
              if (isChapter) {
                chapterCounter += 1;
                return (
                  <div key={m.id || i} id={'pass-' + m.id} className="inovel-chapter">
                    <div className="inovel-chapter-rule" />
                    <div className="inovel-chapter-no">第 {chapterCounter} 章</div>
                    <h2 className="inovel-chapter-title">{m.content}</h2>
                    <div className="inovel-chapter-rule bottom" />
                  </div>
                );
              }
              if (m.sender_type === 'narrator') {
                return (
                  <div key={m.id || i} id={'pass-' + m.id} className="inovel-passage inovel-narr-wrap">
                    <p className={'inovel-narr' + (i === firstNarrIdx ? ' dropcap' : '')}>{m.content}</p>
                    {reactionBar(m)}
                    {passageActs(m)}
                  </div>
                );
              }
              const mine = m.sender_type === 'user' && m.sender_id === user.id;
              if (mine) {
                return (
                  <div key={m.id || i} id={'pass-' + m.id} className="inovel-passage inovel-me">
                    <span className="inovel-me-tag">你</span>
                    <p>{m.content}</p>
                    {reactionBar(m)}
                  </div>
                );
              }
              return (
                <div key={m.id || i} id={'pass-' + m.id} className="inovel-passage inovel-dlg">
                  <Avatar src={m.avatar} name={m.name} size={34} />
                  <div className="inovel-dlg-body">
                    <div className="inovel-who">{m.name}{m.sender_type === 'ai' && <span className="inovel-ai-tag">AI</span>}</div>
                    <div className="inovel-say">{m.content}</div>
                    {reactionBar(m)}
                    {passageActs(m)}
                  </div>
                </div>
              );
            })}
            {acting && (
              <div className="inovel-passage inovel-writing">
                <Feather size={14} className="inovel-quill" /> <span>{acting === '旁白' ? '旁白正在续写…' : acting === '重写' ? '正在重写…' : `${acting} 正在斟酌台词…`}</span>
                <span className="typing"><span></span><span></span><span></span></span>
              </div>
            )}
            {finished && (
              <div className="inovel-fin">
                <div className="inovel-rule"><span>全书完</span></div>
                <p className="inovel-fin-note">感谢阅读 · 共 {toc.passages} 段 · {toc.chars >= 10000 ? (toc.chars / 10000).toFixed(1) + ' 万' : toc.chars} 字</p>
                <button className="btn sm ghost" onClick={() => exportAs('md')}><Download size={13} /> 收藏为 Markdown</button>
              </div>
            )}
            <div className="inovel-foot-space" aria-hidden="true" />
          </div>
        </div>

        {!atBottom && (
          <button className="inovel-jump" onClick={() => { stick(); scrollToBottom(); }} title="回到最新" aria-label="回到最新"><ArrowDown size={18} /></button>
        )}

        {theater.bgm && <audio ref={bgmRef} src={assetUrl(theater.bgm)} loop preload="none" />}

        {!finished && (appMode ? (
          <div className="chat-input-bar inovel-bar qa-theater-composer" ref={barRef}>
            {choices && (
              <section className="qa-theater-choice-panel" aria-labelledby="qa-theater-choice-title">
                <header>
                  <span id="qa-theater-choice-title"><Wand2 size={15} /> 命运抉择</span>
                  <AppIconButton label="收起命运抉择" onClick={() => setChoices(null)}><X size={18} /></AppIconButton>
                </header>
                {choices === 'loading'
                  ? <div className="qa-theater-choice-loading">正在编织新的可能…</div>
                  : (
                    <div className="qa-theater-choice-list">
                      {choices.map((choice, index) => (
                        <AppButton key={index} variant="tertiary" onClick={() => pickChoice(choice)}>
                          <i>{['壹', '贰', '叁'][index] || index + 1}</i><span>{choice}</span><ChevronRight size={17} />
                        </AppButton>
                      ))}
                      <AppButton variant="secondary" onClick={fetchChoices}><RefreshCw size={15} /> 换一批命运</AppButton>
                    </div>
                  )}
              </section>
            )}

            {/* 平台兜底计费披露：多人共读时谁点续写谁付费，必须常驻明示（自带 key 用户不显示，零扣费） */}
            {data?.llm?.platform && (
              <div className="inovel-billing" role="note">
                <CoinIcon size={11} /> 平台模型续写 · 每段约 {data.llm.fee} 金币 · 谁触发谁付费，失败自动退款
              </div>
            )}
            <div className="qa-theater-quick-actions" aria-label="续写操作">
              <AppButton variant="primary" disabled={actionBusy} onClick={() => advance(undefined, '旁白')}><Sparkles size={16} /> 推进剧情</AppButton>
              <AppButton variant="tertiary" selected={Boolean(choices)} disabled={actionBusy} onClick={() => choices ? setChoices(null) : fetchChoices()}><Wand2 size={16} /> 命运抉择</AppButton>
              {cast.map(character => (
                <AppButton key={character.id} variant="tertiary" disabled={actionBusy} onClick={() => advance({ character_id: character.id }, character.name)}>
                  <Avatar src={character.avatar} name={character.name} size={22} /> {character.name}
                </AppButton>
              ))}
              {cast.length > 1 && <AppButton variant="tertiary" disabled={actionBusy} onClick={randomCharacter}><Shuffle size={16} /> 随机</AppButton>}
              {canRetry && <AppButton variant="tertiary" disabled={actionBusy} onClick={retry}><RotateCcw size={16} /> 重写</AppButton>}
            </div>

            <div className="qa-theater-action-hints" aria-label="行动建议">
              {ACTION_HINTS.map(hint => (
                <AppButton key={hint} variant="tertiary" size="sm" disabled={actionBusy} onClick={() => say(hint)}>{hint}</AppButton>
              ))}
            </div>

            <div className="qa-theater-input-island">
              <textarea rows={1} value={input} placeholder="写下你的行动或台词…" aria-label="行动或台词"
                enterKeyHint="send" autoCapitalize="sentences" autoCorrect="on" spellCheck={false}
                onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); say(); } }} />
              <AppIconButton label="发送行动或台词" variant="filled" loading={sending} onClick={() => say()} disabled={!input.trim() || actionBusy}><Send size={19} /></AppIconButton>
            </div>
          </div>
        ) : (
          <div className="chat-input-bar inovel-bar" ref={barRef}>
            {/* —— 命运抉择面板 —— */}
            {choices && (
              <div className="inovel-choicepanel">
                <div className="inovel-choicepanel-hd">
                  <Wand2 size={13} /> 命运抉择
                  <button className="inovel-toc-x" onClick={() => setChoices(null)} title="收起"><X size={14} /></button>
                </div>
                {choices === 'loading'
                  ? <div className="inovel-choice-loading">命运的丝线正在编织<span className="typing"><span></span><span></span><span></span></span></div>
                  : (
                    <>
                      {choices.map((c, i) => (
                        <button key={i} className="inovel-choice" onClick={() => pickChoice(c)}>
                          <i>{['壹', '贰', '叁'][i] || i + 1}</i> {c}
                        </button>
                      ))}
                      <button className="inovel-choice-again" onClick={fetchChoices}><RefreshCw size={12} /> 换一批命运</button>
                    </>
                  )}
              </div>
            )}
            {data?.llm?.platform && (
              <div className="inovel-billing" role="note">
                <CoinIcon size={11} /> 平台模型续写 · 每段约 {data.llm.fee} 金币 · 谁触发谁付费，失败自动退款
              </div>
            )}
            <div className="inovel-choices">
              <button className="inovel-chip primary" disabled={actionBusy} onClick={() => advance(undefined, '旁白')}>
                <Sparkles size={13} /> 推进剧情
              </button>
              <button className={'inovel-chip fate' + (choices ? ' on' : '')} disabled={actionBusy} onClick={() => choices ? setChoices(null) : fetchChoices()} title="AI 生成三个候选行动">
                <Wand2 size={13} /> 命运抉择
              </button>
              {cast.map(c => (
                <button key={c.id} className="inovel-chip" disabled={actionBusy} onClick={() => advance({ character_id: c.id }, c.name)}>
                  <Avatar src={c.avatar} name={c.name} size={18} /> {c.name}
                </button>
              ))}
              {cast.length > 1 && (
                <button className="inovel-chip" disabled={actionBusy} onClick={randomCharacter} title="随机一位角色接话"><Shuffle size={13} /> 随机</button>
              )}
              {canRetry && (
                <button className="inovel-chip" disabled={actionBusy} onClick={retry} title="重写最近一段"><RotateCcw size={13} /> 重写</button>
              )}
            </div>
            <div className="inovel-hints">
              {ACTION_HINTS.map(h => (
                <button key={h} className="inovel-hint" disabled={actionBusy} onClick={() => say(h)}><ChevronRight size={11} /> {h}</button>
              ))}
            </div>
            <div className="box">
              <textarea rows={1} value={input} placeholder="写下你的行动或台词，让故事继续…"
                enterKeyHint="send" autoCapitalize="sentences" autoCorrect="on" spellCheck={false}
                onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); say(); } }} />
              <button className="send-btn" onClick={() => say()} disabled={!input.trim()}><Send size={17} /></button>
            </div>
          </div>
        ))}

        {finished && (appMode ? (
          <div className="chat-input-bar inovel-bar inovel-bar-fin qa-theater-finished-bar" ref={barRef}>
            <span><Flag size={16} /> 本作已完结</span>
            {isOwner && <AppButton variant="secondary" onClick={() => { setStageOpen(true); setStageTab('director'); }}>重新开启连载</AppButton>}
          </div>
        ) : (
          <div className="chat-input-bar inovel-bar inovel-bar-fin" ref={barRef}>
            <div className="inovel-fin-bar">
              <Flag size={14} /> 本作已完结
              {isOwner && <button className="btn sm ghost" onClick={() => { setStageOpen(true); setStageTab('director'); }}>重新开启连载</button>}
            </div>
          </div>
        ))}
      </div>

      {stageOpen && (
        <Modal onClose={() => setStageOpen(false)}>
          <h2 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}><Clapperboard size={18} /> 导演台</h2>
          <div className="seg" style={{ marginBottom: 14 }}>
            <button className={stageTab === 'director' ? 'active' : ''} onClick={() => setStageTab('director')}>导演</button>
            <button className={stageTab === 'stage' ? 'active' : ''} onClick={() => setStageTab('stage')}>舞台背景</button>
            <button className={stageTab === 'world' ? 'active' : ''} onClick={() => setStageTab('world')}>专属世界书</button>
          </div>

          {stageTab === 'director' && (
            <div className="inovel-director">
              <div className="field">
                <label>文风基调 <span className="muted">（影响旁白与全体角色的行文）</span></label>
                <div className="inovel-style-row">
                  {STYLE_PRESETS.map(s => (
                    <button key={s} type="button" className={'inovel-style-chip' + (director.style === s ? ' on' : '')}
                      onClick={() => setDirector(d => ({ ...d, style: d.style === s ? '' : s }))}>{s}</button>
                  ))}
                </div>
                <input className="input" style={{ marginTop: 8 }} placeholder="或自定义文风，例如「克苏鲁式的潮湿阴冷」" maxLength={30}
                  value={director.style} onChange={e => setDirector(d => ({ ...d, style: e.target.value }))} />
              </div>
              <div className="field">
                <label>导演密令 <span className="muted">（读者不可见 · 旁白暗中遵循，可随剧情随时改写）</span></label>
                <textarea className="textarea" rows={3} maxLength={1000}
                  placeholder="例如：让神秘商人在三段内登场；把剧情引向古井；本章结尾埋一个背叛伏笔…"
                  value={director.directive} onChange={e => setDirector(d => ({ ...d, directive: e.target.value }))} />
              </div>
              <div className="field">
                <label>背景音乐 URL <span className="muted">（可选 · 读者可在顶栏开关）</span></label>
                <input className="input" placeholder="https://…/ambience.mp3" maxLength={500}
                  value={director.bgm} onChange={e => setDirector(d => ({ ...d, bgm: e.target.value }))} />
              </div>
              <div className="field">
                <label>连载状态</label>
                <div className="row" style={{ alignItems: 'center', gap: 10 }}>
                  <button type="button" className={'btn sm ' + (director.status !== 'finished' ? 'primary' : 'ghost')}
                    onClick={() => setDirector(d => ({ ...d, status: 'ongoing' }))}><Feather size={13} /> 连载中</button>
                  <button type="button" className={'btn sm ' + (director.status === 'finished' ? 'primary' : 'ghost')}
                    onClick={() => setDirector(d => ({ ...d, status: 'finished' }))}><Flag size={13} /> 宣告完结</button>
                  <span className="muted" style={{ fontSize: 12 }}>完结后正文封笔，读者仍可阅读、回应与导出</span>
                </div>
              </div>
            </div>
          )}

          {stageTab === 'stage' && (
            <>
              <p className="muted" style={{ marginTop: -4, fontSize: 13 }}>背景改动即时预览；点「保存」后对所有读者生效。</p>
              <StageEditor cast={cast} value={stageConfig} onChange={setStageConfig} />
            </>
          )}

          {stageTab === 'world' && (
            <>
              <div className="stage-sec-title"><BookOpen size={13} /> 互动小说专属世界书</div>
              <NovelWorldEditor value={novelWb} onChange={setNovelWb} />
            </>
          )}

          <div className="row" style={{ marginTop: 16 }}>
            <button className="btn block" onClick={() => setStageOpen(false)}>关闭</button>
            <button className="btn primary block" onClick={saveStage} disabled={savingStage}>{savingStage ? '保存中…' : '保存设定'}</button>
          </div>
        </Modal>
      )}
      {appMode && quoteShare && (
        <ShareCardSheet
          kind="quote"
          payload={{
            text: (quoteShare.content || '').replace(/\*+/g, '').trim(),
            speaker: quoteShare.sender_type === 'narrator' ? '旁白' : (quoteShare.name || '角色'),
            avatar: quoteShare.avatar ? assetUrl(quoteShare.avatar) : '',
            date: cnToday(),
            path: '/theater/' + id,
          }}
          onClose={() => setQuoteShare(null)}
        />
      )}
    </div>
  );
}
