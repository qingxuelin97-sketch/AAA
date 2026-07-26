import React, { forwardRef } from 'react';

const DEV = Boolean(import.meta.env?.DEV);
const BUTTON_VARIANTS = new Set(['primary', 'secondary', 'tertiary', 'danger']);
const BUTTON_SIZES = new Set(['sm', 'md', 'lg']);
const ICON_VARIANTS = new Set(['ghost', 'secondary', 'filled']);

function joinClasses(...values) {
  return values.filter(Boolean).join(' ');
}

function isAppChrome() {
  return typeof document !== 'undefined'
    && document.documentElement.dataset.app === '1';
}

// Lumen Web chrome gate (W4)：appmode.js 在 Web 壳 boot 时打 data-lumen-web="1"。
// 三态 dispatch：App 壳 → qa-* 控件（原样不动）；Web 壳 + 旗标 → .lgw-* 真实
// 控件（真 ARIA / loading / selected / pressed，保留调用方 className 作兜底）；
// 两者皆否 → LegacyControl 透明穿透（逃生阀：删掉 appmode.js 里那一行即回落）。
function isWebChrome() {
  return typeof document !== 'undefined'
    && document.documentElement.dataset.app !== '1'
    && document.documentElement.dataset.lumenWeb === '1';
}

function legacyInteractionProps({ disabled, type, onClick, tabIndex }) {
  const result = {};
  if (disabled) result.disabled = true;
  if (type !== undefined) result.type = type;
  if (onClick !== undefined) result.onClick = onClick;
  if (tabIndex !== undefined) result.tabIndex = tabIndex;
  return result;
}

function appInteractionProps(Component, { disabled, loading, type, onClick, tabIndex }) {
  const inactive = Boolean(disabled || loading);
  if (Component === 'button') {
    return {
      type: type || 'button',
      disabled: inactive,
      onClick,
      tabIndex,
    };
  }

  return {
    type,
    'aria-disabled': inactive || undefined,
    tabIndex: inactive ? -1 : tabIndex,
    onClick: inactive
      ? (event) => {
          event.preventDefault();
          event.stopPropagation();
        }
      : onClick,
  };
}

function LegacyControl({ Component, forwardedRef, className, children, disabled, type, onClick, tabIndex, props }) {
  return (
    <Component
      ref={forwardedRef}
      className={className}
      {...legacyInteractionProps({ disabled, type, onClick, tabIndex })}
      {...props}
    >
      {children}
    </Component>
  );
}

/**
 * App-only visual primitive. Outside `data-app="1"` it is deliberately a
 * transparent pass-through: no qa class, wrapper, inferred ARIA or default
 * attribute is added to the caller's legacy DOM.
 */
export const AppButton = forwardRef(function AppButton({
  as: Component = 'button',
  variant = 'secondary',
  size = 'md',
  tone = 'default',
  loading = false,
  selected = false,
  pressed,
  disabled = false,
  className,
  children,
  type,
  onClick,
  tabIndex,
  ...props
}, ref) {
  if (DEV && !BUTTON_VARIANTS.has(variant)) {
    throw new Error(`AppButton variant "${variant}" is not part of the Quiet Aqua contract.`);
  }
  if (DEV && !BUTTON_SIZES.has(size)) {
    throw new Error(`AppButton size "${size}" is not part of the Quiet Aqua contract.`);
  }
  if (!isAppChrome()) {
    if (isWebChrome()) {
      return (
        <Component
          ref={ref}
          {...props}
          {...appInteractionProps(Component, { disabled, loading, type, onClick, tabIndex })}
          className={joinClasses(
            'lgw-button',
            `lgw-button--${variant}`,
            `lgw-button--${size}`,
            tone !== 'default' && `lgw-tone--${tone}`,
            className,
          )}
          data-loading={loading || undefined}
          data-selected={selected || undefined}
          aria-busy={loading || undefined}
          aria-pressed={pressed === undefined ? undefined : Boolean(pressed)}
        >
          <span className="lgw-button__content">{children}</span>
          {loading && <span className="lgw-spinner" aria-hidden="true" />}
        </Component>
      );
    }
    return (
      <LegacyControl
        Component={Component}
        forwardedRef={ref}
        className={className}
        disabled={disabled}
        type={type}
        onClick={onClick}
        tabIndex={tabIndex}
        props={props}
      >
        {children}
      </LegacyControl>
    );
  }

  return (
    <Component
      ref={ref}
      {...props}
      {...appInteractionProps(Component, { disabled, loading, type, onClick, tabIndex })}
      className={joinClasses(
        'qa-button',
        `qa-button--${variant}`,
        `qa-button--${size}`,
        tone !== 'default' && `qa-tone--${tone}`,
        className,
      )}
      data-loading={loading || undefined}
      data-selected={selected || undefined}
      aria-busy={loading || undefined}
      aria-pressed={pressed === undefined ? undefined : Boolean(pressed)}
    >
      <span className="qa-button__content">{children}</span>
      {loading && <span className="qa-spinner" aria-hidden="true" />}
    </Component>
  );
});

export const AppIconButton = forwardRef(function AppIconButton({
  as: Component = 'button',
  label,
  variant = 'ghost',
  tone = 'default',
  loading = false,
  selected = false,
  pressed,
  disabled = false,
  className,
  children,
  type,
  onClick,
  tabIndex,
  ...props
}, ref) {
  const accessibleLabel = props['aria-label'] || label;
  const hasAccessibleLabel = typeof accessibleLabel === 'string' && accessibleLabel.trim().length > 0;
  if (DEV && !ICON_VARIANTS.has(variant)) {
    throw new Error(`AppIconButton variant "${variant}" is not part of the Quiet Aqua contract.`);
  }
  if (DEV && !hasAccessibleLabel) {
    throw new Error('AppIconButton requires `label` or an explicit `aria-label`.');
  }

  if (!isAppChrome()) {
    if (isWebChrome()) {
      return (
        <Component
          ref={ref}
          {...props}
          {...appInteractionProps(Component, { disabled, loading, type, onClick, tabIndex })}
          className={joinClasses(
            'lgw-icon-button',
            `lgw-icon-button--${variant}`,
            tone !== 'default' && `lgw-tone--${tone}`,
            className,
          )}
          aria-label={accessibleLabel}
          title={props.title || label}
          data-loading={loading || undefined}
          data-selected={selected || undefined}
          aria-busy={loading || undefined}
          aria-pressed={pressed === undefined ? undefined : Boolean(pressed)}
        >
          <span className="lgw-icon-button__content" aria-hidden="true">{children}</span>
          {loading && <span className="lgw-spinner" aria-hidden="true" />}
        </Component>
      );
    }
    return (
      <LegacyControl
        Component={Component}
        forwardedRef={ref}
        className={className}
        disabled={disabled}
        type={type}
        onClick={onClick}
        tabIndex={tabIndex}
        props={props}
      >
        {children}
      </LegacyControl>
    );
  }

  return (
    <Component
      ref={ref}
      {...props}
      {...appInteractionProps(Component, { disabled, loading, type, onClick, tabIndex })}
      className={joinClasses(
        'qa-icon-button',
        `qa-icon-button--${variant}`,
        tone !== 'default' && `qa-tone--${tone}`,
        className,
      )}
      aria-label={accessibleLabel}
      title={props.title || label}
      data-loading={loading || undefined}
      data-selected={selected || undefined}
      aria-busy={loading || undefined}
      aria-pressed={pressed === undefined ? undefined : Boolean(pressed)}
    >
      <span className="qa-icon-button__content" aria-hidden="true">{children}</span>
      {loading && <span className="qa-spinner" aria-hidden="true" />}
    </Component>
  );
});

export const AppTabButton = forwardRef(function AppTabButton({
  as: Component = 'button',
  icon: Icon,
  label,
  badgeCount = 0,
  selected = false,
  disabled = false,
  className,
  children,
  type,
  onClick,
  tabIndex,
  ...props
}, ref) {
  if (!isAppChrome() && !isWebChrome()) {
    return (
      <LegacyControl
        Component={Component}
        forwardedRef={ref}
        className={className}
        disabled={disabled}
        type={type}
        onClick={onClick}
        tabIndex={tabIndex}
        props={props}
      >
        {children}
      </LegacyControl>
    );
  }

  const web = !isAppChrome();
  const count = Number.isFinite(Number(badgeCount))
    ? Math.max(0, Math.floor(Number(badgeCount)))
    : 0;
  const visibleCount = count > 99 ? '99+' : String(count);

  return (
    <Component
      ref={ref}
      {...props}
      {...appInteractionProps(Component, { disabled, loading: false, type, onClick, tabIndex })}
      className={joinClasses(web ? 'lgw-tab-button' : 'qa-tab-button', selected && 'active', className)}
      data-selected={selected || undefined}
      aria-current={selected ? 'page' : undefined}
    >
      <span className={web ? 'lgw-tab-button__icon' : 'qa-tab-button__icon'}>
        <span className={web ? 'lgw-tab-button__glyph' : 'qa-tab-button__glyph'} aria-hidden="true">
          {Icon ? <Icon size={22} /> : children}
        </span>
        {count > 0 && (
          <span className={web ? 'lgw-tab-button__badge' : 'qa-tab-button__badge'} aria-label={`${count} 条未读消息`}>
            {visibleCount}
          </span>
        )}
      </span>
      <span className={web ? 'lgw-tab-button__label' : 'qa-tab-button__label'}>{label}</span>
    </Component>
  );
});
