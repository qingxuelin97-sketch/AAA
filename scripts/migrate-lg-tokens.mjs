#!/usr/bin/env node
/**
 * IX-7 token migration codemod.
 *
 * The migration is intentionally idempotent: it only rewrites the legacy
 * namespaces and never touches already migrated --ix-* identifiers.  Keep the
 * map here as an auditable record of the frozen semantic decisions; running
 * this file a second time must produce no further diff.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(process.cwd(), process.argv.includes('--root')
  ? process.argv[process.argv.indexOf('--root') + 1]
  : 'client/src');
const EXTENSIONS = new Set(['.css', '.js', '.jsx', '.mjs', '.html']);
const SKIP = new Set([
  // These files are deleted as part of IX-7 and must remain historical
  // snapshots while the codemod is run.
  'styles/lumen-glass-tokens.css',
  'styles/app-quiet-aqua-tokens.css',
  'styles/app-ix-bridge.css',
  'styles/app-lumen-materials.css',
  'styles/app-lumen-s3.css',
  'styles/app-lumen-s4.css',
  'styles/app-lumen-s5.css',
  'styles/app-lumen-s6.css',
  'styles/app-lumen-s7.css',
]);

// Longest names first prevents a short replacement from consuming a longer
// semantic token (for example --lg-r-card before --lg-r-card-*).
const TOKEN_MAP = new Map([
  ['--lg-ambient-warm', '--ix-ambient-none'],
  ['--lg-ambient-cool', '--ix-ambient-none'],
  ['--lg-ambient-rose', '--ix-ambient-none'],
  ['--lg-ambient', '--ix-ambient-none'],
  ['--lg-azure', '--ix-dia'],
  ['--lg-violet', '--ix-act'],
  ['--lg-rose', '--ix-danger'],
  ['--lg-coral', '--ix-danger'],
  ['--lg-jade', '--ix-success'],
  ['--lg-gold', '--ix-gold'],
  ['--lg-dia', '--ix-dia'],
  ['--lg-finance-ink', '--ix-vault-ink'],
  ['--lg-finance', '--ix-vault'],
  ['--lg-glass-shadow-1', '--ix-shadow-1'],
  ['--lg-glass-shadow-2', '--ix-shadow-2'],
  ['--lg-glass-shadow-3', '--ix-shadow-3'],
  ['--lg-glass-1', '--ix-surface'],
  ['--lg-glass-2', '--ix-raise'],
  ['--lg-glass-3', '--ix-glass-nav'],
  ['--lg-glass-sel', '--ix-surface'],
  ['--lg-blur-s', '--ix-blur-s'],
  ['--lg-blur', '--ix-blur'],
  ['--lg-canvas', '--ix-canvas'],
  ['--lg-grouped', '--ix-grouped'],
  ['--lg-hairline', '--ix-hairline'],
  ['--lg-ink-3', '--ix-ink-3'],
  ['--lg-ink-2', '--ix-ink-2'],
  ['--lg-ink', '--ix-ink'],
  ['--lg-act-ink', '--ix-act-ink'],
  ['--lg-act-soft', '--ix-act-soft'],
  ['--lg-act', '--ix-act'],
  ['--lg-focus', '--ix-focus'],
  ['--lg-ph', '--ix-ph'],
  ['--lg-skeleton', '--ix-skeleton'],
  ['--lg-scrim', '--ix-scrim'],
  ['--lg-font-serif', '--ix-font-ui'],
  ['--lg-font-ui', '--ix-font-ui'],
  ['--lg-type-display', '--ix-type-readout'],
  ['--lg-type-hero', '--ix-type-hero'],
  ['--lg-type-title', '--ix-type-title'],
  ['--lg-type-section', '--ix-type-section'],
  ['--lg-type-body', '--ix-type-body'],
  ['--lg-type-meta', '--ix-type-meta'],
  ['--lg-r-control', '--ix-r-key'],
  ['--lg-r-sheet', '--ix-r-panel'],
  ['--lg-r-panel', '--ix-r-panel'],
  ['--lg-r-pill', '--ix-r-dial'],
  ['--lg-r-card', '--ix-r-card'],
  ['--lg-r-row', '--ix-r-card'],
  ['--lg-r-sm', '--ix-r-card'],
  ['--lg-r-xs', '--ix-r-key'],
  ['--lg-space-1', '--ix-space-1'],
  ['--lg-space-2', '--ix-space-2'],
  ['--lg-space-3', '--ix-space-3'],
  ['--lg-space-4', '--ix-space-4'],
  ['--lg-space-5', '--ix-space-5'],
  ['--lg-space-6', '--ix-space-6'],
  ['--lg-control-min', '--ix-hit-min'],
  ['--lg-control-submit', '--ix-hit-submit'],
  ['--lg-dock-height', '--ix-dock-height'],
  ['--lg-dock-bottom', '--ix-dock-bottom'],
  ['--lg-dur-entity', '--ix-dur-needle'],
  ['--lg-dur-shared', '--ix-dur-needle'],
  ['--lg-dur-sheet', '--ix-dur-sheet'],
  ['--lg-dur-push', '--ix-dur-push'],
  ['--lg-dur-state', '--ix-dur-state'],
  ['--lg-dur-press', '--ix-dur-press'],
  ['--lg-ease', '--ix-ease'],

  ['--qa3-canvas-deep', '--ix-composition-canvas-deep'],
  ['--qa3-canvas', '--ix-composition-canvas'],
  ['--qa3-paper-muted', '--ix-composition-paper-muted'],
  ['--qa3-paper-ink', '--ix-composition-paper-ink'],
  ['--qa3-paper', '--ix-composition-paper'],
  ['--qa3-shadow-float', '--ix-composition-shadow-float'],
  ['--qa3-shadow-short', '--ix-composition-shadow-short'],
  ['--qa3-spring-soft', '--ix-composition-spring-soft'],
  ['--qa3-spring', '--ix-composition-spring'],
  ['--qa3-teal-deep', '--ix-composition-teal-deep'],
  ['--qa3-teal-soft', '--ix-composition-teal-soft'],
  ['--qa3-teal', '--ix-composition-teal'],
  ['--qa3-coral', '--ix-composition-coral'],
  ['--qa3-gold', '--ix-composition-gold'],
  ['--qa3-ink', '--ix-composition-ink'],
  ['--qa3-line', '--ix-composition-line'],
  ['--qa3-material', '--ix-composition-material'],
  ['--qa3-muted', '--ix-composition-muted'],

  ['--qa-semantic-graphite-soft', '--ix-ink-2'],
  ['--qa-semantic-indigo-soft', '--ix-act-soft'],
  ['--qa-semantic-coral-soft', '--ix-danger-soft'],
  ['--qa-semantic-blue-soft', '--ix-dia-soft'],
  ['--qa-semantic-rose-soft', '--ix-danger-soft'],
  ['--qa-semantic-gold-soft', '--ix-gold-soft'],
  ['--qa-reward-soft', '--ix-gold-soft'],
  ['--qa-reward-ink', '--ix-gold-ink'],
  ['--qa-danger-soft', '--ix-danger-soft'],
  ['--qa-danger-ink', '--ix-danger-ink'],
  ['--qa-success-soft', '--ix-success-soft'],
  ['--qa-success-ink', '--ix-success-ink'],
  ['--qa-unread-ink', '--ix-badge-ink'],
  ['--qa-finance-surface-mid', '--ix-vault-2'],
  ['--qa-finance-muted', '--ix-vault-ink-2'],
  ['--qa-glass-chrome-bg', '--ix-glass-nav'],
  ['--qa-glass-sheet-bg', '--ix-glass-temp'],
  ['--qa-glass-thin-bg', '--ix-surface'],
  ['--qa-glass-shadow', '--ix-shadow-2'],
  ['--qa-glass-specular', '--ix-shadow-1'],
  ['--qa-surface-raised', '--ix-raise'],
  ['--qa-surface', '--ix-surface'],
  ['--qa-action-pressed', '--ix-act-pressed'],
  ['--qa-brand-pressed', '--ix-act-pressed'],
  ['--qa-chrome', '--ix-glass-nav'],
  ['--qa-overlay', '--ix-glass-temp'],
  ['--qa-control-submit', '--ix-hit-submit'],
  ['--qa-control-min', '--ix-hit-min'],
  ['--qa-editor-chrome', '--ix-editor-chrome'],
]);

const ordered = [...TOKEN_MAP.entries()].sort((a, b) => b[0].length - a[0].length);
const escaped = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const tokenPattern = new RegExp(`(${ordered.map(([from]) => escaped(from)).join('|')})(?![a-zA-Z0-9_-])`, 'g');

async function filesIn(dir, relative = '') {
  const entries = await readdir(dir, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const rel = path.join(relative, entry.name).replaceAll('\\', '/');
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...await filesIn(full, rel));
    else if (EXTENSIONS.has(path.extname(entry.name).toLowerCase())
      && (process.argv.includes('--include-legacy') || !SKIP.has(rel))) result.push({ full, rel });
  }
  return result;
}

const files = await filesIn(ROOT);
let changed = 0;
let replacements = 0;
for (const { full, rel } of files) {
  const before = await readFile(full, 'utf8');
  const after = before.replace(tokenPattern, (token) => {
    const replacement = TOKEN_MAP.get(token);
    if (replacement === 'none') return 'none';
    replacements += 1;
    return replacement;
  });
  if (after !== before) {
    changed += 1;
    if (!process.argv.includes('--dry-run')) await writeFile(full, after, 'utf8');
    console.log(`${process.argv.includes('--dry-run') ? 'would update' : 'updated'} ${rel}`);
  }
}
console.log(`${process.argv.includes('--dry-run') ? 'dry run' : 'migration'}: ${changed} files, ${replacements} token references`);
