import React from 'react';
import PublicShell from '../components/PublicShell.jsx';
import { FEATURE_GROUPS, FEATURE_INTRO } from '../features.js';
import {
  Drama, Image, MessagesSquare, Heart, Users, Brain, Languages,
  UserPlus, Share2, SquarePen, Database, Type, Images,
  Palette, Camera, Sparkles, Check,
  BookOpen, Key, Layers, ListTree, SlidersHorizontal,
  Clapperboard, Store, Play, FolderOpen,
  Feather, CirclePlus, MessageCircle,
  PenTool, PenLine, Compass, ImagePlus,
  Globe, Trophy, Gift, ChartColumn, Landmark, Search,
} from 'lucide-react';

const ICONS = {
  Drama, Image, MessagesSquare, Heart, Users, Brain, Languages,
  UserPlus, Share2, SquarePen, Database, Type, Images, Palette, Camera,
  BookOpen, Key, Layers, ListTree, SlidersHorizontal,
  Clapperboard, Store, Play, FolderOpen,
  Feather, CirclePlus, MessageCircle,
  PenTool, PenLine, Compass, ImagePlus,
  Globe, Trophy, Gift, ChartColumn, Landmark, Search,
};

export default function Features() {
  return (
    <PublicShell active="/features" title={FEATURE_INTRO.title} subtitle={FEATURE_INTRO.subtitle}>
      <div className="feat-wrap">
        {FEATURE_GROUPS.map((g) => {
          const GIc = ICONS[g.icon] || Sparkles;
          return (
            <section className="feat-section" key={g.id}>
              <header className="feat-section-head">
                <span className="feat-section-ic"><GIc size={22} /></span>
                <div><h2>{g.title}</h2><p>{g.subtitle}</p></div>
              </header>
              <div className="feat-grid">
                {g.cards.map((c) => {
                  const CIc = ICONS[c.icon] || Sparkles;
                  return (
                    <article className="feat-card" key={c.title}>
                      <span className="feat-card-ic"><CIc size={18} /></span>
                      <h3>{c.title}</h3>
                      <ul className="feat-list">
                        {c.items.map((it) => (
                          <li key={it}><Check size={13} className="feat-tick" /><span>{it}</span></li>
                        ))}
                      </ul>
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}
        <p className="feat-note"><Sparkles size={13} /> {FEATURE_INTRO.note}</p>
      </div>
    </PublicShell>
  );
}
