import React, { useEffect, useState } from 'react';
import { AppMaterialSurface } from '../AppMaterialSurface.jsx';

export function useCatboxChromeState() {
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return undefined;
    const update = () => {
      const inset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      document.documentElement.style.setProperty('--catbox-keyboard-inset', `${Math.round(inset)}px`);
      setKeyboardOpen(inset > 96);
    };
    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
      document.documentElement.style.removeProperty('--catbox-keyboard-inset');
    };
  }, []);

  return { keyboardOpen };
}

export function CatboxDock({ navigation, action }) {
  return (
    <div className="app-dock catbox-dock" data-reference-component="app-dock">
      <AppMaterialSurface variant="regular" className="app-tabbar-surface catbox-dock__surface">
        {navigation}
      </AppMaterialSurface>
      {action}
    </div>
  );
}

export function CatboxSheetFrame({ as = 'section', className = '', children, ...props }) {
  return (
    <AppMaterialSurface
      as={as}
      variant="regular"
      className={`catbox-sheet ${className}`.trim()}
      data-reference-component="transient-sheet"
      {...props}
    >
      {children}
    </AppMaterialSurface>
  );
}
