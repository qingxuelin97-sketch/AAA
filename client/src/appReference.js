/*
 * Sanitized interaction contract recovered from the authorized Catbox APK.
 * This module is the small runtime-facing slice of the provenance manifest:
 * no source binaries, brand artwork, vendor SDKs, or platform classes ship
 * with the App.
 */
import chatItemActionConfig from './assets/app-reference/chat-item-action-config-default.json' with { type: 'json' };

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

export const APP_REFERENCE_SCREENS = Object.freeze({
  today: 'catbox-home',
  discover: 'catbox-discover',
  messages: 'catbox-messages',
  profile: 'catbox-profile',
  chat: 'catbox-chat',
  shell: 'catbox-shell',
});

export const APP_DISCOVER_ACTIONS = Object.freeze([
  'like',
  'favorite',
  'comments',
  'share',
  'history',
]);

export const APP_CHAT_MESSAGE_ACTIONS = Object.freeze(
  chatItemActionConfig.actionBar
    .filter((action) => action.show)
    .map((action) => action.id),
);
