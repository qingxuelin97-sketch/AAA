import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { registrationRequestHash as clientHash } from './src/playIntegrity.js';
import { registrationRequestHash as serverHash } from '../server/integrity.js';
import { mergeMessages, messageId } from './src/groupMessages.js';
import { getAppRoute, statusBarContextForTone } from './src/routeRegistry.js';
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
const quietTokens = await readFile(new URL('./src/styles/app-quiet-aqua-tokens.css', import.meta.url), 'utf8');
const quietControls = await readFile(new URL('./src/styles/app-controls.css', import.meta.url), 'utf8');
const quietPages = await readFile(new URL('./src/styles/app-pages-quiet-aqua.css', import.meta.url), 'utf8');
const quietExperience = await readFile(new URL('./src/styles/app-experience-v3.css', import.meta.url), 'utf8');
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
const s7StageSource = await readFile(new URL('./src/styles/app-lumen-s7.css', import.meta.url), 'utf8');
assert.match(s7StageSource, /\.qa-weekly-card/, 'the weekly recap card must land in the S7 stage layer');
assert.match(s7StageSource, /\[data-perf="lite"\][\s\S]*\.qa-weekly-card[\s\S]*backdrop-filter:\s*none/, 'the weekly card must drop its blur on the lite tier');
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
assert.match(announcementsSource, /if \(!app \|\| loading \|\| list\.length === 0\) return;[\s\S]*huanyu_ann_seen/, 'announcement read-memory must stay App-gated');
assert.match(announcementsSource, /\.slice\(-100\)/, 'the seen-id ledger must stay bounded');
assert.match(announcementsSource, /app && newIds\.has\(a\.id\) && <span className="qa-ann-new"/, 'unseen announcements must badge only inside the App shell');
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
assert.match(chatSource, /if \(!app \|\| !id \|\| loc\.state\?\.draft\) return;/, 'draft restore must stay App-gated and yield to one-shot prefills');
assert.match(chatSource, /localStorage\.setItem\('huanyu_draft_' \+ id, input\);[\s\S]*localStorage\.removeItem\('huanyu_draft_' \+ id\);/, 'an emptied composer must delete its stored draft');
for (const scenario of ['weeklyRecapAssertions', 'walletCalendarAssertions', 'quoteCardAssertions', 'galleryS7Assertions', 'conversationMarksAssertions', 'draftAssertions', 's7DarkTierAssertions', 'g10SurfaceAssertions']) {
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
assert.match(renderScriptSource, /qa5-streak-seal-30@2x[\s\S]*qa5-streak-seal-100@2x/, 'the asset pipeline must produce both milestone seal variants');
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
assert.match(runtimeCss, /\.app-tabbar[\s\S]*var\(--lg-blur\)/, 'App Dock must use the Lumen chrome blur authority directly on high and balanced tiers');
assert.match(runtimeCss, /\[data-perf="lite"\]\s*\.app-tabbar\s*\{[^}]*backdrop-filter:\s*none/s, 'lite tier must drop the Dock blur and fall back to an opaque surface');

assert.ok(
  mainSource.indexOf('app-runtime.css') < mainSource.indexOf('lumen-glass-tokens.css')
    && mainSource.indexOf('lumen-glass-tokens.css') < mainSource.indexOf('app-quiet-aqua-tokens.css')
    && mainSource.indexOf('app-quiet-aqua-tokens.css') < mainSource.indexOf('app-controls.css')
    && mainSource.indexOf('app-controls.css') < mainSource.indexOf('app-pages-quiet-aqua.css')
    && mainSource.indexOf('app-pages-quiet-aqua.css') < mainSource.indexOf('app-experience-v3.css')
    && mainSource.indexOf('app-experience-v3.css') < mainSource.indexOf('app-hig-v5.css')
    && mainSource.indexOf('app-hig-v5.css') < mainSource.indexOf('app-lumen-s6.css')
    && mainSource.indexOf('app-lumen-s6.css') < mainSource.indexOf('app-lumen-s7.css')
    && mainSource.indexOf('app-lumen-s7.css') < mainSource.indexOf('app-lumen-materials.css'),
  'Lumen tokens, qa shim, control, page, v3, HIG, S7 layer and Lumen materials must load in cascade order after the runtime layer',
);
/* ---- Lumen Glass token authority guards ---- */
const lumenTokens = await readFile(new URL('./src/styles/lumen-glass-tokens.css', import.meta.url), 'utf8');
const lumenHandoff = await readFile(new URL('../docs/design/lumen-glass-tokens.css', import.meta.url), 'utf8');
assert.equal(lumenTokens, lumenHandoff, 'the runtime Lumen token file must stay byte-identical to the design handoff (values are frozen)');
const lumenMaterials = await readFile(new URL('./src/styles/app-lumen-materials.css', import.meta.url), 'utf8');
assert.match(lumenMaterials, /html\[data-app="1"\]/, 'Lumen materials must remain App-scoped');
assert.doesNotMatch(lumenMaterials.replace(/\/\*[\s\S]*?\*\//g, ''), /^\s*\.lg-[^{,]+/m, 'Lumen material classes must never escape the data-app fence');
const lgDefinitions = new Set([...(lumenTokens + lumenMaterials).matchAll(/(--lg-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
const lumenStageCss = (await Promise.all(['s3', 's4', 's5', 's6', 's7'].map((n) => readFile(new URL(`./src/styles/app-lumen-${n}.css`, import.meta.url), 'utf8')))).join('\n');
const higForLg = await readFile(new URL('./src/styles/app-hig-v5.css', import.meta.url), 'utf8');
assert.doesNotMatch(lumenStageCss.replace(/\/\*[\s\S]*?\*\//g, ''), /^\s*\.(?:qa|lg)-[^{,]+/m, 'Lumen stage layers must never escape the data-app fence');
assert.doesNotMatch(lumenStageCss.replace(/\/\*[\s\S]*?\*\//g, ''), /nth-(?:child|of-type)/, 'Lumen stage layers must not style by position');
const lgUses = new Set([...(quietTokens + quietControls + quietPages + quietExperience + lumenMaterials + lumenStageCss + higForLg).matchAll(/var\((--lg-[a-z0-9-]+)/g)].map((m) => m[1]));
assert.deepEqual([...lgUses].filter((name) => !lgDefinitions.has(name)), [], 'every Lumen token reference must resolve in the frozen token authority');
const higCss = await readFile(new URL('./src/styles/app-hig-v5.css', import.meta.url), 'utf8');
const higNoComments = higCss.replace(/\/\*[\s\S]*?\*\//g, '');
assert.match(higCss, /html\[data-app="1"\]/, 'the Liuli HIG layer must remain App-scoped');
assert.doesNotMatch(higNoComments, /^\s*\.qa-[^{,]+/m, 'HIG selectors must never escape the data-app fence');
assert.doesNotMatch(higNoComments, /nth-(?:child|of-type)/, 'the HIG layer must not assign styling by position');
assert.match(higCss, /prefers-reduced-motion:\s*reduce/, 'the HIG layer must support reduced motion');
assert.doesNotMatch(higNoComments, /backdrop-filter:[^;]*blur\([^;]*!important/, 'the HIG layer must not override the balanced/lite blur gate');
assert.doesNotMatch(higNoComments.replaceAll('sans-serif', ''), /serif|Fraunces|Songti/i, 'App headings must never return to display serifs');
assert.match(quietTokens, /--qa-control-min:\s*44px/, 'ordinary App controls must keep a 44px minimum target');
assert.match(quietTokens, /--qa-control-submit:\s*48px/, 'authentication submit controls must remain 48px tall');
const lumenTokensForGlass = await readFile(new URL('./src/styles/lumen-glass-tokens.css', import.meta.url), 'utf8');
assert.match(lumenTokensForGlass, /--lg-blur:\s*blur\(/, 'the Lumen glass token authority must define the primary blur material');
assert.match(lumenTokensForGlass, /--lg-blur-s:\s*blur\(/, 'the Lumen glass token authority must define the small blur material');
assert.match(lumenTokensForGlass, /\[data-perf="lite"\][\s\S]*--lg-blur:\s*none/, 'lite tier must resolve every glass blur to none at the token layer');
assert.doesNotMatch(quietTokens, /--qa-glass-chrome-blur\s*:/, 'pure aliases must never flow back into the residual shim (blur is lg-authority-direct now)');
/* S7-G8：全 App 层 var(--qa-*) 引用必须 ⊆ 残余 shim 定义集（迁移不许半途） */
{
  const residualDefs = new Set([...quietTokens.matchAll(/(--qa-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
  const s7LayerCss = [quietControls, quietPages, quietExperience, higForLg, runtimeCss,
    await readFile(new URL('./src/styles/app-elevated.css', import.meta.url), 'utf8'),
    await readFile(new URL('./src/styles/app-shell.css', import.meta.url), 'utf8'),
    await readFile(new URL('./src/styles/app-renov.css', import.meta.url), 'utf8'),
    await readFile(new URL('./src/chat/chat-app.css', import.meta.url), 'utf8'),
    lumenStageCss,
    await readFile(new URL('./src/styles/app-lumen-s6.css', import.meta.url), 'utf8'),
    await readFile(new URL('./src/ui.jsx', import.meta.url), 'utf8'),
  ].join('\n');
  const qaRefs = new Set([...s7LayerCss.matchAll(/var\((--qa-[a-z0-9-]+)/g)].map((m) => m[1]));
  assert.deepEqual([...qaRefs].filter((name) => !residualDefs.has(name)), [],
    'every remaining --qa-* reference must resolve in the residual shim — pure aliases live as --lg-* only');
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
const quietTokenDefinitions = new Set([...quietTokens.matchAll(/(--qa-[a-z0-9-]+)\s*:/g)].map((match) => match[1]));
const higForTokens = await readFile(new URL('./src/styles/app-hig-v5.css', import.meta.url), 'utf8');
const quietTokenUses = new Set([...(quietControls + quietPages + quietExperience + higForTokens).matchAll(/var\((--qa-[a-z0-9-]+)/g)].map((match) => match[1]));
assert.deepEqual([...quietTokenUses].filter((name) => !quietTokenDefinitions.has(name)), [], 'every Quiet Aqua token reference must resolve in the single token authority');
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
assert.match(controlsSource, /if \(!isAppChrome\(\)\)[\s\S]*<LegacyControl/, 'control primitives must transparently preserve legacy Web markup');
assert.match(layoutSource, /route\.dock\s*&&\s*\([\s\S]*className="app-dock"/, 'the Quiet Aqua Dock must still obey Route Registry visibility');
const dockNavStart = layoutSource.indexOf('<nav className="app-tabbar"');
const dockNavEnd = layoutSource.indexOf('</nav>', dockNavStart);
const dockFab = layoutSource.indexOf("className={'app-fab'", dockNavStart);
assert.ok(dockNavStart >= 0 && dockNavEnd > dockNavStart && dockFab > dockNavEnd, 'the create action must be a sibling outside the four-destination nav');
assert.match(layoutSource, /badgeCount=\{badgeCount\}/, 'the Messages tab must receive its numeric unread count');
assert.match(layoutSource, /data-tone=\{c\.tone\}/, 'create-sheet rows must carry semantic tones instead of positional rainbow styling');
assert.doesNotMatch(layoutSource, /Sparkles|Wand2/, 'the App shell must use concrete verbs for creation icons, not sparkle/wand metaphors');
assert.match(chatSource, /AFFINITY_APP_ICONS/, 'the App chat affinity badge must render vector icons in place of emoji chrome');
assert.match(layoutSource, /useAppOverlay\(true,\s*onClose,\s*\{\s*rootRef:\s*sheetRef,\s*isolate:\s*true,\s*returnFocusRef\s*\}\)[\s\S]*createPortal/, 'the redesigned create sheet must preserve PR4 portal isolation and explicit focus return');
assert.match(appSource, /path="\/app-controls"[\s\S]*isAppMode\(\) \? P\(<AppControlsGallery \/>/, 'the control gallery must be lazy, protected, and unreachable through the Web shell');
assert.match(routeChunksSource, /AppControlsGallery:[\s\S]*import\('\.\/pages\/AppControlsGallery\.jsx'\)/, 'the control gallery must participate in the route chunk registry');
assert.match(fxSource, /dataset\.app === '1'[\s\S]*\.qa-button[\s\S]*\.app-fab/, 'legacy ripple injection must skip Quiet Aqua controls and the App FAB');

assert.equal(quietCharacterPng.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'the reviewed character fallback must remain a valid PNG');
assert.ok(quietCharacterPng.length >= 1_000_000, 'the production character fallback must retain the approved high-detail master');
assert.match(artSource, /quiet-aqua-character-v3\.png\?url[\s\S]*QuietAquaCharacterArt/, 'the large App oracle art must load from the reviewed raster asset');
assert.match(appHomeSource + discoverSource, /QuietAquaCharacterArt/, 'Today and Discover must use the reviewed oracle art for legacy seed media');
assert.doesNotMatch(appHomeSource + discoverSource + artSource, /quiet-aqua-v3-(?:primary|core-flow|secondary)\.png|character-source-v3\.png/, 'runtime App code must never import full-screen design-source boards');
assert.doesNotMatch(runtimeSource, /quiet-aqua-v3-(?:primary|core-flow|secondary|character-source)\.png|docs\/ui-oracle/, 'no client runtime source may reference oracle boards or their documentation directory');
assert.match(vipSource, /immersive qa-vip[\s\S]*AppIconButton[\s\S]*AppButton/, 'the App membership page must opt into Quiet Aqua controls without replacing the Web branch');
assert.match(quietPages, /\.qa-vip[\s\S]*:where\(\.vm-card-pat, \.vm-card-shine, \.vm-spark\)[\s\S]*display:\s*none/, 'the App membership page must remove campaign shine and spark effects');
assert.match(quietPages, /\.qa-vip \.vm-card,[\s\S]*background:\s*#23272e/, 'membership gold must remain semantic instead of filling the App page');

/* ---- Liuli v5 generated content-media assets ---- */
const appAssetNames = (await readdir(new URL('./src/assets/app/', import.meta.url)))
  .filter((name) => name.endsWith('.png'));
assert.ok(appAssetNames.length >= 20, 'the S7 asset catalog must stay fully generated (run scripts/render-app-assets.mjs)');
for (const name of appAssetNames) {
  const png = await readFile(new URL(`./src/assets/app/${name}`, import.meta.url));
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${name} must be a valid PNG`);
  assert.ok(png.length <= 300 * 1024, `${name} must stay under the 300KB content-media ceiling`);
}
assert.match(artSource, /qa5-empty-generic[\s\S]*AppEmptyArt/, 'the App empty states must ship the generated content media with a generic fallback');
for (const kind of ['achievements', 'theater', 'atelier', 'leaderboard', 'events', 'worldbooks', 'insights', 'noresult', 'group']) {
  assert.match(artSource, new RegExp(`qa5-empty-${kind}@2x`), `the S7 empty-art kind "${kind}" must stay wired into the App art map`);
}
assert.match(artSource, /onboardArtUrls[\s\S]*streakSealUrl/, 'the onboarding screens and streak seal must export reviewed content media');
const capacitorConfig = await readFile(new URL('../capacitor.config.json', import.meta.url), 'utf8');
assert.doesNotMatch(capacitorConfig, /#1b1733/i, 'the native launch surface must not return to the purple-navy splash');
assert.match(capacitorConfig, /"backgroundColor":\s*"#EDEFF6"/, 'native launch colours must match the Lumen canvas');
assert.match(artSource, /isAppMode\(\)[\s\S]*AppEmptyArt/, 'EmptyArt must dispatch to the App media only inside the App shell');

console.log('app invariants: 266/266 passed');
