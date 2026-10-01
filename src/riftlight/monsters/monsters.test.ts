import { type Mesh, Vector3 } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { analyzeClip, validateClip } from '../../engine/animation';
import { StatSheet } from '../core/mods';
import { Rng } from '../core/rng';
import type { ActorLike, Hit, HitResult } from '../core/types';
import {
  ARCHETYPES,
  BOSS_ATTACKS,
  BossBrain,
  BOSSES,
  bossSkills,
  buildBoss,
  buildMonster,
  contrast,
  createTelegraph,
  crossover,
  ELITE_MODS,
  generateBoss,
  generateGenome,
  generatePack,
  genomeBudget,
  genomeCost,
  MONSTER_SKILLS,
  MonsterBrain,
  MonsterRuntime,
  mutate,
  Pack,
  PARTS,
  PLANS,
  validateGenome,
  type BrainWorld,
  type MonsterBody,
  type MonsterEvent,
} from '.';
import { skinGlowMaterial, skinMaterial, skinOf, skinRegion } from './skin';

describe('registries', () => {
  it('have the content the design asks for', () => {
    expect(PLANS.size).toBeGreaterThanOrEqual(9);
    expect(PARTS.size).toBeGreaterThanOrEqual(60);
    expect(ARCHETYPES.size).toBeGreaterThanOrEqual(10);
    expect(ELITE_MODS.size).toBeGreaterThanOrEqual(20);
    expect(BOSSES.all().map((b) => b.level).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it('parts fit real slots, archetype skills and boss attacks resolve', () => {
    for (const p of PARTS.all()) {
      expect(p.fits.length, p.id).toBeGreaterThan(0);
      expect(p.cost ?? 1, p.id).toBeGreaterThanOrEqual(0);
    }
    for (const a of ARCHETYPES.all()) for (const s of a.skills) expect(['melee', 'bolt'].includes(s) || MONSTER_SKILLS.has(s), `${a.id}: ${s}`).toBe(true);
    for (const b of BOSSES.all()) {
      for (const p of b.phases) for (const id of [...p.attacks, ...(p.onEnter ?? [])]) expect(BOSS_ATTACKS.has(id), `${b.id}: ${id}`).toBe(true);
      for (const s of bossSkills(b)) expect(MONSTER_SKILLS.has(s), `${b.id}: ${s}`).toBe(true);
      expect(validateGenome(b.genome), b.id).toEqual([]);
      expect(b.genome.rank).toBe('boss');
    }
  });
});

describe('genomes', () => {
  it('are deterministic per seed and valid', () => {
    const a = generateGenome(new Rng(42), { depth: 5, tags: ['fire'] });
    const b = generateGenome(new Rng(42), { depth: 5, tags: ['fire'] });
    expect(a).toEqual(b);
    expect(generateGenome(new Rng(43), { depth: 5, tags: ['fire'] })).not.toEqual(a);
    for (let i = 0; i < 60; i++) {
      const g = generateGenome(new Rng(`g${i}`), { depth: 1 + i, rank: (['normal', 'magic', 'rare', 'boss'] as const)[i % 4] });
      expect(validateGenome(g), JSON.stringify(g)).toEqual([]);
    }
  });

  it('respect the plan and the power budget', () => {
    for (const plan of PLANS.all()) {
      for (let i = 0; i < 6; i++) {
        const g = generateGenome(new Rng(`${plan.id}${i}`), { plan: plan.id, depth: 1 });
        expect(g.plan).toBe(plan.id);
        const required = g.parts.filter((p) => p.socket === 'head' || p.socket === 'eyes').reduce((s, p) => s + (PARTS.get(p.part).cost ?? 1), 0);
        expect(genomeCost(g)).toBeLessThanOrEqual(genomeBudget(1) + required);
        if (plan.slots.head) expect(g.parts.some((p) => p.socket === 'head')).toBe(true);
      }
    }
  });

  it('evolve: mutate and crossover stay valid and deterministic', () => {
    const a = generateGenome(new Rng(1), { plan: 'quadruped' });
    const b = generateGenome(new Rng(2), { plan: 'hexapod' });
    expect(mutate(a, new Rng('m'), 0.5)).toEqual(mutate(a, new Rng('m'), 0.5));
    for (let i = 0; i < 30; i++) {
      const m = mutate(a, new Rng(i), 1);
      expect(validateGenome(m)).toEqual([]);
      const c = crossover(a, b, new Rng(i));
      expect(validateGenome(c)).toEqual([]);
      expect(['quadruped', 'hexapod']).toContain(c.plan);
    }
  });

  it('packs share one body shape (and so their clips)', () => {
    const pack = generatePack(new Rng('pack'), { depth: 9, tags: ['insect'], archetype: 'swarm' });
    expect(pack.genomes.length).toBeGreaterThanOrEqual(5);
    const shapes = new Set(pack.genomes.map((g) => JSON.stringify([g.plan, g.genes, g.parts])));
    expect(shapes.size).toBe(1);
    for (const g of pack.genomes) expect(validateGenome(g)).toEqual([]);
    const a = buildMonster(pack.genomes[0]!);
    const b = buildMonster(pack.genomes[1]!);
    expect(a.clip('Walk')).toBe(b.clip('Walk'));
  });

  it('palettes read against the floor', () => {
    for (let i = 0; i < 40; i++) {
      const g = generateGenome(new Rng(`p${i}`));
      expect(contrast(g.palette.primary, 0x333c57), JSON.stringify(g.palette)).toBeGreaterThan(1.6);
    }
  });
});

describe('buildMonster', () => {
  it('builds every plan × archetype deterministically and quickly', () => {
    for (const plan of PLANS.all()) {
      for (const arch of ARCHETYPES.all()) {
        const g = generateGenome(new Rng(`${plan.id}:${arch.id}`), { plan: plan.id, archetype: arch.id });
        const m = buildMonster(g);
        expect(m.rig.joints[0]).toBe('Body');
        expect(m.clipNames).toEqual(expect.arrayContaining(['Idle', 'Walk', 'Run', 'Hit', 'Death', 'Spawn']));
        expect(m.skills.length).toBeGreaterThan(0);
        for (const s of m.skills) {
          const skill = MONSTER_SKILLS.get(s);
          expect(m.clipNames, `${plan.id}/${arch.id} ${s}`).toContain(skill.anim);
        }
        expect(m.radius).toBeGreaterThan(0);
        expect(m.height).toBeGreaterThan(0.15);
        const again = buildMonster(g);
        const names: string[] = [];
        again.object.traverse((o) => names.push(`${o.name}@${o.position.toArray().map((v) => v.toFixed(4))}`));
        const first: string[] = [];
        m.object.traverse((o) => first.push(`${o.name}@${o.position.toArray().map((v) => v.toFixed(4))}`));
        expect(names).toEqual(first);
      }
    }
  });

  it('marks hit frames inside attack clips, after the wind-up', () => {
    const m = buildMonster(generateGenome(new Rng(5), { plan: 'brute', archetype: 'tank' }), { eager: true });
    for (const name of m.clipNames) {
      const info = m.clipInfo(name)!;
      if (info.kind !== 'attack') continue;
      expect(info.hitFrame, name).not.toBeNull();
      expect(info.hitFrame!).toBeGreaterThan(0);
      expect(info.hitFrame!).toBeLessThanOrEqual(info.frames);
      expect(info.windup![1]).toBeLessThanOrEqual(info.hitFrame!);
      expect(m.clip(name)!.userData.hit).toBeCloseTo(info.hitFrame! / 30);
    }
  });
});

describe('skin and merged meshes', () => {
  const meshes = (m: ReturnType<typeof buildMonster>) => {
    const out: Mesh[] = [];
    m.object.traverse((o) => (o as Mesh).isMesh && o.name !== 'EliteAura' && out.push(o as Mesh));
    return out;
  };

  it('draws every body with the two shared skin materials, a mesh or two per joint', () => {
    for (const plan of PLANS.all()) {
      const m = buildMonster(generateGenome(new Rng(`skin:${plan.id}`), { plan: plan.id }));
      const list = meshes(m);
      for (const mesh of list) expect([skinMaterial(), skinGlowMaterial()], `${plan.id} ${mesh.name}`).toContain(mesh.material);
      expect(list.length, plan.id).toBeLessThanOrEqual(m.rig.joints.length * 2);
      for (const sole of m.rig.soles) expect(m.object.getObjectByName(sole), `${plan.id} ${sole}`).toBeTruthy();
      for (const mesh of list) expect((mesh.geometry.userData.triColors as Uint8Array).length, mesh.name).toBe(((mesh.geometry.index?.count ?? 0) / 3) * 4);
    }
  });

  it('pack mates share their merged meshes', () => {
    const pack = generatePack(new Rng('skin-pack'), { depth: 3, size: 3 });
    const a = meshes(buildMonster(pack.genomes[1]!));
    const b = meshes(buildMonster(pack.genomes[2]!));
    expect(a.map((m) => m.geometry)).toEqual(b.map((m) => m.geometry));
  });

  it('picks a skin from the genes, with a default for genomes saved before them', () => {
    const g = generateGenome(new Rng('skin-genes'), { plan: 'quadruped' });
    expect(g.genes.pattern).toBeGreaterThanOrEqual(0);
    const old = { ...g, genes: Object.fromEntries(Object.entries(g.genes).filter(([k]) => !['pattern', 'patternScale', 'markHue'].includes(k))) };
    expect(skinOf(old)).toEqual(skinOf({ ...old, seed: old.seed + 1 }));
    expect(skinRegion([0, 0, 0, 0], [0.8, 0, 0, 0])).toBe(1);
    expect(skinRegion([0, 0, 0, 0.05], [0, 4, 0, 0])).toBe(2);
    expect(skinRegion([0, 0, 0, 0.12], [0, 4, 0, 0])).toBe(0);
  });

  it('dresses bosses and marks archetypes without touching their stats', () => {
    const boss = BOSSES.get('vorgath');
    const m = buildMonster(boss.genome);
    const plain = buildMonster({ ...boss.genome, rank: 'rare' });
    const tris = (x: ReturnType<typeof buildMonster>) => meshes(x).reduce((s, mesh) => s + (mesh.geometry.index?.count ?? 0), 0);
    expect(tris(m)).toBeGreaterThan(tris(plain));
    const bomber = generateGenome(new Rng('mark'), { plan: 'blob', archetype: 'bomber', parts: { core: null } });
    for (const p of PARTS.all().filter((x) => x.tags.includes('mark') || x.tags.includes('dress') || x.tags.includes('default'))) {
      expect(p.mods, p.id).toEqual([]);
      expect([p.cost, p.weight], p.id).toEqual([0, 0]);
    }
    expect(meshes(buildMonster(bomber)).some((x) => x.material === skinGlowMaterial())).toBe(true);
  });
});

describe('monster clips pass the hero checks', () => {
  // One monster per plan (plus a boss): every clip validated and measured like `npm run anim -- check`.
  const genomes = [...PLANS.all().map((p) => generateGenome(new Rng(`clips:${p.id}`), { plan: p.id })), BOSSES.get('xal-vey').genome];
  for (const g of genomes) {
    it(`${g.plan} (${g.archetype})`, () => {
      const m = g.rank === 'boss' ? buildBoss(BOSSES.all().find((b) => b.genome === g)!) : buildMonster(g);
      const probe = buildMonster(g).object;
      probe.scale.setScalar(1);
      for (const def of m.defs) {
        expect(validateClip(def, m.rig), def.name).toEqual([]);
        const r = analyzeClip(probe, m.rig, def, m.clip(def.name)!);
        expect(r.problems, `${g.plan} ${def.name}`).toEqual([]);
        expect(Number.isFinite(r.minSoleY) || !m.rig.soles.length).toBe(true);
      }
    });
  }
});

// ---------------------------------------------------------------- brains

class FakeActor implements ActorLike {
  static next = 1;
  readonly id = FakeActor.next++;
  readonly stats = new StatSheet({ life: 100 });
  readonly radius = 0.4;
  life = 100;
  mana = 0;
  level = 1;
  constructor(
    readonly faction: 'hero' | 'monster',
    readonly position: Vector3,
  ) {}
  get alive() {
    return this.life > 0;
  }
  takeHit(hit: Hit): HitResult {
    const total = Object.values(hit.damage).reduce((s, v) => s + (v ?? 0), 0);
    this.life -= total;
    return { total, byType: hit.damage, crit: false, killed: this.life <= 0, ailments: [] };
  }
  push(): void {}
}

class FakeBody implements MonsterBody {
  used: string[] = [];
  events: MonsterEvent[] = [];
  conditions = new Map<string, boolean>();
  moving: Vector3 | null = null;
  telegraphs = 0;
  private cool = new Map<string, number>();
  private busyFor = 0;
  constructor(readonly actor: FakeActor) {}
  moveTo(t: Vector3): void {
    this.moving = t.clone();
  }
  stop(): void {
    this.moving = null;
  }
  face(): void {}
  useSkill(id: string): boolean {
    if ((this.cool.get(id) ?? 0) > 0) return false;
    this.used.push(id);
    this.cool.set(id, MONSTER_SKILLS.get(id).cooldown);
    this.busyFor = MONSTER_SKILLS.get(id).castTime;
    return true;
  }
  busy(): boolean {
    return this.busyFor > 0;
  }
  cooldown(id: string): number {
    return this.cool.get(id) ?? 0;
  }
  telegraph(): void {
    this.telegraphs++;
  }
  setCondition(name: string, on: boolean): void {
    this.conditions.set(name, on);
  }
  emit(e: MonsterEvent): void {
    this.events.push(e);
  }
  tick(dt: number): void {
    this.busyFor -= dt;
    for (const [k, v] of this.cool) this.cool.set(k, v - dt);
    if (this.moving) {
      const d = this.moving.clone().sub(this.actor.position).setY(0);
      if (d.length() > 0.01) this.actor.position.addScaledVector(d.normalize(), Math.min(d.length(), 3 * dt));
    }
  }
}

function world(hero: FakeActor, brains: MonsterBrain[]): BrainWorld & { time: number } {
  return {
    time: 0,
    rng: new Rng('world'),
    enemies: (of, r) => (hero.alive && hero.position.distanceTo(of.position) <= r ? [hero] : []),
    allies: (of, r) => brains.filter((b) => b.body.actor !== of && b.body.actor.position.distanceTo(of.position) <= r),
  };
}

function run(brains: MonsterBrain[], bodies: FakeBody[], w: BrainWorld & { time: number }, seconds: number): void {
  for (let t = 0; t < seconds; t += 1 / 30) {
    w.time += 1 / 30;
    for (const b of brains) b.update(1 / 30, w);
    for (const b of bodies) b.tick(1 / 30);
  }
}

describe('brains', () => {
  it('a charger notices the hero, closes in and attacks', () => {
    const hero = new FakeActor('hero', new Vector3(0, 0, 0));
    const body = new FakeBody(new FakeActor('monster', new Vector3(9, 0, 0)));
    const brain = new MonsterBrain({ body, archetype: 'charger', skills: ['charge', 'bite'] });
    const w = world(hero, [brain]);
    run([brain], [body], w, 6);
    expect(brain.state).toBe('combat');
    expect(body.used).toContain('charge');
    expect(body.telegraphs).toBeGreaterThan(0);
    expect(body.used).toContain('bite');
  });

  it('a caster keeps its distance', () => {
    const hero = new FakeActor('hero', new Vector3(0, 0, 0));
    const body = new FakeBody(new FakeActor('monster', new Vector3(2, 0, 0)));
    const brain = new MonsterBrain({ body, archetype: 'caster', skills: ['firebolt'] });
    const w = world(hero, [brain]);
    run([brain], [body], w, 4);
    expect(body.actor.position.distanceTo(hero.position)).toBeGreaterThan(4);
    expect(body.used).toContain('firebolt');
  });

  it('a totem never moves but still shoots', () => {
    const hero = new FakeActor('hero', new Vector3(0, 0, 0));
    const totem = new FakeBody(new FakeActor('monster', new Vector3(5, 0, 0)));
    const t = new MonsterBrain({ body: totem, archetype: 'totem', skills: ['firebolt', 'ward'] });
    const w = world(hero, [t]);
    run([t], [totem], w, 3);
    expect(totem.actor.position.x).toBe(5);
    expect(totem.used.length).toBeGreaterThan(0);
  });

  it('packs share aggro and spread out to flank', () => {
    const hero = new FakeActor('hero', new Vector3(0, 0, 0));
    const bodies = [0, 1, 2, 3].map((i) => new FakeBody(new FakeActor('monster', new Vector3(10 + i, 0, i * 0.5))));
    const brains = bodies.map((b) => new MonsterBrain({ body: b, archetype: 'skirmisher', skills: ['bite'] }));
    const pack = new Pack(brains);
    brains[3]!.alert(hero);
    expect(brains.every((b) => b.state === 'combat')).toBe(true);
    expect(new Set(brains.map((b) => b.slot.toFixed(2))).size).toBe(4);
    expect(pack.leader).toBeDefined();
  });

  it('elite behaviours act through the body', () => {
    const hero = new FakeActor('hero', new Vector3(0, 0, 0));
    const body = new FakeBody(new FakeActor('monster', new Vector3(3, 0, 0)));
    const brain = new MonsterBrain({ body, archetype: 'tank', skills: ['slam'], elite: ['shielded', 'frost-aura', 'splitter'] });
    const w = world(hero, [brain]);
    brain.alert(hero);
    run([brain], [body], w, 9);
    expect(body.conditions.get('shielded') !== undefined).toBe(true);
    expect(body.events.some((e) => e.type === 'aura')).toBe(true);
    body.actor.life = 0;
    run([brain], [body], w, 0.1);
    expect(body.events.some((e) => e.type === 'split')).toBe(true);
  });
});

describe('bosses', () => {
  it('run their phase script: thresholds, signatures, enrage', () => {
    const boss = BOSSES.get('vorgath');
    const hero = new FakeActor('hero', new Vector3(0, 0, 0));
    const actor = new FakeActor('monster', new Vector3(4, 0, 0));
    actor.life = 1000;
    const body = new FakeBody(actor);
    const brain = new BossBrain(boss, { body, skills: buildBoss(boss).skills, maxLife: 1000 });
    const w = world(hero, [brain]);
    brain.alert(hero);
    run([brain], [body], w, 8);
    expect(brain.phase).toBe(0);
    expect(brain.log.length).toBeGreaterThan(0);
    expect(body.events.some((e) => e.type === 'hazard')).toBe(true);
    actor.life = 500;
    run([brain], [body], w, 1);
    expect(brain.phase).toBe(1);
    actor.life = 200;
    run([brain], [body], w, 1);
    expect(brain.phase).toBe(2);
    expect(body.events.filter((e) => e.type === 'phase').length).toBe(2);
    brain.combatTime = boss.enrage.after;
    run([brain], [body], w, 0.1);
    expect(brain.enraged).toBe(true);
  });

  it('generateBoss is deterministic and themed by mechanics', () => {
    const a = generateBoss(new Rng(99), 20, ['gale', 'frostglass']);
    const b = generateBoss(new Rng(99), 20, ['gale', 'frostglass']);
    expect(a).toEqual(b);
    expect(a.name).toMatch(/^\S.*, the .+$/);
    expect(a.phases.length).toBe(3);
    expect(validateGenome(a.genome)).toEqual([]);
    const tagged = a.phases.flatMap((p) => p.attacks).filter((id) => BOSS_ATTACKS.get(id).tags.some((t) => t === 'gale' || t === 'frostglass'));
    expect(tagged.length).toBeGreaterThan(0);
  });
});

describe('runtime', () => {
  it('fires a hit event on the attack clip hit frame', () => {
    const m = buildMonster(generateGenome(new Rng(3), { plan: 'quadruped', archetype: 'skirmisher' }));
    const rt = new MonsterRuntime(m);
    rt.play('Bite', { fade: 0 });
    const events: string[] = [];
    let t = 0;
    while (t < 1) {
      for (const e of rt.update(1 / 60, { lookAt: new Vector3(0, 0, 3) })) events.push(`${e.type}@${t.toFixed(2)}`);
      t += 1 / 60;
    }
    const hit = events.find((e) => e.startsWith('hit'));
    expect(hit).toBeDefined();
    expect(Number(hit!.split('@')[1])).toBeCloseTo(m.clipInfo('Bite')!.hitTime!, 1);
    expect(events.some((e) => e.startsWith('end'))).toBe(true);
    rt.flinch(new Vector3(0, 0, 1));
    rt.locomote(2);
    expect(['Walk', 'Run']).toContain(rt.clip);
    rt.dispose();
  });

  it('plants feet on uneven ground (foot placement layer)', () => {
    const m = buildMonster(generateGenome(new Rng(8), { plan: 'quadruped', archetype: 'tank' }));
    const rt = new MonsterRuntime(m);
    const ground = (_x: number, z: number) => 0.08 * z; // a slope rising forwards
    rt.update(1 / 60, { ground });
    m.object.updateMatrixWorld(true);
    for (const leg of m.skeleton.legs) {
      const sole = m.object.getObjectByName(leg.foot)!.localToWorld(new Vector3(0, -leg.ankle, 0));
      expect(Math.abs(sole.y - ground(sole.x, sole.z)), leg.id).toBeLessThan(0.03);
    }
    rt.dispose();
  });

  it('builds telegraph decals that fill up to the hit', () => {
    for (const shape of ['circle', 'cone', 'line'] as const) {
      const t = createTelegraph({ shape, size: 3, width: 60, at: 'self' });
      expect(t.object.children.length).toBe(2);
      const fill = t.object.children[1]!;
      t.update(0.5);
      const half = fill.scale.clone();
      t.update(1);
      expect(fill.scale.lengthSq()).toBeGreaterThan(half.lengthSq());
      t.dispose();
    }
  });
});
