import React, { useEffect, useState } from 'react';
import { useNav as useNavigate } from '../nav.js';
import { api, assetUrl, useAuth } from '../api.jsx';
import { useToast, Avatar, CreatorV } from '../ui.jsx';
import { AppButton, AppIconButton } from '../components/AppControls.jsx';
import { isAppMode } from '../appmode.js';
import { EmptyArt } from '../art.jsx';
import { Heart, Play, Flame, ScrollText, Trophy, Crown, ArrowLeft, ChevronRight, RefreshCw } from 'lucide-react';

export default function Leaderboard() {
  const nav = useNavigate();
  const toast = useToast();
  const appMode = isAppMode();
  const { user } = useAuth();
  const [tab, setTab] = useState('characters');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const load = () => {
    setLoading(true);
    setLoadError('');
    api('/engage/leaderboard')
      .then(setData)
      .catch(e => { setLoadError(e.message || '排行榜载入失败，请稍后重试'); toast(e.message, 'err'); })
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const characters = data?.characters || [];
  const scripts = data?.scripts || [];
  const authors = data?.authors || [];

  // Normalise each tab to a common shape so the podium + list can be rendered once.
  const rows = (() => {
    if (tab === 'characters') return characters.map(c => ({
      id: c.id, to: '/character/' + c.id, name: c.name, sub: c.owner_name,
      avatar: c.avatar, metric: <><Heart size={14} fill="currentColor" /> {c.likes}</>,
    }));
    if (tab === 'scripts') return scripts.map(s => ({
      id: s.id, to: '/script/' + s.id, name: s.title, sub: s.author_name,
      cover: s.cover, fallback: <ScrollText size={20} />, metric: <><Play size={14} fill="currentColor" /> {s.plays}</>,
    }));
    return authors.map(a => ({
      id: a.id, to: '/user/' + a.id, name: a.display_name, sub: `${a.chars} 角色 · ${a.scripts} 剧本`,
      avatar: a.avatar, vTier: a.creator_tier, metric: <><Flame size={14} /> {a.score} 人气</>,
    }));
  })();

  const emptyText = tab === 'characters' ? '暂无上榜角色' : tab === 'scripts' ? '暂无上榜剧本' : '暂无上榜作者';
  const top3 = rows.slice(0, 3);
  const rest = rows.slice(3);
  // Podium display order: 2nd · 1st · 3rd (champion centred and tallest).
  const podiumOrder = [top3[1], top3[0], top3[2]].map((r, i) => ({ r, place: [2, 1, 3][i] })).filter(x => x.r);

  const Thumb = ({ row, size }) => row.cover !== undefined
    ? (row.cover
        ? <img src={assetUrl(row.cover)} alt="" style={{ width: size, height: size, borderRadius: size * 0.23, objectFit: 'cover', flexShrink: 0 }} />
        : <div style={{ width: size, height: size, borderRadius: size * 0.23, display: 'grid', placeItems: 'center', background: 'var(--bg-2)', flexShrink: 0 }}>{row.fallback}</div>)
    : <Avatar src={row.avatar} name={row.name} size={size} />;
  const AppThumb = ({ row, size }) => row.cover !== undefined
    ? (row.cover
        ? <img src={assetUrl(row.cover)} alt="" width={size} height={size} />
        : <span className="qa-leaderboard-thumb-fallback" style={{ width: size, height: size }}>{row.fallback}</span>)
    : <Avatar src={row.avatar} name={row.name} size={size} />;

  if (appMode) {
    return (
      <main className="qa-leaderboard-page">
        <header className="qa-leaderboard-head">
          <AppIconButton label="返回" onClick={() => nav(-1)}><ArrowLeft size={21} /></AppIconButton>
          <div className="qa-leaderboard-head-title"><h1>排行榜</h1><span>每日实时更新</span></div>
          <span className="qa-leaderboard-head-spacer" aria-hidden="true" />
        </header>

        <div className="qa-leaderboard-body">
          <section className="qa-leaderboard-intro" aria-labelledby="qa-leaderboard-intro-title">
            <span aria-hidden="true"><Trophy size={23} /></span>
            <div><h2 id="qa-leaderboard-intro-title">本期人气榜</h2><p>发现最受欢迎的角色、剧本与创作者。</p></div>
          </section>

          <div className="qa-leaderboard-tabs" role="tablist" aria-label="排行榜分类">
            <AppButton variant="tertiary" selected={tab === 'characters'} role="tab" aria-selected={tab === 'characters'} onClick={() => setTab('characters')}>角色榜</AppButton>
            <AppButton variant="tertiary" selected={tab === 'scripts'} role="tab" aria-selected={tab === 'scripts'} onClick={() => setTab('scripts')}>剧本榜</AppButton>
            <AppButton variant="tertiary" selected={tab === 'authors'} role="tab" aria-selected={tab === 'authors'} onClick={() => setTab('authors')}>创作者榜</AppButton>
          </div>

          {loading ? (
            <section className="qa-leaderboard-loading" role="status" aria-label="正在载入排行榜">
              {[0, 1, 2, 3, 4].map(index => <span className="skel" key={index} aria-hidden="true" />)}
            </section>
          ) : rows.length === 0 ? (
            <section className="qa-leaderboard-empty"><Trophy size={34} /><h2>{emptyText}</h2><p>榜单正在等待新的名字。</p></section>
          ) : (
            <>
              {/* 领奖台：2 · 1 · 3 排列，冠军居中最高（S5 曜光玻璃 · s26） */}
              {podiumOrder.length > 0 && (
                <section className="qa-leaderboard-podium" aria-label="领奖台 · 前三名">
                  {podiumOrder.map(({ r, place }) => {
                    const isYou = !!user && r.to === '/user/' + user.id;
                    return (
                      <AppButton
                        key={r.id}
                        className={'qa-leaderboard-pod is-p' + place + (isYou ? ' is-you' : '')}
                        variant="tertiary"
                        aria-label={`第 ${place} 名，${r.name}`}
                        onClick={() => nav(r.to)}
                      >
                        <span className="qa-leaderboard-pod-media" aria-hidden="true">
                          {place === 1 && <Crown className="qa-leaderboard-pod-crown" size={15} />}
                          <AppThumb row={r} size={place === 1 ? 62 : 50} />
                          <i>{place}</i>
                        </span>
                        <b>{r.name}{r.vTier != null && <CreatorV tier={r.vTier} size={12} />}</b>
                        <small>{r.metric}</small>
                        {isYou && <span className="qa-leaderboard-you">你的位置</span>}
                      </AppButton>
                    );
                  })}
                </section>
              )}
              {rest.length > 0 && (
                <section className="qa-leaderboard-list" aria-label={tab === 'characters' ? '角色排行榜' : tab === 'scripts' ? '剧本排行榜' : '创作者排行榜'}>
                  {rest.map((row, index) => {
                    const rank = index + 4;
                    const isYou = !!user && row.to === '/user/' + user.id;
                    return (
                      <AppButton className={'qa-leaderboard-row' + (isYou ? ' is-you' : '')} key={row.id} variant="tertiary" onClick={() => nav(row.to)}>
                        <span className="qa-leaderboard-rank">{rank}</span>
                        <span className="qa-leaderboard-thumb"><AppThumb row={row} size={48} /></span>
                        <span className="qa-leaderboard-copy">
                          <b>{row.name}{row.vTier != null && <CreatorV tier={row.vTier} size={13} />}{isYou && <span className="qa-leaderboard-you">你</span>}</b>
                          <small>{row.sub}</small>
                        </span>
                        <span className="qa-leaderboard-metric">{row.metric}</span>
                        <ChevronRight className="qa-leaderboard-chevron" size={17} />
                      </AppButton>
                    );
                  })}
                </section>
              )}
            </>
          )}
        </div>
      </main>
    );
  }

  return (
    <>
      <div className="topbar">
        <div style={{ flex: 1 }}><h1 className="title-glow"><Trophy size={20} style={{ verticalAlign: -3, marginRight: 8 }} />排行榜</h1><div className="sub">最受欢迎的角色 · 剧本 · 作者，每日实时更新</div></div>
      </div>
      <div className="page">
        <div className="seg seg-3" style={{ marginBottom: 18 }}>
          <button className={tab === 'characters' ? 'active' : ''} onClick={() => setTab('characters')}>角色榜</button>
          <button className={tab === 'scripts' ? 'active' : ''} onClick={() => setTab('scripts')}>剧本榜</button>
          <button className={tab === 'authors' ? 'active' : ''} onClick={() => setTab('authors')}>创作者榜</button>
        </div>

        {loading ? (
          <div className="lgw-skel-list" aria-hidden="true">
            <div className="skel lgw-skel-lg" />
            {[0, 1, 2, 3].map(i => <div key={i} className="skel" />)}
          </div>
        ) : loadError && !data ? (
          <div className="empty lgw-error" role="alert">
            <span className="lgw-error-ic"><Trophy size={22} /></span>
            <h2 className="lgw-error-title">排行榜暂时无法载入</h2>
            <p className="lgw-error-msg">{loadError}</p>
            <button className="btn primary lgw-error-retry" onClick={() => load()}><RefreshCw size={15} /> 重新载入</button>
          </div>
        ) : rows.length === 0 ? (
          <div className="empty lgw-empty">
            <EmptyArt kind="generic" />
            <h2 className="lgw-empty-title">{emptyText}</h2>
            <p className="lgw-empty-sub">榜单每日实时更新，作品被点赞、游玩后就会登上来。</p>
            <div className="lgw-empty-cta">
              <button className="btn primary" onClick={() => nav('/')}>去发现广场逛逛</button>
            </div>
          </div>
        ) : (
          <>
            {podiumOrder.length > 0 && (
              <div className="lb-podium">
                {podiumOrder.map(({ r, place }) => (
                  <div key={r.id} className={'lb-pod p' + place} onClick={() => nav(r.to)}>
                    {place === 1 && <Crown className="lb-crown" size={26} />}
                    <div className="lb-pod-av"><Thumb row={r} size={place === 1 ? 86 : 66} /><span className="lb-pod-rank">{place}</span></div>
                    <b className="lb-pod-name" title={r.name}>
                      {r.name}{r.vTier != null && <CreatorV tier={r.vTier} size={13} />}
                    </b>
                    <span className="lb-pod-sub">{r.sub}</span>
                    <span className="lb-pod-metric">{r.metric}</span>
                    <div className="lb-pod-base" />
                  </div>
                ))}
              </div>
            )}

            <div className="lb-list">
              {rest.map((r, i) => (
                <div key={r.id} className="lb-row" onClick={() => nav(r.to)}>
                  <div className="lb-rank">{i + 4}</div>
                  <Thumb row={r} size={44} />
                  <div className="grow" style={{ flex: 1, minWidth: 0 }}>
                    <b style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>{r.name}{r.vTier != null && <CreatorV tier={r.vTier} size={13} />}</b>
                    <div className="muted" style={{ fontSize: 12.5 }}>{r.sub}</div>
                  </div>
                  <span className="lb-num">{r.metric}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}
