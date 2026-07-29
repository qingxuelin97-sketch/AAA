import React from 'react';

/** A semantic, data-driven quick rail shared by the profile App surface. */
export default function CatboxProfileQuickRail({ items, onOpen }) {
  return (
    <section className="pf-quick cbx-profile-quick" aria-label="Quick access">
      {items.map((item) => {
        const Icon = item.ic;
        return (
          <button key={item.label + item.to} type="button" data-tone={item.tone} onClick={() => onOpen(item.to)}>
            <span className="pf-quick-ic"><Icon size={20} />{item.tag ? <i className="pf-quick-tag">{item.tag}</i> : null}</span>
            <span>{item.label}</span>
          </button>
        );
      })}
    </section>
  );
}
