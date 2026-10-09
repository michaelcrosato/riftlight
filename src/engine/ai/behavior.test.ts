import { describe, expect, it } from 'vitest';
import { action, BehaviorTree, condition, cooldown, inverter, parallel, repeat, selector, sequence, type Status, steps, succeeder, wait } from './behavior';

interface Board {
  threat: number;
  log: string[];
}

/** An action that takes `n` ticks, logging each step and any halt. */
const job = (name: string, n: number) => {
  let left = n;
  return action<Board>(
    name,
    (b) => {
      b.log.push(name);
      if (--left > 0) return 'running';
      left = n;
      return 'success';
    },
    (b) => {
      b.log.push(`halt ${name}`);
      left = n;
    },
  );
};
const answer = (name: string, s: Status) => action<Board>(name, (b) => (b.log.push(name), s));

describe('BehaviorTree', () => {
  it('a selector takes the first child that does not fail', () => {
    const b: Board = { threat: 0, log: [] };
    const tree = new BehaviorTree(selector('root', answer('a', 'failure'), answer('b', 'success'), answer('c', 'success')), b);
    expect(tree.tick(0.1)).toBe('success');
    expect(b.log).toEqual(['a', 'b']);
    expect(new BehaviorTree(selector('none', answer('a', 'failure')), b).tick(0.1)).toBe('failure');
  });

  it('a sequence stops at the first child that does not succeed', () => {
    const b: Board = { threat: 0, log: [] };
    expect(new BehaviorTree(sequence('s', answer('a', 'success'), answer('b', 'failure'), answer('c', 'success')), b).tick(0.1)).toBe('failure');
    expect(b.log).toEqual(['a', 'b']);
    b.log = [];
    expect(new BehaviorTree(sequence('s', answer('a', 'success'), answer('b', 'success')), b).tick(0.1)).toBe('success');
    expect(b.log).toEqual(['a', 'b']);
  });

  it('a higher priority takes over at once and halts what was running', () => {
    const b: Board = { threat: 9, log: [] };
    const tree = new BehaviorTree(selector('root', sequence('flee', condition('scared?', (x: Board) => x.threat < 3), job('run', 5)), job('work', 4)), b);
    expect(tree.tick(0.1)).toBe('running');
    expect(tree.tick(0.1)).toBe('running');
    expect(tree.activePath()).toEqual(['root', 'work']);
    b.threat = 1; // danger: flee preempts the job
    expect(tree.tick(0.1)).toBe('running');
    expect(b.log).toEqual(['work', 'work', 'run', 'halt work']);
    expect(tree.activePath()).toEqual(['root', 'flee', 'run']);
    // the danger passes: the flight is halted, and the work starts again from the beginning
    b.threat = 9;
    b.log = [];
    for (let i = 0; i < 4; i++) tree.tick(0.1);
    expect(b.log).toEqual(['halt run', 'work', 'work', 'work', 'work']);
    expect(tree.status).toBe('success');
  });

  it('a reactive sequence re-checks its condition every tick; halting a finished action does nothing', () => {
    const b: Board = { threat: 0, log: [] };
    const tree = new BehaviorTree(sequence('guarded', condition('safe?', (x: Board) => x.threat === 0), job('dig', 3)), b);
    tree.tick(0.1);
    b.threat = 5;
    expect(tree.tick(0.1)).toBe('failure');
    expect(b.log).toEqual(['dig', 'halt dig']);
    tree.halt();
    expect(b.log).toEqual(['dig', 'halt dig']);
  });

  it('steps remember where they got to', () => {
    const b: Board = { threat: 0, log: [] };
    let checks = 0;
    const tree = new BehaviorTree(steps('recipe', condition('once', () => (checks++, true)), job('stir', 2), job('bake', 2)), b);
    const out: Status[] = [];
    for (let i = 0; i < 3; i++) out.push(tree.tick(0.1));
    expect(out).toEqual(['running', 'running', 'success']);
    expect(checks).toBe(1); // not checked again while stirring and baking
    expect(b.log).toEqual(['stir', 'stir', 'bake', 'bake']);
    tree.tick(0.1);
    expect(checks).toBe(2); // done: from the top next time
  });

  it('wait runs for its time; a halt starts it over', () => {
    const b: Board = { threat: 0, log: [] };
    const w = wait<Board>('nap', 0.5);
    const tree = new BehaviorTree(w, b);
    expect([0.2, 0.2].map((dt) => tree.tick(dt))).toEqual(['running', 'running']);
    tree.halt();
    expect([0.2, 0.2, 0.2].map((dt) => tree.tick(dt))).toEqual(['running', 'running', 'success']);
  });

  it('inverter, succeeder and repeat change the answer', () => {
    const b: Board = { threat: 0, log: [] };
    expect(new BehaviorTree(inverter(answer('a', 'success')), b).tick(0)).toBe('failure');
    expect(new BehaviorTree(inverter(answer('a', 'failure')), b).tick(0)).toBe('success');
    expect(new BehaviorTree(inverter(answer('a', 'running')), b).tick(0)).toBe('running');
    expect(new BehaviorTree(succeeder(answer('a', 'failure')), b).tick(0)).toBe('success');
    const thrice = new BehaviorTree(repeat(answer('hop', 'success'), 3), b);
    expect([0, 0, 0, 0].map(() => thrice.tick(0))).toEqual(['running', 'running', 'success', 'running']);
    const broken = new BehaviorTree(repeat(answer('hop', 'failure'), 3), b);
    expect(broken.tick(0)).toBe('failure');
  });

  it('cooldown refuses for its time after a success, counted in tree time even when not ticked', () => {
    const b: Board = { threat: 0, log: [] };
    const shout = cooldown(answer('shout', 'success'), 1);
    let mute = false;
    const tree = new BehaviorTree(selector('root', sequence('maybe', condition('loud?', () => !mute), shout), answer('idle', 'success')), b);
    tree.tick(0.25);
    mute = true; // the cooldown is not reached for a while
    for (let i = 0; i < 3; i++) tree.tick(0.25);
    mute = false;
    tree.tick(0.25); // 1 s after the shout: allowed again
    expect(b.log.filter((x) => x === 'shout')).toHaveLength(2);
    tree.tick(0.25);
    expect(b.log.at(-1)).toBe('idle');
  });

  it('parallel: all must succeed, or one is enough; the losers are halted', () => {
    const b: Board = { threat: 0, log: [] };
    const both = new BehaviorTree(parallel('both', 'all', job('walk', 2), job('talk', 3)), b);
    expect([0, 0, 0, 0].map(() => both.tick(0))).toEqual(['running', 'running', 'success', 'running']);
    expect(b.log).toEqual(['walk', 'talk', 'walk', 'talk', 'talk', 'walk', 'talk']); // walk done after 2, not run again until both are
    b.log = [];
    const race = new BehaviorTree(parallel('race', 'one', job('hare', 2), job('tortoise', 5)), b);
    expect([0, 0].map(() => race.tick(0))).toEqual(['running', 'success']);
    expect(b.log).toEqual(['hare', 'tortoise', 'hare', 'tortoise', 'halt tortoise']);
    const failing = new BehaviorTree(parallel('f', 'all', answer('no', 'failure'), job('long', 5)), b);
    b.log = [];
    expect(failing.tick(0)).toBe('failure');
    expect(b.log).toEqual(['no', 'long', 'halt long']);
  });

  it('the trace shows every node, with an answer only where this tick went', () => {
    const b: Board = { threat: 9, log: [] };
    const tree = new BehaviorTree(selector('root', sequence('flee', condition('scared?', (x: Board) => x.threat < 3), job('run', 5)), job('work', 4)), b);
    tree.tick(0.1);
    expect(tree.trace()).toEqual([
      { name: 'root', kind: 'selector', depth: 0, status: 'running' },
      { name: 'flee', kind: 'sequence', depth: 1, status: 'failure' },
      { name: 'scared?', kind: 'condition', depth: 2, status: 'failure' },
      { name: 'run', kind: 'action', depth: 2, status: null },
      { name: 'work', kind: 'action', depth: 1, status: 'running' },
    ]);
  });

  it('halting the tree stops the running action; a cooldown is kept across the halt', () => {
    const b: Board = { threat: 0, log: [] };
    const tree = new BehaviorTree(sequence('s', cooldown(answer('ping', 'success'), 1), job('dig', 5)), b);
    tree.tick(0.1);
    tree.halt();
    expect(b.log).toEqual(['ping', 'dig', 'halt dig']);
    expect(tree.tick(0.1)).toBe('failure'); // still cooling down after the halt
  });

  it('activePath follows steps and parallels to the leaf at work', () => {
    const b: Board = { threat: 0, log: [] };
    const tree = new BehaviorTree(steps('recipe', answer('prep', 'success'), parallel('cook', 'all', job('stir', 3), answer('taste', 'success'))), b);
    tree.tick(0.1);
    expect(tree.activePath()).toEqual(['recipe', 'cook', 'taste']); // the last child that did not fail
    tree.tick(0.1);
    expect(tree.activePath()).toEqual(['recipe', 'cook', 'stir']); // taste is done: not run again this round
  });

  it('refuses a node that is already in another tree', () => {
    const shared = job('dig', 3);
    new BehaviorTree(shared, { threat: 0, log: [] });
    expect(() => new BehaviorTree(selector('other', shared), { threat: 0, log: [] })).toThrow(/another tree/);
  });
});
