import React, { forwardRef } from 'react';

const MATERIALS = new Set(['standard', 'regular', 'clear']);

/**
 * App-only material primitive.
 *
 * It stays a transparent pass-through outside the native App shell so Web
 * markup and CSS remain unchanged. The material value describes a functional
 * layer; it never turns arbitrary content cards into glass.
 */
export const AppMaterialSurface = forwardRef(function AppMaterialSurface({
  as: Component = 'div',
  variant = 'standard',
  className = '',
  children,
  ...props
}, ref) {
  const safeVariant = MATERIALS.has(variant) ? variant : 'standard';
  const app = typeof document !== 'undefined'
    && document.documentElement.dataset.app === '1';
  if (!app) {
    return (
      <Component ref={ref} className={className} {...props}>
        {children}
      </Component>
    );
  }
  return (
    <Component
      ref={ref}
      className={`qa-material qa-material--${safeVariant}${className ? ` ${className}` : ''}`}
      data-app-material={safeVariant}
      {...props}
    >
      {children}
    </Component>
  );
});

export default AppMaterialSurface;
