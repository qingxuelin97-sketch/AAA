import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv[2];

function localEnv() {
  const file = path.join(root, 'client', '.env');
  if (!fs.existsSync(file)) return {};
  const values = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

const envFile = localEnv();
const serverUrl = String(process.env.VITE_API_BASE || envFile.VITE_API_BASE || '').trim().replace(/\/+$/, '');
const projectNumber = String(process.env.PLAY_INTEGRITY_CLOUD_PROJECT_NUMBER || envFile.PLAY_INTEGRITY_CLOUD_PROJECT_NUMBER || '').trim();
const httpTest = mode === '--before-debug-http' || mode === '--after-debug-http';

function validateInputs() {
  let parsed;
  try { parsed = new URL(serverUrl); } catch { throw new Error('VITE_API_BASE must be a valid absolute URL'); }
  const expectedProtocol = httpTest ? 'http:' : 'https:';
  if (parsed.protocol !== expectedProtocol || parsed.username || parsed.password || parsed.hash || parsed.search
      || (parsed.pathname && parsed.pathname !== '/')) {
    throw new Error(`VITE_API_BASE must be a bare ${expectedProtocol.slice(0, -1).toUpperCase()} origin without credentials, path, query, or fragment`);
  }
  if (httpTest && ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)) {
    throw new Error('HTTP test endpoint must be reachable by the physical test device');
  }
  if (!httpTest && !/^\d{6,20}$/.test(projectNumber)) {
    throw new Error('PLAY_INTEGRITY_CLOUD_PROJECT_NUMBER must contain 6-20 digits');
  }
  return parsed;
}

function writeCapacitorConfig(cloudProjectNumber, insecureHttp = false) {
  const file = path.join(root, 'capacitor.config.json');
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  config.server = { androidScheme: insecureHttp ? 'http' : 'https', cleartext: insecureHttp };
  config.plugins ||= {};
  config.plugins.PlayIntegrity = { cloudProjectNumber };
  fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
}

function before() {
  validateInputs();
  writeCapacitorConfig(httpTest ? '' : projectNumber, httpTest);
}

// —— 版本号 ——
// Capacitor 生成的工程恒为 versionCode 1 / versionName "1.0"。versionCode 不递增时
// Android 会拒绝覆盖安装（也上不了任何分发渠道），用户只能先卸载——而卸载会清空
// 本地数据。CI 传 ANDROID_VERSION_CODE / ANDROID_VERSION_NAME 覆盖；缺省保持原值。
function applyVersion(gradle) {
  const code = String(process.env.ANDROID_VERSION_CODE || '').trim();
  const name = String(process.env.ANDROID_VERSION_NAME || '').trim();
  if (code) {
    if (!/^\d{1,9}$/.test(code)) throw new Error('ANDROID_VERSION_CODE must be 1-9 digits');
    gradle = gradle.replace(/versionCode\s+\d+/, `versionCode ${code}`);
  }
  if (name) {
    if (!/^[\w.+-]{1,32}$/.test(name)) throw new Error('ANDROID_VERSION_NAME must be 1-32 chars of [A-Za-z0-9._+-]');
    gradle = gradle.replace(/versionName\s+"[^"]*"/, `versionName "${name}"`);
  }
  return gradle;
}

// —— release 签名 ——
// debug 签名用的是 Android SDK 的公共调试密钥：任何人都能用同一个密钥签出「同一个
// 应用」的更新包，且 debug 与 release 签名不可互换——一旦切换，已装用户必须卸载重装
// （本地 token / 草稿 / 阅读进度全丢）。因此越早切代价越小。
//
// 密钥本身不进仓库：CI 从 secret 解出 keystore 落到 app/ 下，口令走 System.getenv
// 在 Gradle 运行时读取，不写进任何文件。未配置 secret 时整段跳过，构建照常产出
// debug 包——不能因为签名没配好就把发版链路整个掐断。
function applySigning(gradle, appRoot) {
  const b64 = String(process.env.ANDROID_KEYSTORE_BASE64 || '').trim();
  if (!b64) return gradle;
  for (const key of ['ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD']) {
    if (!String(process.env[key] || '').trim()) throw new Error(`${key} is required when ANDROID_KEYSTORE_BASE64 is set`);
  }
  const keystore = Buffer.from(b64, 'base64');
  // JKS 以 0xFEEDFEED 开头，PKCS#12 是 DER SEQUENCE（0x30）。base64 传坏时这里就拦住，
  // 否则要等 Gradle 报一句难以定位的密钥库错误。
  const magic = keystore.readUInt32BE(0);
  if (keystore.length < 64 || (magic !== 0xfeedfeed && keystore[0] !== 0x30)) {
    throw new Error('ANDROID_KEYSTORE_BASE64 does not decode to a JKS or PKCS#12 keystore');
  }
  fs.writeFileSync(path.join(appRoot, 'release.keystore'), keystore);

  if (!/signingConfigs\s*\{/.test(gradle)) {
    gradle = gradle.replace(/android\s*\{/, match => `${match}
    signingConfigs {
        release {
            storeFile file('release.keystore')
            storePassword System.getenv("ANDROID_KEYSTORE_PASSWORD")
            keyAlias System.getenv("ANDROID_KEY_ALIAS")
            keyPassword System.getenv("ANDROID_KEY_PASSWORD")
        }
    }`);
  }
  if (!/signingConfig\s+signingConfigs\.release/.test(gradle)) {
    gradle = gradle.replace(/(buildTypes\s*\{\s*release\s*\{)/, '$1\n            signingConfig signingConfigs.release');
  }
  return gradle;
}

function after() {
  validateInputs();
  try {
    const appRoot = path.join(root, 'android', 'app');
    const javaDir = path.join(appRoot, 'src', 'main', 'java', 'ai', 'huanyu', 'app');
    const integrityPluginFile = path.join(javaDir, 'PlayIntegrityPlugin.java');
    fs.mkdirSync(javaDir, { recursive: true });
    const gradleFile = path.join(appRoot, 'build.gradle');
    let gradle = fs.readFileSync(gradleFile, 'utf8');
    const dependency = "implementation 'com.google.android.play:integrity:1.6.0'";
    if (httpTest) {
      // A sideloaded HTTP debug build has no Play licence verdict. Keep the
      // bridge entirely out of this variant; invite/whitelist registration
      // remains the only registration path.
      // 只删依赖自己那一整行。此前两侧用 \s* 贪婪匹配再替换成单个 \n，会把紧随其后
      // 那一行的缩进一并吃掉，正式/调试变体来回切换时逐次侵蚀 build.gradle。
      const escaped = dependency.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      gradle = gradle.replace(new RegExp(`^[ \\t]*${escaped}[ \\t]*\\r?\\n`, 'gm'), '');
      fs.copyFileSync(path.join(root, '.github', 'native', 'debug', 'MainActivity.java'), path.join(javaDir, 'MainActivity.java'));
      if (fs.existsSync(integrityPluginFile)) fs.rmSync(integrityPluginFile);
    } else {
      const templateDir = path.join(root, '.github', 'native', 'android');
      for (const name of ['MainActivity.java', 'PlayIntegrityPlugin.java']) {
        fs.copyFileSync(path.join(templateDir, name), path.join(javaDir, name));
      }
      if (!gradle.includes(dependency)) {
        gradle = gradle.replace(/dependencies\s*\{/, match => `${match}\n    ${dependency}`);
      }
      // 签名只给正式变体。侧载的 HTTP 调试包本就拿不到 Play 校验结论，
      // 给它上正式密钥没有意义，反而多一份密钥暴露面。
      gradle = applySigning(gradle, appRoot);
    }
    gradle = applyVersion(gradle);
    fs.writeFileSync(gradleFile, gradle);

    const manifestFile = path.join(appRoot, 'src', 'main', 'AndroidManifest.xml');
    let manifest = fs.readFileSync(manifestFile, 'utf8');
    const attributes = { usesCleartextTraffic: httpTest ? 'true' : 'false', allowBackup: 'false' };
    for (const [attribute, value] of Object.entries(attributes)) {
      const pattern = new RegExp(`android:${attribute}="[^"]*"`, 'i');
      if (pattern.test(manifest)) {
        manifest = manifest.replace(pattern, `android:${attribute}="${value}"`);
      } else {
        manifest = manifest.replace('<application', `<application android:${attribute}="${value}"`);
      }
    }
    fs.writeFileSync(manifestFile, manifest);
  } finally {
    // The generated native project keeps the real number. Avoid leaving a
    // machine-specific build value in the tracked configuration afterwards.
    writeCapacitorConfig('');
  }
}

if (mode === '--before' || mode === '--before-debug-http') before();
else if (mode === '--after' || mode === '--after-debug-http') after();
else throw new Error('Usage: node scripts/configure-android.mjs --before|--after|--before-debug-http|--after-debug-http');
