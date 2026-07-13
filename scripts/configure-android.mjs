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

function validateInputs() {
  let parsed;
  try { parsed = new URL(serverUrl); } catch { throw new Error('VITE_API_BASE must be a valid HTTPS URL'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash || parsed.search) {
    throw new Error('VITE_API_BASE must be an HTTPS URL without credentials, query, or fragment');
  }
  if (!/^\d{6,20}$/.test(projectNumber)) {
    throw new Error('PLAY_INTEGRITY_CLOUD_PROJECT_NUMBER must contain 6-20 digits');
  }
}

function writeCapacitorConfig(cloudProjectNumber) {
  const file = path.join(root, 'capacitor.config.json');
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  config.server = { androidScheme: 'https', cleartext: false };
  config.plugins ||= {};
  config.plugins.PlayIntegrity = { cloudProjectNumber };
  fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
}

function before() {
  validateInputs();
  writeCapacitorConfig(projectNumber);
}

function after() {
  validateInputs();
  try {
    const appRoot = path.join(root, 'android', 'app');
    const javaDir = path.join(appRoot, 'src', 'main', 'java', 'ai', 'huanyu', 'app');
    const templateDir = path.join(root, '.github', 'native', 'android');
    fs.mkdirSync(javaDir, { recursive: true });
    for (const name of ['MainActivity.java', 'PlayIntegrityPlugin.java']) {
      fs.copyFileSync(path.join(templateDir, name), path.join(javaDir, name));
    }

    const gradleFile = path.join(appRoot, 'build.gradle');
    let gradle = fs.readFileSync(gradleFile, 'utf8');
    const dependency = "implementation 'com.google.android.play:integrity:1.6.0'";
    if (!gradle.includes(dependency)) {
      gradle = gradle.replace(/dependencies\s*\{/, match => `${match}\n    ${dependency}`);
      fs.writeFileSync(gradleFile, gradle);
    }

    const manifestFile = path.join(appRoot, 'src', 'main', 'AndroidManifest.xml');
    let manifest = fs.readFileSync(manifestFile, 'utf8');
    for (const attribute of ['usesCleartextTraffic', 'allowBackup']) {
      const pattern = new RegExp(`android:${attribute}="[^"]*"`, 'i');
      if (pattern.test(manifest)) {
        manifest = manifest.replace(pattern, `android:${attribute}="false"`);
      } else {
        manifest = manifest.replace('<application', `<application android:${attribute}="false"`);
      }
    }
    fs.writeFileSync(manifestFile, manifest);
  } finally {
    // The generated native project keeps the real number. Avoid leaving a
    // machine-specific build value in the tracked configuration afterwards.
    writeCapacitorConfig('');
  }
}

if (mode === '--before') before();
else if (mode === '--after') after();
else throw new Error('Usage: node scripts/configure-android.mjs --before|--after');
