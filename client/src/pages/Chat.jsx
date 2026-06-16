import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, getToken } from '../api.jsx';
import { useToast, Avatar } from '../ui.jsx';

export default function Chat() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const [convs, setConvs] = useState([]);
  const [conv, setConv] = useState(null);
  const [character, setCharacter] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const scrollRef = useRef();

  const loadConvs = () => api('/chat/conversations').then(d => setConvs(d.conversations)).catch(() => {});
  useEffect(() => { loadConvs(); }, []);

  useEffect(() => {
    if (!id) { setConv(null); setCharacter(null); setMessages([]); return; }
    api('/chat/conversations/' + id).then(d => {
      setConv(d.conversation); setCharacter(d.character); setMessages(d.messages);
    }).catch(e => toast(e.message, 'err'));
  }, [id]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, streaming]);

  const send = async () => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput('');
    setMessages(m => [...m, { role: 'user', content: text }, { role: 'assistant', content: '', _streaming: true }]);
    setStreaming(true);
    try {
      const res = await fetch(`/api/chat/conversations/${id}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ content: text })
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || '请求失败');
      }
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
          const payload = t.slice(5).trim();
          if (payload === '[DONE]') continue;
          try {
            const j = JSON.parse(payload);
            if (j.error) throw new Error(j.error);
            if (j.delta) setMessages(m => {
              const copy = [...m]; copy[copy.length - 1] = { ...copy[copy.length - 1], content: copy[copy.length - 1].content + j.delta };
              return copy;
            });
          } catch (err) { if (err.message && !err.message.includes('JSON')) throw err; }
        }
      }
      setMessages(m => { const c = [...m]; c[c.length - 1] = { ...c[c.length - 1], _streaming: false }; return c; });
      loadConvs();
    } catch (err) {
      toast(err.message, 'err');
      setMessages(m => { const c = [...m]; const last = c[c.length - 1];
        if (last?._streaming) c[c.length - 1] = { role: 'assistant', content: '⚠️ ' + err.message, _streaming: false }; return c; });
    } finally { setStreaming(false); }
  };

  const speak = async (text) => {
    try {
      const res = await fetch('/api/chat/tts', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ text, voice: character?.voice_name || undefined })
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || '语音合成失败'); }
      const blob = await res.blob();
      new Audio(URL.createObjectURL(blob)).play();
    } catch (err) { toast(err.message, 'err'); }
  };

  const delConv = async (e, cv) => {
    e.stopPropagation();
    if (!confirm('删除该对话？')) return;
    await api('/chat/conversations/' + cv.id, { method: 'DELETE' });
    if (String(cv.id) === String(id)) nav('/chats');
    loadConvs();
  };

  const onKey = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } };

  return (
    <div className="chat-layout">
      <div className="chat-list">
        <div className="hd">对话 <button className="btn sm" onClick={() => nav('/library')}>＋</button></div>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {convs.length === 0 && <div className="empty" style={{ padding: 30, fontSize: 13 }}>从「我的角色」开始一段对话</div>}
          {convs.map(cv => (
            <div key={cv.id} className={'conv-item' + (String(cv.id) === String(id) ? ' active' : '')} onClick={() => nav('/chats/' + cv.id)}>
              <Avatar src={cv.character_avatar} name={cv.character_name} size={40} />
              <div className="tx"><b>{cv.character_name}</b><span>{cv.title}</span></div>
              <button className="speak" onClick={e => delConv(e, cv)}>✕</button>
            </div>
          ))}
        </div>
      </div>

      <div className="chat-main">
        {!conv ? (
          <div className="empty" style={{ margin: 'auto' }}>
            <div className="big">💬</div>选择左侧对话，或从角色库开启新对话
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
            <div className="chat-head">
              <Avatar src={character?.avatar} name={character?.name} size={42} />
              <div className="nm"><b>{character?.name}</b><br /><span>{character?.tagline || '正在扮演中'}</span></div>
            </div>

            <div className="chat-scroll" ref={scrollRef}>
              {messages.map((m, i) => (
                <div key={i} className={'msg ' + m.role}>
                  {m.role === 'assistant' && <Avatar src={character?.avatar} name={character?.name} size={36} />}
                  <div>
                    <div className="bubble">
                      {m.content || (m._streaming && <span className="typing"><span></span><span></span><span></span></span>)}
                    </div>
                    {m.role === 'assistant' && m.content && !m._streaming &&
                      <button className="speak" onClick={() => speak(m.content)}>🔊 朗读</button>}
                  </div>
                </div>
              ))}
            </div>

            <div className="chat-input-bar">
              <div className="box">
                <textarea rows={1} value={input} placeholder={`对 ${character?.name} 说点什么…（Enter 发送，Shift+Enter 换行）`}
                  onChange={e => setInput(e.target.value)} onKeyDown={onKey} disabled={streaming} />
                <button className="send-btn" onClick={send} disabled={streaming || !input.trim()}>➤</button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
