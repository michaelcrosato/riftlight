/* global window, document */
// Part of the e2e suite "riftlight": the real LootPort and TreePort in the game shell (production
// build), on WebGPU and the WebGL 2 fallback, with the stub hero / level / monster ports:
//
//   new run → starter gems socketed → kill a boss → real loot drops (beam light from ctx.lights) →
//   pick up (F) → I opens the inventory → right-click equips → the hero's StatSheet changes →
//   Esc closes it without the pause menu; pause → Inventory works while paused →
//   G skill panel: right-click a gem into slot 1 → the skill bar changes; a support raises its
//   cost; X (keys / pad) takes it out → P passive tree: click a node → the stat changes; real
//   Escape closes it without the pause menu → Oru's respec refunds for gold → Ilsa: buy wares,
//   the gems tab, sell → Brann's anvil: an orb on an item → the stash chest: Ctrl-click stores →
//   save → reload → Continue: the stash, sockets, tree and gear are back → a loot label click
//   after a GPU device loss → a portrait phone (390×844): every window fits the screen.
//
// Frames (the 3D frame with the HUD and the item / tree overlays composited) land in
// .scratch/e2e/riftlight-items-*.png. Self-contained: e2e.mjs passes its helpers in.

import { writeFile } from 'node:fs/promises';

/**
 * @param {object} h helpers from e2e.mjs: { exe, scenario, openPage, check, capture, checkClean, encodePng, OUT }
 */
export async function runRiftlightItems(h) {
  const { exe, scenario: s, openPage, check, capture, checkClean, encodePng, OUT } = h;
  const tag = s.name === 'webgpu' ? 'webgpu' : 'webgl';
  console.log(`\n▶ riftlight items, skills and tree (${s.backend})`);
  let ctx;
  try {
    // real localStorage (a fresh browser profile): the stash has to survive a reload
    ctx = await openPage(exe, s, 'game=riftlight&debug=0&seed=777');
    const { page, logs } = ctx;
    await page.waitForFunction(() => window.__RIFTLIGHT__, null, { timeout: 60000 });
    const R = (fn, arg) => page.evaluate(fn, arg);
    const st = () => R(() => window.__RIFTLIGHT__.state());
    const step = (n = 1) => R((k) => window.__PIXEL_ENGINE__.step(k), n);
    /** Art pixel of the item windows → page point. */
    const itemsPt = (x, y) => R(([a, b]) => window.__RIFTLIGHT__.game.ports.loot.ui.toClient(a, b), [x, y]);
    const bar = () =>
      R(() =>
        window.__RIFTLIGHT__.game.hero
          .skills()
          .filter((k) => typeof k.slot === 'number')
          .map((k) => ({ id: k.id, name: k.name, cost: k.cost })),
      );
    // frames: every window on WebGPU, the inventory on WebGL 2 too (the UI is the same 2D overlay)
    const shot = (name) => (tag === 'webgpu' || name === 'inventory' ? composite(page, `riftlight-items-${tag}-${name}.png`) : null);
    /** Stand at a townsperson (or the chest) and press F: the same path as walking there (the core suite walks). */
    const talkTo = (id) =>
      R((who) => {
        const rl = window.__RIFTLIGHT__;
        const it = rl.game.town.interactables.find((x) => x.id === who);
        rl.game.hero.enter(rl.game.town, it.position.clone(), 0);
        window.__PIXEL_ENGINE__.step(2);
        const ok = rl.game.interact();
        window.__PIXEL_ENGINE__.step(1);
        return { ok, state: rl.state() };
      }, id);

    // ---------------------------------------------------------------- a new run: starter gems
    await R(() => window.__RIFTLIGHT__.newRun({ slot: 1, seed: 777 }));
    const start = await R(() => window.__RIFTLIGHT__.game.save.hero.skills.map((x) => x.gem?.gem?.id ?? null));
    check(start.join() === 'cleave,frost-nova,dash,war-cry', `a new run socket the starter gems (${start.join(',')})`);
    let b = await bar();
    check(b.map((k) => k.name).join() === 'Cleave,Frost Nova,Dash,War Cry', `the skill bar shows the socketed gems (${b.map((k) => k.name).join(',')})`);
    await R(() => window.__RIFTLIGHT__.give({ levels: 12, gold: 20000 }));

    // ---------------------------------------------------------------- kill → real drops → pick up
    await R(async () => {
      await window.__RIFTLIGHT__.enterDepth(1);
      window.__PIXEL_ENGINE__.step(5);
    });
    await R(() => {
      const rl = window.__RIFTLIGHT__;
      for (const m of rl.game.level.monsters()) m.actor.life = 0.001; // the level's own pack: keep them out of the way
      const p = rl.game.hero.actor.position;
      rl.spawn({ seed: 31, x: p.x + 1.5, z: p.z, rank: 'boss' });
      rl.killAll();
      window.__PIXEL_ENGINE__.step(45); // the drops arc out and land
    });
    const ground = await R(() =>
      window.__RIFTLIGHT__.game.ports.loot.ground().map((l) => ({ id: l.id, kind: l.drop.kind, rarity: l.drop.item?.rarity, base: l.drop.item?.base, label: l.label, beam: !!l.ground.beam, x: l.position.x, z: l.position.z })),
    );
    const items = ground.filter((g) => g.kind === 'item');
    check(items.length > 0 && items.some((g) => g.rarity === 'rare' || g.rarity === 'unique'), `a boss kill drops real items, a rare or better among them (${items.map((g) => `${g.rarity} ${g.base}`).join(', ')})`);
    const beams = await R(() => window.__PIXEL_ENGINE__.lights.describe().filter((r) => r.name === 'loot beam' && r.alive).length);
    check(items.some((g) => g.beam) && beams > 0, `rares land with a beam and a light from the engine's light pool (${beams} loot lights)`);
    await shot('drops');
    // the loot filter follows the setting (2 = rares only; currency and gems always show) and Alt
    const filter = await R(() => {
      const rl = window.__RIFTLIGHT__;
      const g = rl.game;
      const at = g.hero.actor.position.clone();
      const normal = { uid: 'e2e-normal-belt', base: 'leather-belt', rarity: 'normal', level: 1, name: 'Leather Belt', affixes: [] };
      const orb = { uid: 'e2e-ground-orb', base: 'ember-bead', rarity: 'normal', level: 1, name: 'Ember Bead', affixes: [] };
      g.ports.loot.spawn([{ kind: 'item', item: normal }, { kind: 'item', item: orb }], at, g.level, g.services.rng);
      window.__PIXEL_ENGINE__.step(30);
      const hidden = () => g.ports.loot.ground().filter((l) => l.filtered).map((l) => l.drop.item.uid);
      const before = hidden();
      g.settings.lootFilter = 2;
      const strict = hidden();
      rl.press('AltLeft');
      const alt = hidden();
      rl.press('AltLeft');
      const back = hidden();
      g.settings.lootFilter = 0;
      return { before, strict, alt, back };
    });
    check(
      !filter.before.includes('e2e-normal-belt') && filter.strict.includes('e2e-normal-belt') && !filter.strict.includes('e2e-ground-orb') && filter.alt.length === 0 && filter.back.includes('e2e-normal-belt'),
      `the loot filter follows the setting and Alt shows everything (show all: ${filter.before.length} hidden, rares only: ${filter.strict.length}, Alt: ${filter.alt.length}, Alt again: ${filter.back.length})`,
    );
    const picked = await R(() => {
      const rl = window.__RIFTLIGHT__;
      const loot = rl.game.ports.loot;
      const target = loot.ground().find((l) => l.drop.kind === 'item' && !l.filtered);
      if (!target) return { ok: false };
      rl.moveTo(target.position.x, target.position.z, { radius: 0.5 });
      const before = loot.counts().inventory;
      const lying = loot.ground().map((l) => l.drop.item?.uid);
      const ok = rl.interact().ok;
      const gone = lying.filter((uid) => uid && !loot.ground().some((l) => l.drop.item?.uid === uid));
      return { ok, before, after: loot.counts().inventory, inBag: gone.length === 1 && loot.store.state.inventory.items.some((p) => p.item.uid === gone[0]) };
    });
    check(picked.ok && picked.inBag && picked.after === picked.before + 1, `F picks the nearest item up into the bag (${picked.before} → ${picked.after})`);
    await R(() => window.__RIFTLIGHT__.toTown());
    await step(5);

    // ---------------------------------------------------------------- inventory → equip → stats
    const gear = await R(() => {
      const loot = window.__RIFTLIGHT__.game.ports.loot;
      // a known magic belt, so the stat change is certain
      const belt = { uid: 'e2e-belt', base: 'leather-belt', rarity: 'magic', level: 5, name: 'Hale Leather Belt', affixes: [{ id: 'life', tier: 0, mods: [{ stat: 'life', kind: 'flat', value: 25 }] }] };
      loot.add(belt);
      return belt.uid;
    });
    await R(() => window.__RIFTLIGHT__.press('KeyI'));
    let rs = await st();
    check(rs.ui.includes('inventory') && !rs.paused, `I opens the inventory, the town keeps running (ui ${rs.ui.join(',')})`);
    const beltAt = await R((uid) => window.__RIFTLIGHT__.game.ports.loot.ui.itemCenter(uid), gear);
    const beltPt = await itemsPt(beltAt.x, beltAt.y);
    await page.mouse.move(beltPt.x, beltPt.y);
    await step(2);
    await shot('inventory-tooltip');
    const lifeBefore = await R(() => window.__RIFTLIGHT__.hero('life').value);
    await page.mouse.click(beltPt.x, beltPt.y, { button: 'right' });
    await step(2);
    const equipped = await R(() => {
      const rl = window.__RIFTLIGHT__;
      return { belt: rl.game.ports.loot.store.state.equipment.belt?.uid ?? null, life: rl.hero('life'), sources: rl.game.hero.actor.stats.sourceKeys() };
    });
    check(equipped.belt === gear, `right-click equips the belt (${equipped.belt})`);
    check(equipped.life.value > lifeBefore && equipped.life.sources.some((x) => x.source === 'item:belt'), `the hero's StatSheet changes: life ${lifeBefore} → ${equipped.life.value} from item:belt`);
    await shot('inventory');
    await R(() => window.__RIFTLIGHT__.press('Escape'));
    rs = await st();
    check(rs.ui.length === 0, `Esc closes the inventory and doesn't open the pause menu (ui ${rs.ui.join(',') || 'none'})`);
    // while paused: pause → Inventory, then Esc back to the pause menu
    await R(() => window.__RIFTLIGHT__.press('Escape'));
    await R(() => window.__RIFTLIGHT__.ui.click('inventory'));
    rs = await st();
    check(rs.ui.join() === 'pause,inventory' && rs.paused, `the pause menu opens the inventory over it, still paused (ui ${rs.ui.join(',')})`);
    await R(() => window.__RIFTLIGHT__.press('PadB'));
    rs = await st();
    check(rs.ui.join() === 'pause', `pad B closes the inventory back to the pause menu (ui ${rs.ui.join(',')})`);
    await R(() => window.__RIFTLIGHT__.press('Escape'));
    await R(() => window.__RIFTLIGHT__.press('PadBack'));
    rs = await st();
    check(rs.ui.join() === 'inventory', `pad Back opens the inventory (ui ${rs.ui.join(',')})`);
    await R(() => window.__RIFTLIGHT__.press('KeyI'));
    rs = await st();
    check(rs.ui.length === 0, `I closes it again (ui ${rs.ui.join(',') || 'none'})`);

    // ---------------------------------------------------------------- skill panel: socket gems
    await R(() => {
      const loot = window.__RIFTLIGHT__.game.ports.loot;
      loot.add({ uid: 'e2e-fireball', base: 'skill-gem', rarity: 'normal', level: 1, name: 'Fireball', affixes: [], gem: { id: 'fireball', level: 3, support: false } });
      loot.add({ uid: 'e2e-lmp', base: 'support-gem', rarity: 'normal', level: 1, name: 'Lesser Multiple Projectiles', affixes: [], gem: { id: 'lmp', level: 1, support: true } });
    });
    await R(() => window.__RIFTLIGHT__.press('KeyG'));
    rs = await st();
    check(rs.ui.join() === 'skills', `G opens the skill panel (ui ${rs.ui.join(',')})`);
    await step(1);
    const gemPt = await R(() => {
      const ui = window.__RIFTLIGHT__.game.ports.loot.ui;
      const c = ui.itemCenter('e2e-fireball');
      return ui.toClient(c.x, c.y);
    });
    await page.mouse.click(gemPt.x, gemPt.y, { button: 'right' });
    await step(2);
    b = await bar();
    const sock = await R(() => {
      const rl = window.__RIFTLIGHT__;
      return { slot0: rl.game.save.hero.skills[0].gem?.gem?.id, cleaveBack: rl.game.ports.loot.store.state.inventory.items.some((p) => p.item.gem?.id === 'cleave') };
    });
    check(sock.slot0 === 'fireball' && b[0].name === 'Fireball', `right-click sockets Fireball in skill 1 and the bar shows it (${b[0].name})`);
    check(sock.cleaveBack, 'the gem it replaced (Cleave) went back into the bag');
    const cost0 = b[0].cost;
    const lmpPt = await R(() => {
      const ui = window.__RIFTLIGHT__.game.ports.loot.ui;
      const c = ui.itemCenter('e2e-lmp');
      return ui.toClient(c.x, c.y);
    });
    await page.mouse.click(lmpPt.x, lmpPt.y, { button: 'right' });
    await step(2);
    b = await bar();
    const linked = await R(() => window.__RIFTLIGHT__.game.save.hero.skills[0].supports.map((g) => g?.gem?.id ?? null));
    check(linked[0] === 'lmp' && b[0].cost > cost0, `a support links to it and its cost follows (${linked.join(',')}; cost ${cost0} → ${b[0].cost})`);
    const lines = await R(() => {
      const ui = window.__RIFTLIGHT__.game.ports.loot.ui;
      return ui.skillLines(ui.numbers()[0]).map((l) => l.text);
    });
    check(lines.some((l) => /^HIT \d/.test(l)) && lines.some((l) => /^DPS \d/.test(l)) && lines.some((l) => /^COST \d/.test(l)), `the panel shows the resolved skill (${lines.join(' | ')})`);
    // the socket's tooltip
    const sockPt = await R(() => {
      const ui = window.__RIFTLIGHT__.game.ports.loot.ui;
      const c = ui.socketCenter(0, -1);
      return ui.toClient(c.x, c.y);
    });
    await page.mouse.move(sockPt.x, sockPt.y);
    await step(2);
    await shot('skills');
    // keys / pad: Enter puts the cursor on skill 1's socket, X takes the gem out
    await R(() => window.__RIFTLIGHT__.press('Enter'));
    await R(() => window.__RIFTLIGHT__.press('PadX'));
    b = await bar();
    const out = await R(() => ({ slot0: window.__RIFTLIGHT__.game.save.hero.skills[0].gem, inBag: window.__RIFTLIGHT__.game.ports.loot.store.state.inventory.items.some((p) => p.item.uid === 'e2e-fireball') }));
    check(out.slot0 === null && out.inBag && b[0].id === null, `pad X takes the gem out: slot 1 is empty, Fireball is back in the bag (${b[0].id})`);
    await R(() => window.__RIFTLIGHT__.press('PadX')); // nothing to take: still fine
    const gemPt2 = await R(() => {
      const ui = window.__RIFTLIGHT__.game.ports.loot.ui;
      const c = ui.itemCenter('e2e-fireball');
      return ui.toClient(c.x, c.y);
    });
    await page.mouse.click(gemPt2.x, gemPt2.y, { button: 'right' }); // and back in
    await step(2);
    b = await bar();
    check(b[0].name === 'Fireball', `…and back in with a right-click (${b[0].name})`);
    await R(() => window.__RIFTLIGHT__.press('Escape'));
    rs = await st();
    check(rs.ui.length === 0, `Esc closes the skill panel (ui ${rs.ui.join(',') || 'none'})`);

    // ---------------------------------------------------------------- passive tree
    await page.keyboard.press('KeyP');
    await step(2);
    rs = await st();
    check(rs.ui.includes('tree') && rs.paused, `P opens the passive tree, the world pauses (ui ${rs.ui.join(',')})`);
    const node = await R(() => {
      const panel = window.__RIFTLIGHT__.game.layer.find('tree');
      const st = panel.state;
      const tree = panel.view.tree;
      const id = [...tree.roots].flatMap((r) => tree.neighbours(r)).find((n) => st.canAllocate(n) && tree.node(n).mods.length);
      const mod = tree.node(id).mods[0];
      panel.view.focus(id, 0.6);
      return { id, stat: mod.stat, tags: mod.tags ?? [], points: st.points };
    });
    check(node.points >= 12, `the tree has the hero's points (${node.points})`);
    await new Promise((r) => setTimeout(r, 150)); // the tree view repaints on its own frame
    const nodePt = await R((id) => {
      const panel = window.__RIFTLIGHT__.game.layer.find('tree');
      const [x, y] = panel.view.screenOf(id);
      const c = document.querySelector('canvas[data-rift-tree="canvas"]').getBoundingClientRect();
      const d = panel.view.debug().art;
      return { x: c.left + ((x + 0.5) / d.width) * c.width, y: c.top + ((y + 0.5) / d.height) * c.height };
    }, node.id);
    const statBefore = await R(([stat, tags]) => window.__RIFTLIGHT__.hero(stat, tags).value, [node.stat, node.tags]);
    await page.mouse.click(nodePt.x, nodePt.y);
    await step(2);
    const after = await R(([stat, tags, id]) => ({ allocated: window.__RIFTLIGHT__.game.save.hero.allocated.includes(id), h: window.__RIFTLIGHT__.hero(stat, tags) }), [node.stat, node.tags, node.id]);
    check(after.allocated, `a click allocates ${node.id}`);
    check(after.h.value !== statBefore && after.h.sources.some((x) => x.source === 'tree'), `the stat changes through the tree source: ${node.stat} ${statBefore} → ${after.h.value}`);
    await new Promise((r) => setTimeout(r, 150));
    await shot('tree');
    // a right-click here is refused: only the mystic refunds
    await page.mouse.click(nodePt.x, nodePt.y, { button: 'right' });
    await step(1);
    check(await R((id) => window.__RIFTLIGHT__.game.save.hero.allocated.includes(id), node.id), 'refunds are refused outside the respec');
    await page.keyboard.press('Escape');
    await step(2);
    rs = await st();
    check(!rs.ui.includes('tree') && !rs.ui.includes('pause') && !rs.paused, `real Escape closes the tree and never reaches the pause menu (ui ${rs.ui.join(',') || 'none'})`);
    await page.keyboard.press('KeyP');
    await step(2);
    await page.keyboard.press('KeyP');
    await step(2);
    rs = await st();
    check(rs.ui.length === 0, `P toggles the tree open and shut (ui ${rs.ui.join(',') || 'none'})`);
    // the mystic: refund for gold
    let talk = await talkTo('oru');
    check(talk.state.ui.includes('tree'), `talking to Oru opens the respec tree (ui ${talk.state.ui.join(',')})`);
    const goldBeforeRespec = (await st()).hero.gold;
    await R((id) => window.__RIFTLIGHT__.game.layer.find('tree').view.focus(id, 0.6), node.id);
    await new Promise((r) => setTimeout(r, 150));
    const nodePt2 = await R((id) => {
      const panel = window.__RIFTLIGHT__.game.layer.find('tree');
      const [x, y] = panel.view.screenOf(id);
      const c = document.querySelector('canvas[data-rift-tree="canvas"]').getBoundingClientRect();
      const d = panel.view.debug().art;
      return { x: c.left + ((x + 0.5) / d.width) * c.width, y: c.top + ((y + 0.5) / d.height) * c.height };
    }, node.id);
    await page.mouse.click(nodePt2.x, nodePt2.y, { button: 'right' });
    await step(2);
    const respec = await R((id) => ({ allocated: window.__RIFTLIGHT__.game.save.hero.allocated.includes(id), gold: window.__RIFTLIGHT__.state().hero.gold }), node.id);
    check(!respec.allocated && respec.gold < goldBeforeRespec, `Oru refunds the node for gold (${goldBeforeRespec} → ${respec.gold})`);
    await R(() => window.__RIFTLIGHT__.press('PadB'));
    rs = await st();
    check(rs.ui.length === 0, `pad B closes the tree (ui ${rs.ui.join(',') || 'none'})`);
    // allocate it again for the save check below
    await R((id) => {
      window.__RIFTLIGHT__.ui.open('tree');
      window.__RIFTLIGHT__.game.layer.find('tree').view.allocate(id);
      window.__RIFTLIGHT__.ui.close('tree');
    }, node.id);

    // ---------------------------------------------------------------- vendor: buy, gems, sell
    talk = await talkTo('ilsa');
    check(talk.state.ui.includes('vendor'), `talking to Ilsa opens her wares (ui ${talk.state.ui.join(',')})`);
    await step(1);
    const buy = await R(() => {
      const rl = window.__RIFTLIGHT__;
      const loot = rl.game.ports.loot;
      const item = loot.store.vendor.stock[0];
      const c = loot.ui.itemCenter(item.uid);
      return { uid: item.uid, pt: loot.ui.toClient(c.x, c.y), gold: rl.state().hero.gold };
    });
    await page.mouse.click(buy.pt.x, buy.pt.y);
    await step(2);
    const bought = await R((uid) => ({ gold: window.__RIFTLIGHT__.state().hero.gold, inBag: window.__RIFTLIGHT__.game.ports.loot.store.state.inventory.items.some((p) => p.item.uid === uid) }), buy.uid);
    check(bought.inBag && bought.gold < buy.gold, `a click buys from the smith's wares (gold ${buy.gold} → ${bought.gold})`);
    const tabPt = await R(() => {
      const ui = window.__RIFTLIGHT__.game.ports.loot.ui;
      const c = ui.tabCenter(1);
      return ui.toClient(c.x, c.y);
    });
    await page.mouse.click(tabPt.x, tabPt.y);
    await step(2);
    const gems = await R(() => {
      const loot = window.__RIFTLIGHT__.game.ports.loot;
      const g = loot.store.vendor.stock.find((x) => x.gem);
      const c = loot.ui.itemCenter(g.uid);
      return { kind: loot.store.vendor.kind, uid: g.uid, id: g.gem.id, pt: loot.ui.toClient(c.x, c.y), all: loot.store.vendor.stock.every((x) => x.gem) };
    });
    check(gems.kind === 'gems' && gems.all, `the gems tab sells skill and support gems (${gems.kind}, ${gems.id})`);
    await page.mouse.move(gems.pt.x, gems.pt.y);
    await step(2);
    await shot('vendor-gems');
    await page.mouse.click(gems.pt.x, gems.pt.y);
    await step(2);
    check(await R((uid) => window.__RIFTLIGHT__.game.ports.loot.store.state.inventory.items.some((p) => p.item.uid === uid), gems.uid), `bought a ${gems.id} gem`);
    const sale = await R(() => {
      const rl = window.__RIFTLIGHT__;
      const ui = rl.game.ports.loot.ui;
      const c = ui.itemCenter('e2e-fireball') ?? ui.itemCenter(rl.game.ports.loot.store.state.inventory.items[0].item.uid);
      return { pt: ui.toClient(c.x, c.y), gold: rl.state().hero.gold, n: rl.game.ports.loot.counts().inventory };
    });
    await page.keyboard.down('Control');
    await page.mouse.click(sale.pt.x, sale.pt.y);
    await page.keyboard.up('Control');
    await step(2);
    const sold = await R(() => ({ gold: window.__RIFTLIGHT__.state().hero.gold, n: window.__RIFTLIGHT__.game.ports.loot.counts().inventory }));
    check(sold.gold > sale.gold && sold.n === sale.n - 1, `Ctrl-click sells (gold ${sale.gold} → ${sold.gold})`);
    await R(() => window.__RIFTLIGHT__.press('Escape'));

    // ---------------------------------------------------------------- crafting bench: an orb on an item
    await R(() => {
      const loot = window.__RIFTLIGHT__.game.ports.loot;
      loot.add({ uid: 'e2e-boots', base: 'rawhide-boots', rarity: 'normal', level: 8, name: 'Rawhide Boots', affixes: [] });
      loot.add({ uid: 'e2e-orb', base: 'kindling-shard', rarity: 'normal', level: 1, name: 'Kindling Shard', affixes: [], quantity: 3 });
    });
    talk = await talkTo('brann');
    check(talk.state.ui.includes('crafting'), `talking to Brann opens the anvil (ui ${talk.state.ui.join(',')})`);
    await step(1);
    const bootsPt = await R(() => {
      const ui = window.__RIFTLIGHT__.game.ports.loot.ui;
      const c = ui.itemCenter('e2e-boots');
      return ui.toClient(c.x, c.y);
    });
    await page.mouse.click(bootsPt.x, bootsPt.y);
    await step(1);
    const orbPt = await R(() => {
      const ui = window.__RIFTLIGHT__.game.ports.loot.ui;
      const c = ui.orbCenter('kindling-shard');
      return ui.toClient(c.x, c.y);
    });
    await page.mouse.move(orbPt.x, orbPt.y);
    await step(1);
    await page.mouse.click(orbPt.x, orbPt.y);
    await step(2);
    const crafted = await R(() => {
      const s = window.__RIFTLIGHT__.game.ports.loot.store.state;
      const boots = s.inventory.items.find((p) => p.item.uid === 'e2e-boots')?.item;
      const orb = s.inventory.items.find((p) => p.item.uid === 'e2e-orb')?.item;
      return { bench: window.__RIFTLIGHT__.game.ports.loot.ui.benchItem, rarity: boots?.rarity, affixes: boots?.affixes.length, orbs: orb?.quantity };
    });
    check(crafted.bench === 'e2e-boots' && crafted.rarity === 'magic' && crafted.affixes > 0 && crafted.orbs === 2, `a Kindling Shard on the bench makes the boots magic (${crafted.rarity}, ${crafted.affixes} affixes, ${crafted.orbs} shards left)`);
    await shot('crafting');
    await R(() => window.__RIFTLIGHT__.press('Escape'));

    // ---------------------------------------------------------------- stash → save → reload → continue
    talk = await talkTo('stash');
    check(talk.state.ui.includes('stash'), `the chest opens the stash (ui ${talk.state.ui.join(',')})`);
    await step(1);
    const storePt = await R(() => {
      const ui = window.__RIFTLIGHT__.game.ports.loot.ui;
      const c = ui.itemCenter('e2e-boots');
      return ui.toClient(c.x, c.y);
    });
    await page.keyboard.down('Control');
    await page.mouse.click(storePt.x, storePt.y);
    await page.keyboard.up('Control');
    await step(2);
    check(await R(() => window.__RIFTLIGHT__.game.ports.loot.store.state.stash[0].items.some((p) => p.item.uid === 'e2e-boots')), 'Ctrl-click stores the boots in the stash');
    // drag them to a cell of our own: the cell must survive the reload too
    const drag = await R(() => {
      const ui = window.__RIFTLIGHT__.game.ports.loot.ui;
      const a = ui.itemCenter('e2e-boots');
      const b = ui.cellCenter('left', 6, 4);
      return { from: ui.toClient(a.x, a.y), to: ui.toClient(b.x, b.y) };
    });
    await page.mouse.move(drag.from.x, drag.from.y);
    await page.mouse.down();
    await page.mouse.move(drag.to.x, drag.to.y, { steps: 4 });
    await page.mouse.up();
    await step(2);
    const stashed = await R(() => window.__RIFTLIGHT__.game.ports.loot.store.state.stash[0].items.find((p) => p.item.uid === 'e2e-boots') ?? null);
    check(stashed && stashed.x === 6 && stashed.y === 4, `drag and drop moves them within the stash (${stashed?.x},${stashed?.y})`);
    await shot('stash');
    await R(() => window.__RIFTLIGHT__.press('Escape'));
    const before = await R(() => {
      const rl = window.__RIFTLIGHT__;
      rl.save(1);
      return { allocated: rl.game.save.hero.allocated.length, sockets: rl.game.save.hero.skills.map((x) => x.gem?.gem?.id ?? null).join() };
    });
    await page.reload();
    await page.waitForFunction(() => window.__RIFTLIGHT__ && window.__PIXEL_ENGINE__?.frame >= 2, null, { timeout: 90000 });
    await R(() => window.__RIFTLIGHT__.continueRun(1));
    const restored = await R(() => {
      const rl = window.__RIFTLIGHT__;
      const s = rl.game.ports.loot.store.state;
      const p = s.stash[0].items.find((x) => x.item.uid === 'e2e-boots');
      return {
        stash: p ? { x: p.x, y: p.y, rarity: p.item.rarity } : null,
        belt: s.equipment.belt?.uid ?? null,
        sockets: rl.game.save.hero.skills.map((x) => x.gem?.gem?.id ?? null).join(),
        bar: rl.game.hero.skills()[0].name,
        allocated: rl.game.save.hero.allocated.length,
        life: rl.hero('life').sources.map((x) => x.source),
      };
    });
    check(restored.stash && restored.stash.x === stashed.x && restored.stash.y === stashed.y && restored.stash.rarity === 'magic', `the stash survives save → reload → Continue, in the same cell (${JSON.stringify(restored.stash)})`);
    check(restored.belt === 'e2e-belt' && restored.life.includes('item:belt'), `equipped gear comes back and applies (${restored.belt})`);
    check(restored.sockets === before.sockets && restored.bar === 'Fireball', `the skill sockets come back (${restored.sockets})`);
    check(restored.allocated === before.allocated && restored.life.includes('item:belt'), `the passive tree comes back (${restored.allocated} nodes)`);

    // ---------------------------------------------------------------- a label click after a lost GPU device
    // (WebGPU only: the label click is the shell's window-level pointer, the same on both
    // backends; the phone suite covers the WebGL 2 context loss itself)
    if (tag === 'webgpu') {
      await R(async () => {
        await window.__RIFTLIGHT__.enterDepth(1);
        window.__PIXEL_ENGINE__.step(5);
      });
      await R(() => {
        const r = window.__PIXEL_ENGINE__.renderer.renderer;
        if (r.backend.isWebGPUBackend) r.backend.device.destroy();
        else r.backend.gl.getExtension('WEBGL_lose_context').loseContext();
      });
      await page.waitForFunction(() => window.__PIXEL_ENGINE__.state().gpuRecoveries === 1, null, { timeout: 60000 });
      await R(() => window.__RIFTLIGHT__.realtime());
      await new Promise((r) => setTimeout(r, 300));
      const drop = await R(() => {
        const rl = window.__RIFTLIGHT__;
        const g = rl.game;
        const item = { uid: 'e2e-ring', base: 'iron-ring', rarity: 'rare', level: 5, name: 'Grim Coil', affixes: [] };
        g.ports.loot.spawn([{ kind: 'item', item }], g.hero.actor.position.clone(), g.level, g.services.rng);
        window.__PIXEL_ENGINE__.step(40);
        const l = g.ports.loot.ground().find((x) => x.drop.kind === 'item');
        const v = l.position.clone().project(g.ctx.engine.camera.camera);
        const res = g.ctx.engine.renderer.resolution;
        const ax = Math.round(((v.x + 1) / 2) * res.width);
        const ay = Math.round(((1 - v.y) / 2) * res.height) - 14 + 5;
        const c = g.ctx.engine.renderer.renderer.domElement.getBoundingClientRect();
        return { x: c.left + ((ax + 0.5) / res.width) * c.width, y: c.top + ((ay + 0.5) / res.height) * c.height };
      });
      await page.mouse.move(drop.x, drop.y);
      await step(2);
      await page.mouse.click(drop.x, drop.y);
      await step(2);
      const got = await R(() => {
        const g = window.__RIFTLIGHT__.game;
        const l = g.ports.loot.ground().find((x) => x.drop.kind === 'item');
        return {
          inBag: g.ports.loot.store.state.inventory.items.some((p) => p.item.uid === 'e2e-ring'),
          left: l ? { d: +l.position.distanceTo(g.hero.actor.position).toFixed(2) } : null,
          pointer: { ...g.pointer.art },
          ui: g.layer.stack.map((o) => o.panel.id),
        };
      });
      check(got.inBag, `after a lost GPU device a click on a loot label still picks it up (${JSON.stringify(got)})`);
    }
    checkClean(await R(() => window.__PIXEL_ENGINE__.state()), logs);
  } catch (e) {
    check(false, `riftlight items crashed: ${e.message}\n    ${ctx?.logs.join('\n    ') ?? ''}`);
  } finally {
    await ctx?.browser.close();
  }

  // ---------------------------------------------------------------- a phone in portrait
  if (s.name === 'webgpu') await runPhone();

  async function runPhone() {
    let phone;
    try {
      phone = await openPage(exe, s, 'game=riftlight&debug=0&seed=777&save=memory&touch=1', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true });
      const { page, logs } = phone;
      await page.waitForFunction(() => window.__RIFTLIGHT__, null, { timeout: 60000 });
      const R = (fn, arg) => page.evaluate(fn, arg);
      await R(() => {
        const rl = window.__RIFTLIGHT__;
        rl.newRun({ slot: 2, seed: 99 });
        rl.give({ levels: 5, items: 4 });
        rl.game.ports.loot.add({ uid: 'p-orb', base: 'ember-bead', rarity: 'normal', level: 1, name: 'Ember Bead', affixes: [], quantity: 4 });
      });
      for (const view of ['inventory', 'stash', 'vendor', 'crafting', 'skills']) {
        const fit = await R((v) => {
          const rl = window.__RIFTLIGHT__;
          rl.ui.open(v);
          window.__PIXEL_ENGINE__.step(2);
          const ui = rl.game.ports.loot.ui;
          const res = window.__PIXEL_ENGINE__.renderer.resolution;
          const rects = ui.rects();
          const inside = rects.every((r) => r.x >= 0 && r.y >= 0 && r.x + r.w <= res.width && r.y + r.h <= res.height);
          const overlap = rects.length === 2 && rects[0].x < rects[1].x + rects[1].w && rects[1].x < rects[0].x + rects[0].w && rects[0].y < rects[1].y + rects[1].h && rects[1].y < rects[0].y + rects[0].h;
          return { inside, overlap, rects, res: `${res.width}x${res.height}`, ui: rl.state().ui };
        }, view);
        check(fit.inside && !fit.overlap && fit.ui.length === 1, `phone ${fit.res}: the ${view} windows fit the screen without overlapping (${fit.rects.map((r) => `${r.x},${r.y} ${r.w}x${r.h}`).join(' / ')})`);
        await composite(page, `riftlight-items-phone-${view}.png`);
        if (view !== 'inventory' && view !== 'skills') {
          await R(() => window.__RIFTLIGHT__.ui.close());
          continue;
        }
        // a tap on the first item shows its tooltip (the second would act)
        const tap = await R(() => {
          const ui = window.__RIFTLIGHT__.game.ports.loot.ui;
          const it = ui.store.state.inventory.items[0];
          if (!it) return null;
          const c = ui.itemCenter(it.item.uid);
          return ui.toClient(c.x, c.y);
        });
        if (tap) {
          await page.touchscreen.tap(tap.x, tap.y);
          await R(() => window.__PIXEL_ENGINE__.step(2));
        }
        await composite(page, `riftlight-items-phone-${view}-tap.png`);
        await R(() => window.__RIFTLIGHT__.ui.close());
      }
      // the passive tree fills the portrait screen at the engine's art size, and a tap shows a node
      const tree = await R(() => {
        const rl = window.__RIFTLIGHT__;
        rl.ui.open('tree');
        window.__PIXEL_ENGINE__.step(2);
        const view = rl.game.layer.find('tree').view;
        const res = window.__PIXEL_ENGINE__.renderer.resolution;
        return { art: view.debug().art, res: { width: res.width, height: res.height } };
      });
      check(tree.art.width === tree.res.width && tree.art.height === tree.res.height, `phone: the passive tree fills the screen at ${tree.art.width}×${tree.art.height}`);
      await new Promise((r) => setTimeout(r, 200));
      await composite(page, 'riftlight-items-phone-tree.png');
      await R(() => window.__RIFTLIGHT__.press('PadB'));
      check((await R(() => window.__RIFTLIGHT__.state().ui)).length === 0, 'phone: back closes the tree');
      checkClean(await R(() => window.__PIXEL_ENGINE__.state()), logs, 'phone: ');
    } catch (e) {
      check(false, `riftlight items on a phone crashed: ${e.message}\n    ${phone?.logs.join('\n    ') ?? ''}`);
    } finally {
      await phone?.browser.close();
    }
  }

  /** The presented frame with the HUD, the item windows and the passive tree composited on top. */
  async function composite(page, file) {
    const frame = await capture(page, file);
    const overlays = await page.evaluate(() =>
      ['canvas[data-hud="true"].pixel-hud', 'canvas[data-items-ui]', 'canvas[data-rift-tree="canvas"]']
        .map((sel) => document.querySelector(sel))
        .filter((c) => c && c.width > 0 && c.style.display !== 'none' && c.closest('[style*="display: none"]') === null)
        .map((c) => {
          const r = c.getBoundingClientRect();
          return { w: c.width, h: c.height, left: r.left, top: r.top, cw: r.width, ch: r.height, data: [...c.getContext('2d').getImageData(0, 0, c.width, c.height).data] };
        }),
    );
    const view = await page.evaluate(() => {
      const r = window.__PIXEL_ENGINE__.renderer.renderer.domElement.getBoundingClientRect();
      return { left: r.left, top: r.top, w: r.width, h: r.height };
    });
    const px = frame.pixels;
    for (const o of overlays) {
      for (let y = 0; y < frame.height; y++) {
        for (let x = 0; x < frame.width; x++) {
          // frame pixel → page point → overlay pixel
          const cx = view.left + ((x + 0.5) / frame.width) * view.w;
          const cy = view.top + ((y + 0.5) / frame.height) * view.h;
          const ox = Math.floor(((cx - o.left) / o.cw) * o.w);
          const oy = Math.floor(((cy - o.top) / o.ch) * o.h);
          if (ox < 0 || oy < 0 || ox >= o.w || oy >= o.h) continue;
          const i = (oy * o.w + ox) * 4;
          if (!o.data[i + 3]) continue;
          px.set(o.data.slice(i, i + 3), (y * frame.width + x) * 4);
        }
      }
    }
    await writeFile(new URL(file, OUT), encodePng(frame));
  }
}
