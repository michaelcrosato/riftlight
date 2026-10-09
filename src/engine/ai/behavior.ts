/**
 * Behaviour trees: an agent's decisions as a tree of small nodes, ticked every step. Each tick
 * a node answers success, failure or running (still at it). Selectors try their children in
 * priority order until one doesn't fail; sequences run theirs in order until one doesn't
 * succeed. Both are reactive: every tick starts again from the first child, so a higher
 * priority (flee!) takes over at once, and whatever was running below it is halted.
 *
 *   const tree = new BehaviorTree(
 *     selector('root',
 *       sequence('flee', condition('scared?', (b) => b.threat < 3), action('run away', fleeStep)),
 *       sequence('work', action('go to crystal', goTo), action('pick it up', pickUp)),
 *       action('wander', wander)),
 *     blackboard);
 *   tree.tick(dt);       // per step; tree.trace() for drawing it
 */

export type Status = 'success' | 'failure' | 'running';

export abstract class BtNode<B> {
  /** Status at the last tick that reached this node. */
  status: Status | null = null;
  /** The tree's tick count when this node last ran. */
  visited = -1;
  readonly children: BtNode<B>[] = [];
  /** The tree it belongs to: a node keeps its own state, so it can be in one tree only. */
  tree: BehaviorTree<B> | null = null;

  constructor(
    readonly name: string,
    readonly kind: string,
  ) {}

  protected abstract tick(b: B, dt: number, tree: BehaviorTree<B>): Status;

  /** Tick this node (keeps `status` and `visited` for the trace). */
  run(b: B, dt: number, tree: BehaviorTree<B>): Status {
    this.visited = tree.ticks;
    this.status = this.tick(b, dt, tree);
    return this.status;
  }

  /** Interrupted: forget any progress, and tell actions that were running to stop. */
  halt(b: B): void {
    for (const c of this.children) c.halt(b);
  }
}

/** A composite remembers which child was running, to halt it when another takes over. */
abstract class Composite<B> extends BtNode<B> {
  protected runningAt = -1;

  constructor(name: string, kind: string, children: BtNode<B>[]) {
    super(name, kind);
    this.children.push(...children);
  }

  /** Child `i` is now the one running (-1: none): halt the one that was, if it is another. */
  protected switchTo(i: number, b: B): void {
    if (this.runningAt >= 0 && this.runningAt !== i) this.children[this.runningAt]!.halt(b);
    this.runningAt = i;
  }

  override halt(b: B): void {
    this.runningAt = -1;
    super.halt(b);
  }
}

class Selector<B> extends Composite<B> {
  protected tick(b: B, dt: number, tree: BehaviorTree<B>): Status {
    for (let i = 0; i < this.children.length; i++) {
      const s = this.children[i]!.run(b, dt, tree);
      if (s === 'failure') continue;
      this.switchTo(s === 'running' ? i : -1, b);
      return s;
    }
    this.switchTo(-1, b);
    return 'failure';
  }
}

class Sequence<B> extends Composite<B> {
  protected tick(b: B, dt: number, tree: BehaviorTree<B>): Status {
    for (let i = 0; i < this.children.length; i++) {
      const s = this.children[i]!.run(b, dt, tree);
      if (s === 'success') continue;
      this.switchTo(s === 'running' ? i : -1, b);
      return s;
    }
    this.switchTo(-1, b);
    return 'success';
  }
}

/** A sequence that resumes where it was: finished children are not run again until it ends. */
class Steps<B> extends Composite<B> {
  private at = 0;

  protected tick(b: B, dt: number, tree: BehaviorTree<B>): Status {
    for (; this.at < this.children.length; this.at++) {
      const s = this.children[this.at]!.run(b, dt, tree);
      if (s === 'running') return s;
      if (s === 'failure') {
        this.at = 0;
        return s;
      }
    }
    this.at = 0;
    return 'success';
  }

  override halt(b: B): void {
    this.at = 0;
    super.halt(b);
  }
}

class Parallel<B> extends Composite<B> {
  /** Children that have finished this round (they are not run again until it ends). */
  private finished: (Status | null)[];

  constructor(
    name: string,
    private readonly needed: 'all' | 'one',
    children: BtNode<B>[],
  ) {
    super(name, 'parallel', children);
    this.finished = children.map(() => null);
  }

  protected tick(b: B, dt: number, tree: BehaviorTree<B>): Status {
    this.children.forEach((c, i) => {
      if (this.finished[i] === null) {
        const s = c.run(b, dt, tree);
        if (s !== 'running') this.finished[i] = s;
      }
    });
    const ok = this.finished.filter((s) => s === 'success').length;
    const bad = this.finished.filter((s) => s === 'failure').length;
    const n = this.children.length;
    const result: Status = this.needed === 'all' ? (bad > 0 ? 'failure' : ok === n ? 'success' : 'running') : ok > 0 ? 'success' : bad === n ? 'failure' : 'running';
    if (result !== 'running') this.halt(b); // decided: stop the ones still at it, and start afresh next time
    return result;
  }

  override halt(b: B): void {
    this.finished.fill(null);
    super.halt(b);
  }
}

class Condition<B> extends BtNode<B> {
  constructor(
    name: string,
    private readonly test: (b: B) => boolean,
  ) {
    super(name, 'condition');
  }
  protected tick(b: B): Status {
    return this.test(b) ? 'success' : 'failure';
  }
}

class Action<B> extends BtNode<B> {
  private active = false;

  constructor(
    name: string,
    private readonly step: (b: B, dt: number) => Status,
    private readonly onHalt?: (b: B) => void,
  ) {
    super(name, 'action');
  }

  protected tick(b: B, dt: number): Status {
    const s = this.step(b, dt);
    this.active = s === 'running';
    return s;
  }

  override halt(b: B): void {
    if (!this.active) return;
    this.active = false;
    this.onHalt?.(b);
  }
}

class Wait<B> extends BtNode<B> {
  private elapsed = 0;

  constructor(
    name: string,
    private readonly seconds: number,
  ) {
    super(name, 'wait');
  }

  protected tick(_b: B, dt: number): Status {
    this.elapsed += dt;
    if (this.elapsed < this.seconds) return 'running';
    this.elapsed = 0;
    return 'success';
  }

  override halt(): void {
    this.elapsed = 0;
  }
}

/** One child, its answer changed. */
abstract class Decorator<B> extends BtNode<B> {
  constructor(name: string, kind: string, child: BtNode<B>) {
    super(name, kind);
    this.children.push(child);
  }
  protected get child(): BtNode<B> {
    return this.children[0]!;
  }
}

class Inverter<B> extends Decorator<B> {
  protected tick(b: B, dt: number, tree: BehaviorTree<B>): Status {
    const s = this.child.run(b, dt, tree);
    return s === 'running' ? s : s === 'success' ? 'failure' : 'success';
  }
}

class Succeeder<B> extends Decorator<B> {
  protected tick(b: B, dt: number, tree: BehaviorTree<B>): Status {
    return this.child.run(b, dt, tree) === 'running' ? 'running' : 'success';
  }
}

class Repeat<B> extends Decorator<B> {
  private done = 0;

  constructor(
    name: string,
    child: BtNode<B>,
    private readonly times: number,
  ) {
    super(name, 'repeat', child);
  }

  protected tick(b: B, dt: number, tree: BehaviorTree<B>): Status {
    const s = this.child.run(b, dt, tree);
    if (s === 'failure') this.done = 0;
    if (s !== 'success') return s;
    if (++this.done < this.times) return 'running';
    this.done = 0;
    return 'success';
  }

  override halt(b: B): void {
    this.done = 0;
    super.halt(b);
  }
}

class Cooldown<B> extends Decorator<B> {
  private until = -Infinity;

  constructor(
    name: string,
    child: BtNode<B>,
    private readonly seconds: number,
  ) {
    super(name, 'cooldown', child);
  }

  protected tick(b: B, dt: number, tree: BehaviorTree<B>): Status {
    if (tree.time < this.until) return 'failure';
    const s = this.child.run(b, dt, tree);
    if (s === 'success') this.until = tree.time + this.seconds;
    return s;
  }
  // a halt keeps the cooldown: being interrupted is no reason to allow it again early
}

/** Children in priority order: the first that doesn't fail decides (success or running). */
export const selector = <B>(name: string, ...children: BtNode<B>[]): BtNode<B> => new Selector<B>(name, 'selector', children);
/** Children in order: fails at the first failure, runs while one runs, succeeds when all have. Reactive: from the top each tick. */
export const sequence = <B>(name: string, ...children: BtNode<B>[]): BtNode<B> => new Sequence<B>(name, 'sequence', children);
/** A sequence that resumes where it was (steps that must not be checked again once done). */
export const steps = <B>(name: string, ...children: BtNode<B>[]): BtNode<B> => new Steps<B>(name, 'steps', children);
/** All children at once (each until it finishes): 'all' succeeds when every one has and fails at a failure, 'one' succeeds as soon as one has. */
export const parallel = <B>(name: string, needed: 'all' | 'one', ...children: BtNode<B>[]): BtNode<B> => new Parallel<B>(name, needed, children);
/** A test: success if true, failure if not. */
export const condition = <B>(name: string, test: (b: B) => boolean): BtNode<B> => new Condition<B>(name, test);
/** Something done a step at a time: return 'running' until it is done. `onHalt` tidies up if it is interrupted. */
export const action = <B>(name: string, step: (b: B, dt: number) => Status, onHalt?: (b: B) => void): BtNode<B> => new Action<B>(name, step, onHalt);
/** Running for `seconds`, then success (from zero again next time, or after a halt). */
export const wait = <B>(name: string, seconds: number): BtNode<B> => new Wait<B>(name, seconds);
/** Success becomes failure and failure success. */
export const inverter = <B>(child: BtNode<B>, name = `not ${child.name}`): BtNode<B> => new Inverter<B>(name, 'inverter', child);
/** Success whatever the child answered, once it has finished. */
export const succeeder = <B>(child: BtNode<B>, name = `${child.name} (anyway)`): BtNode<B> => new Succeeder<B>(name, 'succeeder', child);
/** The child `times` times over: running until it has succeeded that often; a failure fails. */
export const repeat = <B>(child: BtNode<B>, times: number, name = `${child.name} x${times}`): BtNode<B> => new Repeat<B>(name, child, times);
/** After the child succeeds it fails, without running, for `seconds` of tree time (no spamming). */
export const cooldown = <B>(child: BtNode<B>, seconds: number, name = `${child.name} (cooldown)`): BtNode<B> => new Cooldown<B>(name, child, seconds);

export interface TraceRow {
  name: string;
  kind: string;
  depth: number;
  /** This tick's answer, or null if this tick never reached the node. */
  status: Status | null;
}

export class BehaviorTree<B> {
  /** Ticks so far. */
  ticks = 0;
  /** Seconds ticked so far (the sum of every dt). */
  time = 0;
  status: Status | null = null;

  constructor(
    readonly root: BtNode<B>,
    readonly blackboard: B,
  ) {
    // every node checked first, then claimed: a refused tree leaves its nodes free
    const nodes = new Set<BtNode<B>>();
    const visit = (n: BtNode<B>) => {
      if (nodes.has(n)) throw new Error(`BehaviorTree: node "${n.name}" appears twice (nodes keep state: make one per place)`);
      if (n.tree) throw new Error(`BehaviorTree: node "${n.name}" is already in another tree (nodes keep state: build one tree per agent)`);
      nodes.add(n);
      for (const c of n.children) visit(c);
    };
    visit(root);
    for (const n of nodes) n.tree = this;
  }

  tick(dt: number): Status {
    this.ticks++;
    this.time += dt;
    this.status = this.root.run(this.blackboard, dt, this);
    return this.status;
  }

  /** Stop everything (a cutscene, a stun): running actions are told to halt. */
  halt(): void {
    this.root.halt(this.blackboard);
  }

  /** Every node depth-first with this tick's answer: for drawing the tree. */
  trace(): TraceRow[] {
    const out: TraceRow[] = [];
    const walk = (n: BtNode<B>, depth: number) => {
      out.push({ name: n.name, kind: n.kind, depth, status: n.visited === this.ticks ? n.status : null });
      for (const c of n.children) walk(c, depth + 1);
    };
    walk(this.root, 0);
    return out;
  }

  /** The names down the branch that decided this tick, root first (the last child each node ran that didn't fail). */
  activePath(): string[] {
    const path: string[] = [];
    let n: BtNode<B> | undefined = this.root;
    while (n && n.visited === this.ticks) {
      path.push(n.name);
      let next: BtNode<B> | undefined;
      for (const c of n.children) if (c.visited === this.ticks && c.status !== 'failure') next = c;
      n = next;
    }
    return path;
  }
}

/** The builders in one object, for `bt.selector(...)` without importing each. */
export const bt = { selector, sequence, steps, parallel, condition, action, wait, inverter, succeeder, repeat, cooldown } as const;
