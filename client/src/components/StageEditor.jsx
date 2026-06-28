import React from 'react';
import { Uploader, Avatar } from '../ui.jsx';
import { Image as ImageIcon, Wand2, Plus, Trash2, X } from 'lucide-react';

// 互动小说「舞台背景」编辑器（创作者自定义）：
//   1) 角色专属背景 —— 重要角色发言时，舞台自动切到该角色的背景；
//   2) 场景关键词触发 —— 剧情出现关键词时，舞台切到对应场景背景。
// 受控组件：value = { charAuto, charBg:{角色id:url}, scenes:[{name,keys,image}] }
export default function StageEditor({ cast = [], value, onChange }) {
  const cfg = {
    charAuto: value?.charAuto !== false,
    charBg: value?.charBg || {},
    scenes: value?.scenes || [],
  };
  const patch = (p) => onChange({ ...cfg, ...p });
  const setCharBg = (id, url) => {
    const cb = { ...cfg.charBg };
    if (url) cb[id] = url; else { delete cb[id]; delete cb[String(id)]; }
    patch({ charBg: cb });
  };
  const setScene = (i, k, v) => patch({ scenes: cfg.scenes.map((s, j) => (j === i ? { ...s, [k]: v } : s)) });
  const addScene = () => patch({ scenes: [...cfg.scenes, { name: '', keys: '', image: '' }] });
  const delScene = (i) => patch({ scenes: cfg.scenes.filter((_, j) => j !== i) });

  return (
    <div className="stage-editor">
      <label className="switch stage-auto">
        <input type="checkbox" checked={cfg.charAuto} onChange={e => patch({ charAuto: e.target.checked })} />
        <span className="track" />
        <span>角色发言时，自动切换到该角色背景</span>
      </label>

      <div className="stage-sec-title"><ImageIcon size={13} /> 角色专属背景</div>
      <p className="stage-hint">为重要角色设置登场背景，其发言时舞台自动切换。留空则沿用角色自带背景。</p>
      <div className="stage-char-list">
        {cast.length === 0 && <div className="muted" style={{ fontSize: 13 }}>先选择登场角色，再为其设置专属背景。</div>}
        {cast.map(c => {
          const url = cfg.charBg[c.id] || cfg.charBg[String(c.id)] || '';
          const eff = url || c.background || '';
          return (
            <div key={c.id} className="stage-char-row">
              <Avatar src={c.avatar} name={c.name} size={34} />
              <div className="stage-char-info">
                <b>{c.name}</b>
                <span className="muted">{url ? '专属背景' : c.background ? '角色自带背景' : '暂无背景'}</span>
              </div>
              <div className="stage-up">
                <Uploader value={eff} onChange={u => setCharBg(c.id, u)} label="背景" />
              </div>
              {url && <button className="btn sm ghost" onClick={() => setCharBg(c.id, '')} title="清除专属背景"><X size={13} /></button>}
            </div>
          );
        })}
      </div>

      <div className="stage-sec-title"><Wand2 size={13} /> 场景背景触发</div>
      <p className="stage-hint">当剧情（旁白 / 角色台词 / 你的行动）出现关键词时，舞台切到该场景背景。</p>
      <div className="stage-scenes">
        {cfg.scenes.map((s, i) => (
          <div key={i} className="stage-scene-row">
            <div className="stage-up stage-up-scene">
              <Uploader value={s.image} onChange={u => setScene(i, 'image', u)} label="场景图" />
            </div>
            <div className="stage-scene-fields">
              <input className="input" placeholder="场景名（如：雪夜 / 密室）" value={s.name} onChange={e => setScene(i, 'name', e.target.value)} maxLength={40} />
              <input className="input" placeholder="触发关键词，逗号分隔（如：风雪,寒夜,雪原）" value={s.keys} onChange={e => setScene(i, 'keys', e.target.value)} maxLength={300} />
            </div>
            <button className="btn sm ghost danger" onClick={() => delScene(i)} title="删除场景"><Trash2 size={14} /></button>
          </div>
        ))}
        <button className="btn sm ghost stage-add" onClick={addScene}><Plus size={14} /> 添加场景背景</button>
      </div>
    </div>
  );
}
