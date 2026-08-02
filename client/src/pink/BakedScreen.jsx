import React from 'react';
import { BAKED_PARTS, pinkAsset } from './reference.js';

export function PinkHit({ className = '', label, children, ...props }) {
  return (
    <button type="button" className={`pink-hit ${className}`.trim()} aria-label={label} {...props}>
      <span className="pink-sr-only">{label}</span>
      {children}
    </button>
  );
}

export default function BakedScreen({ screen, className = '', children }) {
  return (
    <div className={`pink-screen pink-screen--${screen} ${className}`.trim()} data-pink-screen={screen}>
      <div className="pink-screen__plate" aria-hidden="true">
        {(BAKED_PARTS[screen] || []).map((file) => (
          <img key={file} src={pinkAsset(`baked/${screen}/${file}`)} alt="" draggable="false" />
        ))}
      </div>
      <div className="pink-screen__controls">{children}</div>
    </div>
  );
}
