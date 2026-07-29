import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import { registrationRequestHash as clientHash } from './src/playIntegrity.js';
import { registrationRequestHash as serverHash } from '../server/integrity.js';
import { mergeMessages, messageId } from './src/groupMessages.js';
import { getAppRoute, statusBarContextForTone } from './src/routeRegistry.js';
import { APP_ROLE_GESTURES, APP_DISCOVER_ACTIONS, APP_CHAT_MESSAGE_ACTIONS } from './src/appReference.js';
import { CallSession } from './src/callSession.js';
import { runBootstrapTasks } from './src/appBootstrapCore.js';
import { reconnectDelay, MAX_RECONNECT_DELAY_MS } from './src/realtimePolicy.js';
import { currentVoiceId, playAudioUrl, stripParensForSpeech } from './src/voice.js';

const fields = { email: ' Test@Example.COM ', username: ' 测试User ' };
assert.equal(await clientHash(fields), serverHash(fields), 'client and server request hashes must match');

const ordered = mergeMessages(
  [{ id: '12', content: 'old' }, { id: 10, content: 'first' }],
  [{ id: 11, content: 'middle' }, { id: 12, content: 'updated' }],
);
assert.deepEqual(ordered.map(messageId), [10, 11, 12], 'messages must be sorted numerically');
assert.equal(ordered.length, 3, 'SSE/poll duplicates must collapse');
assert.equal(ordered[2].content, 'updated', 'newest duplicate payload must win');
assert.equal(stripParensForSpeech('你好（轻声'), '你好 轻声', 'unmatched Chinese parenthesis must not be spoken as punctuation');
assert.equal(stripParensForSpeech('hello (aside'), 'hello aside', 'unmatched ASCII parenthesis must be removed');
assert.equal(stripParensForSpeech('设定【秘密'), '设定 秘密', 'unmatched lenticular bracket must be removed');

const runtimeCss = await readFile(new URL('./src/styles/app-runtime.css', import.meta.url), 'utf8');
assert.doesNotMatch(
  runtimeCss,
  /data-insecure-http[^\n{]*body::after/,
  'HTTP badge must not share the global body texture pseudo-element',
);
assert.match(runtimeCss, /data-insecure-http[^\n{]*\.http-test-badge/, 'HTTP badge must use its own DOM node');

const chatRoute = getAppRoute('/chats/42?from=messages');
assert.equal(chatRoute.parent, '/messages', 'chat detail must return to Messages');
assert.equal(getAppRoute('/today').dock, true, 'top-level Today route must own the Dock');
assert.equal(getAppRoute('/').material, 'clear', 'Discover must own a clear media chrome layer');
assert.equal(getAppRoute('/today').material, 'regular', 'Today must own regular navigation chrome');
assert.equal(getAppRoute('/messages').material, 'regular', 'Messages must own regular navigation chrome');
assert.equal(getAppRoute('/me').material, 'regular', 'Profile must own regular navigation chrome');
assert.equal(chatRoute.material, 'clear', 'Chat media headers must own clear chrome');
assert.deepEqual(
  [
    getAppRoute('/today').referenceScreen,
    getAppRoute('/').referenceScreen,
    getAppRoute('/messages').referenceScreen,
    getAppRoute('/me').referenceScreen,
    chatRoute.referenceScreen,
  ],
  ['catbox-home', 'catbox-discover', 'catbox-messages', 'catbox-profile', 'catbox-chat'],
  'the five routed Catbox-first surfaces must expose a stable reference-screen contract',
);
assert.deepEqual(
  [getAppRoute('/').contentMaterial, chatRoute.contentMaterial],
  ['clear', 'standard'],
  'Discover stays full-bleed while immersive Chat keeps standard message content',
);
assert.equal(APP_ROLE_GESTURES.doubleTapLike.maxIntervalMs, 320, 'role-feed double tap timing must remain deterministic');
assert.equal(APP_ROLE_GESTURES.messageLongPress.ms, 450, 'message long press must remain touch-friendly');
assert.deepEqual([...APP_DISCOVER_ACTIONS], ['like', 'favorite', 'comments', 'share', 'history'], 'role-feed action rail contract must stay ordered');
assert.deepEqual(
  [...APP_CHAT_MESSAGE_ACTIONS],
  ['like', 'dislike', 'report', 'share', 'replay', 'chatShare'],
  'ported chat message actions must retain the approved reference order',
);
assert.deepEqual(
  { parent: getAppRoute('/character/7/edit').parent, dirty: getAppRoute('/character/7/edit').dirty },
  { parent: '/character/7', dirty: 'confirm' },
  'editor route policy must resolve dynamic parents and dirty confirmation',
);
assert.equal(getAppRoute('/future/page').dock, false, 'unknown secondary routes must fail closed without a Dock');
assert.deepEqual(statusBarContextForTone('immersive'), { color: '#0e1013', dark: true }, 'immersive routes must request light system chrome on a dark surface');
assert.equal(statusBarContextForTone('surface'), null, 'surface routes must restore theme-owned system chrome');
assert.deepEqual(
  (({ parent, tab, dock, refresh }) => ({ parent, tab, dock, refresh }))(getAppRoute('/app-controls')),
  { parent: '/today', tab: '/today', dock: false, refresh: 'none' },
  'the App control gallery must be a non-Dock child of Today with refresh disabled',
);

const call = new CallSession();
const initialCall = call.token();
assert.equal(call.isActive(initialCall), true, 'new call generation must be active');
const pendingCallTask = call.task(initialCall);
const nextCall = call.beginTurn();
assert.equal(call.isActive(initialCall), false, 'new turn must invalidate late callbacks from the previous turn');
assert.equal(call.isActive(nextCall), true, 'new turn generation must become active');
assert.equal(pendingCallTask.signal.aborted, true, 'new turn must abort previous network work');
call.end();
assert.equal(call.isActive(nextCall), false, 'hangup must permanently invalidate the active generation');

const originalAudio = globalThis.Audio;
const originalRevokeObjectURL = URL.revokeObjectURL;
const revokedAudioUrls = [];
let rejectedAudioDone = 0;
globalThis.Audio = class RejectedAudio {
  pause() {}
  play() { return Promise.reject(new Error('autoplay denied')); }
};
URL.revokeObjectURL = (url) => { revokedAudioUrls.push(url); };
playAudioUrl('blob:rejected-audio', 'call-voice', { revoke: true, onDone: () => { rejectedAudioDone += 1; } });
await Promise.resolve();
await Promise.resolve();
assert.equal(currentVoiceId(), null, 'rejected autoplay must clear the global playing state');
assert.deepEqual(revokedAudioUrls, ['blob:rejected-audio'], 'rejected autoplay must revoke its one-shot Blob URL');
assert.equal(rejectedAudioDone, 1, 'rejected autoplay must settle its preview control exactly once');
if (originalAudio === undefined) delete globalThis.Audio;
else globalThis.Audio = originalAudio;
URL.revokeObjectURL = originalRevokeObjectURL;

const bootOrder = [];
const boot = await runBootstrapTasks({
  initialize: async () => { bootOrder.push('native'); },
  restoreSession: async () => { bootOrder.push('session'); return { state: 'anonymous' }; },
  finalize: async () => { bootOrder.push('splash'); },
  timeoutMs: 50,
});
assert.deepEqual(bootOrder, ['native', 'session', 'splash'], 'bootstrap must initialize native state before session and always hide Splash');
assert.equal(boot.session.state, 'anonymous', 'successful bootstrap must preserve restored session state');
assert.equal(boot.error, null, 'successful bootstrap must not report an error');
let timeoutFinalized = false;
const timedOut = await runBootstrapTasks({
  initialize: () => new Promise(() => {}),
  finalize: async () => { timeoutFinalized = true; },
  timeoutMs: 5,
});
assert.equal(timedOut.error?.code, 'APP_BOOTSTRAP_TIMEOUT', 'bootstrap must have a hard timeout');
assert.equal(timeoutFinalized, true, 'Splash finalizer must run after a bootstrap timeout');

assert.equal(reconnectDelay(1, () => 0.5), 2000, 'first realtime retry must use bounded exponential backoff');
assert.equal(reconnectDelay(99, () => 0.5), MAX_RECONNECT_DELAY_MS, 'realtime retries must cap delay without permanently giving up');

const mainSource = await readFile(new URL('./src/main.jsx', import.meta.url), 'utf8');
const overlayHooks = await readFile(new URL('./src/chat/hooks.js', import.meta.url), 'utf8');
const realtimeSource = await readFile(new URL('./src/realtime.jsx', import.meta.url), 'utf8');
const layoutSource = await readFile(new URL('./src/components/AppLayout.jsx', import.meta.url), 'utf8');
const catboxDockSource = await readFile(new URL('./src/components/catbox/CatboxDock.jsx', import.meta.url), 'utf8');
const catboxChatSource = await readFile(new URL('./src/components/catbox/CatboxChat.jsx', import.meta.url), 'utf8');
const catboxLottieSource = await readFile(new URL('./src/components/catbox/CatboxLottie.jsx', import.meta.url), 'utf8');
const catboxHomeSource = await readFile(new URL('./src/components/catbox/HomeStoryDeck.jsx', import.meta.url), 'utf8');
const catboxDiscoverRailSource = await readFile(new URL('./src/components/catbox/DiscoverActionRail.jsx', import.meta.url), 'utf8');
const materialSurfaceSource = await readFile(new URL('./src/components/AppMaterialSurface.jsx', import.meta.url), 'utf8');
const appReferenceSource = await readFile(new URL('./src/appReference.js', import.meta.url), 'utf8');
const appSource = await readFile(new URL('./src/App.jsx', import.meta.url), 'utf8');
const navigationSource = await readFile(new URL('./src/appNavigation.jsx', import.meta.url), 'utf8');
const navSource = await readFile(new URL('./src/nav.js', import.meta.url), 'utf8');
const chatSource = await readFile(new URL('./src/pages/Chat.jsx', import.meta.url), 'utf8');
const settingsSource = await readFile(new URL('./src/pages/Settings.jsx', import.meta.url), 'utf8');
const characterEditorSource = await readFile(new URL('./src/pages/CharacterEditor.jsx', import.meta.url), 'utf8');
const scriptEditorSource = await readFile(new URL('./src/pages/ScriptEditor.jsx', import.meta.url), 'utf8');
const worldbookEditorSource = await readFile(new URL('./src/pages/WorldbookEditor.jsx', import.meta.url), 'utf8');
const adminSource = await readFile(new URL('./src/pages/Admin.jsx', import.meta.url), 'utf8');
const callSource = await readFile(new URL('./src/components/CallScreen.jsx', import.meta.url), 'utf8');
const commandSource = await readFile(new URL('./src/components/CommandPalette.jsx', import.meta.url), 'utf8');
const welcomeSource = await readFile(new URL('./src/components/WelcomePopup.jsx', import.meta.url), 'utf8');
const characterViewSource = await readFile(new URL('./src/pages/CharacterView.jsx', import.meta.url), 'utf8');
const appHomeSource = await readFile(new URL('./src/pages/AppHome.jsx', import.meta.url), 'utf8');
const discoverSource = await readFile(new URL('./src/pages/DiscoverFeed.jsx', import.meta.url), 'utf8');
const vipSource = await readFile(new URL('./src/pages/Vip.jsx', import.meta.url), 'utf8');
const artSource = await readFile(new URL('./src/art.jsx', import.meta.url), 'utf8');
const quietCharacterPng = await readFile(new URL('./src/assets/quiet-aqua-character-v3.png', import.meta.url));
const ixTokens = await readFile(new URL('./src/styles/app-ix-tokens.css', import.meta.url), 'utf8');
const quietControls = await readFile(new URL('./src/styles/app-controls.css', import.meta.url), 'utf8');
const quietPages = await readFile(new URL('./src/styles/app-pages-quiet-aqua.css', import.meta.url), 'utf8');
const quietExperience = await readFile(new URL('./src/styles/app-experience-v3.css', import.meta.url), 'utf8');
const roleIosCss = await readFile(new URL('./src/styles/app-role-ios26.css', import.meta.url), 'utf8');
const catboxChatCss = await readFile(new URL('./src/styles/app-catbox-chat.css', import.meta.url), 'utf8');
const quietControlsNoComments = quietControls.replace(/\/\*[\s\S]*?\*\//g, '');
const quietPagesNoComments = quietPages.replace(/\/\*[\s\S]*?\*\//g, '');
const quietExperienceNoComments = quietExperience.replace(/\/\*[\s\S]*?\*\//g, '');
const controlsSource = await readFile(new URL('./src/components/AppControls.jsx', import.meta.url), 'utf8');
const routeChunksSource = await readFile(new URL('./src/routeChunks.js', import.meta.url), 'utf8');
const fxSource = await readFile(new URL('./src/fx.js', import.meta.url), 'utf8');
const runtimeSourceRoot = new URL('./src/', import.meta.url);
const runtimeSourceNames = (await readdir(runtimeSourceRoot, { recursive: true }))
  .filter((name) => /\.(?:js|jsx|css|html)$/i.test(name));
const runtimeSource = (await Promise.all(runtimeSourceNames.map((name) => (
  readFile(new URL(String(name).replaceAll('\\', '/'), runtimeSourceRoot), 'utf8')
)))).join('\n');
const appRuntimeSourceNames = runtimeSourceNames.filter((name) => {
  const normalized = String(name).replaceAll('\\', '/');
  return normalized === 'chat/chat-app.css' || normalized.startsWith('styles/app-');
});
const appRuntimeSource = (await Promise.all(appRuntimeSourceNames.map((name) => (
  readFile(new URL(String(name).replaceAll('\\', '/'), runtimeSourceRoot), 'utf8')
)))).join('\n');
const economySource = await readFile(new URL('../server/routes/economy.js', import.meta.url), 'utf8');
const mockBackendSource = await readFile(new URL('./src/mock/backend.js', import.meta.url), 'utf8');
assert.match(mainSource, /!NATIVE\s*&&\s*'serviceWorker' in navigator/, 'native shell must never register the PWA service worker');
assert.doesNotMatch(overlayHooks, /pushState|replaceState/, 'overlay back handling must not mutate browser history');
assert.doesNotMatch(realtimeSource, /MAX_RETRIES/, 'realtime connection must not stop forever after six failures');
assert.match(layoutSource, /paneLru\.current\.length > SWIPE_TABS\.length/, 'all four top-level App tabs must remain eligible for KeepAlive');
assert.match(navigationSource, /requestNavigate[\s\S]*confirmNavigation/, 'AppNavProvider must expose one authoritative dirty-navigation guard');
assert.match(navSource, /appNavigation\.confirmNavigation\(\)/, 'useNav must guard every forward App navigation');
assert.match(layoutSource, /navTo\(to\) !== false/, 'Create Sheet must keep its context when dirty navigation is cancelled');
assert.match(characterEditorSource, /useUnsavedValue\(c,\s*loaded/, 'character edits must register with the App dirty-navigation guard');
assert.match(scriptEditorSource, /useUnsavedValue\(s,\s*loaded/, 'script edits must register with the App dirty-navigation guard');
assert.match(worldbookEditorSource, /useUnsavedValue\(wb,\s*loaded/, 'worldbook edits must register with the App dirty-navigation guard');
assert.match(appSource, /path="\/chats"[\s\S]*isAppMode\(\) \? <Navigate to="\/messages"/, 'App /chats must redirect to Messages while Web keeps Chat');
assert.match(chatSource, /revoke:\s*mid == null/, 'anonymous Chat auto-read audio must be one-shot');
assert.doesNotMatch(settingsSource, /new Audio\(URL\.createObjectURL/, 'Settings TTS preview must use managed global audio');
assert.doesNotMatch(characterEditorSource, /new Audio\(URL\.createObjectURL/, 'Character editor TTS preview must use managed global audio');
assert.doesNotMatch(adminSource, /new Audio\(URL\.createObjectURL/, 'Admin TTS preview must use managed global audio');
assert.match(chatSource, /voiceRequestRef[\s\S]*signal:\s*controller\.signal/, 'Chat TTS must abort and ignore requests that outlive the conversation');
assert.match(settingsSource, /voiceAbortRef[\s\S]*signal:\s*controller\.signal/, 'Settings TTS preview must abort on tab/page exit');
assert.match(characterEditorSource, /voiceAbortRef[\s\S]*signal:\s*controller\.signal/, 'character TTS preview must abort on editor exit');
assert.match(adminSource, /voiceAbortRef[\s\S]*signal:\s*controller\.signal/, 'Admin TTS preview must abort when its platform tab unmounts');
assert.doesNotMatch(chatSource, /huanyu-statusbar/, 'Chat must not race the Route Registry with a bespoke status-bar override');
assert.match(layoutSource, /huanyu-statusbar[\s\S]*statusBarContextForTone\(route\.statusBar\)/, 'AppLayout must execute Route Registry status-bar metadata');
assert.match(chatSource, /const isCurrent = \(\) => abortRef\.current === ctrl[\s\S]*if \(!isCurrent\(\)\) return;/, 'late SSE callbacks must not mutate a newly selected conversation');
assert.match(callSource, /isolate:\s*appPortal[\s\S]*createPortal\(screen/, 'full-screen App calls must portal outside and isolate the background');
assert.match(commandSource, /isolate:\s*appPortal[\s\S]*createPortal\(palette/, 'App command palette must isolate background focus');
assert.match(welcomeSource, /isolate:\s*appPortal[\s\S]*createPortal\(popup/, 'App welcome modal must isolate background focus');
assert.match(commandSource, /nav\(row\.n\.to\) !== false[\s\S]*result !== false/, 'command palette must stay open when dirty navigation is cancelled');
assert.match(welcomeSource, /nav\('\/events'\) !== false[\s\S]*close\(\)/, 'welcome modal must stay open when dirty navigation is cancelled');
assert.match(appHomeSource, /e\?\.code === 'ALREADY_CHECKED_IN'[\s\S]*签到失败，请稍后重试/, 'check-in UI must only mark an explicit duplicate as complete');
assert.match(economySource, /status\(409\)[\s\S]*code:\s*'ALREADY_CHECKED_IN'/, 'real backend must return a stable duplicate check-in code');
assert.match(mockBackendSource, /E\('今天已经签到过啦', 409, 'ALREADY_CHECKED_IN'\)/, 'HTTP static mock must mirror duplicate check-in semantics');
/* ---- S7 backend/mock 双轨配对守卫 ---- */
assert.match(economySource, /checkin\/calendar/, 'the check-in calendar must be derived server-side');
assert.match(mockBackendSource, /economy\/checkin\/calendar/, 'the static mock must mirror the check-in calendar endpoint');
assert.match(mockBackendSource, /PAYMENT_ORDER_REQUIRED/, 'the static mock must never mint currency from a bare recharge call');
assert.match(mockBackendSource, /\/economy\/packages/, 'the static mock must serve the read-only wallet package list');
assert.match(mockBackendSource, /\/economy\/transactions/, 'the static mock must serve the read-only transaction ledger');
assert.match(mockBackendSource, /engage\\\/tasks\\\/\(\[\\w-\]\+\)/, 'the mock daily-task claim route must accept every real task id');
const settingsSourceForInterests = await readFile(new URL('../server/routes/settings.js', import.meta.url), 'utf8');
assert.match(settingsSourceForInterests, /sanitizeInterests/, 'interest tags must be whitelisted server-side');
assert.match(mockBackendSource, /body\.interests/, 'interest tags must have a static-mock twin');
const achIdsOf = (src) => {
  const block = src.match(/const ACHIEVEMENTS = \[[\s\S]*?\n\];/)?.[0] || '';
  return [...block.matchAll(/\{ id: '([a-z0-9_]+)'/g)].map((match) => match[1]).sort();
};
const serverAchievementsSource = await readFile(new URL('../server/routes/achievements.js', import.meta.url), 'utf8');
assert.deepEqual(achIdsOf(serverAchievementsSource), achIdsOf(mockBackendSource), 'server and mock achievement catalogues must stay the same set');
assert.ok(achIdsOf(serverAchievementsSource).length >= 30, 'the achievement catalogue must keep the parliament and friendship tiers');
assert.match(mockBackendSource, /honor: !!a\.honor/, 'the mock must surface the honor flag with server semantics');
/* ---- S7-G10 周报双轨配对 ---- */
const meRouteSource = await readFile(new URL('../server/routes/me.js', import.meta.url), 'utf8');
assert.match(meRouteSource, /router\.get\('\/weekly'[\s\S]*cnToday/, 'the weekly recap must be derived server-side on the Beijing week boundary');
assert.match(meRouteSource, /\(t\.getUTCDay\(\) \+ 6\) % 7/, 'the weekly recap week must start on Monday, not the JS Sunday default');
assert.match(mockBackendSource, /path === '\/me\/weekly'[\s\S]*week_start/, 'the static mock must mirror the weekly recap endpoint and shape');
for (const key of ['week_start', 'active_days', 'gold_earned', 'gold_spent', 'new_friends', 'companion']) {
  assert.ok(meRouteSource.includes(key) && mockBackendSource.includes(key), `weekly recap field "${key}" must exist on both backends`);
}
/* ---- S7-G10 会话整理双轨配对 ---- */
const chatRouteSource = await readFile(new URL('../server/routes/chat.js', import.meta.url), 'utf8');
assert.match(chatRouteSource, /ORDER BY cv\.pinned DESC, cv\.updated_at DESC/, 'pinned conversations must sort first server-side');
assert.match(chatRouteSource, /markOnly[\s\S]*if \(!markOnly\) db\.prepare\("UPDATE conversations SET updated_at/, 'pin/mute toggles must never bump the conversation sort timestamp');
assert.match(mockBackendSource, /\(b\.pinned \|\| 0\) - \(a\.pinned \|\| 0\)/, 'the static mock must mirror pinned-first ordering');
assert.match(mockBackendSource, /if \(!markOnly\) conv\.updated_at = now\(\)/, 'the static mock must mirror mark-only PATCH semantics');
const dbSource = await readFile(new URL('../server/db.js', import.meta.url), 'utf8');
assert.match(dbSource, /ALTER TABLE conversations ADD COLUMN pinned INTEGER DEFAULT 0/, 'the pinned column must ship as a migration');
assert.match(dbSource, /ALTER TABLE conversations ADD COLUMN muted INTEGER DEFAULT 0/, 'the muted column must ship as a migration');
assert.match(characterViewSource, /loadError[\s\S]*EmptyArt[\s\S]*nav\('\/library'\)/, 'character load failures must offer a real recovery empty state');
const insightsSource = await readFile(new URL('./src/pages/Insights.jsx', import.meta.url), 'utf8');
assert.match(insightsSource, /AppErrorState[\s\S]*onRetry=\{load\}/, 'Insights first-load failure must offer the unified App recovery state');
const errorStateSource = await readFile(new URL('./src/components/AppErrorState.jsx', import.meta.url), 'utf8');
assert.match(errorStateSource, /role="alert"[\s\S]*AppEmptyArt[\s\S]*onRetry/, 'AppErrorState must pair alert semantics with art and a retry action');
const e2eSourceForS7 = await readFile(new URL('../server/quiet-aqua-e2e.mjs', import.meta.url), 'utf8');
assert.match(e2eSourceForS7, /insightsRecoveryAssertions/, 'the e2e suite must keep exercising the Insights offline-retry recovery');
assert.match(e2eSourceForS7, /captureCatboxScreens[\s\S]*width:\s*390,\s*height:\s*844[\s\S]*width:\s*430,\s*height:\s*932/,
  'the Catbox-first visual gate must retain both 390x844 and 430x932 handoff captures');
for (const screen of ['today', 'discover', 'messages', 'profile', 'chat', 'app-layout-create']) {
  assert.match(e2eSourceForS7, new RegExp(`['\`]+${screen}(?:-|['\`])`),
    `the Catbox-first visual gate must keep the ${screen} surface`);
}
/* ---- S7-G3 首启引导契约 ---- */
const onboardingSource = await readFile(new URL('./src/components/AppOnboarding.jsx', import.meta.url), 'utf8');
assert.match(onboardingSource, /huanyu_onboard_done[\s\S]*accountIsFresh/, 'onboarding must gate on both the stored key and account freshness');
assert.match(onboardingSource, /localStorage\.setItem\(ONBOARD_KEY[\s\S]*return;/, 'veteran accounts must be silently marked instead of interrupted');
assert.match(onboardingSource, /isolate:\s*appPortal[\s\S]*createPortal\(popup/, 'onboarding must keep the App overlay isolation contract');
assert.match(onboardingSource, /personalize[\s\S]*interests/, 'the interest picker must honour the personalize consent switch');
assert.match(layoutSource, /<AppOnboarding \/>[\s\S]*<WelcomePopup \/>/, 'onboarding must mount inside the App shell ahead of the daily welcome');
assert.match(e2eSourceForS7, /onboard = true[\s\S]*huanyu_onboard_done/, 'the e2e harness must pre-seed the onboarding key so baselines stay onboarding-blind');
assert.match(e2eSourceForS7, /onboardingAssertions/, 'the e2e suite must keep exercising the first-run onboarding flow');
/* ---- S7-G4 签到仪式契约 ---- */
assert.match(appHomeSource, /CheckinCalendarSheet[\s\S]*qa-streak/, 'the Today page must surface the streak week view with a calendar entry');
assert.match(appHomeSource, /burst\(/, 'a successful check-in must fire the one-shot celebration');
assert.doesNotMatch(appHomeSource, /setInterval\(\s*\(\)\s*=>\s*burst/, 'celebrations must stay one-shot, never looping');
assert.match(appHomeSource, /engage\/tasks\/\$\{t\.id\}\/claim/, 'daily tasks must be claimable inline on the Today page');
const calendarSheetSource = await readFile(new URL('./src/components/CheckinCalendarSheet.jsx', import.meta.url), 'utf8');
assert.match(calendarSheetSource, /checkin\/calendar[\s\S]*role="grid"/, 'the calendar sheet must render the server-derived history as an accessible grid');
assert.match(calendarSheetSource, /isolate:\s*appPortal[\s\S]*createPortal\(sheet/, 'the calendar sheet must keep the App overlay isolation contract');
assert.match(e2eSourceForS7, /todayRitualAssertions/, 'the e2e suite must keep exercising the check-in ritual');
/* ---- S7-G10 周报卡契约 ---- */
assert.match(appHomeSource, /\/me\/weekly'\)[\s\S]*catch\(\(\) => setWeekly\(null\)\)/, 'the weekly recap must hide silently on failure, never error the home');
assert.match(appHomeSource, /weekly && weekly\.messages > 0 &&/, 'the weekly recap must only appear once there is a story to tell');
assert.match(appHomeSource, /qa-weekly-bars"[\s\S]*role="img"[\s\S]*aria-label/, 'the weekly bars must expose a text alternative for the whole chart');
const ixTailSource = await readFile(new URL('./src/styles/app-ix-pages-d.css', import.meta.url), 'utf8');
assert.match(ixTailSource, /\.qa-weekly-card/, 'the weekly recap card must land in the migrated IX page tail');
assert.match(ixTailSource, /\[data-perf="lite"\][\s\S]*\.qa-weekly-card[\s\S]*backdrop-filter:\s*none/, 'the weekly card must drop its blur on the lite tier');
/* ---- S7-G10 Gallery 展区契约 ---- */
const gallerySource = await readFile(new URL('./src/pages/AppControlsGallery.jsx', import.meta.url), 'utf8');
assert.match(gallerySource, /gallery-s7-empty[\s\S]*gallery-s7-streak[\s\S]*gallery-s7-medal[\s\S]*gallery-s7-weekly[\s\S]*gallery-s7-press/, 'the controls gallery must exhibit the full S7 component family');
assert.match(gallerySource, /<AppErrorState[\s\S]*onRetry=\{demoRetry\}/, 'the gallery error-state demo must exercise a real retry affordance');
assert.match(gallerySource, /<AppPressMenu[\s\S]*returnFocusRef=\{pressAnchorRef\}/, 'the gallery press-menu demo must return focus to its anchor');
/* ---- S7-G5 成就 2.0 契约 ---- */
const achievementsSource = await readFile(new URL('./src/pages/Achievements.jsx', import.meta.url), 'utf8');
assert.match(achievementsSource, /data-medal=\{medalOf\(achievement\.reward\)\}/, 'App achievement rarity must derive from the shared reward formula');
assert.match(achievementsSource, /data-honor[\s\S]*荣誉/, 'honor achievements must surface the badge semantics');
assert.match(achievementsSource, /achievement\.honor[\s\S]*已铭刻/, 'unlocked honor achievements must never expose a claim button');
assert.match(achievementsSource, /qa-ach-wall[\s\S]*aria-valuenow/, 'the badge wall must expose per-category completion as progressbars');
assert.match(achievementsSource, /setCelebrating[\s\S]*setTimeout/, 'the claim celebration must be one-shot and self-clearing');
assert.match(e2eSourceForS7, /achievementsAssertions/, 'the e2e suite must keep exercising achievements 2.0');
/* ---- S7-G6 分享卡契约 ---- */
const shareCardSource = await readFile(new URL('./src/sharecard.js', import.meta.url), 'utf8');
assert.doesNotMatch(runtimeSource, /html2canvas|dom-to-image/, 'share cards must stay hand-composited without raster dependencies');
assert.match(shareCardSource, /document\.fonts/, 'the compositor must wait for fonts before painting text');
assert.match(shareCardSource, /CARD_W = 1080[\s\S]*CARD_H = 1440/, 'export resolution must stay fixed and DPR-decoupled');
const shareSheetSource = await readFile(new URL('./src/components/ShareCardSheet.jsx', import.meta.url), 'utf8');
assert.match(shareSheetSource, /canShare[\s\S]*download/, 'sharing must probe navigator.canShare and keep a download fallback');
assert.match(shareSheetSource, /import\('\.\.\/sharecard\.js'\)/, 'the compositor must load lazily outside the first-screen bundle');
assert.match(characterViewSource, /ShareCardSheet/, 'the character view must expose the share-card entry');
assert.match(e2eSourceForS7, /shareCardAssertions/, 'the e2e suite must keep exercising the share-card flow');
/* ---- S7-G10 台词卡契约 ---- */
assert.match(shareCardSource, /renderQuoteCard/, 'the compositor must offer the quote-card template');
assert.match(shareSheetSource, /kind === 'quote'[\s\S]*renderQuoteCard/, 'the share sheet must route the quote kind to its template');
assert.match(chatSource, /app && !!m\.content && \([\s\S]*生成台词卡/, 'the quote-card entry must stay App-only');
assert.match(chatSource, /speaker: quoteShare\.role === 'user' \? \(user\?\.display_name[\s\S]*: character\.name/, 'quote cards must attribute the line to its real speaker on both sides');
assert.match(chatSource, /sheetOpenedAtRef\.current = performance\.now\(\);[\s\S]*msg-sheet-mask" onClick=\{\(\) => \{ if \(performance\.now\(\) - sheetOpenedAtRef\.current < 350\) return;/, 'the message sheet mask must swallow the trailing long-press click');
/* ---- S7-G10 抽卡晒卡与收藏筛选 ---- */
const gachaSource = await readFile(new URL('./src/pages/Gacha.jsx', import.meta.url), 'utf8');
assert.match(gachaSource, /isAppMode\(\) && \([\s\S]*晒出这张卡/, 'the gacha share entry must stay App-only');
assert.match(gachaSource, /isAppMode\(\) && shareOpen && result &&[\s\S]*kind="character"/, 'gacha results must share through the character template');
const favoritesSource = await readFile(new URL('./src/pages/Favorites.jsx', import.meta.url), 'utf8');
assert.match(favoritesSource, /app && !loading && cats\.length >= 2[\s\S]*qa-fav-cats/, 'favorite category chips must stay App-only and need two categories');
assert.match(favoritesSource, /该分类下暂无收藏/, 'an emptied favorite filter must explain itself');
/* ---- S7-G10 公告已读记忆 ---- */
const announcementsSource = await readFile(new URL('./src/pages/Announcements.jsx', import.meta.url), 'utf8');
assert.match(announcementsSource, /if \(app\) \{[\s\S]*huanyu_ann_seen/, 'announcement read-memory must stay App-gated');
assert.match(announcementsSource, /setNewIds\(new Set\(\(d\.announcements \|\| \[\]\)\.filter/, 'NEW badges must be computed in lockstep with the fetched data, not a trailing effect');
assert.match(announcementsSource, /\.slice\(-100\)/, 'the seen-id ledger must stay bounded');
assert.match(announcementsSource, /app && newIds\.has\(a\.id\) && <span className="qa-ann-new"/, 'unseen announcements must badge only inside the App shell');
/* ---- S7-G10 群聊分段 ---- */
const groupsSource = await readFile(new URL('./src/pages/Groups.jsx', import.meta.url), 'utf8');
assert.match(groupsSource, /groups\.some\(g => g\.joined\) && groups\.some\(g => !g\.joined\)[\s\S]*qa-groups-seg/, 'the join-state segment must appear only when both sides exist');
assert.match(groupsSource, /seg === 'joined' \? g\.joined : !g\.joined/, 'segment filtering must partition by joined state');
/* ---- S7-G10 画廊长按 ---- */
const drawSource = await readFile(new URL('./src/pages/Draw.jsx', import.meta.url), 'utf8');
assert.match(drawSource, /app \? bindTilePress\(/, 'gallery tiles must bind long-press only inside the App shell');
assert.match(drawSource, /label: '删除作品', danger: true/, 'the gallery press menu must mark deletion as destructive');
/* ---- S7-G10 星轨年鉴卡契约 ---- */
assert.match(shareCardSource, /renderInsightsCard/, 'the compositor must offer the insights annual-card template');
assert.match(shareSheetSource, /kind === 'insights'[\s\S]*renderInsightsCard/, 'the share sheet must route the insights kind to its template');
assert.match(insightsSource, /appMode && \([\s\S]*生成星轨卡/, 'the insights share entry must stay App-only');
assert.match(insightsSource, /kind="insights"[\s\S]*companion: d\.companions\[0\]/, 'the insights card must carry the deepest-bond companion');
/* ---- S7-G7 微交互契约 ---- */
const messagesSource = await readFile(new URL('./src/pages/Messages.jsx', import.meta.url), 'utf8');
assert.match(messagesSource, /AppPressMenu[\s\S]*useLongPress/, 'conversation rows must offer the long-press context menu');
const pressMenuSource = await readFile(new URL('./src/components/AppPressMenu.jsx', import.meta.url), 'utf8');
assert.match(pressMenuSource, /isolate:\s*appPortal[\s\S]*createPortal\(menu/, 'the press menu must keep the App overlay isolation contract');
assert.match(pressMenuSource, /role="menu"/, 'the press menu must expose menu semantics');
const gesturesSource = await readFile(new URL('./src/appgestures.js', import.meta.url), 'utf8');
assert.match(gesturesSource, /qa-onboard[\s\S]*qa-cal[\s\S]*qa-share-sheet/, 'new self-owned gesture surfaces must opt out of tab-swipe and pull-to-refresh');
const appProfileSource = await readFile(new URL('./src/pages/AppProfile.jsx', import.meta.url), 'utf8');
assert.match(appProfileSource, /CountUp value=\{s\.n\}/, 'profile stats must animate with the shared CountUp');
assert.match(e2eSourceForS7, /pressMenuAssertions/, 'the e2e suite must keep exercising the press-menu flow');
/* ---- S7-G10 会话整理与草稿契约 ---- */
assert.match(messagesSource, /toggleConvMark[\s\S]*取消置顶[\s\S]*免打扰/, 'the press menu must toggle pin and mute marks');
assert.match(messagesSource, /msgs-draft[\s\S]*草稿/, 'the conversation row must surface an unsent draft first');
assert.match(messagesSource, /CatboxMessageNoticeGroup[\s\S]*msgs-tab-chatted[\s\S]*msgs-panel-chatted/, 'App Messages must keep a data-driven notice group and linked tab panels');
assert.match(messagesSource, /Boolean\(a\.pinned\)[\s\S]*updated_at/, 'App conversation ordering must keep pinned conversations above chronological rows');
assert.match(appProfileSource, /CatboxProfileQuickRail[\s\S]*cbx-profile/, 'App Profile must use the dedicated quick-access rail');
const messageProfileCss = await readFile(new URL('./src/styles/app-catbox-messages-profile.css', import.meta.url), 'utf8');
assert.match(messageProfileCss, /html\[data-app="1"\]/, 'Messages/Profile App composition must remain App-scoped');
assert.doesNotMatch(messageProfileCss.replace(/\/\*[\s\S]*?\*\//g, ''), /(^|\})\s*:root\b/m, 'Messages/Profile composition must not leak root tokens into Web');
assert.match(appHomeSource, /<HomeStoryDeck[\s\S]*resume=\{resume\}[\s\S]*picks=\{null\}/, 'Today must render the migrated story deck as its live resume surface');
assert.doesNotMatch(appHomeSource, /\{false\s*&&/, 'Today must not retain a dead legacy card tree beside the migrated deck');
assert.match(catboxHomeSource, /继续进行[\s\S]*你的故事[\s\S]*遇见新角色/, 'the migrated Today deck must retain the reference reading order');
assert.match(discoverSource, /<DiscoverActionRail/, 'Discover must render the migrated action rail');
assert.match(discoverSource, /<CatboxLottie[\s\S]*name="doubleTapLike"/, 'Discover must play the migrated double-tap animation');
assert.doesNotMatch(discoverSource, /fd2-acts--legacy/, 'the obsolete Discover action rail must leave the App DOM');
assert.match(catboxDiscoverRailSource, /className="fd2-acts cbx-action-rail"[\s\S]*className=\{`fd2-act/, 'the live Discover rail must preserve the fd2 action hooks');
assert.match(chatSource, /HeaderSurface = app \? CatboxChatMediaHeader[\s\S]*<HeaderSurface/, 'immersive Chat must render the migrated media header');
assert.match(chatSource, /ComposerSurface = app \? CatboxChatComposerSurface[\s\S]*<ComposerSurface/, 'immersive Chat must render the migrated composer');
assert.match(chatSource, /MessageFrame = app \? CatboxChatMessageFrame[\s\S]*<MessageFrame/, 'immersive Chat must render migrated message cards');
assert.match(chatSource, /<CatboxChatActionBar/, 'immersive Chat must render the APK-ordered action bar');
assert.match(catboxChatSource, /variant="clear"[\s\S]*variant="regular"[\s\S]*variant="standard"/, 'Chat must map media, transient chrome, and messages to clear/regular/standard materials');
assert.match(catboxChatSource, /APP_CHAT_MESSAGE_ACTIONS\.map/, 'the rendered Chat action bar must consume the APK-derived action order');
assert.match(catboxLottieSource, /lottie_light[\s\S]*prefers-reduced-motion[\s\S]*fallback/, 'reference animation playback must use the light runtime and a reduced-motion fallback');
assert.match(catboxChatCss, /min-(?:width|height): 44px/, 'Catbox Chat actions must preserve the 44px touch-target floor');
for (const [name, css] of [['role', roleIosCss], ['chat', catboxChatCss], ['messages/profile', messageProfileCss]]) {
  assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ''), /(?:^|[;{]\s*|\n\s*)(--(?!ix-)[a-z0-9-]+)\s*:/gm, `Catbox ${name} CSS must consume the IX token authority rather than define a parallel token set`);
}
assert.match(chatSource, /if \(!app \|\| !id \|\| loc\.state\?\.draft\) return;/, 'draft restore must stay App-gated and yield to one-shot prefills');
assert.match(chatSource, /localStorage\.setItem\('huanyu_draft_' \+ id, input\);[\s\S]*localStorage\.removeItem\('huanyu_draft_' \+ id\);/, 'an emptied composer must delete its stored draft');
for (const scenario of ['weeklyRecapAssertions', 'walletCalendarAssertions', 'quoteCardAssertions', 'galleryS7Assertions', 'conversationMarksAssertions', 'draftAssertions', 's7DarkTierAssertions', 'g10SurfaceAssertions', 'g10SurfaceBAssertions']) {
  assert.ok(new RegExp(`await ${scenario}\\(browser, base\\)`).test(e2eSourceForS7), `the e2e suite must keep running ${scenario}`);
}
/* ---- S7-G10 剧场台词卡与群聊长按 ---- */
const theaterRoomSource = await readFile(new URL('./src/pages/TheaterRoom.jsx', import.meta.url), 'utf8');
assert.match(theaterRoomSource, /台词卡<\/AppButton>/, 'theater passages must offer the quote-card export');
assert.match(theaterRoomSource, /appMode && quoteShare[\s\S]*kind="quote"[\s\S]*'旁白'/, 'theater quote cards must stay App-only and attribute narrator lines');
const groupRoomSource = await readFile(new URL('./src/pages/GroupRoom.jsx', import.meta.url), 'utf8');
assert.match(groupRoomSource, /app \? bindMsgPress\(pressPayload\) : \{\}/, 'group bubbles must bind long-press only inside the App shell');
assert.match(groupRoomSource, /label: `@\$\{pressMsg\.nm\}`/, 'the group press menu must offer an @-mention insert');
/* ---- S7-G10 钱包流水筛选 ---- */
const walletSource = await readFile(new URL('./src/pages/Wallet.jsx', import.meta.url), 'utf8');
assert.match(walletSource, /qa-wallet-v4__tx-filter" role="group"/, 'the App ledger filter must expose group semantics');
assert.match(walletSource, /txFilter === 'checkin' \? t\.kind === 'checkin'/, 'the checkin filter must select by transaction kind, not sign');
assert.match(walletSource, /该类别暂无记录/, 'an emptied filter view must explain itself instead of collapsing');
/* ---- S7-G10 里程碑印章分档 ---- */
const artSourceForSeals = await readFile(new URL('./src/art.jsx', import.meta.url), 'utf8');
assert.match(artSourceForSeals, /streakSealForTier = \(streak\) => \(streak >= 100[\s\S]*streak >= 30/, 'milestone seals must tier at 100 and 30 days');
const renderScriptSource = await readFile(new URL('../scripts/render-app-assets.mjs', import.meta.url), 'utf8');
assert.doesNotMatch(renderScriptSource, /qa5-(?:empty|onboard|streak-seal|boot-mark|vip-weave)/, 'the retired raster asset pipeline must not recreate Lumen empty, onboarding, stamp, boot, or VIP-weave assets');
assert.match(renderScriptSource, /nativeJobs|NATIVE_JOBS/, 'the asset pipeline must retain the native resource entry point');
assert.match(shareCardSource, /streakSealForTier\(Number\(streak\)/, 'the streak card must pick its seal by milestone tier');
assert.match(appHomeSource, /qa-milestone-seal[\s\S]*streakSealForTier\(milestone\)/, 'the milestone banner must show the tiered seal');
/* ---- S7-G10 排行榜我的名次双轨 ---- */
const engageSource = await readFile(new URL('../server/routes/engage.js', import.meta.url), 'utf8');
assert.match(engageSource, /mine = \{ rank: higher \+ 1, score: myScore \}/, 'the leaderboard must rank the caller server-side');
assert.match(mockBackendSource, /mine = \{ rank: higher \+ 1, score: myScore \}/, 'the static mock must mirror caller ranking');
const leaderboardSource = await readFile(new URL('./src/pages/Leaderboard.jsx', import.meta.url), 'utf8');
assert.match(leaderboardSource, /tab === 'authors' && data\?\.me &&[\s\S]*qa-lb-mine/, 'the App creators tab must pin the caller rank row');
/* ---- S7-G10 触感开关 ---- */
assert.match(gesturesSource, /huanyu_haptics'\) === '0'\) return;/, 'tick() must honour the haptics opt-out before vibrating');
const settingsPageSource = await readFile(new URL('./src/pages/Settings.jsx', import.meta.url), 'utf8');
assert.match(settingsPageSource, /app && \([\s\S]*qa-haptics-row/, 'the haptics switch must stay App-only');
/* ---- S7-G10 搜索分类 / 任务全领 / 新功能 Sheet ---- */
const searchSource = await readFile(new URL('./src/pages/Search.jsx', import.meta.url), 'utf8');
assert.match(searchSource, /app && !res && !loading && cats\.length > 0[\s\S]*qa-search-cats/, 'hot category chips must stay App-only on the empty panel');
assert.match(searchSource, /tabOverride: 'character'/, 'category chips must search as characters regardless of the active tab');
const eventsSource = await readFile(new URL('./src/pages/Events.jsx', import.meta.url), 'utf8');
assert.match(eventsSource, /claimAllTasks[\s\S]*单条失败不拦后续|单条失败不拦后续[\s\S]*claimAllTasks/, 'claim-all must tolerate per-task races');
assert.match(eventsSource, /app && tasks\.filter\(t => t\.done && !t\.claimed\)\.length >= 2/, 'the claim-all button must stay App-only and appear from two claimables');
const whatsNewSource = await readFile(new URL('./src/components/WhatsNewSheet.jsx', import.meta.url), 'utf8');
assert.match(whatsNewSource, /isolate: appPortal[\s\S]*createPortal\(sheet/, 'the whats-new sheet must keep the App overlay isolation contract');
assert.match(appProfileSource, /WhatsNewSheet onClose/, 'the profile footer must open the whats-new sheet');
/* ---- S7-G10 相伴档案与相伴一览 ---- */
assert.match(characterViewSource, /bond && \([\s\S]*qa-bond[\s\S]*继续这段故事/, 'the character page must surface the bond dossier with a resume CTA');
assert.match(characterViewSource, /\(b\.affinity \|\| 0\) > \(a\.affinity \|\| 0\)/, 'the bond CTA must resume the highest-affinity conversation');
assert.match(appProfileSource, /qa-glance" role="group"[\s\S]*相伴一览/, 'the profile must expose the companion glance group');
assert.match(appProfileSource, /Promise\.allSettled\(\[api\('\/achievements'\), api\('\/me\/weekly'\)\]\)/, 'the glance must degrade gracefully per data source');
/* ---- S7-G10 私信长按/草稿与群聊提及高亮 ---- */
const friendsSource = await readFile(new URL('./src/pages/Friends.jsx', import.meta.url), 'utf8');
assert.match(friendsSource, /appMode \? bindDmPress\(pressPayload\) : \{\}/, 'DM bubbles must bind long-press only inside the App shell');
assert.match(friendsSource, /huanyu_dmdraft_' \+ sel, text\)[\s\S]*localStorage\.removeItem\('huanyu_dmdraft_' \+ sel\)/, 'an emptied DM composer must delete its stored draft');
assert.match(friendsSource, /if \(!appMode \|\| !sel\) return;[\s\S]*huanyu_dmdraft_/, 'DM drafts must stay App-gated');
assert.match(groupRoomSource, /if \(!app\) return content;[\s\S]*gr-mention/, 'mention highlighting must never leak into the Web bubble DOM');
/* ---- S7-G10 里程碑地平线 / 新功能未读点 / 分档印章沿用 ---- */
assert.match(calendarSheetSource, /\[Math\.ceil\(\(s \+ 1\) \/ 7\) \* 7, 30, 100\]\.filter\(\(t\) => t > s\)/, 'the milestone horizon must target the nearest 7-multiple, 30 or 100');
assert.match(calendarSheetSource, /streakSealForTier\(data\?\.streak \|\| 0\)/, 'the calendar seal must follow the milestone tier');
assert.match(appProfileSource, /huanyu_whatsnew_seen'\) === 'S7'/, 'the whats-new dot must key on the current version');
assert.match(appProfileSource, /pf-whatsnew-dot/, 'the unread dot must sit on the whats-new entry');
assert.match(gallerySource, /gallery-s7-companion[\s\S]*qa-gallery__lbmine/, 'the gallery must exhibit the companion dossier family');
/* ---- S7-G10 阅读进度记忆 ---- */
const novelReaderSource = await readFile(new URL('./src/pages/NovelReader.jsx', import.meta.url), 'utf8');
assert.match(novelReaderSource, /if \(!app \|\| !data\) return;[\s\S]*huanyu_read_' \+ id/, 'reading progress must stay App-gated');
assert.match(novelReaderSource, /saved > 0\.01 && saved < 0\.999/, 'near-start and finished runs must reopen from the top');
assert.match(novelReaderSource, /if \(!isAppMode\(\)\) return 18;/, 'font-size memory must never change the Web reader');
const characterRecoveryIndex = characterViewSource.indexOf('if (!c && loadError)');
const characterDispatchIndex = characterViewSource.indexOf('const shared =');
assert.ok(
  characterRecoveryIndex >= 0 && characterDispatchIndex > characterRecoveryIndex,
  'character error/retry recovery must run in the parent before App/Web view dispatch',
);
assert.match(runtimeCss, /\.topbar h1,[\s\S]*word-break:\s*keep-all/, 'narrow App topbar titles must not stack vertically');
assert.match(runtimeCss, /\.topbar\s*\{[^}]*flex-wrap:\s*wrap;[^}]*row-gap:\s*10px;/, 'dense narrow App topbars must wrap whole controls without horizontal overflow');
assert.match(runtimeCss, /\.vm-plans\s*\{\s*padding-top:\s*12px/, 'VIP plans must reserve space for the raised badge');
assert.match(runtimeCss, /\.app-tabbar[\s\S]*var\(--ix-blur\)/, 'App Dock must use the IX chrome blur authority directly on high and balanced tiers');
assert.match(runtimeCss, /\[data-perf="lite"\]\s*\.app-tabbar\s*\{[^}]*backdrop-filter:\s*none/s, 'lite tier must drop the Dock blur and fall back to an opaque surface');

// W6 CSS 按模式分包：App 层样式的静态 import 与级联顺序整体迁入
// styles/app-entry.js；main.jsx 只保留 isAppMode() 门控的 render 前动态加载。
const appEntrySource = await readFile(new URL('./src/styles/app-entry.js', import.meta.url), 'utf8');
assert.ok(
  appEntrySource.indexOf('chat-app.css') < appEntrySource.indexOf('app-runtime.css')
    && appEntrySource.indexOf('app-runtime.css') < appEntrySource.indexOf('app-ix-tokens.css')
    && appEntrySource.indexOf('app-ix-tokens.css') < appEntrySource.indexOf('app-ix-accents.css')
    && appEntrySource.indexOf('app-ix-accents.css') < appEntrySource.indexOf('app-controls.css')
    && appEntrySource.indexOf('app-controls.css') < appEntrySource.indexOf('app-pages-quiet-aqua.css')
    && appEntrySource.indexOf('app-pages-quiet-aqua.css') < appEntrySource.indexOf('app-experience-v3.css')
    && appEntrySource.indexOf('app-experience-v3.css') < appEntrySource.indexOf('app-hig-v5.css')
    && appEntrySource.indexOf('app-hig-v5.css') < appEntrySource.indexOf('app-ix-core.css')
    && appEntrySource.indexOf('app-ix-core.css') < appEntrySource.indexOf('app-ix-pages-a.css')
    && appEntrySource.indexOf('app-ix-pages-a.css') < appEntrySource.indexOf('app-ix-pages-b.css')
    && appEntrySource.indexOf('app-ix-pages-b.css') < appEntrySource.indexOf('app-ix-pages-c.css')
    && appEntrySource.indexOf('app-ix-pages-c.css') < appEntrySource.indexOf('app-ix-pages-d.css'),
  'IX tokens, accents, controls, shared App layers, and IX pages must load in a deterministic cascade',
);
assert.doesNotMatch(mainSource, /^import ['"]\.\/(?:styles\/app-[a-z0-9-]+\.css|chat\/chat-app\.css)['"];$/m,
  'App-layer CSS must not be statically imported by main.jsx (Web users must not download it)');
assert.match(mainSource, /isAppMode\(\)[\s\S]*import\('\.\/styles\/app-entry\.js'\)/,
  'the App style bundle must load behind the isAppMode gate');
assert.match(mainSource, /ensureAppStyles\(\)\.then\(render\)/,
  'the App style bundle must finish loading before first render');
assert.doesNotMatch(appEntrySource, /(?:lumen-glass-tokens|app-quiet-aqua-tokens|app-lumen-s[3-7]|app-lumen-materials|app-ix-bridge)\.css/,
  'runtime entry must not import retired Lumen, S3-S7, materials, or bridge layers');
/* ---- IX-1「仪与匣」token twin + bridge guards ---- */
{
  const ixTwin = await readFile(new URL('./src/styles/app-ix-tokens.css', import.meta.url), 'utf8');
  const ixFrozen = await readFile(new URL('../docs/design/field-instrument/design-tokens.css', import.meta.url), 'utf8');
  const ixReversed = ixTwin
    .replaceAll('html[data-app="1"][data-theme="dark"]', ':root[data-theme="dark"]')
    .replaceAll('html[data-app="1"][data-perf="lite"]', ':root[data-perf="lite"]')
    .replace(/html\[data-app="1"\](\s*\{)/g, ':root$1');
  assert.equal(ixReversed, ixFrozen, 'the runtime IX token twin must equal the frozen handoff byte-for-byte modulo the App-fence selector rewrite');
  assert.doesNotMatch(ixTwin, /(^|\n):root/, 'the IX token twin must never leak an unfenced :root block into the Web bundle');
  const ixAccents = await readFile(new URL('./src/styles/app-ix-accents.css', import.meta.url), 'utf8');
  const accentDefs = new Set([...ixAccents.matchAll(/(--ix-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
  assert.deepEqual([...accentDefs].sort(), ['--ix-act', '--ix-act-ink', '--ix-act-soft', '--ix-focus'], 'the accent companion may only vary the act family (semantic colors and vault never follow accent)');
  assert.ok(ixAccents.split('\n').filter((l) => l.includes('--ix-act:')).every((l) => l.includes('[data-accent=')), 'accent act overrides must stay behind an explicit data-accent match (default stays the frozen phosphor teal)');
  for (const id of ['dusk', 'teal', 'forest', 'rose', 'amber']) {
    assert.ok(ixAccents.includes(`[data-accent="${id}"]`), `accent id "${id}" from accent.js must resolve in the IX accent companion`);
  }
  const retiredRuntimeFiles = [
    'lumen-glass-tokens.css', 'app-quiet-aqua-tokens.css', 'app-ix-bridge.css',
    'app-lumen-materials.css', 'app-lumen-s3.css', 'app-lumen-s4.css',
    'app-lumen-s5.css', 'app-lumen-s6.css', 'app-lumen-s7.css',
  ];
  for (const name of retiredRuntimeFiles) {
    await assert.rejects(access(new URL(`./src/styles/${name}`, import.meta.url)),
      /ENOENT/, `retired runtime layer must be deleted: ${name}`);
  }
  assert.doesNotMatch(appRuntimeSource, /(?:var\(\s*)?--(?:lg|qa)(?:[0-9-]|\*)/,
    'App runtime code must be free of the retired --lg/--qa namespaces');
  assert.doesNotMatch(appRuntimeSource, /(?:var\(\s*)?--gl-/,
    'App runtime code must be free of the retired local glass aliases');
  assert.doesNotMatch(appRuntimeSource, /(?:lumen-glass-tokens|app-quiet-aqua-tokens|app-lumen-s[3-7]|app-lumen-materials|app-ix-bridge)\.css/,
    'App runtime must not reference retired style files');
  /* ---- IX-2 control-layer contract ---- */
  const ixCore = await readFile(new URL('./src/styles/app-ix-core.css', import.meta.url), 'utf8');
  const ixCoreClean = ixCore.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(ixCoreClean, /^\s*\.[a-z-]+[^{,]*\{/m, 'every IX core selector must stay behind the data-app fence');
  assert.doesNotMatch(ixCoreClean, /nth-(?:child|of-type)/, 'the IX core layer must not style by position');
  assert.doesNotMatch(ixCoreClean, /var\(--(?:lg|qa)-/, 'the IX core layer writes the new system and must consume --ix-* only');
  assert.match(ixCore, /\.qa-button:active[^{]*\{[^}]*translateY\(var\(--ix-key-travel\)\)/, 'pressed keycaps must travel 1px down instead of scaling');
  assert.match(ixCore, /\.qa-tab-button\.active \.qa-tab-button__icon::before\s*\{[^}]*var\(--ix-act\)/s, 'the selected Dock key must light its LED from the act authority');
  assert.match(ixCore, /\.app-sheet::before\s*\{[^}]*width:\s*36px[^}]*height:\s*4px/s, 'sheets must carry the 36×4 grabber');
  assert.match(ixCore, /prefers-reduced-motion/, 'the IX core layer must stop its shimmer loop under reduced motion');
  const coreAnimations = [...ixCoreClean.matchAll(/animation:\s*([a-z-]+)/g)].map((m) => m[1]).filter((n) => n !== 'none');
  assert.deepEqual([...new Set(coreAnimations)], ['ix-shimmer'], 'the skeleton shimmer is the only loop the core layer may run (it stops when data arrives)');
  /* ---- IX-3 primary-pages contract ---- */
  const ixPagesA = await readFile(new URL('./src/styles/app-ix-pages-a.css', import.meta.url), 'utf8');
  const ixPagesAClean = ixPagesA.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(ixPagesAClean, /^\s*\.[a-z-]+[^{,]*\{/m, 'every IX pages-a selector must stay behind the data-app fence');
  assert.doesNotMatch(ixPagesAClean, /nth-(?:child|of-type)/, 'the IX pages-a layer must not style by position');
  assert.doesNotMatch(ixPagesAClean, /var\(--(?:lg|qa)-/, 'the IX pages-a layer must consume --ix-* only');
  assert.match(ixPagesA, /\.ah-checkin\.qa-button\s*\{[^}]*#3FD2B4/s, 'the vault check-in key must stay the fixed bright teal (never follows user accent)');
  assert.match(ixPagesA, /\.ah-hero::before\s*\{[^}]*var\(--ix-glare\)/s, 'the vault card must wear its static 45° glare cap');
  assert.match(ixPagesA, /\.qa-weekly-bar i\s*\{[^}]*var\(--ix-act\)[^}]*opacity:\s*\.3/s, 'weekly history bars must be the same hue at 30% (single-hue chart discipline)');
  const appHomeForDate = await readFile(new URL('./src/pages/AppHome.jsx', import.meta.url), 'utf8');
  assert.match(appHomeForDate, /className="aht-date"/, 'the today header must carry the mono date readout line');
  /* ---- IX-4 immersive/conversation contract ---- */
  const ixPagesB = await readFile(new URL('./src/styles/app-ix-pages-b.css', import.meta.url), 'utf8');
  const ixPagesBClean = ixPagesB.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(ixPagesBClean, /^\s*\.[a-z-]+[^{,]*\{/m, 'every IX pages-b selector must stay behind the data-app fence');
  assert.doesNotMatch(ixPagesBClean, /nth-(?:child|of-type)/, 'the IX pages-b layer must not style by position');
  assert.doesNotMatch(ixPagesBClean, /var\(--(?:lg|qa)-/, 'the IX pages-b layer must consume --ix-* only');
  assert.match(ixPagesB, /\.msg\.assistant \.bubble\s*\{[^}]*var\(--ix-surface\)/s, 'character bubbles must sit on the opaque instrument surface (body text never rides glass)');
  assert.match(ixPagesB, /has-bg \.msg\.assistant \.bubble\s*\{[^}]*var\(--ix-surface\)/s, 'immersive portrait mode must keep character bubbles opaque');
  assert.match(ixPagesB, /\.send-btn\s*\{[^}]*width:\s*40px[^}]*var\(--ix-act\)/s, 'the send key must be the 40px act circle');
  assert.match(ixPagesB, /\.ch-dot\s*\{[^}]*var\(--ix-led-halo\)/s, 'online presence must speak LED, not glow washes');
  /* ---- IX-5 value/identity + ritual contract ---- */
  const ixPagesC = await readFile(new URL('./src/styles/app-ix-pages-c.css', import.meta.url), 'utf8');
  const ixPagesCClean = ixPagesC.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(ixPagesCClean, /^\s*\.[a-z-]+[^{,]*\{/m, 'every IX pages-c selector must stay behind the data-app fence');
  assert.doesNotMatch(ixPagesCClean, /nth-(?:child|of-type)/, 'the IX pages-c layer must not style by position');
  assert.doesNotMatch(ixPagesCClean, /var\(--(?:lg|qa)-/, 'the IX pages-c layer must consume --ix-* only');
  assert.doesNotMatch(ixPagesCClean, /animation:[^;]*infinite/, 'ritual motion plays once and stops (no loops in pages-c)');
  assert.match(ixPagesC, /qa-wallet-v4__asset-icon\.gold\) strong \{ color: var\(--ix-vault-gold\); \}/, 'the vault gold readout must use the fixed vault gold');
  assert.match(ixPagesC, /\[data-medal="gold"\] \.qa-achievements-card-icon\s*\{[^}]*radial-gradient/s, 'medal metal may only exist as the radial on the medal body');
  assert.match(ixPagesC, /\.qa-cal-cell\.on\s*\{[^}]*var\(--ix-act\)/s, 'checked calendar cells must be solid act with inverse ink');
  assert.match(ixPagesC, /ix-flip-old::before \{ content: attr\(data-ch\); \}/, 'flip ghosts must render via CSS content so text flow only ever carries the current value');
  const ixFlipSource = await readFile(new URL('./src/components/IxFlip.jsx', import.meta.url), 'utf8');
  assert.match(ixFlipSource, /data-ch=/, 'IxFlip must pass the old value through data-ch, never as a text node');
  const appHomeForFlip = await readFile(new URL('./src/pages/AppHome.jsx', import.meta.url), 'utf8');
  assert.match(appHomeForFlip, /<IxFlip value=\{fmtNum\(user\?\.gold\)\}/, 'the vault gold readout must flip through IxFlip');
  /* ---- IX-6 长尾/后补帧契约 ---- */
  const ixPagesD = await readFile(new URL('./src/styles/app-ix-pages-d.css', import.meta.url), 'utf8');
  const ixPagesDClean = ixPagesD.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(ixPagesDClean, /^\s*\.[a-z-]+[^{,]*\{/m, 'every IX pages-d selector must stay behind the data-app fence');
  assert.doesNotMatch(ixPagesDClean, /nth-(?:child|of-type)/, 'the IX pages-d layer must not style by position');
  assert.doesNotMatch(ixPagesDClean, /var\(--(?:lg|qa)-/, 'the IX pages-d layer must consume --ix-* only');
  assert.doesNotMatch(ixPagesDClean, /animation:[^;]*infinite/, 'IX-6 status motion must not introduce decorative loops');
  assert.match(ixPagesD, /\.qa-settings-page[\s\S]*--ix-canvas/, 'settings must use the instrument canvas');
  assert.match(ixPagesD, /\.qa-atelier-card[\s\S]*--ix-surface/, 'atelier cards must use opaque specimen surfaces');
  assert.match(ixPagesD, /\.qa-character-editor__savebar[\s\S]*--ix-glass-nav/, 'editor save bars must use the instrument body rail');
  assert.match(ixPagesD, /\.qa-error-state__code/, 'error states must expose a sanitized diagnostic code');
  assert.match(appEntrySource, /app-ix-pages-c\.css[\s\S]*app-ix-pages-d\.css/, 'IX-6 pages-d must be the final IX cascade layer');
  assert.match(groupRoomSource, /data-ix-tone=\{app \? ixNameTone/, 'group speaker tones must be IX semantic and App-only');
  assert.doesNotMatch(groupRoomSource, /data-lg-tone|lgNameTone/, 'group speaker tones must not retain the Lumen namespace');
  assert.match(ixPagesB, /data-ix-tone="(?:act|dia|gold|success)"/, 'group speaker mapping must expose all four fixed semantic tones');
}
/* ---- IX-7 frozen authority / migrated composition guards ---- */
{
  const ixTwin = await readFile(new URL('./src/styles/app-ix-tokens.css', import.meta.url), 'utf8');
  const ixFrozen = await readFile(new URL('../docs/design/field-instrument/design-tokens.css', import.meta.url), 'utf8');
  const ixReversed = ixTwin
    .replaceAll('html[data-app="1"][data-theme="dark"]', ':root[data-theme="dark"]')
    .replaceAll('html[data-app="1"][data-perf="lite"]', ':root[data-perf="lite"]')
    .replace(/html\[data-app="1"\](\s*\{)/g, ':root$1');
  assert.equal(ixReversed, ixFrozen, 'the runtime IX token twin must equal the frozen field-instrument handoff');
  assert.doesNotMatch(ixTwin, /(^|\n):root/, 'the IX token twin must stay App-fenced');
  const ixAccents = await readFile(new URL('./src/styles/app-ix-accents.css', import.meta.url), 'utf8');
  const accentDefs = new Set([...ixAccents.matchAll(/(--ix-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
  assert.deepEqual([...accentDefs].sort(), ['--ix-act', '--ix-act-ink', '--ix-act-soft', '--ix-focus'], 'accent companion may only vary the act family');
  for (const id of ['dusk', 'teal', 'forest', 'rose', 'amber']) assert.ok(ixAccents.includes('[data-accent="' + id + '"]'), 'accent id "' + id + '" must resolve');

  const ixCore = await readFile(new URL('./src/styles/app-ix-core.css', import.meta.url), 'utf8');
  const ixPagesA = await readFile(new URL('./src/styles/app-ix-pages-a.css', import.meta.url), 'utf8');
  const ixPagesB = await readFile(new URL('./src/styles/app-ix-pages-b.css', import.meta.url), 'utf8');
  const ixPagesC = await readFile(new URL('./src/styles/app-ix-pages-c.css', import.meta.url), 'utf8');
  const ixPagesD = await readFile(new URL('./src/styles/app-ix-pages-d.css', import.meta.url), 'utf8');
  const ixLayers = [ixCore, ixPagesA, ixPagesB, ixPagesC, ixPagesD];
  for (const [name, css] of [['core', ixCore], ['pages-a', ixPagesA], ['pages-b', ixPagesB], ['pages-c', ixPagesC], ['pages-d', ixPagesD]]) {
    const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(clean, /var\(\s*--(?:lg|qa)-/, 'IX ' + name + ' layer must consume --ix-* only');
    assert.doesNotMatch(clean, /nth-(?:child|of-type)/, 'IX ' + name + ' layer must not style by position');
  }
  assert.match(ixPagesD, /IX-7 migrated composition/, 'pages-d must contain the folded S3-S7 composition');
  const pagesDNonIxDefinitions = [...ixPagesD.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(?:^|[;{]\s*|\n\s*)(--[a-z0-9-]+)\s*:/gm)]
    .map((match) => match[1])
    .filter((name) => !name.startsWith('--ix-'));
  assert.deepEqual([...new Set(pagesDNonIxDefinitions)], [], 'pages-d custom properties must live in the IX namespace');
  assert.match(ixPagesD, /\.qa-settings-page[\s\S]*--ix-canvas/, 'settings must use the instrument canvas');
  assert.match(ixPagesD, /\.qa-atelier-card[\s\S]*--ix-surface/, 'atelier cards must use opaque specimen surfaces');
  assert.match(ixPagesD, /\.qa-character-editor__savebar[\s\S]*--ix-glass-nav/, 'editor save bars must use the instrument body rail');
  assert.match(ixPagesD, /\.qa-error-state__code/, 'error states must expose a sanitized diagnostic code');
  const layerText = ixLayers.join('\n');
  assert.doesNotMatch(layerText, /(?:var\(\s*)?--(?:lg|qa)(?:[0-9-]|\*)/, 'IX layers must not contain legacy token spellings');
  assert.match(ixCore, /--ix-act-pressed/, 'IX core must own migrated pressed-state aliases');
  assert.match(ixCore, /--ix-editor-chrome/, 'IX core must own migrated editor chrome alias');
}
const elevatedCss = await readFile(new URL('./src/styles/app-elevated.css', import.meta.url), 'utf8');
assert.doesNotMatch(elevatedCss, /--gl-halo/, 'glass cards must not restore accent/dusk halo washes');
assert.doesNotMatch(elevatedCss, /#22d3ee/i, 'the Liuli glass system must not reintroduce the cyan neon edge');

/* ---- Liuli v5 anti-AI-residue guards over the legacy App layers ---- */
const shellCss = await readFile(new URL('./src/styles/app-shell.css', import.meta.url), 'utf8');
const renovCss = await readFile(new URL('./src/styles/app-renov.css', import.meta.url), 'utf8');
const motionCss = await readFile(new URL('./src/styles/app-motion.css', import.meta.url), 'utf8');
const legacyAppCss = [shellCss, elevatedCss, renovCss]
  .map((css) => css.replace(/\/\*[\s\S]*?\*\//g, '')).join('\n');
assert.doesNotMatch(
  legacyAppCss,
  /nth-(?:child|of-type)\([^)]*\)[^{]*\{[^}]*(?:linear-gradient|color-mix\(in srgb, var\(--(?:diamond|gold|dusk)\))/,
  'legacy App layers must not reintroduce position-driven rainbow tinting',
);
const appLayerCss = legacyAppCss + '\n' + [motionCss, runtimeCss, quietControls, quietPages, quietExperience,
  await readFile(new URL('./src/chat/chat-app.css', import.meta.url), 'utf8'),
].map((css) => css.replace(/\/\*[\s\S]*?\*\//g, '')).join('\n');
assert.doesNotMatch(appLayerCss, /background-clip:\s*text/, 'App layers must not restore gradient text');
// The unfenced `.cps-item.hue-*` palette block is Web-owned (the App fence
// overrides it with semantic tones); exclude only those lines from the ban.
const appLayerCssSansWebHue = appLayerCss.split('\n').filter((line) => !/^\.cps-item\.hue-/.test(line.trim())).join('\n');
assert.doesNotMatch(appLayerCssSansWebHue, /#a78bfa|#7c3aed|#e11d48|#a21caf|#0e7490/i, 'the dead Tailwind rainbow hexes must stay dead in App-owned styling');
const INFINITE_ALLOWLIST = new Set([
  // status/loading loops — the only necessary cycles, they stop with their state
  'appRouteSpin', 'call-pulse', 'caretBlink', 'caretBreath', 'chatCaret', 'chatTyping',
  'gachaShake', 'liveRing', 'motionSkel', 'qa-spin', 'qa3RefreshSpin', 'qa3Skeleton',
  'skel-shimmer', 'skel-spin', 'spin360',
  // Web-owned legacy loops living unfenced in shared files; the App fence neutralises them
  'chatKenburns', 'emptyFloat', 'insDrift', 'ringSlide', 'vmGoShine', 'vmShine', 'vmSpark',
]);
const infiniteNames = [...appLayerCss.matchAll(/animation:\s*([a-zA-Z][\w-]*)[^;]*\binfinite\b/g)].map((m) => m[1]);
assert.deepEqual(
  [...new Set(infiniteNames)].filter((name) => !INFINITE_ALLOWLIST.has(name)),
  [],
  'no new perpetual decorative animation may enter the App layers (extend the allowlist only for status loops)',
);
assert.match(quietExperience, /html\[data-app="1"\] \.chat-main \.cps-item\.hue-call/, 'the chat plus-panel must keep its App-fenced semantic-tone override');
assert.match(quietExperience, /html\[data-app="1"\] \.ins-star \{ display: none/, 'shared decorative star drift must stay hidden inside the App shell');
assert.doesNotMatch(
  [quietControls, quietPages, quietExperience, runtimeCss].join('\n'),
  /(?:var\(\s*)?--(?:lg|qa)(?:[0-9-]|\*)/,
  'shared App layers must consume the IX namespace directly',
);
assert.match(quietControls, /html\[data-app="1"\]/, 'Quiet Aqua controls must remain App-scoped');
assert.doesNotMatch(quietControls + quietPages, /^\s*\.qa-[^{,]+/m, 'Quiet Aqua class selectors must never escape the data-app fence');
assert.doesNotMatch(quietControlsNoComments, /nth-(?:child|of-type)/, 'Quiet Aqua must not assign rainbow colours by position');
assert.doesNotMatch(quietPagesNoComments, /nth-(?:child|of-type)/, 'Quiet Aqua page styling must not restore position-driven rainbow colours');
assert.doesNotMatch(quietExperienceNoComments, /nth-(?:child|of-type)/, 'Quiet Aqua v3 styling must not restore position-driven rainbow colours');
assert.match(quietExperience, /html\[data-app="1"\]/, 'Quiet Aqua v3 experience rules must remain App-scoped');
assert.match(quietPages, /html\[data-app="1"\]\s+\.qa-messages-page/, 'Messages composition must stay App-scoped');
assert.match(quietPages, /\.qa-character-view\s+\.cvx-row\s*>\s*\.qa-button__content\s*\{[^}]*width:\s*100%[^}]*justify-content:\s*flex-start/s, 'character rows must keep their full-width content alignment');
assert.match(quietControls, /prefers-reduced-motion:\s*reduce/, 'Quiet Aqua must support reduced motion');
assert.doesNotMatch(quietControlsNoComments, /backdrop-filter:[^;]*blur\([^;]*!important/, 'normal control chrome must not override the balanced/lite blur gate');
assert.match(controlsSource, /AppIconButton requires/, 'App icon buttons must fail loudly in development when their accessible name is missing');
assert.match(controlsSource, /BUTTON_VARIANTS = new Set\(\['primary', 'secondary', 'tertiary', 'danger'\]\)[\s\S]*AppButton variant/, 'AppButton must reject visual variants outside its single design contract');
assert.match(controlsSource, /ICON_VARIANTS = new Set\(\['ghost', 'secondary', 'filled'\]\)[\s\S]*AppIconButton variant/, 'filled must remain an icon-button treatment rather than an undefined AppButton variant');
assert.match(controlsSource, /aria-pressed=\{pressed === undefined \? undefined : Boolean\(pressed\)\}/, 'selected styling must not invent toggle-button semantics');
assert.match(controlsSource, /badgeCount[\s\S]*count > 99 \? '99\+'/, 'tab badges must expose real counts and cap their visual label at 99+');
assert.match(controlsSource, /preventDefault\(\);[\s\S]*stopPropagation\(\);/, 'disabled non-button controls must suppress link activation');
assert.match(controlsSource, /if \(!isAppChrome\(\)\)[\s\S]*<LegacyControl/, 'control primitives must keep the legacy escape hatch outside the App chrome gate');
assert.match(controlsSource, /isWebChrome\(\)[\s\S]*'lgw-button'/, 'the Lumen Web chrome gate must render real .lgw-* controls on the web shell');
assert.match(controlsSource, /dataset\.lumenWeb === '1'/, 'the web control gate must key off the removable data-lumen-web boot flag');
assert.match(layoutSource, /route\.dock\s*&&\s*\([\s\S]*<CatboxDock\b/, 'the Catbox Dock must still obey Route Registry visibility');
assert.match(layoutSource, /data-app-material=\{route\.material\}/, 'AppLayout must expose route-owned material semantics');
assert.match(catboxDockSource, /AppMaterialSurface[\s\S]*variant="regular"/, 'Dock and transient chrome must use the shared material primitive');
assert.match(materialSurfaceSource, /standard.*regular.*clear/, 'material primitive must expose standard, regular, and clear variants');
assert.match(materialSurfaceSource, /document\.documentElement\.dataset\.app === '1'/, 'material primitive must stay transparent outside the App shell');
assert.match(discoverSource, /APP_ROLE_GESTURES\.doubleTapLike/, 'Discover must consume the migrated double-tap gesture contract');
assert.match(chatSource, /APP_ROLE_GESTURES\.messageLongPress/, 'Chat must consume the migrated long-press gesture contract');
assert.match(roleIosCss, /html\[data-app="1"\]/, 'the role/iOS 26 layer must be App-scoped');
assert.doesNotMatch(roleIosCss.replace(/\/\*[\s\S]*?\*\//g, ''), /(^|\})\s*:root\b/m, 'the role/iOS 26 layer must not leak a Web :root selector');
const forbiddenReferencePattern = new RegExp(
  String.fromCodePoint(0x732b, 0x7bb1)
    + '|' + ['com', 'parallel', 'odyssey'].join('\\.'),
  'i',
);
assert.doesNotMatch(appReferenceSource + roleIosCss + appEntrySource, forbiddenReferencePattern, 'migrated App code must not ship reference branding or vendor package identifiers');
const dockNavStart = layoutSource.indexOf('<nav className="app-tabbar"');
const dockNavEnd = layoutSource.indexOf('</nav>', dockNavStart);
const dockFab = layoutSource.indexOf("className={'app-fab'", dockNavStart);
assert.ok(dockNavStart >= 0 && dockNavEnd > dockNavStart && dockFab > dockNavEnd, 'the create action must be a sibling outside the four-destination nav');
assert.match(layoutSource, /badgeCount=\{badgeCount\}/, 'the Messages tab must receive its numeric unread count');
assert.match(layoutSource, /data-tone=\{c\.tone\}/, 'create-sheet rows must carry semantic tones instead of positional rainbow styling');
assert.doesNotMatch(layoutSource, /Sparkles|Wand2/, 'the App shell must use concrete verbs for creation icons, not sparkle/wand metaphors');
assert.match(chatSource, /AFFINITY_APP_ICONS/, 'the App chat affinity badge must render vector icons in place of emoji chrome');
assert.match(layoutSource, /useAppOverlay\(true,\s*onClose,\s*\{\s*rootRef:\s*sheetRef,\s*isolate:\s*true,\s*returnFocusRef\s*\}\)[\s\S]*createPortal/, 'the redesigned create sheet must preserve PR4 portal isolation and explicit focus return');
assert.match(appSource, /path="\/app-controls"[\s\S]*P\(<AppControlsGallery \/>\)/, 'the control gallery must stay lazy and protected (dual-shell acceptance page since W4)');
assert.match(routeChunksSource, /AppControlsGallery:[\s\S]*import\('\.\/pages\/AppControlsGallery\.jsx'\)/, 'the control gallery must participate in the route chunk registry');
assert.match(fxSource, /dataset\.app === '1'[\s\S]*\.qa-button[\s\S]*\.app-fab/, 'legacy ripple injection must skip Quiet Aqua controls and the App FAB');
assert.match(fxSource, /\.lgw-button, \.lgw-icon-button, \.lgw-tab-button/, 'legacy ripple injection must also skip Lumen Web controls (they own their pressed state)');

assert.equal(quietCharacterPng.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'the reviewed character fallback must remain a valid PNG');
assert.ok(quietCharacterPng.length >= 1_000_000, 'the production character fallback must retain the approved high-detail master');
assert.match(artSource, /quiet-aqua-character-v3\.png\?url[\s\S]*QuietAquaCharacterArt/, 'the large App oracle art must load from the reviewed raster asset');
assert.match(appHomeSource + discoverSource, /QuietAquaCharacterArt/, 'Today and Discover must use the reviewed oracle art for legacy seed media');
assert.doesNotMatch(appHomeSource + discoverSource + artSource, /quiet-aqua-v3-(?:primary|core-flow|secondary)\.png|character-source-v3\.png/, 'runtime App code must never import full-screen design-source boards');
assert.doesNotMatch(runtimeSource, /quiet-aqua-v3-(?:primary|core-flow|secondary|character-source)\.png|docs\/ui-oracle/, 'no client runtime source may reference oracle boards or their documentation directory');
assert.match(vipSource, /immersive qa-vip[\s\S]*AppIconButton[\s\S]*AppButton/, 'the App membership page must opt into Quiet Aqua controls without replacing the Web branch');
assert.match(quietPages, /\.qa-vip[\s\S]*:where\(\.vm-card-pat, \.vm-card-shine, \.vm-spark\)[\s\S]*display:\s*none/, 'the App membership page must remove campaign shine and spark effects');
assert.match(quietPages, /\.qa-vip \.vm-card,[\s\S]*background:\s*#23272e/, 'membership gold must remain semantic instead of filling the App page');

/* ---- IX generated content-media assets ---- */
const appAssetNames = (await readdir(new URL('./src/assets/app/', import.meta.url)))
  .filter((name) => name.endsWith('.png'));
assert.ok(appAssetNames.every((name) => !/^qa5-(?:empty-|onboard-|streak-seal|boot-mark|vip-weave)/.test(name)),
  'retired Lumen raster assets must stay out of the runtime catalog');
for (const name of appAssetNames) {
  const png = await readFile(new URL(`./src/assets/app/${name}`, import.meta.url));
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${name} must be a valid PNG`);
  assert.ok(png.length <= 300 * 1024, `${name} must stay under the 300KB content-media ceiling`);
}
assert.match(artSource, /ix-illo-offline-light\.svg\?url[\s\S]*AppEmptyArt/, 'the App empty states must ship the IX SVG fallback');
for (const scene of ['chat', 'favorites', 'search', 'achievements', 'theater', 'leaderboard', 'notifications', 'friends', 'drafts', 'works', 'worldbook', 'wallet', 'scripts', 'gallery', 'offline', 'maintenance']) {
  assert.match(artSource, new RegExp(`ix-illo-${scene}-light\\.svg\\?url`), `the IX empty-art scene "${scene}" must be wired into the App art map`);
}
assert.match(artSource, /ix-illo-onb-001-light\.svg\?url[\s\S]*IxOnboardingArt/, 'onboarding must use the reviewed IX SVG media');
assert.match(artSource, /ix-stamp-bronze\.svg\?url[\s\S]*streakSealForTier/, 'streak seals must use the reviewed IX SVG media');
const capacitorConfig = await readFile(new URL('../capacitor.config.json', import.meta.url), 'utf8');
assert.doesNotMatch(capacitorConfig, /#1b1733/i, 'the native launch surface must not return to the purple-navy splash');
assert.match(capacitorConfig, /"backgroundColor":\s*"#E8EBE9"/, 'native launch colours must match the IX canvas');
const nativeSource = await readFile(new URL('./src/native.js', import.meta.url), 'utf8');
assert.match(nativeSource, /dark \? '#0F1312' : '#E8EBE9'/, 'native system chrome must follow the light/dark IX canvas');
const themeSource = await readFile(new URL('./src/theme.js', import.meta.url), 'utf8');
assert.match(themeSource, /app \? '#0F1312' : '#0A0C12'[\s\S]*app \? '#E8EBE9' : '#EDEFF6'/,
  'App theme chrome must use IX while preserving the Web Lumen canvas');
assert.match(artSource, /isAppMode\(\)[\s\S]*AppEmptyArt/, 'EmptyArt must dispatch to the App media only inside the App shell');

console.log('app invariants: IX-6/IX-7 guards passed');
