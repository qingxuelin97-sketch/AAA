import React from 'react';
import { ChevronRight, Compass, Flame, MessageCircle, Sparkles } from 'lucide-react';
import { Avatar } from '../../ui.jsx';
import { assetUrl } from '../../api.jsx';
import { QuietAquaCharacterArt, resolveCharacterMedia } from '../../art.jsx';
import { AppButton } from '../AppControls.jsx';

// Home's content deck is intentionally separate from the account/check-in
// header: it maps the mobile reference's "continue story → new encounter"
// reading order while retaining AAA's live data hooks in AppHome.
export default function HomeStoryDeck({ resume, picks, onOpenChat, onNavigate, includeResume = true }) {
  return (
    <>
      {includeResume && (resume === null ? <div className="ah-rail-skel" role="status" aria-label="正在加载故事" /> : resume.length > 0 ? (
        <section className="ah-sec ah-resume-section cbx-home-stories" aria-labelledby="today-resume-title">
          <div className="ah-sec-head"><div><span className="cbx-home-kicker">继续进行</span><h2 id="today-resume-title">你的故事</h2></div>
            <AppButton className="ah-more" variant="tertiary" size="sm" onClick={() => onNavigate('/messages')}>全部 <ChevronRight size={14} /></AppButton>
          </div>
          <div className="ah-rail" aria-label="最近对话">
            {resume.map(conversation => (
              <button key={conversation.id} type="button" className="ah-resume cbx-story-card" onClick={() => onNavigate(`/chats/${conversation.id}`)}>
                <Avatar src={conversation.character_avatar} name={conversation.character_name} size={56} />
                <span className="cbx-story-card__copy"><b>{conversation.character_name}</b><em><Flame size={11} /> {conversation.affinity || '新的故事'}</em></span>
                <ChevronRight size={16} aria-hidden="true" />
              </button>
            ))}
          </div>
        </section>
      ) : (
        <button type="button" className="ah-empty cbx-home-empty" onClick={() => onNavigate('/')}><Compass size={22} /><div><b>从一段新故事开始</b><span>在发现页挑选一个角色</span></div><ChevronRight size={18} /></button>
      ))}

      {picks && picks.length > 0 && (
        <section className="ah-sec cbx-home-picks" aria-labelledby="home-picks-title">
          <div className="ah-sec-head"><div><span className="cbx-home-kicker">为此刻准备</span><h2 id="home-picks-title"><Sparkles size={16} /> 遇见新角色</h2></div>
            <AppButton className="ah-more" variant="tertiary" size="sm" onClick={() => onNavigate('/')}>发现 <ChevronRight size={14} /></AppButton>
          </div>
          <div className="ah-picks">
            {picks.map(character => {
              const media = resolveCharacterMedia(character);
              return <button key={character.id} type="button" className="ah-pick cbx-pick-card" onClick={() => onOpenChat(character)}>
                <div className="ah-pick-av">{media.src ? <img src={assetUrl(media.src)} alt="" loading="lazy" /> : <QuietAquaCharacterArt alt="" loading="lazy" />}</div>
                <span className="ah-pick-tx"><b>{character.name}</b><span>{character.tagline || character.intro || '等你来开启的故事'}</span><em><MessageCircle size={12} /> 进入对话</em></span>
              </button>;
            })}
          </div>
        </section>
      )}
    </>
  );
}
