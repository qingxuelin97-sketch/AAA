import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useNav as useNavigate } from '../nav.js';
import { api, assetUrl } from '../api.jsx';
import { useToast, Avatar } from '../ui.jsx';
import { ArrowLeft, Minus, Plus, Type, ScrollText, Pencil } from 'lucide-react';

// 公开阅读页：阅读「书架精选」里已发布的作品（或自己的作品）。只读、沉浸排版。
export default function NovelReader() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [size, setSize] = useState(18);

  useEffect(() => {
    api(`/novels/${id}/read`).then(setData).catch(e => { setErr(e.message); toast(e.message, 'err'); });
  }, [id]);

  if (err) return <div className="empty" style={{ paddingTop: 140 }}>{err}<div style={{ marginTop: 16 }}><button className="btn" onClick={() => nav('/atelier')}>返回工坊</button></div></div>;
  if (!data) return <div className="empty" style={{ paddingTop: 160 }}>载入中…</div>;
  const { novel, author, run, beats } = data;

  return (
    <div className="atl-read-page">
      <div className="atl-read-bar">
        <button className="btn ghost sm" onClick={() => nav(-1)}><ArrowLeft size={16} /></button>
        <span className="atl-read-bar-title">{novel.title}</span>
        {novel.mine && <button className="btn ghost sm" onClick={() => nav(`/atelier/${novel.id}`)} title="去创作台编辑"><Pencil size={14} /> 编辑</button>}
        <div className="atl-reader-font">
          <button onClick={() => setSize(s => Math.max(14, s - 1))}><Minus size={14} /></button>
          <Type size={14} />
          <button onClick={() => setSize(s => Math.min(28, s + 1))}><Plus size={14} /></button>
        </div>
      </div>
      <div className="atl-read-scroll">
        <article className="atl-reader-page" style={{ fontSize: size }}>
          {novel.cover && <img className="atl-read-cover" src={assetUrl(novel.cover)} alt="" />}
          <div className="atl-kicker" style={{ justifyContent: 'center', display: 'flex' }}><ScrollText size={13} /> {novel.genre || '小说'}{run ? ' · ' + run.name : ''}</div>
          <h1>{novel.title}</h1>
          {novel.logline && <p className="atl-reader-logline">{novel.logline}</p>}
          {author && (
            <div className="atl-read-author" onClick={() => nav(`/user/${author.id}`)}>
              <Avatar src={author.avatar} name={author.display_name} size={26} /> <span>{author.display_name}</span>
            </div>
          )}
          <div className="inovel-rule" style={{ margin: '24px 0' }}><span>正文</span></div>
          {(beats || []).filter(b => b.content).map(b => (
            <React.Fragment key={b.id}>
              {b.image && <img className="atl-reader-img" src={assetUrl(b.image)} alt="" />}
              <p className="atl-reader-para">{b.content}</p>
            </React.Fragment>
          ))}
          {(!beats || beats.length === 0) && <p className="muted">这部作品还没有正文。</p>}
          <div className="atl-read-end">· 完 ·</div>
        </article>
      </div>
    </div>
  );
}
