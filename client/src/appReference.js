/*
 * Sanitized interaction contract recovered from the authorized mobile
 * reference. It deliberately contains behavior values only: no source
 * binaries, brand artwork, vendor SDKs, or platform-specific classes ship
 * with the App.
 */

export const APP_ROLE_GESTURES = Object.freeze({
  doubleTapLike: Object.freeze({
    maxIntervalMs: 320,
  }),
  messageLongPress: Object.freeze({
    ms: 450,
    moveTol: 10,
  }),
  cardHistoryPauseMs: 600,
});

export const APP_DISCOVER_ACTIONS = Object.freeze([
  'like',
  'favorite',
  'comment',
  'share',
  'history',
]);

export const APP_CHAT_MESSAGE_ACTIONS = Object.freeze([
  'speak',
  'copy',
  'regenerate',
  'react',
  'reply',
  'bookmark',
  'delete',
]);
