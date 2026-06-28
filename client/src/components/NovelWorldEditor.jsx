import React from 'react';
import { Plus, Trash2, BookOpen } from 'lucide-react';

// 互动小说专属世界书（创作者自定义）：叠加在所有登场角色之上的额外设定。
// 关键词命中近期剧情、或勾选「常驻」时，注入到 AI 生成。
// 受控组件：value = [{ keys, content, always }]
export default function NovelWorldEditor({ value = [], onChange }) {
  const entries = Array.isArray(value) ? value : [];
  const upd = (i, k, v) => onChange(entries.map((e, j) => (j === i ? { ...e, [k]: v } : e)));
  const add = () => onChange([...entries, { keys: '', content: '', always: false }]);
  const del = (i) => onChange(entries.filter((_, j) => j !== i));

  return (
    <div className="novel-wb">
      <p className="stage-hint">这套世界书只属于本故事，叠加在所有登场角色之上。关键词命中剧情、或设为常驻时注入 AI。</p>
      {entries.length === 0 && <div className="novel-wb-empty"><BookOpen size={15} /> 还没有专属设定，添加几条让这部小说拥有自己的世界观。</div>}
      {entries.map((e, i) => (
        <div key={i} className="novel-wb-row">
          <div className="novel-wb-top">
            <input className="input" placeholder="触发关键词，逗号分隔（如：王国,皇室）" value={e.keys}
              onChange={ev => upd(i, 'keys', ev.target.value)} maxLength={200} disabled={e.always} />
            <label className="novel-wb-always" title="常驻：每次生成都注入，无需关键词">
              <input type="checkbox" checked={!!e.always} onChange={ev => upd(i, 'always', ev.target.checked)} /> 常驻
            </label>
            <button className="btn sm ghost danger" onClick={() => del(i)} title="删除条目"><Trash2 size={14} /></button>
          </div>
          <textarea className="textarea" placeholder="设定内容（世界观 / 时代背景 / 禁忌 / 隐藏真相…）" value={e.content}
            onChange={ev => upd(i, 'content', ev.target.value)} maxLength={2000} rows={2} />
        </div>
      ))}
      <button className="btn sm ghost stage-add" onClick={add}><Plus size={14} /> 添加设定条目</button>
    </div>
  );
}
