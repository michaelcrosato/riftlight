// npm run lang: Riftlight's words and their translations (docs/game/lang.md, AI Hub Languages v1).
//
//   npm run lang -- lines [--json]          the line list: how many, by area (--json: the block)
//   npm run lang -- status                  each stored language: lines current, stale, missing
//   npm run lang -- todo <code> [--out f]   what a translator must do for <code> (missing and stale
//                                           lines, with notes, widths, names, the brief and the plural
//                                           forms the language needs) as JSON (default .scratch/lang/todo-<code>.json)
//   npm run lang -- apply <code> <file> --by <who>
//                                           file a translation ({ lines, names? }) into
//                                           src/riftlight/lang/translations/<code>.json after the checks
//   npm run lang -- check                   every stored language's current lines against the checks
//                                           (stale lines are left out of the page and not checked; nor
//                                           are lines no longer in the game, or dev. lines)
//   npm run lang -- audit [--lang en-XA]    play the built game (npm run build first) under a test
//                                           language and list every string on screen that isn't a line
//                                           (.scratch/lang/audit.json); exit 1 if there is any
//
// The checks (AI Hub Languages v1, *Translating*) are `lineProblems` / `translationProblems` in
// src/riftlight/lang/translations.ts (`npm test` runs them over every stored language too): every id
// is the game's (dev. lines skipped), a line is text or plural forms of text, each line keeps the
// original's {tags} exactly (paired tags in order; {count} may go only where a form means one
// number), a plural line has the forms its language needs (Intl.PluralRules), and a line with a max
// keeps within it.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { helpExit } from './manual.mjs';
import { registerEngineHooks } from './trace/hooks';

helpExit(import.meta.url);
registerEngineHooks();

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const argv = process.argv.slice(2);
const opt = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

const { riftlightLines } = await import('../src/riftlight/lang/index');
const { lineHash, lineProblems, pluralFormsOf, storedTranslations, translationProblems, translationStatus, TRANSLATIONS_DIR } = await import('../src/riftlight/lang/translations');
const { HUB_LANGUAGES } = await import('../src/engine/lang/lang');
type Line = string | Partial<Record<string, string>>;

const source = riftlightLines();
const lines = source.lines as Record<string, Line>;
const texts = (l: Line): string[] => (typeof l === 'string' ? [l] : Object.values(l).filter((v): v is string => typeof v === 'string'));

function areaOf(id: string): string {
  return id.split('.')[0]!;
}

const cmd = argv[0] ?? 'help';

if (cmd === 'lines') {
  if (argv.includes('--json')) {
    // into a pipe stdout is asynchronous: finish writing before the process.exit below
    await new Promise<void>((done) => process.stdout.write(JSON.stringify(source, null, 1) + '\n', () => done()));
  } else {
    const by = new Map<string, number>();
    for (const id of Object.keys(lines)) by.set(areaOf(id), (by.get(areaOf(id)) ?? 0) + 1);
    const words = Object.values(lines).flatMap(texts).join(' ').split(/\s+/).filter(Boolean).length;
    console.log(`${Object.keys(lines).length} lines, ${words} words; ${source.names.length} names; brief ${source.brief.length} characters`);
    for (const [a, n] of [...by.entries()].sort((x, y) => y[1] - x[1])) console.log(`  ${a.padEnd(14)} ${n}`);
  }
} else if (cmd === 'status') {
  const stored = storedTranslations();
  const codes = HUB_LANGUAGES.filter((c) => c !== source.language);
  console.log(`${Object.keys(lines).filter((id) => !id.startsWith('dev.')).length} lines to translate (dev. lines skipped)`);
  for (const code of codes) {
    const s = stored[code];
    if (!s) {
      console.log(`  ${code.padEnd(8)} none`);
      continue;
    }
    const st = translationStatus(s, source);
    console.log(`  ${code.padEnd(8)} ${st.current.length} current · ${st.stale.length} stale · ${st.missing.length} missing${st.unknown.length ? ` · ${st.unknown.length} no longer in the game` : ''}  (by ${s.by})`);
  }
} else if (cmd === 'todo') {
  const code = argv[1];
  if (!code || !HUB_LANGUAGES.includes(code) || code === source.language) throw new Error(`todo <code>: one of ${HUB_LANGUAGES.filter((c) => c !== source.language).join(', ')}`);
  const stored = storedTranslations()[code];
  const st = stored ? translationStatus(stored, source) : { missing: Object.keys(lines).filter((id) => !id.startsWith('dev.')), stale: [] as string[] };
  const ids = [...st.missing, ...st.stale];
  const forms = pluralFormsOf(code);
  const todo = {
    language: code,
    pluralForms: forms,
    brief: source.brief,
    names: source.names,
    translatedNames: stored?.names ?? {},
    lines: Object.fromEntries(ids.map((id) => [id, lines[id]])),
    notes: Object.fromEntries(ids.filter((id) => source.notes?.[id]).map((id) => [id, source.notes![id]])),
    max: Object.fromEntries(ids.filter((id) => source.max?.[id]).map((id) => [id, source.max![id]])),
    stale: Object.fromEntries(st.stale.map((id) => [id, stored!.lines[id]])),
  };
  const out = opt('out') ?? join(ROOT, `.scratch/lang/todo-${code}.json`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(todo, null, 1));
  console.log(`${out}: ${ids.length} lines for ${code} (${st.stale.length} stale), plural forms ${forms.join(' ')}`);
} else if (cmd === 'apply') {
  const code = argv[1];
  const file = argv[2];
  const by = opt('by');
  if (!code || !HUB_LANGUAGES.includes(code) || code === source.language || !file || !by) throw new Error('apply <code> <file> --by <who>');
  const given = JSON.parse(readFileSync(file, 'utf8')) as { lines?: Record<string, unknown>; names?: Record<string, string> };
  const stored = storedTranslations()[code] ?? { by, lines: {}, source: {} };
  const out = { by, names: { ...(stored.names ?? {}), ...(given.names ?? {}) }, lines: { ...stored.lines } as Record<string, Line>, source: { ...stored.source } as Record<string, string> };
  const problems: string[] = [];
  let filed = 0;
  for (const [id, line] of Object.entries(given.lines ?? {})) {
    const bad = lineProblems(code, id, line, source);
    if (bad.length) {
      problems.push(...bad);
      continue;
    }
    out.lines[id] = line as Line;
    out.source[id] = lineHash(lines[id]!);
    filed++;
  }
  const sorted = { by: out.by, ...(Object.keys(out.names).length ? { names: out.names } : {}), lines: Object.fromEntries(Object.entries(out.lines).sort(([a], [b]) => a.localeCompare(b))), source: Object.fromEntries(Object.entries(out.source).sort(([a], [b]) => a.localeCompare(b))) };
  mkdirSync(TRANSLATIONS_DIR, { recursive: true });
  writeFileSync(join(TRANSLATIONS_DIR, `${code}.json`), JSON.stringify(sorted, null, 1) + '\n');
  console.log(`${code}: ${filed} lines filed${problems.length ? `, ${problems.length} refused:` : ''}`);
  for (const p of problems.slice(0, 40)) console.log(`  ✘ ${p}`);
  if (problems.length > 40) console.log(`  … and ${problems.length - 40} more`);
  if (problems.length) process.exitCode = 1;
} else if (cmd === 'check') {
  let bad = 0;
  for (const [code, stored] of Object.entries(storedTranslations())) {
    const problems = translationProblems(code, stored, source);
    const st = translationStatus(stored, source);
    console.log(`${problems.length ? '✘' : '✔'} ${code}: ${st.current.length} current, ${st.stale.length} stale, ${st.missing.length} missing${problems.length ? `, ${problems.length} problems` : ''}`);
    for (const p of problems.slice(0, 10)) console.log(`    ${p}`);
    bad += problems.length;
  }
  if (bad) process.exitCode = 1;
} else if (cmd === 'audit') {
  const { audit } = await import('./lang-audit.mjs');
  const code = opt('lang') ?? 'en-XA';
  const report = await audit({ root: ROOT, lang: code, names: source.names });
  if (report.offenders) process.exitCode = 1;
} else {
  console.log('npm run lang -- lines | status | todo <code> | apply <code> <file> --by <who> | check | audit (--help: the manual)');
}
process.exit(process.exitCode ?? 0);
