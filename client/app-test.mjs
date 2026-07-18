import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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
assert.deepEqual(statusBarContextForTone('immersive'), { color: '#12101a', dark: true }, 'immersive routes must request light system chrome on a dark surface');
assert.equal(statusBarContextForTone('surface'), null, 'surface routes must restore theme-owned system chrome');

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
assert.match(characterViewSource, /loadError[\s\S]*EmptyArt[\s\S]*nav\('\/library'\)/, 'character load failures must offer a real recovery empty state');
const characterRecoveryIndex = characterViewSource.indexOf('if (!c && loadError)');
const characterDispatchIndex = characterViewSource.indexOf('const shared =');
assert.ok(
  characterRecoveryIndex >= 0 && characterDispatchIndex > characterRecoveryIndex,
  'character error/retry recovery must run in the parent before App/Web view dispatch',
);
assert.match(runtimeCss, /\.topbar h1,[\s\S]*word-break:\s*keep-all/, 'narrow App topbar titles must not stack vertically');
assert.match(runtimeCss, /\.topbar\s*\{[^}]*flex-wrap:\s*wrap;[^}]*row-gap:\s*10px;/, 'dense narrow App topbars must wrap whole controls without horizontal overflow');
assert.match(runtimeCss, /\.vm-plans\s*\{\s*padding-top:\s*12px/, 'VIP plans must reserve space for the raised badge');
assert.match(runtimeCss, /\.app-tabbar[\s\S]*98%[\s\S]*top:\s*-18px/, 'App Dock must use a solid surface with a top fade');

console.log('app invariants: 66/66 passed');
