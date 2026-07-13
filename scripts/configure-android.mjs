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
      gradle = gradle.replace(new RegExp(`\\s*${dependency.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`, 'g'), '\n');
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
    }
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
