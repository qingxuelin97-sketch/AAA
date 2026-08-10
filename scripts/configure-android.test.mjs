// configure-android.mjs 的回归测试。
//
// —— 为什么这个脚本值得专门测 ——
// 它掌管整条发版链路：注入 Play Integrity 桥、关掉明文流量、关掉 allowBackup、
// 清理机器相关的构建值、以及（本轮起）注入 release 签名配置。它此前零测试，
// 而它的反馈环是整条链路里最长的一段 —— 改错要等到 CI 出完 APK、装到真机上
// 才会发现，而那时错的可能是「装得上但注册不了」这种不会报错的形态。
//
// 做法：把真实脚本复制进一棵最小的假 android 工程树里跑。脚本用
// import.meta.url 定位 root，因此复制到 <tmp>/scripts/ 下运行时，它操作的就是
// 临时工程 —— 测的是实际发布的那个文件，不是它的副本或重写。
//
// 运行：node scripts/configure-android.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REAL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REAL_SCRIPT = path.join(REAL_ROOT, 'scripts', 'configure-android.mjs');

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✓', msg); } else { fail++; console.log('  ✗', msg); } };

const GRADLE_FIXTURE = `apply plugin: 'com.android.application'

android {
    namespace "ai.huanyu.app"
    compileSdk 35
    defaultConfig {
        applicationId "ai.huanyu.app"
        minSdk 23
        targetSdk 35
        versionCode 1
        versionName "1.0"
    }
    buildTypes {
        release {
            minifyEnabled false
        }
    }
}

dependencies {
    implementation fileTree(include: ['*.jar'], dir: 'libs')
    implementation "androidx.appcompat:appcompat:$androidxAppCompatVersion"
}

apply from: 'capacitor.build.gradle'
`;

const MANIFEST_FIXTURE = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application
        android:allowBackup="true"
        android:icon="@mipmap/ic_launcher"
        android:label="@string/app_name">
        <activity android:name=".MainActivity" android:exported="true" />
    </application>
    <uses-permission android:name="android.permission.INTERNET" />
</manifest>
`;

// 一棵能让脚本跑起来的最小工程树。故意在 capacitor.config.json 里放一个**别的**
// 插件配置，用来验证清理 cloudProjectNumber 时不会把邻居一起抹掉。
function makeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-android-'));
  const mk = (p) => fs.mkdirSync(path.join(dir, p), { recursive: true });
  const write = (p, s) => fs.writeFileSync(path.join(dir, p), s);

  mk('scripts');
  fs.copyFileSync(REAL_SCRIPT, path.join(dir, 'scripts', 'configure-android.mjs'));

  mk('android/app/src/main');
  write('android/app/build.gradle', GRADLE_FIXTURE);
  write('android/app/src/main/AndroidManifest.xml', MANIFEST_FIXTURE);

  mk('.github/native/android');
  write('.github/native/android/MainActivity.java', '// release MainActivity\n');
  write('.github/native/android/PlayIntegrityPlugin.java', '// PlayIntegrityPlugin\n');
  mk('.github/native/debug');
  write('.github/native/debug/MainActivity.java', '// debug MainActivity\n');

  write('capacitor.config.json', `${JSON.stringify({
    appId: 'ai.huanyu.app',
    appName: '幻域',
    webDir: 'client/dist-static',
    backgroundColor: '#E4F1F6',
    plugins: { SplashScreen: { launchAutoHide: false }, Keyboard: { resize: 'none' } },
  }, null, 2)}\n`);

  return dir;
}

function run(dir, mode, env = {}) {
  return execFileSync(process.execPath, [path.join(dir, 'scripts', 'configure-android.mjs'), mode], {
    cwd: dir, encoding: 'utf8',
    env: { ...process.env, VITE_API_BASE: 'https://api.example.com', PLAY_INTEGRITY_CLOUD_PROJECT_NUMBER: '123456789012', ...env },
  });
}
// 预期失败的用例：吞掉子进程 stderr，否则正常的测试输出会被堆栈淹没。
const runFails = (dir, mode, env = {}) => {
  try {
    execFileSync(process.execPath, [path.join(dir, 'scripts', 'configure-android.mjs'), mode], {
      cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, VITE_API_BASE: 'https://api.example.com', PLAY_INTEGRITY_CLOUD_PROJECT_NUMBER: '123456789012', ...env },
    });
    return null;
  } catch (e) { return String(e.stderr || e.message); }
};
const read = (dir, p) => fs.readFileSync(path.join(dir, p), 'utf8');
const exists = (dir, p) => fs.existsSync(path.join(dir, p));
const JAVA_DIR = 'android/app/src/main/java/ai/huanyu/app';

console.log('configure-android.mjs 回归');

/* 1) --after 正式变体：桥接注入 / 明文关闭 / 备份关闭 */
{
  const dir = makeFixture();
  run(dir, '--before');
  run(dir, '--after');
  const manifest = read(dir, 'android/app/src/main/AndroidManifest.xml');
  const gradle = read(dir, 'android/app/build.gradle');

  ok(exists(dir, `${JAVA_DIR}/MainActivity.java`) && exists(dir, `${JAVA_DIR}/PlayIntegrityPlugin.java`),
    '两个 .java 模板落到 ai/huanyu/app 下');
  ok(gradle.includes("implementation 'com.google.android.play:integrity:1.6.0'"), 'gradle 注入 Play Integrity 依赖');
  ok(/android:usesCleartextTraffic="false"/.test(manifest), 'manifest 关闭明文流量');
  ok(/android:allowBackup="false"/.test(manifest), 'manifest 关闭 allowBackup（否则 adb backup 可捞出登录态）');
  ok(!/android:allowBackup="true"/.test(manifest), '既有的 allowBackup="true" 被覆盖而不是追加');
  // 这条最容易在改 writeCapacitorConfig 时踩坏：清 cloudProjectNumber 不能顺手清掉别的插件配置。
  const cfg = JSON.parse(read(dir, 'capacitor.config.json'));
  ok(cfg.plugins?.PlayIntegrity?.cloudProjectNumber === '', '构建后 cloudProjectNumber 被清空（不把机器相关值留在仓库里）');
  ok(cfg.plugins?.SplashScreen?.launchAutoHide === false && cfg.plugins?.Keyboard?.resize === 'none',
    '清理 cloudProjectNumber 时未抹掉其它插件配置');
  ok(cfg.appId === 'ai.huanyu.app' && cfg.backgroundColor === '#E4F1F6', '其余顶层配置保持不变');
  fs.rmSync(dir, { recursive: true, force: true });
}

/* 2) 幂等：连跑两次结果逐字节一致（重复注入 gradle 依赖是最典型的翻车方式） */
{
  const dir = makeFixture();
  run(dir, '--before'); run(dir, '--after');
  const first = { gradle: read(dir, 'android/app/build.gradle'), manifest: read(dir, 'android/app/src/main/AndroidManifest.xml') };
  run(dir, '--before'); run(dir, '--after');
  const second = { gradle: read(dir, 'android/app/build.gradle'), manifest: read(dir, 'android/app/src/main/AndroidManifest.xml') };

  ok(first.gradle === second.gradle, '重复执行后 build.gradle 不变（依赖未被重复注入）');
  ok(first.manifest === second.manifest, '重复执行后 AndroidManifest.xml 不变');
  const deps = read(dir, 'android/app/build.gradle').match(/com\.google\.android\.play:integrity/g) || [];
  ok(deps.length === 1, `Play Integrity 依赖只出现一次（实际 ${deps.length}）`);
  fs.rmSync(dir, { recursive: true, force: true });
}

/* 3) HTTP 调试变体：桥接必须整个移除，明文必须打开 */
{
  const dir = makeFixture();
  const env = { VITE_API_BASE: 'http://192.168.1.10:4000', PLAY_INTEGRITY_CLOUD_PROJECT_NUMBER: '' };
  run(dir, '--before-debug-http', env);
  run(dir, '--after-debug-http', env);
  const gradle = read(dir, 'android/app/build.gradle');
  const manifest = read(dir, 'android/app/src/main/AndroidManifest.xml');

  ok(!gradle.includes('com.google.android.play:integrity'), 'HTTP 变体移除 Play Integrity 依赖');
  ok(!exists(dir, `${JAVA_DIR}/PlayIntegrityPlugin.java`), 'HTTP 变体不留 PlayIntegrityPlugin.java');
  ok(read(dir, `${JAVA_DIR}/MainActivity.java`).includes('debug MainActivity'), 'HTTP 变体使用 debug 版 MainActivity');
  ok(/android:usesCleartextTraffic="true"/.test(manifest), 'HTTP 变体允许明文流量');
  ok(/android:allowBackup="false"/.test(manifest), 'HTTP 变体仍然关闭 allowBackup');
  ok(gradle.includes("implementation fileTree(include: ['*.jar'], dir: 'libs')"), '移除依赖时未误伤其它依赖行');
  fs.rmSync(dir, { recursive: true, force: true });
}

/* 4) 正式变体 → HTTP 变体 → 正式变体 来回切换必须干净收敛 */
{
  const dir = makeFixture();
  run(dir, '--before'); run(dir, '--after');
  const httpsGradle = read(dir, 'android/app/build.gradle');
  const httpEnv = { VITE_API_BASE: 'http://192.168.1.10:4000', PLAY_INTEGRITY_CLOUD_PROJECT_NUMBER: '' };
  run(dir, '--before-debug-http', httpEnv); run(dir, '--after-debug-http', httpEnv);
  run(dir, '--before'); run(dir, '--after');

  ok(read(dir, 'android/app/build.gradle') === httpsGradle, '切到 HTTP 变体再切回来，build.gradle 回到同一状态');
  ok(exists(dir, `${JAVA_DIR}/PlayIntegrityPlugin.java`), '切回正式变体后 PlayIntegrityPlugin.java 被恢复');
  ok(read(dir, `${JAVA_DIR}/MainActivity.java`).includes('release MainActivity'), '切回正式变体后 MainActivity 换回 release 版');
  ok(/android:usesCleartextTraffic="false"/.test(read(dir, 'android/app/src/main/AndroidManifest.xml')), '切回正式变体后明文重新关闭');
  fs.rmSync(dir, { recursive: true, force: true });
}

/* 5) 输入校验：这些是「装得上但用不了」的静默故障源，必须构建期就拦住 */
{
  const dir = makeFixture();
  const cases = [
    ['HTTP 地址走正式变体', { VITE_API_BASE: 'http://api.example.com' }],
    ['带路径的地址', { VITE_API_BASE: 'https://api.example.com/v1' }],
    ['带查询串的地址', { VITE_API_BASE: 'https://api.example.com/?x=1' }],
    ['带凭据的地址', { VITE_API_BASE: 'https://u:p@api.example.com' }],
    ['非法 URL', { VITE_API_BASE: 'not-a-url' }],
    ['空的项目编号', { PLAY_INTEGRITY_CLOUD_PROJECT_NUMBER: '' }],
    ['非数字项目编号', { PLAY_INTEGRITY_CLOUD_PROJECT_NUMBER: 'abcdefgh' }],
  ];
  for (const [name, env] of cases) ok(runFails(dir, '--before', env) !== null, `--before 拒绝：${name}`);
  ok(runFails(dir, '--before-debug-http', { VITE_API_BASE: 'http://localhost:4000', PLAY_INTEGRITY_CLOUD_PROJECT_NUMBER: '' }) !== null,
    '--before-debug-http 拒绝：localhost（真机够不着）');
  ok(runFails(dir, '--nonsense') !== null, '未知参数直接报错而不是静默什么都不做');
  fs.rmSync(dir, { recursive: true, force: true });
}

/* 6) release 签名：配了 secret 才注入，且只给正式变体 */
{
  // 造一个形状合法的 JKS：魔数 0xFEEDFEED + 足够长度。这里只验证脚本的接线与校验，
  // 真正能否签出包由 Gradle 在 CI 上决定。
  const jks = Buffer.concat([Buffer.from([0xfe, 0xed, 0xfe, 0xed]), Buffer.alloc(96, 7)]);
  const signEnv = {
    ANDROID_KEYSTORE_BASE64: jks.toString('base64'),
    ANDROID_KEYSTORE_PASSWORD: 'pw', ANDROID_KEY_ALIAS: 'huanyu', ANDROID_KEY_PASSWORD: 'pw',
  };

  const dir = makeFixture();
  run(dir, '--before'); run(dir, '--after', signEnv);
  const gradle = read(dir, 'android/app/build.gradle');
  ok(/signingConfigs\s*\{[\s\S]*release\s*\{[\s\S]*storeFile file\('release\.keystore'\)/.test(gradle), '注入 signingConfigs.release');
  ok(/buildTypes\s*\{\s*release\s*\{\s*\n\s*signingConfig signingConfigs\.release/.test(gradle), 'release 构建类型挂上该签名配置');
  ok(exists(dir, 'android/app/release.keystore'), 'keystore 从 base64 解出并落盘');
  ok(!gradle.includes('pw') && !gradle.includes(jks.toString('base64')),
    '口令与密钥内容不写进 build.gradle（走 System.getenv 在运行时读）');

  run(dir, '--before'); run(dir, '--after', signEnv);
  const twice = read(dir, 'android/app/build.gradle');
  ok((twice.match(/signingConfigs \{/g) || []).length === 1, '重复执行不重复注入 signingConfigs');
  ok((twice.match(/signingConfig signingConfigs\.release/g) || []).length === 1, '重复执行不重复挂 signingConfig');
  fs.rmSync(dir, { recursive: true, force: true });

  // 未配 secret：整段跳过，构建链路不能因此断掉。
  const plain = makeFixture();
  run(plain, '--before'); run(plain, '--after');
  ok(!read(plain, 'android/app/build.gradle').includes('signingConfigs'), '未配 secret 时不注入签名（仍产出 debug 包）');
  ok(!exists(plain, 'android/app/release.keystore'), '未配 secret 时不落 keystore');
  fs.rmSync(plain, { recursive: true, force: true });

  // HTTP 调试变体不上正式密钥。
  const http = makeFixture();
  const httpEnv = { VITE_API_BASE: 'http://192.168.1.10:4000', PLAY_INTEGRITY_CLOUD_PROJECT_NUMBER: '', ...signEnv };
  run(http, '--before-debug-http', httpEnv); run(http, '--after-debug-http', httpEnv);
  ok(!read(http, 'android/app/build.gradle').includes('signingConfigs'), 'HTTP 调试变体不注入正式签名');
  ok(!exists(http, 'android/app/release.keystore'), 'HTTP 调试变体不落正式 keystore');
  fs.rmSync(http, { recursive: true, force: true });

  // 缺口令 / 坏 base64 必须构建期报错，而不是等 Gradle 抛一句难以定位的密钥库错误。
  const bad = makeFixture();
  ok(runFails(bad, '--after', { ANDROID_KEYSTORE_BASE64: jks.toString('base64') }) !== null, '配了 keystore 却缺口令 → 报错');
  ok(runFails(bad, '--after', { ...signEnv, ANDROID_KEYSTORE_BASE64: Buffer.from('not a keystore').toString('base64') }) !== null,
    'base64 解出来不是密钥库 → 报错');
  fs.rmSync(bad, { recursive: true, force: true });
}

/* 7) versionCode / versionName：不递增就无法覆盖安装 */
{
  const dir = makeFixture();
  run(dir, '--before');
  run(dir, '--after', { ANDROID_VERSION_CODE: '7', ANDROID_VERSION_NAME: '1.2.0' });
  const gradle = read(dir, 'android/app/build.gradle');
  ok(/versionCode 7\b/.test(gradle), 'versionCode 被覆盖为 7');
  ok(/versionName "1\.2\.0"/.test(gradle), 'versionName 被覆盖为 1.2.0');
  ok(!/versionCode 1\b/.test(gradle) && !/versionName "1\.0"/.test(gradle), '模板默认值 1 / "1.0" 未残留');
  fs.rmSync(dir, { recursive: true, force: true });

  const dflt = makeFixture();
  run(dflt, '--before'); run(dflt, '--after');
  ok(/versionCode 1\b/.test(read(dflt, 'android/app/build.gradle')), '未提供版本号时保持模板默认值');
  fs.rmSync(dflt, { recursive: true, force: true });

  const bad = makeFixture();
  ok(runFails(bad, '--after', { ANDROID_VERSION_CODE: 'abc' }) !== null, '非数字 versionCode → 报错');
  ok(runFails(bad, '--after', { ANDROID_VERSION_NAME: 'x".evil' }) !== null, '含引号的 versionName → 报错（否则会破坏 gradle 语法）');
  fs.rmSync(bad, { recursive: true, force: true });
}

console.log(`\nconfigure-android: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
