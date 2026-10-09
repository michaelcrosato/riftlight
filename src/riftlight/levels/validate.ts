import { FLOOR, flood } from './layout/grid';
import { buildGeometry } from './layout/geometry';
import { compatibleSet, MECHANICS } from './mechanics';
import { bypassReachable } from './mechanics/common';
import { type LevelPlan, planLevel } from './plan';
import type { LevelSpec } from '../core/types';

/**
 * Level validation (used by `npm run level -- validate` and the unit tests). A plan passes
 * when:
 *  - **reachability**: the exit and every room are reachable from the start;
 *  - **bypass guarantee**: the exit stays reachable with every mechanic element blocked;
 *  - **rooms**: the generator delivered the rooms the spec asked for;
 *  - **budget**: packs spend 80–120% of their target budget (ranks + per-member power),
 *    every combat room has a pack, ≤ 12 monsters per pack and ≤ 400 per level, one boss;
 *  - **no overlaps**: elements, packs, props, chests and shrines never share a cell, and
 *    nothing sits on a solid cell;
 *  - **mechanics**: known, mutually compatible, and the name matches;
 *  - **build time**: plan + geometry under `maxMs` (default 1500 ms; tools warn above 500).
 */
export interface LevelReport {
  readonly depth: number;
  readonly name: string;
  readonly ok: boolean;
  readonly problems: string[];
  readonly warnings: string[];
  readonly stats: Record<string, number | string>;
}

export function validatePlan(plan: LevelPlan, buildMs: number, maxMs = 1500): LevelReport {
  const { layout, spec } = plan;
  const W = layout.width;
  const problems: string[] = [];
  const warnings: string[] = [];
  const floor = (i: number) => layout.cells[i] === FLOOR || plan.dynamicFloor[i] === 1;

  // Reachability.
  const reach = flood(W, layout.height, layout.start, floor);
  if (!reach[layout.exit.z * W + layout.exit.x]) problems.push('exit unreachable from the start');
  for (const r of layout.rooms) {
    let ok = false;
    for (let z = r.z; z < r.z + r.h && !ok; z++) for (let x = r.x; x < r.x + r.w; x++) if (reach[z * W + x] && layout.roomOf[z * W + x] === r.id) ok = true;
    if (!ok) problems.push(`room ${r.id} (${r.tags[0]}) unreachable`);
  }
  if (!layout.path.length) problems.push('no critical path');

  // Bypass guarantee: every element cell blocked, the exit must still be reachable.
  const blocked = new Uint8Array(W * layout.height);
  for (const e of plan.elements) for (const c of e.cells) blocked[c] = 1;
  if (!bypassReachable(layout, blocked)) problems.push('bypass guarantee broken: the exit needs a mechanic element');

  // Rooms.
  const want = spec.layout.style === 'arena' ? Math.min(spec.layout.rooms, 5) : spec.layout.rooms;
  if (layout.rooms.length < Math.min(want, spec.layout.style === 'town' ? 4 : want)) problems.push(`rooms: ${layout.rooms.length} < ${want}`);
  if (!layout.rooms.some((r) => r.tags.includes('boss'))) problems.push('no boss room');

  // Encounter budget.
  const bosses = plan.packs.filter((p) => p.rank === 'boss').length;
  if (bosses !== 1) problems.push(`boss packs: ${bosses} (want 1)`);
  const ratio = plan.budget.spent / Math.max(1, plan.budget.target);
  if (ratio < 0.8 || ratio > 1.2) problems.push(`encounter budget ${plan.budget.spent.toFixed(0)}/${plan.budget.target.toFixed(0)} (${(ratio * 100).toFixed(0)}%)`);
  for (const r of layout.rooms) if (r.tags[0] === 'combat' && !plan.packs.some((p) => p.room === r.id)) problems.push(`combat room ${r.id} has no pack`);
  const monsters = plan.packs.reduce((n, p) => n + p.members.length, 0);
  if (plan.packs.some((p) => p.members.length > 12)) problems.push('a pack has more than 12 monsters');
  if (monsters > 400) problems.push(`${monsters} monsters (> 400)`);

  // Overlaps.
  const owner = new Map<number, string>();
  const claim = (cell: number, what: string) => {
    const prev = owner.get(cell);
    if (prev) problems.push(`overlap at ${cell % W},${Math.floor(cell / W)}: ${prev} / ${what}`);
    else owner.set(cell, what);
  };
  for (const e of plan.elements) for (const c of e.cells) claim(c, `${e.mechanic}.${e.kind}#${e.id}`);
  for (const p of plan.packs) for (const m of p.members) {
    const c = Math.floor(m.z) * W + Math.floor(m.x);
    if (layout.cells[c] !== FLOOR) problems.push(`pack ${p.id} member on a non-floor cell`);
    claim(c, `pack ${p.id}`);
  }
  for (const p of plan.props) claim(Math.floor(p.z) * W + Math.floor(p.x), `prop ${p.kind}`);
  for (const f of plan.features) claim(Math.floor(f.z) * W + Math.floor(f.x), f.kind);
  if (blocked[layout.start.z * W + layout.start.x] || blocked[layout.exit.z * W + layout.exit.x]) problems.push('an element covers the start or the exit');

  // Mechanics.
  for (const id of spec.mechanics) if (!MECHANICS.has(id)) problems.push(`unknown mechanic ${id}`);
  if (!compatibleSet(spec.mechanics)) problems.push(`incompatible mechanics: ${spec.mechanics.join(' + ')}`);
  for (const id of spec.mechanics) if (!plan.elements.some((e) => e.mechanic === id)) warnings.push(`${id} placed no elements`);
  if (spec.depth <= 12 && spec.name !== MECHANICS.get(spec.mechanics[0]!).name) problems.push(`designed level ${spec.depth} is named "${spec.name}", not after its mechanic`);

  // Build time.
  if (buildMs > maxMs) problems.push(`build ${buildMs.toFixed(0)} ms > ${maxMs} ms`);
  else if (buildMs > 500) warnings.push(`build ${buildMs.toFixed(0)} ms`);

  return {
    depth: spec.depth,
    name: spec.name,
    ok: problems.length === 0,
    problems,
    warnings,
    stats: {
      style: layout.style,
      size: W,
      rooms: layout.rooms.length,
      path: layout.path.length,
      elements: plan.elements.length,
      refused: plan.refused,
      packs: plan.packs.length,
      budget: `${plan.budget.spent.toFixed(0)}/${plan.budget.target.toFixed(0)}`,
      props: plan.props.length,
      attempts: layout.attempts,
      ms: Math.round(buildMs),
    },
  };
}

/** Plan + build geometry + validate one spec. */
export function validateSpec(spec: LevelSpec, maxMs?: number): { plan: LevelPlan; report: LevelReport } {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now(); // real time: timing the checks
  const plan = planLevel(spec);
  buildGeometry(plan);
  const ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0; // real time: timing the checks
  return { plan, report: validatePlan(plan, ms, maxMs) };
}
