import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, readFile, readdir } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_CHAT_MESSAGE_ACTIONS } from './src/appReference.js';

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? collectFiles(path) : [path];
  }))).flat();
}

const provenance = JSON.parse(await readFile(new URL('../docs/app-reference/apk-provenance.json', import.meta.url), 'utf8'));
const screenMapping = JSON.parse(await readFile(new URL('../docs/app-reference/screen-mapping.json', import.meta.url), 'utf8'));
assert.equal(provenance.schemaVersion, 1, 'APK provenance must use the reviewed schema');
assert.equal(provenance.sourceApk.sha256, '4947e594de9465d0e1be108f978bc84d5e7ce7130c611a905c18bff37effdb66', 'APK provenance must pin the reviewed source checksum');
assert.deepEqual(provenance.sourcePackage, { name: 'com.parallel.odyssey', versionCode: '2190050', versionName: '2.19.0' }, 'APK provenance must pin the reviewed package and version');
assert.deepEqual([...APP_CHAT_MESSAGE_ACTIONS], ['like', 'dislike', 'report', 'share', 'replay', 'chatShare'], 'ported chat message actions must retain the approved reference order');
assert.equal(provenance.selectedLotties.length, 7, 'only seven reviewed Lottie samples may cross the reference boundary');
assert.equal(provenance.selectedAssets.length, 1, 'the chat action config must be the only selected non-Lottie APK asset');

const chatActionAsset = provenance.selectedAssets[0];
assert.deepEqual(
  { kind: chatActionAsset.kind, localPath: chatActionAsset.localPath, apkPath: chatActionAsset.apkPath },
  {
    kind: 'json-config',
    localPath: 'client/src/assets/app-reference/chat-item-action-config-default.json',
    apkPath: 'assets/chat_item_action_config_default.json',
  },
  'chat action config provenance must retain its exact source and destination',
);
const chatActionBytes = await readFile(new URL(`../${chatActionAsset.localPath}`, import.meta.url));
assert.equal(createHash('sha256').update(chatActionBytes).digest('hex'), chatActionAsset.sha256, 'chat action config must match its APK-recorded hash');
assert.equal(chatActionAsset.sha256, '91a0161a19c7afb07e272ddc22cc1b77f30add1fe1c2eee8c746841058fb85ca', 'chat action config must pin the reviewed APK payload');
const chatActionConfig = JSON.parse(chatActionBytes.toString('utf8'));
assert.ok(
  chatActionConfig.actionBar.every(({ id, show }) => typeof id === 'string' && show === true),
  'the verbatim APK action config must keep six enabled, named actions',
);
assert.deepEqual(
  chatActionConfig.actionBar.map(({ id, show }) => ({ id, show })),
  APP_CHAT_MESSAGE_ACTIONS.map((id) => ({ id, show: true })),
  'archived chat action order must agree with the verbatim APK config',
);

for (const sample of provenance.selectedLotties) {
  assert.match(sample.localPath, /^client\/public\/reference-lottie\/[a-z0-9-]+\.json$/, 'selected Lottie must stay in the migration allowlist');
  const content = await readFile(new URL(`./public/reference-lottie/${sample.localPath.split('/').at(-1)}`, import.meta.url));
  assert.equal(createHash('sha256').update(content).digest('hex'), sample.sha256, `${sample.localPath} must match its recorded APK hash`);
  const lottie = JSON.parse(content.toString('utf8'));
  assert.ok(lottie.v && Array.isArray(lottie.layers), `${sample.localPath} must remain valid Lottie JSON`);
}

assert.equal(provenance.screenMapping, 'docs/app-reference/screen-mapping.json', 'provenance must link the checked-in screen mapping');
assert.ok(provenance.selectedLayouts.length >= 8, 'at least eight APK layouts must be decoded into the geometry dossier');
assert.equal(provenance.dexClasses.targets.length, 9, 'all nine target Activity/Fragment classes must be indexed');
assert.equal(provenance.dexClasses.buildToolsRevision, '35.0.0', 'DEX/layout evidence must pin the Android Build Tools revision');
assert.deepEqual(
  Object.fromEntries(provenance.dexClasses.targets.map(({ name, dexEntry }) => [name, dexEntry])),
  {
    HomeActivity: 'classes17.dex',
    HomeFeedFragment: 'classes17.dex',
    BotPartnerActivity: 'classes16.dex',
    ChatIMFragment: 'classes16.dex',
    StoryGameActivity: 'classes16.dex',
    DramaActivity: 'classes16.dex',
    UGCCreationActivity: 'classes16.dex',
    SearchMainActivity: 'classes17.dex',
    MemberCenterActivity: 'classes19.dex',
  },
  'target classes must remain pinned to their unique defining DEX entries',
);
assert.deepEqual(
  Object.fromEntries(
    ['classes16.dex', 'classes17.dex', 'classes19.dex'].map((dexEntry) => [
      dexEntry,
      provenance.dexClasses.targets.filter((target) => target.dexEntry === dexEntry).length,
    ]),
  ),
  { 'classes16.dex': 5, 'classes17.dex': 3, 'classes19.dex': 1 },
  'target class index must retain the reviewed 5/3/1 DEX distribution',
);
for (const target of provenance.dexClasses.targets) {
  assert.equal(target.buildToolsRevision, '35.0.0', `${target.name} must pin the Build Tools revision`);
  assert.equal(
    target.kind,
    target.name.endsWith('Fragment') ? 'fragment' : 'activity',
    `${target.name} must record its Android component kind`,
  );
  assert.equal(
    target.manifestDeclared,
    target.kind === 'activity',
    `${target.name} Manifest declaration must agree with its component kind`,
  );
}
assert.equal(screenMapping.schemaVersion, 1, 'screen mapping must use the reviewed schema');
assert.deepEqual(
  screenMapping.surfaces.map(({ id }) => id),
  ['today', 'discover', 'messages', 'profile', 'chat', 'shell'],
  'screen mapping must cover the six App surfaces exactly once',
);
const selectedLayoutPaths = new Set(provenance.selectedLayouts.map(({ apkPath }) => apkPath));
const indexedClasses = new Set(provenance.dexClasses.targets.map(({ fqcn }) => fqcn));
const mappedLayoutPaths = new Set();
const mappedClasses = new Set();
const minimumComponents = {
  today: 2,
  discover: 5,
  messages: 2,
  profile: 2,
  chat: 1,
  shell: 4,
};
for (const surface of screenMapping.surfaces) {
  const expectedTreatment = surface.id === 'chat'
    ? { structure: 'main-baseline', behavior: 'main-baseline', approvedAssets: 'reference-only' }
    : { structure: 'rewrite', behavior: 'port', approvedAssets: 'reuse' };
  assert.deepEqual(
    surface.treatment,
    expectedTreatment,
    `${surface.id} must state the reuse/port/rewrite treatment`,
  );
  assert.ok(surface.apkClasses.length > 0, `${surface.id} must map at least one APK class`);
  assert.ok(surface.apkLayouts.length > 0, `${surface.id} must map at least one decoded APK layout`);
  assert.ok(
    surface.aaaComponents.length >= minimumComponents[surface.id],
    `${surface.id} must map its decomposed AAA component surface`,
  );
  assert.ok(surface.tests.length > 0, `${surface.id} must map at least one test contract`);
  for (const fqcn of surface.apkClasses) {
    assert.ok(indexedClasses.has(fqcn), `${surface.id} class ${fqcn} must exist in the DEX target index`);
    mappedClasses.add(fqcn);
  }
  for (const apkPath of surface.apkLayouts) {
    assert.ok(selectedLayoutPaths.has(apkPath), `${surface.id} layout ${apkPath} must exist in the decoded layout index`);
    mappedLayoutPaths.add(apkPath);
  }
  for (const component of surface.aaaComponents) {
    await access(new URL(`../${component.path}`, import.meta.url));
    assert.ok(component.export, `${surface.id} component mapping must name its export`);
  }
  for (const test of surface.tests) {
    await access(new URL(`../${test.path}`, import.meta.url));
    assert.ok(test.contract, `${surface.id} test mapping must describe its contract`);
  }
}
assert.deepEqual([...mappedClasses].sort(), [...indexedClasses].sort(), 'every indexed APK class must participate in a surface mapping');
assert.deepEqual([...mappedLayoutPaths].sort(), [...selectedLayoutPaths].sort(), 'every decoded APK layout must participate in a surface mapping');

const workOutput = fileURLToPath(new URL('../../maoxiang-reference/', import.meta.url));
let workDossierPresent = true;
try {
  await access(workOutput);
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
  workDossierPresent = false;
}
if (workDossierPresent) {
  const layoutGeometryIndex = JSON.parse(await readFile(join(workOutput, 'layout-geometry-index.json'), 'utf8'));
  const dexClassIndex = JSON.parse(await readFile(join(workOutput, 'dex-class-index.json'), 'utf8'));
  assert.equal(layoutGeometryIndex.layoutCount, provenance.selectedLayouts.length, 'layout geometry work index must cover every selected layout');
  assert.ok(layoutGeometryIndex.layoutCount >= 8, 'layout geometry work index must retain at least eight xmltree dumps');
  for (const layout of layoutGeometryIndex.layouts) {
    assert.ok(layout.rootElement, `${layout.id} must record a decoded root element`);
    assert.ok(layout.elementCount > 0, `${layout.id} must record decoded elements`);
    await access(join(workOutput, layout.outputPath));
  }
  assert.equal(dexClassIndex.buildToolsRevision, '35.0.0', 'DEX work index must pin the Build Tools revision');
  assert.equal(dexClassIndex.foundCount, 9, 'DEX work index must resolve all nine target classes');
  assert.deepEqual(
    dexClassIndex.classes.map(({ name, kind, manifestDeclared, buildToolsRevision, dexEntry }) => ({
      name,
      kind,
      manifestDeclared,
      buildToolsRevision,
      dexEntry,
    })),
    provenance.dexClasses.targets.map(({ name, kind, manifestDeclared, buildToolsRevision, dexEntry }) => ({
      name,
      kind,
      manifestDeclared,
      buildToolsRevision,
      dexEntry,
    })),
    'checked-in class provenance must agree with the reproducible work index',
  );
}

try {
  await access(provenance.sourceApk.path);
  const apk = await readFile(provenance.sourceApk.path);
  assert.equal(createHash('sha256').update(apk).digest('hex'), provenance.sourceApk.sha256, 'available source APK must match its provenance checksum');
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

const clientRoot = fileURLToPath(new URL('./', import.meta.url));
const sourceFiles = await collectFiles(join(clientRoot, 'src'));
const publicFiles = await collectFiles(join(clientRoot, 'public'));
const prohibitedArtifactExtensions = new Set(['.apk', '.aab', '.aar', '.dex', '.odex', '.vdex', '.so', '.jar', '.smali', '.class']);
assert.deepEqual(
  [...sourceFiles, ...publicFiles].filter((path) => prohibitedArtifactExtensions.has(extname(path).toLowerCase())),
  [],
  'client runtime must not ship APK/native/vendor artifact file types',
);
const runtimeText = await Promise.all(sourceFiles.filter((path) => /\.(?:[cm]?js|jsx|css)$/i.test(path)).map((path) => readFile(path, 'utf8')));
assert.doesNotMatch(runtimeText.join('\n'), /(?:猫箱|com\.parallel\.odyssey|com\.bytedance|com\.lynx|ttwebview|maoxiang)/i, 'runtime source must exclude the reference brand and vendor namespaces');

console.log(
  `APK provenance gate passed: ${provenance.selectedLotties.length} Lotties, `
  + `${provenance.selectedAssets.length} config, ${provenance.selectedLayouts.length} layouts, `
  + `${provenance.dexClasses.targets.length} classes, ${screenMapping.surfaces.length} surfaces`,
);
