import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useNav as useNavigate } from '../nav.js';
import { api, assetUrl } from '../api.jsx';
import { useToast, Avatar, Modal } from '../ui.jsx';
import { isAppMode } from '../appmode.js';
import { ArrowLeft, Minus, Plus, Type, ScrollText, Pencil } from 'lucide-react';

// 公开阅读页：阅读「书架精选」里已发布的作品（或自己的作品）。只读、沉浸排版。
// 曜光玻璃 s12（仅 App 壳，Web DOM/行为零差异）：不透明纸面 + 可隐藏的 L3
// 玻璃工具条（点正文空白处隐藏/唤回）+ Aa 阅读设置走现有 Sheet（Modal）。
export default function NovelReader() {
  const { id } = useParams();
  const app = isAppMode();
  const nav = useNavigate();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [size, setSize] = useState(18);
  const [aaOpen, setAaOpen] = useState(false);
  const [chromeHidden, setChromeHidden] = useState(false);

  useEffect(() => {
    api(`/novels/${id}/read`).then(setData).catch(e => { setErr(e.message); toast(e.message, 'err'); });
  }, [id]);

  if (err) return <div className="empty" style={{ paddingTop: 140 }}>{err}<div style={{ marginTop: 16 }}><button className="btn" onClick={() => nav('/atelier')}>返回工坊</button></div></div>;
  if (!data) return <div className="empty" style={{ paddingTop: 160 }}>载入中…</div>;
  const { novel, author, run, beats } = data;

  return (
    <div className={'atl-read-page' + (app ? ' qa-novel-read' + (chromeHidden ? ' is-chrome-hidden' : '') : '')}>
      <div className="atl-read-bar">
        <button className="btn ghost sm" onClick={() => nav(-1)} aria-label={app ? '返回' : undefined}><ArrowLeft size={16} /></button>
        <span className="atl-read-bar-title">{novel.title}</span>
        {novel.mine && <button className="btn ghost sm" onClick={() => nav(`/atelier/${novel.id}`)} title="去创作台编辑"><Pencil size={14} /> 编辑</button>}
        {app ? (
          <button className="btn ghost sm qa-novel-aa-btn" onClick={() => setAaOpen(true)}
            aria-haspopup="dialog" aria-label="阅读设置"><Type size={15} /> Aa</button>
        ) : (
          <div className="atl-reader-font">
            <button onClick={() => setSize(s => Math.max(14, s - 1))}><Minus size={14} /></button>
            <Type size={14} />
            <button onClick={() => setSize(s => Math.min(28, s + 1))}><Plus size={14} /></button>
          </div>
        )}
      </div>
      <div className="atl-read-scroll"
        onClick={app ? (e) => {
          // 点正文空白处隐藏/唤回工具条；命中链接/按钮/作者行/插图时不拦截
          if (e.target.closest('button, a, .atl-read-author, img')) return;
          setChromeHidden(h => !h);
        } : undefined}>
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

      {/* Aa 阅读设置：走现有 Sheet 机制（Modal 在 App 壳自动 Portal + L2 玻璃） */}
      {app && aaOpen && (
        <Modal onClose={() => setAaOpen(false)} className="qa-novel-aa-sheet">
          <h2 className="qa-novel-aa-title"><Type size={17} /> 阅读设置</h2>
          <p className="qa-novel-aa-preview" style={{ fontSize: size }}>字号预览：晨光落在书页上。</p>
          <div className="qa-novel-aa-row" role="group" aria-label="正文字号">
            <button type="button" onClick={() => setSize(s => Math.max(14, s - 1))} aria-label="减小字号"><Minus size={17} /></button>
            <b aria-live="polite">{size}px</b>
            <button type="button" onClick={() => setSize(s => Math.min(28, s + 1))} aria-label="增大字号"><Plus size={17} /></button>
          </div>
          <button type="button" className="btn block" onClick={() => setAaOpen(false)}>完成</button>
        </Modal>
      )}
    </div>
  );
}
