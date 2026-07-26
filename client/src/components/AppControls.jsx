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
  if (!isAppChrome()) {
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

  const count = Number.isFinite(Number(badgeCount))
    ? Math.max(0, Math.floor(Number(badgeCount)))
    : 0;
  const visibleCount = count > 99 ? '99+' : String(count);

  return (
    <Component
      ref={ref}
      {...props}
      {...appInteractionProps(Component, { disabled, loading: false, type, onClick, tabIndex })}
      className={joinClasses('qa-tab-button', selected && 'active', className)}
      data-selected={selected || undefined}
      aria-current={selected ? 'page' : undefined}
    >
      <span className="qa-tab-button__icon">
        <span className="qa-tab-button__glyph" aria-hidden="true">
          {Icon ? <Icon size={22} /> : children}
        </span>
        {count > 0 && (
          <span className="qa-tab-button__badge" aria-label={`${count} 条未读消息`}>
            {visibleCount}
          </span>
        )}
      </span>
      <span className="qa-tab-button__label">{label}</span>
    </Component>
  );
});
