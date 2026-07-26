// 「今日」共享数据层 —— 从 pages/AppHome.jsx 原样搬出的可复用部分。
// App 端 /today 启动页与 Web 端合体首页（pages/WebHome.jsx）共用同一套
// 问候/天光、签到闭环与三条数据加载（续读轨 / 今日任务 / 精选与挑选）。
// 铁律：这里只做「代码搬家」，不改任何行为 —— AppHome 的渲染输出必须与
// 抽取前逐字节一致；接口语义（null=加载中 → 骨架，false/[]=空 → 隐藏）
// 与错误兜底全部原样保留。
import { useEffect, useState } from 'react';
import { api, useAuth } from '../../api.jsx';
import { useToast } from '../../ui.jsx';
import { cnToday } from '../../util.js';

export function greeting() {
  const h = new Date().getHours();
  if (h < 5) return '夜深了';
  if (h < 11) return '早安';
  if (h < 14) return '午安';
  if (h < 18) return '下午好';
  if (h < 23) return '晚上好';
  return '夜深了';
}

// Keep the existing time-of-day hook as a subtle surface variant. The final
// treatment is owned by shell-scoped CSS rather than baked artwork.
export function skyClass() {
  const h = new Date().getHours();
  if (h < 5 || h >= 20) return 'sky-night';
  if (h < 11) return 'sky-morning';
  if (h < 17) return '';        // 白昼用默认暖阳渐变
  return 'sky-dusk';
}

// 签到闭环：状态初始化（用 /auth/me 带回的 last_checkin，已签到直接呈现
// 「已签到」态，而不是等用户点了按钮吃 400 才知道）、随 user 同步、提交。
export function useCheckin() {
  const { user, refreshUser } = useAuth();
  const toast = useToast();
  const [checked, setChecked] = useState(() => !!user?.last_checkin && user.last_checkin === cnToday());
  const [streak, setStreak] = useState(user?.checkin_streak || 0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setChecked(Boolean(user?.last_checkin && user.last_checkin === cnToday()));
    setStreak(user?.checkin_streak || 0);
  }, [user?.last_checkin, user?.checkin_streak]);

  const checkin = async () => {
    if (busy || checked) return;
    setBusy(true);
    try {
      const d = await api('/economy/checkin', { method: 'POST' });
      setChecked(true); setStreak(d.streak || 0);
      toast(`签到成功 · +${d.reward} 金币 · 连续 ${d.streak} 天`);
      refreshUser?.(); // 顶部金币余额立即更新，不留旧值
    } catch (e) {
      // Only the server's explicit idempotent verdict may settle the CTA as
      // complete. Offline, timeout and 5xx failures keep it retryable.
      if (e?.code === 'ALREADY_CHECKED_IN') {
        setChecked(true);
        toast('今天已签到');
      } else {
        toast(e?.message || '签到失败，请稍后重试', 'err');
      }
    } finally { setBusy(false); }
  };

  return { checked, streak, busy, checkin };
}

// 续读轨：最近对话（头像 + 好感度）。失败落 [] → 呈现空态而非骨架卡死。
export function loadResumeRail(setResume, limit = 10) {
  return api('/chat/conversations')
    .then(d => setResume((d.conversations || []).slice(0, limit)))
    .catch(() => setResume([]));
}

// 精选 Hero + 为你挑选。One hot fetch feeds both the featured hero and the
// picks fallback; the personalised "recommended" set takes precedence for
// picks when present. (null = loading → skeleton; false/[] = loaded-empty →
// hidden.)
export function loadHeroAndPicks(setHero, setPick) {
  api('/characters/public?sort=hot').then(d => {
    const hot = d.characters || [];
    const top = hot.find(c => c.featured) || hot[0] || null;
    setHero(top || false);
    setPick(p => (p && p.length) ? p : hot.filter(c => !top || c.id !== top.id).slice(0, 6));
  }).catch(() => { setHero(false); setPick(p => p || []); });
  api('/characters/recommended')
    .then(d => { const cs = d.characters || []; if (cs.length) setPick(cs.slice(0, 6)); })
    .catch(() => {});
}

// 今日任务（启动页语义：只看未领取的前几条；Web 目录页自己维护全量任务
// 清单与直接领取，不走这里）。
export function loadTodayTasks(setTasks, limit = 3) {
  return api('/engage/tasks')
    .then(d => setTasks((d.tasks || []).filter(t => !t.claimed).slice(0, limit)))
    .catch(() => {});
}
