// 创作草稿自动保存 —— 防止编辑角色/剧本时误退或断网导致内容丢失。
// 纯前端 localStorage 暂存，每个草稿独立 key，外加一个轻量索引便于列表展示。
// 兑现 features.js 宣传的「多版本草稿管理」能力。
import { useEffect, useRef } from 'react';

const PREFIX = 'huanyu_draft_';
const INDEX_KEY = 'huanyu_draft_index';
const AUTOSAVE_MS = 1500;

function readIndex() {
  try { return JSON.parse(localStorage.getItem(INDEX_KEY) || '{}'); } catch { return {}; }
}
function writeIndex(idx) {
  try { localStorage.setItem(INDEX_KEY, JSON.stringify(idx)); } catch { /* quota */ }
}

// 判断草稿是否值得保存（避免存一堆空白草稿污染索引）
function worthSaving(type, data) {
  if (!data) return false;
  if (type === 'character') {
    return !!(data.name || data.intro || data.greeting || data.persona || (data.world && data.world.length));
  }
  if (type === 'script') {
    return !!(data.title || data.content || data.summary);
  }
  return true;
}

export function saveDraft(type, key, data, name) {
  if (!key || !worthSaving(type, data)) return false;
  try {
    localStorage.setItem(PREFIX + type + '_' + key, JSON.stringify(data));
    const idx = readIndex();
    if (!idx[type]) idx[type] = {};
    idx[type][key] = { name: (name || '未命名').slice(0, 40), savedAt: Date.now() };
    writeIndex(idx);
    return true;
  } catch { return false; } // quota 超限等，静默失败
}

export function loadDraft(type, key) {
  if (!key) return null;
  try { return JSON.parse(localStorage.getItem(PREFIX + type + '_' + key) || 'null'); } catch { return null; }
}

export function delDraft(type, key) {
  if (!key) return;
  localStorage.removeItem(PREFIX + type + '_' + key);
  const idx = readIndex();
  if (idx[type]) { delete idx[type][key]; writeIndex(idx); }
}

export function listDrafts(type) {
  const idx = readIndex();
  const map = idx[type] || {};
  return Object.entries(map)
    .map(([key, v]) => ({ key, name: v.name, savedAt: v.savedAt }))
    .sort((a, b) => b.savedAt - a.savedAt);
}

export function hasDraft(type, key) {
  if (!key) return false;
  const idx = readIndex();
  return !!(idx[type] && idx[type][key]);
}

// 自动保存 hook：监听 data 变化，防抖保存。仅当编辑器未在加载初始数据时启用，
// 避免覆盖刚从服务器拉取的版本。saveNow/discard 供手动调用。
export function useDraftAutosave(type, key, data, name, enabled = true) {
  const ref = useRef(data);
  ref.current = data;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  useEffect(() => {
    if (!enabled || !key) return;
    const t = setTimeout(() => saveDraft(type, key, ref.current, name), AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [type, key, data, name, enabled]);

  return {
    saveNow: () => saveDraft(type, key, ref.current, name),
    discard: () => delDraft(type, key),
  };
}
