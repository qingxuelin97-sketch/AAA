// S7 · App 首启引导（三屏：世界观 → 玩法 → 兴趣画像）。
// Gating（全部条件与）：App 壳 ∧ 已登录 ∧ 无 huanyu_onboard_done 键 ∧ 账号
// 7 天内新建。老账号缺键时静默补键不打扰（升级用户零弹窗）。完成或跳过
// 同时写 huanyu_welcome_seen，避免引导刚关又弹每日欢迎。
// 结构契约与 WelcomePopup 同构：useAppOverlay + createPortal + 焦点隔离。
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Sparkles, MessageCircle, Feather, Users, Check } from 'lucide-react';
import { api, useAuth } from '../api.jsx';
import { useToast } from '../ui.jsx';
import { useAppOverlay } from '../overlay.jsx';
import { isAppMode } from '../appmode.js';
import { onboardArtUrls } from '../art.jsx';
import { AppButton } from './AppControls.jsx';
import { tick } from '../appgestures.js';

const ONBOARD_KEY = 'huanyu_onboard_done';
const FRESH_WINDOW_MS = 7 * 86400e3;

// created_at 由 sqlite datetime('now') 写入（'YYYY-MM-DD HH:MM:SS' UTC）；
// 解析失败按「非新账号」处理（宁静默不误弹）。
function accountIsFresh(user) {
  const raw = String(user?.created_at || '');
  const ts = Date.parse(raw.includes('T') ? raw : raw.replace(' ', 'T') + 'Z');
  return Number.isFinite(ts) && Date.now() - ts < FRESH_WINDOW_MS;
}

const todayStamp = () => new Date().toISOString().slice(0, 10);

export default function AppOnboarding() {
  const { user } = useAuth();
  const appPortal = isAppMode();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [cats, setCats] = useState([]);
  const [picked, setPicked] = useState(() => new Set());
  const [personalizeOn, setPersonalizeOn] = useState(true);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!appPortal || !user) return;
    if (localStorage.getItem(ONBOARD_KEY)) return;
    if (!accountIsFresh(user)) {
      // 老账号静默补键：升级后的存量用户不被全量打扰
      localStorage.setItem(ONBOARD_KEY, todayStamp());
      return;
    }
    const t = setTimeout(() => setOpen(true), 500);
    return () => clearTimeout(t);
  }, [appPortal, user]);

  useEffect(() => {
    if (!open) return;
    api('/meta/categories').then((d) => setCats(d.categories || [])).catch(() => {});
    api('/settings').then((d) => setPersonalizeOn(d.settings?.personalize !== 0)).catch(() => {});
  }, [open]);

  const finish = async (save) => {
    if (busy) return;
    if (save && personalizeOn && picked.size > 0) {
      setBusy(true);
      try {
        await api('/settings', { method: 'PUT', body: { interests: [...picked] } });
        toast('兴趣已记下，推荐会更懂你');
      } catch { toast('兴趣暂存失败，可稍后在设置中调整', 'err'); }
      setBusy(false);
    }
    localStorage.setItem(ONBOARD_KEY, todayStamp());
    localStorage.setItem('huanyu_welcome_seen', todayStamp());
    setOpen(false);
  };

  const close = () => finish(false);
  useAppOverlay(open, close, { rootRef, isolate: appPortal });

  // 冷启动竞态自愈：boot 溅屏/首跳可能吞掉 overlay 的一次性 rAF 聚焦，
  // 短时重试直到焦点真正落入对话框（自终止状态循环，非装饰动画）。
  useEffect(() => {
    if (!open) return;
    let tries = 0;
    const id = setInterval(() => {
      const root = rootRef.current;
      if (!root) return;
      if (root.contains(document.activeElement)) { clearInterval(id); return; }
      const first = root.querySelector('.qa-onboard-acts .qa-button:not([disabled])');
      (first || root).focus?.({ preventScroll: true });
      if (++tries >= 12) clearInterval(id);
    }, 150);
    return () => clearInterval(id);
  }, [open]);

  if (!open) return null;

  const togglePick = (slug) => {
    tick(6);
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else if (next.size < 6) next.add(slug);
      return next;
    });
  };

  const FEATURES = [
    { Icon: MessageCircle, title: '角色对话', copy: '与会呼吸的角色随时开聊，无需任何配置' },
    { Icon: Feather, title: '共写创作', copy: '角色卡、剧本、世界书与小说工坊随手创作' },
    { Icon: Users, title: '同台演出', copy: '剧场联机，与多位 AI 和好友同台推进故事' },
  ];

  const popup = (
    <div className="qa-onboard-mask" role="presentation">
      <div ref={rootRef} className="qa-onboard" role="dialog" aria-modal="true" aria-label="欢迎引导" tabIndex={-1}>
        <div className="qa-onboard-track" style={{ transform: `translateX(-${step * 100}%)` }}>
          <section className="qa-onboard-screen" aria-hidden={step !== 0} inert={step !== 0 || undefined}>
            <img className="qa-onboard-art" src={onboardArtUrls.world} width={290} height={193} alt="" draggable="false" />
            <span className="qa-onboard-eyebrow"><Sparkles size={14} /> 欢迎来到幻域</span>
            <h2>把你脑海里的故事，写成会呼吸的角色</h2>
            <p>穿过月门，这里的每一次对话都是一段新的旅程。</p>
          </section>
          <section className="qa-onboard-screen" aria-hidden={step !== 1} inert={step !== 1 || undefined}>
            <img className="qa-onboard-art" src={onboardArtUrls.craft} width={290} height={193} alt="" draggable="false" />
            <h2>三件事，从这里开始</h2>
            <ul className="qa-onboard-feats">
              {FEATURES.map(({ Icon, title, copy }) => (
                <li key={title}><span className="qa-onboard-feat-ic"><Icon size={18} /></span><span><b>{title}</b><small>{copy}</small></span></li>
              ))}
            </ul>
          </section>
          <section className="qa-onboard-screen" aria-hidden={step !== 2} inert={step !== 2 || undefined}>
            <img className="qa-onboard-art" src={onboardArtUrls.tune} width={290} height={193} alt="" draggable="false" />
            <h2>{personalizeOn ? '挑几个你喜欢的题材' : '推荐已按你的偏好关闭'}</h2>
            {personalizeOn ? (
              <>
                <p>最多选 6 个，推荐从此更合口味；随时可在设置里调整。</p>
                <div className="qa-onboard-chips" role="group" aria-label="兴趣题材">
                  {cats.map((c) => (
                    <AppButton
                      key={c.slug}
                      variant="tertiary"
                      size="sm"
                      className="qa-onboard-chip"
                      selected={picked.has(c.slug)}
                      onClick={() => togglePick(c.slug)}
                    >
                      {picked.has(c.slug) && <Check size={13} />} {c.name}
                    </AppButton>
                  ))}
                </div>
              </>
            ) : (
              <p>你关闭了个性化推荐，我们不会收集兴趣画像；此选择可随时在「设置 · 隐私」中更改。</p>
            )}
          </section>
        </div>

        <div className="qa-onboard-dots" aria-hidden="true">
          {[0, 1, 2].map((i) => <span key={i} className={'qa-onboard-dot' + (i === step ? ' on' : '')} />)}
        </div>

        <div className="qa-onboard-acts">
          <AppButton variant="tertiary" onClick={close}>跳过</AppButton>
          {step < 2 ? (
            <AppButton variant="primary" size="lg" onClick={() => { tick(6); setStep(step + 1); }}>继续</AppButton>
          ) : (
            <AppButton variant="primary" size="lg" loading={busy} disabled={busy} onClick={() => finish(true)}>
              {personalizeOn && picked.size > 0 ? `选好了（${picked.size}）` : '开始探索'}
            </AppButton>
          )}
        </div>
      </div>
    </div>
  );

  return appPortal && typeof document !== 'undefined' ? createPortal(popup, document.body) : popup;
}
