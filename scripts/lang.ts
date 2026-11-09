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
//   npm run lang -- check                   every stored translation against the checks
//   npm run lang -- audit [--lang en-XA]    play the built game (npm run build first) under a test
//                                           language and list every string on screen that isn't a line
//                                           (.scratch/lang/audit.json); exit 1 if there is any
//
// The checks (AI Hub Languages v1, *Translating*): every id is the game's (dev. lines skipped), a
// line is text or plural forms of text, each line keeps the original's {tags} exactly (paired tags
// in order; {count} may go only where a form means one number), a plural line has the forms its
// language needs (Intl.PluralRules), and a line with a max keeps within it.
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
const { lineHash, storedTranslations, translationStatus, TRANSLATIONS_DIR } = await import('../src/riftlight/lang/translations');
const { HUB_LANGUAGES, lineWidth, PLURAL_FORMS } = await import('../src/engine/lang/lang');
type Line = string | Partial<Record<string, string>>;

const source = riftlightLines();
const lines = source.lines as Record<string, Line>;
const tagsOf = (s: string): string[] => s.match(/\{[^{}]*\}/g) ?? [];
const texts = (l: Line): string[] => (typeof l === 'string' ? [l] : Object.values(l).filter((v): v is string => typeof v === 'string'));

/** Problems with one translated line (empty when it can be filed). */
function lineProblems(code: string, id: string, line: unknown): string[] {
  const orig = lines[id];
  if (!orig) return [`${id}: not a line of the game`];
  if (id.startsWith('dev.')) return [`${id}: dev. lines are not translated`];
  const ok = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
  const bad: string[] = [];
  if (typeof orig === 'string') {
    if (!ok(line)) return [`${id}: a line is text`];
    const want = tagsOf(orig).sort().join();
    if (tagsOf(line).sort().join() !== want) bad.push(`${id}: tags ${tagsOf(line).join(' ')} ≠ ${tagsOf(orig).join(' ')}`);
    const paired = (s: string) => tagsOf(s).filter((t) => /^\{\/?[a-z]+(=|\})/.test(t) && /^\{\/|=/.test(t));
    if (paired(line).join() !== paired(orig).join()) bad.push(`${id}: paired tags out of order`);
  } else {
    if (!line || typeof line !== 'object' || Array.isArray(line)) return [`${id}: plural forms (an object)`];
    const forms = line as Record<string, unknown>;
    let need: string[] = ['other'];
    try {
      need = new Intl.PluralRules(code).resolvedOptions().pluralCategories as string[];
    } catch {
      /* an unknown code: other only */
    }
    for (const f of need) if (!ok(forms[f])) bad.push(`${id}: needs the plural form ${f}`);
    for (const [f, v] of Object.entries(forms)) {
      if (!PLURAL_FORMS.includes(f as never)) bad.push(`${id}: ${f} is not a plural form`);
      if (!ok(v)) bad.push(`${id}: form ${f} is empty`);
      else {
        const want = tagsOf(texts(orig)[0]!).filter((t) => t !== '{count}').sort().join();
        if (tagsOf(v).filter((t) => t !== '{count}').sort().join() !== want) bad.push(`${id}.${f}: tags ${tagsOf(v).join(' ')}`);
      }
    }
  }
  const max = source.max?.[id];
  if (max) for (const s of texts(line as Line)) if (lineWidth(s) > max) bad.push(`${id}: ${lineWidth(s)} wide, max ${max}`);
  return bad;
}

function areaOf(id: string): string {
  return id.split('.')[0]!;
}

const cmd = argv[0] ?? 'help';

if (cmd === 'lines') {
  if (argv.includes('--json')) {
    console.log(JSON.stringify(source, null, 1));
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
  let forms: string[] = ['other'];
  try {
    forms = new Intl.PluralRules(code).resolvedOptions().pluralCategories as string[];
  } catch {
    /* other only */
  }
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
    const bad = lineProblems(code, id, line);
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
    const problems: string[] = [];
    if (!HUB_LANGUAGES.includes(code) || code === source.language) problems.push(`${code} is not a language the hub takes`);
    for (const [id, line] of Object.entries(stored.lines)) if (lines[id]) problems.push(...lineProblems(code, id, line));
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
