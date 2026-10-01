// npx tsx scripts/riftlight/stat-names.ts [--json]
//
// Every stat name the loot and passive tree registries put on a StatSheet: affix tiers,
// corruptions, base implicits and base stats (what `itemMods` emits for a rolled item of each
// base), uniques, passive nodes and mastery options, keystone flags. Each name is listed with
// where it comes from, so a stat that combat never reads (or reads under another name) is
// easy to find and reconcile with the combat side's stat table.
//
// Writes .scratch/stats/emitted.json.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Mod } from '../../src/riftlight/core/mods';
import { Rng } from '../../src/riftlight/core/rng';
import { AFFIXES, CORRUPTIONS, UNIQUES, equipmentBases } from '../../src/riftlight/loot/content';
import { rollItem } from '../../src/riftlight/loot/generate';
import { itemMods } from '../../src/riftlight/loot/itemMods';
import { defaultTree } from '../../src/riftlight/tree/tree';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const json = process.argv.includes('--json');

/** stat → system → where (a few examples each). */
const seen = new Map<string, Map<string, Set<string>>>();
function add(stat: string, system: 'loot' | 'tree', where: string): void {
  const bySystem = seen.get(stat) ?? new Map<string, Set<string>>();
  seen.set(stat, bySystem);
  const set = bySystem.get(system) ?? new Set<string>();
  bySystem.set(system, set);
  if (set.size < 4) set.add(where);
}
const mods = (list: readonly Mod[] | undefined, system: 'loot' | 'tree', where: string) => {
  for (const m of list ?? []) add(m.stat, system, `${where}${m.kind === 'flag' ? ' (flag)' : ''}`);
};

// ---- loot: what reaches the StatSheet (local.* stats fold into the item first)
for (const a of AFFIXES.all()) for (const t of a.tiers) for (const m of t.mods) if (!m.stat.startsWith('local.')) add(m.stat, 'loot', `affix ${a.id}`);
for (const a of CORRUPTIONS.all()) for (const t of a.tiers) for (const m of t.mods) if (!m.stat.startsWith('local.')) add(m.stat, 'loot', `corruption ${a.id}`);
for (const u of UNIQUES.all())
  mods(
    u.mods.filter((m) => !m.stat.startsWith('local.')),
    'loot',
    `unique ${u.id}`,
  );
for (const b of equipmentBases()) {
  const item = rollItem(new Rng(b.id), { base: b.id, itemLevel: Math.max(1, b.level), rarity: 'normal' });
  mods(itemMods(item), 'loot', `base ${b.id}`);
}

// ---- tree: every node and mastery option
for (const n of defaultTree().nodes) {
  mods(n.mods, 'tree', `${n.kind} ${n.id}`);
  for (const o of n.options ?? []) mods(o.mods, 'tree', `mastery ${n.id}=${o.id}`);
}

const rows = [...seen.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([stat, by]) => ({ stat, loot: [...(by.get('loot') ?? [])], tree: [...(by.get('tree') ?? [])] }));
mkdirSync(join(ROOT, '.scratch/stats'), { recursive: true });
writeFileSync(join(ROOT, '.scratch/stats/emitted.json'), JSON.stringify(rows, null, 2));
if (json) console.log(JSON.stringify(rows, null, 2));
else {
  for (const r of rows) console.log(`${r.stat.padEnd(34)} ${r.loot.length ? 'loot' : '    '} ${r.tree.length ? 'tree' : '    '}  ${[...r.loot, ...r.tree].slice(0, 2).join(', ')}`);
  console.log(`\n${rows.length} stat names (${rows.filter((r) => r.loot.length).length} from loot, ${rows.filter((r) => r.tree.length).length} from the tree) → .scratch/stats/emitted.json`);
}
