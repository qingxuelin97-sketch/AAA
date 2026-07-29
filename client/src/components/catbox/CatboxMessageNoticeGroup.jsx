import React from 'react';
import { ChevronRight } from 'lucide-react';

/**
 * The App notification rows deliberately live apart from the conversation
 * list: a conversation can be read while social and direct-message counters
 * remain unread.  Keeping the rows data-driven makes their state explicit and
 * avoids coupling the three destinations to the list fetch.
 */
export default function CatboxMessageNoticeGroup({ rows }) {
  return (
    <section className="msgs-entry-group cbx-notice-group" aria-label="Message destinations">
      {rows.map(({ key, icon: Icon, title, detail, count, tone, onOpen }) => (
        <button key={key} type="button" className="msgs-entry cbx-notice-row" data-tone={tone} onClick={onOpen}>
          <span className="msgs-entry-ic"><Icon size={20} /></span>
          <span className="msgs-entry-tx"><b>{title}</b><small>{detail}</small></span>
          {count > 0 ? <i className="msgs-badge">{count > 99 ? '99+' : count}</i> : null}
          <ChevronRight size={18} className="msgs-entry-chev" aria-hidden="true" />
        </button>
      ))}
    </section>
  );
}
