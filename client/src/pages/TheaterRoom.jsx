import React, { useEffect, useRef, useState, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, useAuth } from '../api.jsx';
import { useToast, Avatar, Modal } from '../ui.jsx';
import { useKeyboardInsetBar } from '../mobile.js';
import StageEditor from '../components/StageEditor.jsx';
import NovelWorldEditor from '../components/NovelWorldEditor.jsx';
import { Send, Sparkles, ArrowLeft, Feather, Users, LogOut, BookOpen, Zap, ZapOff, ChevronRight,
  Palette, Image as ImageIcon, MoreVertical, RotateCcw, Copy, Download, Type, Shuffle, ArrowDown } from 'lucide-react';

// 互动小说阅读器：以你为主角的即兴叙事。你写下行动 / 台词，旁白续写后果，
// 也可点登场角色让其接话。整体按「小说阅读」体验打造 —— 旁白为文学化散文、
// 角色对白带署名、玩家行动单独成段、段落淡入；支持重写、随机接话、导出、
// 自动续写，以及字号 / 字体的阅读排版设置。后端沿用 /theater 既有接口。

const ACTION_HINTS = ['环顾四周', '继续向前', '开口询问', '保持沉默', '回忆起什么', '伸手触碰'];
const FONT_KEY = 'inovel_font', SERIF_KEY = 'inovel_serif';

export default function TheaterRoom() {
  const { id } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [acting, setActing] = useState(false);
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
  const [savingStage, setSavingStage] = useState(false);
  const scrollRef = useRef();
  const barRef = useRef();
  const lastId = useRef(0);
  const atBottomRef = useRef(true);

  // 移动端软键盘适配：输入栏顶在键盘上方（与对话页同一套稳健实现）。
  useKeyboardInsetBar(barRef, [id]);

  const leave = async () => {
    setMenuOpen(false);
    if (!confirm('确定离开这部互动小说？')) return;
    try { await api('/theater/' + id + '/leave', { method: 'POST' }); toast('已离开'); nav('/theater'); }
    catch (e) { toast(e.message, 'err'); }
  };

  const load = async () => {
    try {
      const d = await api('/theater/' + id);
      setData(d);
      setMessages(d.messages);
      if (d.theater?.stage_config) setStageConfig({ charAuto: true, charBg: {}, scenes: [], ...d.theater.stage_config });
      if (Array.isArray(d.theater?.worldbook)) setNovelWb(d.theater.worldbook);
      lastId.current = d.messages.length ? d.messages[d.messages.length - 1].id : 0;
      if (!d.joined) api('/theater/' + id + '/join', { method: 'POST' }).catch(() => {});
    } catch (e) { toast(e.message, 'err'); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  // 轮询其他读者 / AI 贡献的新段落
  useEffect(() => {
    const t = setInterval(async () => {
      try {
        const d = await api('/theater/' + id + '/messages?after=' + lastId.current);
        if (d.messages.length) {
          setMessages(m => [...m, ...d.messages.filter(x => x.id > lastId.current)]);
          lastId.current = d.messages[d.messages.length - 1].id;
        }
      } catch { /* */ }
    }, 4000);
    return () => clearInterval(t);
  }, [id]);

  // 智能跟随：仅当读者已在底部附近时自动滚到最新，避免回看历史被强行拉走。
  const scrollToBottom = (behavior = 'smooth') => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior });
  useEffect(() => { atBottomRef.current = atBottom; }, [atBottom]);
  useEffect(() => { if (atBottomRef.current) scrollToBottom(); }, [messages, acting]);
  const onScroll = () => {
    const el = scrollRef.current; if (!el) return;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 120);
  };
  const stick = () => { atBottomRef.current = true; setAtBottom(true); };

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

  // 让旁白 / 某个角色续写一段。
  const advance = async (body, label) => {
    if (acting) return;
    stick(); setActing(label || '旁白');
    try { const d = await api('/theater/' + id + '/act', { method: 'POST', body: body || { narrator: true } }); push(d.message); }
    catch (e) { toast(e.message, 'err'); } finally { setActing(false); }
  };
  // 随机挑一位登场角色接话，制造意外。
  const randomCharacter = () => {
    if (!cast.length || acting) return;
    const c = cast[Math.floor(Math.random() * cast.length)];
    advance({ character_id: c.id }, c.name);
  };
  // 重写最近一段 AI 续写（不满意时换一种写法）。
  const retry = async () => {
    if (acting) return;
    stick(); setActing('重写');
    try {
      const d = await api('/theater/' + id + '/retry', { method: 'POST', body: {} });
      setMessages(m => [...m.filter(x => x.id !== d.removedId), d.message]);
      lastId.current = Math.max(lastId.current, d.message.id);
    } catch (e) { toast(e.message, 'err'); } finally { setActing(false); }
  };

  // 你写下一段行动 / 台词；可选地自动让旁白续写后果，形成「行动 → 后果」的互动循环。
  const say = async (textArg) => {
    const content = (textArg ?? input).trim();
    if (!content || acting) return;
    if (textArg == null) setInput('');
    stick();
    try {
      const d = await api('/theater/' + id + '/say', { method: 'POST', body: { content } });
      push(d.message);
      if (autoFlow) setTimeout(() => advance(undefined, '旁白'), 120);
    } catch (e) { toast(e.message, 'err'); }
  };

  const copyPassage = async (text) => {
    try { await navigator.clipboard.writeText(text); toast('已复制'); } catch { toast('复制失败', 'err'); }
  };
  const exportMd = () => {
    setMenuOpen(false);
    const lines = [`# ${theater.name}`, ''];
    if (theater.scene) lines.push(`> ${theater.scene}`, '');
    for (const m of messages) {
      if (m.sender_type === 'narrator') lines.push(m.content, '');
      else if (m.sender_type === 'user' && m.sender_id === user.id) lines.push(`**你：** ${m.content}`, '');
      else lines.push(`**${m.name}：** ${m.content}`, '');
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `${theater.name || '互动小说'}.md`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('已导出 Markdown');
  };

  const saveStage = async () => {
    setSavingStage(true);
    try {
      const d = await api('/theater/' + id, { method: 'PATCH', body: { stage_config: stageConfig, worldbook: novelWb } });
      if (d.theater?.stage_config) setStageConfig({ charAuto: true, charBg: {}, scenes: [], ...d.theater.stage_config });
      if (Array.isArray(d.theater?.worldbook)) setNovelWb(d.theater.worldbook);
      setData(prev => prev ? { ...prev, theater: { ...prev.theater, ...d.theater } } : prev);
      toast('舞台与世界书已保存');
      setStageOpen(false);
    } catch (e) { toast(e.message, 'err'); } finally { setSavingStage(false); }
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

  // 首个旁白段落用于首字下沉装饰。
  const firstNarrIdx = useMemo(() => messages.findIndex(m => m.sender_type === 'narrator'), [messages]);

  if (!data) return <div className="empty" style={{ paddingTop: 120 }}>翻开书页…</div>;
  const { theater, cast } = data;
  const isOwner = user && theater.owner_id === user.id;
  const passages = messages.length;
  const lastMsg = messages[messages.length - 1];
  const canRetry = !!lastMsg && (lastMsg.sender_type === 'ai' || lastMsg.sender_type === 'narrator');

  const passageActs = (m) => (
    <div className="inovel-acts">
      <button onClick={() => copyPassage(m.content)} title="复制本段"><Copy size={12} /> 复制</button>
    </div>
  );

  return (
    <div className="chat-layout immersive inovel">
      <div className="chat-main">
        <div className="chat-bg inovel-bg" aria-hidden="true">
          {stageBg.url
            ? <img key={stageBg.url} src={stageBg.url} alt="" className="inovel-bg-img" />
            : <div className="inovel-bg-fallback" />}
        </div>
        {stageBg.label && stageBg.kind !== 'cover' && (
          <div className="inovel-scene-tag" key={stageBg.kind + stageBg.label + stageBg.url}>
            {stageBg.kind === 'scene' ? <ImageIcon size={12} /> : <Feather size={12} />}
            {stageBg.label}
          </div>
        )}

        {/* 取消整条标题栏：功能键悬浮成独立 UI，阅读区直通到顶，空间更宽阔。标题已在封面区呈现。 */}
        <div className="inovel-topbar">
          <button className="inovel-fab" onClick={() => nav('/theater')} title="返回"><ArrowLeft size={17} /></button>
          <div className="inovel-topbar-actions">
            <button className={'inovel-fab' + (autoFlow ? ' on' : '')} onClick={toggleAuto} title={autoFlow ? '自动续写：开' : '自动续写：关'}>
              {autoFlow ? <Zap size={16} /> : <ZapOff size={16} />}
            </button>
            <div className="chat-menu-wrap">
              <button className={'inovel-fab' + (menuOpen ? ' on' : '')} onClick={() => setMenuOpen(o => !o)} title="更多"><MoreVertical size={17} /></button>
              {menuOpen && (
                <>
                  <div className="chat-menu-mask" onClick={() => setMenuOpen(false)} />
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
                    <button onClick={exportMd}><Download size={15} /> 导出为 Markdown</button>
                    {isOwner && <button onClick={() => { setStageOpen(true); setMenuOpen(false); }}><Palette size={15} /> 舞台 · 世界书设定</button>}
                    <div className="chat-menu-sep" />
                    <button className="danger" onClick={leave}><LogOut size={15} /> 离开故事</button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
        {showMembers && (
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

        <div className="chat-scroll inovel-scroll" ref={scrollRef} onScroll={onScroll}>
          <div className={'inovel-book font-' + fontSize + (serif ? ' serif' : ' sans')}>
            <div className="inovel-cover-block">
              <div className="inovel-kicker"><Feather size={13} /> 互动小说</div>
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
              const isLast = i === messages.length - 1;
              if (m.sender_type === 'narrator') {
                return (
                  <div key={m.id || i} className="inovel-passage inovel-narr-wrap">
                    <p className={'inovel-narr' + (i === firstNarrIdx ? ' dropcap' : '')}>{m.content}</p>
                    {passageActs(m)}
                  </div>
                );
              }
              const mine = m.sender_type === 'user' && m.sender_id === user.id;
              if (mine) {
                return (
                  <div key={m.id || i} className="inovel-passage inovel-me">
                    <span className="inovel-me-tag">你</span>
                    <p>{m.content}</p>
                  </div>
                );
              }
              return (
                <div key={m.id || i} className="inovel-passage inovel-dlg">
                  <Avatar src={m.avatar} name={m.name} size={34} />
                  <div className="inovel-dlg-body">
                    <div className="inovel-who">{m.name}{m.sender_type === 'ai' && <span className="inovel-ai-tag">AI</span>}</div>
                    <div className="inovel-say">{m.content}</div>
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
            <div className="inovel-foot-space" aria-hidden="true" />
          </div>
        </div>

        {!atBottom && (
          <button className="inovel-jump" onClick={() => { stick(); scrollToBottom(); }} title="回到最新" aria-label="回到最新"><ArrowDown size={18} /></button>
        )}

        <div className="chat-input-bar inovel-bar" ref={barRef}>
          <div className="inovel-choices">
            <button className="inovel-chip primary" disabled={!!acting} onClick={() => advance(undefined, '旁白')}>
              <Sparkles size={13} /> 推进剧情
            </button>
            {cast.map(c => (
              <button key={c.id} className="inovel-chip" disabled={!!acting} onClick={() => advance({ character_id: c.id }, c.name)}>
                <Avatar src={c.avatar} name={c.name} size={18} /> {c.name}
              </button>
            ))}
            {cast.length > 1 && (
              <button className="inovel-chip" disabled={!!acting} onClick={randomCharacter} title="随机一位角色接话"><Shuffle size={13} /> 随机</button>
            )}
            {canRetry && (
              <button className="inovel-chip" disabled={!!acting} onClick={retry} title="重写最近一段"><RotateCcw size={13} /> 重写</button>
            )}
          </div>
          <div className="inovel-hints">
            {ACTION_HINTS.map(h => (
              <button key={h} className="inovel-hint" disabled={!!acting} onClick={() => say(h)}><ChevronRight size={11} /> {h}</button>
            ))}
          </div>
          <div className="box">
            <textarea rows={1} value={input} placeholder="写下你的行动或台词，让故事继续…"
              enterKeyHint="send" autoCapitalize="sentences" autoCorrect="on" spellCheck={false}
              onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); say(); } }} />
            <button className="send-btn" onClick={() => say()} disabled={!input.trim()}><Send size={17} /></button>
          </div>
        </div>
      </div>

      {stageOpen && (
        <Modal onClose={() => setStageOpen(false)}>
          <h2 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}><Palette size={18} /> 舞台背景 · 专属世界书</h2>
          <p className="muted" style={{ marginTop: -4, fontSize: 13 }}>背景改动即时预览；点「保存」后对所有读者生效。</p>
          <StageEditor cast={cast} value={stageConfig} onChange={setStageConfig} />
          <div className="stage-sec-title" style={{ marginTop: 16 }}><BookOpen size={13} /> 互动小说专属世界书</div>
          <NovelWorldEditor value={novelWb} onChange={setNovelWb} />
          <div className="row" style={{ marginTop: 16 }}>
            <button className="btn block" onClick={() => setStageOpen(false)}>关闭</button>
            <button className="btn primary block" onClick={saveStage} disabled={savingStage}>{savingStage ? '保存中…' : '保存设定'}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
