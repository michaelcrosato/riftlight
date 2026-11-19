// API.md for the engine bundle: every export of src/bundle.ts with its signature and its doc
// comment, grouped by subsystem, generated from the TypeScript program (never out of date).
// Used by scripts/bundle.mjs; the program is the one that emits the bundle's .d.ts files.
// Nothing is cut: every signature and type whole (no `... 4 more ...`), every doc as written, its
// code tables and examples too (a member's later paragraphs indented under its bullet).
// src/bundle-api.test.ts holds it to that.
import ts from 'typescript';

/** Sections in reading order: [title, matcher on the declaring file (relative to src/)]. */
const SECTIONS = [
  ['Engine and games', /^(engine\/(Engine|version|lifecycle|LoadingScreen|quality|framing|debugKeys|DebugUI|settings|SettingsPanel)\.ts|bundle\.ts)$/],
  ['Camera', /^engine\/camera\.ts$/],
  ['Rendering, looks and filters', /^engine\/render\/(PixelRenderer|look|lookLayer|filters|webgpuCompat)\.ts$/],
  ['Materials, meshes and lights', /^engine\/(render\/(toon|merge|ContactShadow|lights)|palette)\.ts$/],
  ['Physics', /^engine\/physics\//],
  ['Characters', /^engine\/character\//],
  ['Input and touch', /^engine\/(input|TouchControls)\.ts$/],
  ['Audio', /^engine\/audio\//],
  ['Particles', /^engine\/particles\//],
  ['HUD', /^engine\/hud\//],
  ['Models and textures (ASSETS.md)', /^engine\/(assets\.ts|png\.ts|catalog\.ts|model\/|texture\/)/],
  ['Animation toolkit', /^engine\/animation\//],
  ['Hero kit', /^game\/hero\//],
  ['Inspection tools', /^engine\/inspect\//],
];

/** The libraries the bundle re-exports whole. */
const LIBRARIES = {
  THREE:
    "`three/webgpu` (three.js r186: Mesh, Group, Vector3, BoxGeometry, MeshBasicNodeMaterial, ...). Use `THREE.X` for anything three.js has; never import a second copy of three (two copies break `instanceof` and the renderer).",
  TSL: '`three/tsl` (three.js shading language: `uniform`, `vec3`, `mix`, `Fn`, ...) for node materials and custom filters. All shader code is TSL; there is no GLSL.',
  RAPIER:
    'The Rapier 3D physics module (`@dimforge/rapier3d` 0.20), already initialised by `Engine.start`. Most games only need `ctx.physics`; use `RAPIER.X` for raw shapes, joints and queries on `ctx.physics.world`.',
};

const oneLine = (s) => s.replace(/\s+/g, ' ').trim();
/**
 * A member's doc for its bullet: the first paragraph on the bullet's line, each later one (the
 * rest of a contract, an example) beneath it as written, indented so it stays the member's item.
 */
const memberDoc = (s) => {
  const [first, ...rest] = s.split(/\n[^\S\n]*\n/);
  return [oneLine(first), ...rest.filter((p) => p.trim()).map((p) => p.replace(/\s+$/, '').replace(/^/gm, '  '))].join('\n\n');
};

export function generateApi(program, entryFile, srcDir, { version, build }) {
  const checker = program.getTypeChecker();
  const entry = program.getSourceFile(entryFile);
  const moduleSymbol = checker.getSymbolAtLocation(entry);
  const exports = checker.getExportsOfModule(moduleSymbol).sort((a, b) => a.name.localeCompare(b.name));
  const doc = (sym) => ts.displayPartsToString(sym.getDocumentationComment(checker)).trim();
  const isPublic = (decl) => {
    const flags = ts.getCombinedModifierFlags(decl);
    if (flags & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)) return false;
    const name = decl.name?.getText?.() ?? '';
    return !name.startsWith('_') && !name.startsWith('#');
  };
  // whole types: TypeScript's own `... 4 more ...` would hide what an agent looks a name up for
  const typeString = (type) => checker.typeToString(type, undefined, ts.TypeFormatFlags.NoTruncation);
  const typeText = (node, sym, decl) => (node ? oneLine(node.getText()) : typeString(checker.getTypeOfSymbolAtLocation(sym, decl)));
  // a parameter without its modifiers (`private readonly target: Window = window` → `target: Window = window`)
  const param = (p) =>
    `${p.dotDotDotToken ? '...' : ''}${p.name.getText()}${p.questionToken ? '?' : ''}${p.type ? `: ${oneLine(p.type.getText())}` : ''}${p.initializer ? ` = ${oneLine(p.initializer.getText())}` : ''}`;
  const params = (decl) => decl.parameters.map(param).join(', ');
  /** `@internal` in a doc comment keeps a public member out of the API (state the engine shares with itself). */
  const internal = (sym) => sym.getJsDocTags(checker).some((t) => t.name === 'internal');
  const ret = (decl) => {
    if (decl.type) return oneLine(decl.type.getText());
    const sig = checker.getSignatureFromDeclaration(decl);
    return sig ? typeString(checker.getReturnTypeOfSignature(sig)) : 'void';
  };

  /** Lines for one class / interface member, or null to skip it. */
  function member(m) {
    const decl = m.declarations?.[0];
    if (!decl || !isPublic(decl) || internal(m)) return null;
    const isStatic = ts.getCombinedModifierFlags(decl) & ts.ModifierFlags.Static ? 'static ' : '';
    const ro = ts.getCombinedModifierFlags(decl) & ts.ModifierFlags.Readonly ? 'readonly ' : '';
    const d = memberDoc(doc(m));
    let sig;
    if (ts.isMethodDeclaration(decl) || ts.isMethodSignature(decl)) sig = `${isStatic}${m.name}${decl.questionToken ? '?' : ''}(${params(decl)}): ${ret(decl)}`;
    else if (ts.isGetAccessorDeclaration(decl)) sig = `${isStatic}get ${m.name}: ${ret(decl)}`;
    else if (ts.isSetAccessorDeclaration(decl)) sig = `${isStatic}set ${m.name}(${params(decl)})`;
    else if (ts.isPropertyDeclaration(decl) || ts.isPropertySignature(decl) || ts.isParameter(decl)) {
      const opt = decl.questionToken ? '?' : '';
      // an initialised property without a type annotation: say what it is from the checker
      sig = `${isStatic}${ro}${m.name}${opt}: ${typeText(decl.type, m, decl)}`;
    } else return null;
    return `- \`${sig}\`${d ? `: ${d}` : ''}`;
  }

  function entryFor(sym) {
    const target = sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym;
    const decl = target.declarations?.[0];
    if (!decl) return null;
    const file = decl.getSourceFile().fileName;
    const rel = file.startsWith(srcDir) ? file.slice(srcDir.length + 1) : null;
    const name = sym.name;
    const d = doc(target) || doc(sym);
    // a namespace re-export (THREE, TSL, RAPIER): point at the library's own docs
    if (!rel || ts.isSourceFile(decl) || target.flags & ts.SymbolFlags.ValueModule) {
      const what = LIBRARIES[name] ?? `Namespace re-export of \`${name}\`.`;
      return { section: 'three.js and Rapier', name, text: `### ${name}\n\n${what}\n` };
    }
    const out = [];
    if (ts.isClassDeclaration(decl)) {
      out.push(`### class ${name}`, '');
      if (d) out.push(d, '');
      const ctor = decl.members.find((m) => ts.isConstructorDeclaration(m) && isPublic(m));
      const lines = [];
      if (ctor) lines.push(`- \`new ${name}(${params(ctor)})\``);
      for (const m of [...(target.exports?.values() ?? []), ...(target.members?.values() ?? [])]) {
        if (m.flags & ts.SymbolFlags.Prototype || m.name === '__constructor') continue;
        const l = member(m);
        if (l) lines.push(l);
      }
      out.push(...lines);
    } else if (ts.isInterfaceDeclaration(decl)) {
      out.push(`### interface ${name}`, '');
      if (d) out.push(d, '');
      for (const m of target.members?.values() ?? []) {
        const l = member(m);
        if (l) out.push(l);
      }
    } else if (ts.isTypeAliasDeclaration(decl)) {
      out.push(`### type ${name}`, '', '```ts', `type ${name} = ${oneLine(decl.type.getText())}`, '```');
      if (d) out.push('', d);
    } else if (ts.isFunctionDeclaration(decl)) {
      const sigs = (target.declarations ?? []).filter(ts.isFunctionDeclaration).filter((f) => !f.body || (target.declarations ?? []).length === 1);
      out.push(`### ${name}()`, '', '```ts', ...sigs.map((f) => `function ${name}(${params(f)}): ${ret(f)}`), '```');
      if (d) out.push('', d);
    } else if (ts.isVariableDeclaration(decl)) {
      const t = decl.type ? oneLine(decl.type.getText()) : typeString(checker.getTypeOfSymbolAtLocation(target, decl));
      out.push(`### ${name}`, '', '```ts', `const ${name}: ${t}`, '```');
      if (d) out.push('', d);
    } else {
      out.push(`### ${name}`, '');
      if (d) out.push(d);
    }
    const section = SECTIONS.find(([, re]) => re.test(rel))?.[0] ?? 'More';
    return { section, name, rel, text: `${out.join('\n')}\n` };
  }

  const entries = exports.filter((s) => !internal(s.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(s) : s)).map(entryFor).filter(Boolean);
  const order = [...SECTIONS.map(([t]) => t), 'three.js and Rapier', 'More'];
  const bySection = new Map(order.map((t) => [t, []]));
  for (const e of entries) bySection.get(e.section).push(e);
  const used = order.filter((t) => bySection.get(t).length);
  const lines = [
    `# Pixel Engine API (v${version})`,
    '',
    `Every export of \`pixel-engine.js\` (${entries.length} names), generated from the engine's TypeScript at build ${build}. ` +
      'Signatures are the source declarations; descriptions are their doc comments. Read GUIDE.md first: it says how the ' +
      'pieces fit; come here for exact names and parameters (search this file, don\'t read it whole).',
    '',
    '## Sections',
    '',
    ...used.map((t, i) => `${i + 1}. ${t}: ${bySection.get(t).map((e) => `\`${e.name}\``).join(', ')}`),
    '',
  ];
  used.forEach((t, i) => {
    lines.push(`## ${i + 1}. ${t}`, '');
    for (const e of bySection.get(t)) lines.push(e.text);
  });
  return { markdown: lines.join('\n'), names: entries.map((e) => e.name) };
}
