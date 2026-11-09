#!/usr/bin/env node
/*!
 * AI Hub Catalogue v1: the checker.
 * https://raw.githubusercontent.com/michaelcrosato/ai-hub/main/lib/hub/catalogue.md
 *
 *   node catalogue-check.mjs PACKAGE      every game in PACKAGE/games, with its screenshots
 *   node catalogue-check.mjs GAME.html    one game page, without screenshots
 *   node catalogue-check.mjs FOLDER       one game folder (its index.html), without screenshots
 *
 *   --offline        don't compare the games with the ones already on the wall
 *   --library FILE   compare them with this games.json instead of the wall's
 *   --json           print one JSON report instead of the list
 *
 * Exits with 0 when every game passes and 1 when any fails. Node 18 or later,
 * nothing to install. The AI Hub's importer and tests use the same functions,
 * so a game that passes here passes there.
 */

import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const VERSION = 1;
/** The wall's catalogue: every game on it, with the fields this page names. */
export const LIBRARY_URL = 'https://crosato-arcade.michael-crosato.workers.dev/data/games.json';

const MiB = 1024 * 1024;

export const TYPES = ['Game', 'Tech demo', 'Tool'];
export const GAME_GENRES = ['Action', 'Adventure', 'Fighting', 'Flight', 'Horror', 'Kids & Learning', 'Life Sim', 'Platformer', 'Puzzle', 'Racing', 'RPG', 'Shooter', 'Simulation', 'Sports', 'Stealth', 'Strategy'];
/** The genres of a tech demo or a tool. */
export const DEMO_GENRES = ['Graphics', 'Tech Demo'];
export const TAGS = [
  '2.5d', '2d', '3d', 'action-rpg', 'arcade', 'boss fights', 'co-op', 'combat', 'comedy', 'cozy', 'crime',
  'demolition', 'dungeon crawler', 'educational', 'exploration', 'fantasy', 'first-person', 'gamepad', 'isometric',
  'loot', 'low-poly', 'military', 'music', 'open world', 'party', 'physics', 'pixel art', 'procedural', 'race',
  'rail-shooter', 'retro', 'sandbox', 'sci-fi', 'side-scrolling', 'space', 'stealth', 'story', 'third-person',
  'top-down', 'touch', 'turn-based', 'tycoon', 'vehicles', 'versus',
];
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
export const MODES = ['parallel', 'ghost', 'shared-world'];
/** AI Hub Languages v1, *Languages*: both sets. */
export const LANGUAGES = ['en', 'zh-Hans', 'hi', 'es-419', 'ar', 'fr', 'bn', 'pt-BR', 'ru', 'id', 'ja', 'de', 'ko', 'zh-Hant', 'ur', 'tr', 'vi', 'sw', 'ha', 'am', 'yo'];

export const LIMITS = Object.freeze({
  name: 40, tagline: 60, description: 200, controls: 160, source: 60, series: 60, model: 40, harness: 40,
  sessionGoal: 60, sessionHowto: 80, icon: 32 * 1024, charset: 1024,
  page: 25 * MiB, folder: 95 * MiB, folderFiles: 100,
});
export const STRIP = Object.freeze({ frames: ['0.jpg', '1.jpg', '2.jpg'], width: 640, height: 480, quality: 58, small: 6000 });

/** The hub:* tags a game may carry: this page's, then the session protocol's. Any other becomes a stray field on the wall. */
export const CATALOGUE_TAGS = ['hub:catalogue', 'hub:type', 'hub:genre', 'hub:tags', 'hub:controls', 'hub:model', 'hub:effort', 'hub:harness', 'hub:session', 'hub:source', 'hub:series', 'hub:players', 'hub:webgpu', 'hub:name', 'hub:tagline'];
export const SESSION_TAGS = ['hub:session-players', 'hub:session-mode', 'hub:session-goal', 'hub:session-howto', 'hub:session-minutes'];

/* --- text ------------------------------------------------------------------ */

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', middot: '·', bull: '•', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', copy: '©', reg: '®', trade: '™' };
export const decode = (s) =>
  String(s ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (whole, ref) => {
    if (ref[0] !== '#') return ENTITIES[ref.toLowerCase()] ?? whole;
    const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
    return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
const squish = (s) => decode(s).replace(/\s+/g, ' ').trim();
const quoted = (s) => `"${s}"`;
const list = (items) => items.join(', ');
const lineAt = (text, index) => text.slice(0, index).split('\n').length;

/** The hub's slug for a name: accents dropped, lowercase, every run of other characters one hyphen, none at the ends. */
export function slugify(input) {
  return String(input ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const WHOLE_VERSION = /^[vV]?(\d+(?:\.\d+)*)$/;
const TRAILING_VERSION = /^(.+?)[-_. ]+(?:[vV](\d+(?:\.\d+)*)|(\d+\.\d+(?:\.\d+)*))$/;
/** `void-explorer-v0.5` is build 0.5 of void-explorer; a bare trailing number is not a version. */
export function parseVersion(name) {
  const text = String(name ?? '').trim();
  const whole = text.match(WHOLE_VERSION);
  if (whole) return { base: '', version: whole[1] };
  const trailing = text.match(TRAILING_VERSION);
  if (trailing) return { base: trailing[1], version: trailing[2] ?? trailing[3] };
  return { base: text, version: null };
}

// The library's older naming, Source-Title-YYYY-MM-DD-model: the date and model stay out of the slug.
const STAMP = /^(.+)-(\d{4})-(\d{2})-(\d{2})-([A-Za-z].*)$/;
function stampBase(name) {
  const m = String(name ?? '').match(STAMP);
  return m && +m[3] >= 1 && +m[3] <= 12 && +m[4] >= 1 && +m[4] <= 31 ? m[1] : String(name ?? '');
}

/** The slug the wall gives games/NAME.html or games/NAME/index.html, and the build its name says it is. */
export function slugOf(name) {
  const base = stampBase(name);
  const { base: family, version } = parseVersion(base);
  return { slug: slugify(family || base), version };
}

const TITLE_SEP = /\s*[—–]\s*|\s+[·•|]\s+|\s*:\s+|\s+[-‒]\s+|\s+\/\s+/;
/** How the wall splits a <title> into the game's name and the line under it: at the first separator. */
export function splitTitle(title) {
  const full = squish(title);
  if (!full) return { name: '', tagline: '' };
  const at = full.search(TITLE_SEP);
  if (at < 0) return { name: full, tagline: '' };
  const name = full.slice(0, at).trim();
  const tagline = full.slice(at + full.slice(at).match(TITLE_SEP)[0].length).trim();
  if (name.length < 2 || !tagline) return { name: full, tagline: '' };
  return { name, tagline };
}
const separators = (title) => (squish(title).match(new RegExp(TITLE_SEP.source, 'g')) || []).length;

/** Words that are no value: a field that would hold one is left out instead. */
const NO_VALUE = /^(unknown|none|n\/?a|null|original|-|—|tbd)$/i;
/** An id as an API writes it (claude-opus-5-5), rather than the model's name. */
const API_ID = /^[a-z0-9.]+(?:-[a-z0-9.]+)+$/;

/* --- controls: what the Couch draws as keycaps (assets/js/couch/howto.js) -- */

const KEY_WORDS = new Set(['wasd', 'arrows', 'space', 'spacebar', 'shift', 'enter', 'return', 'esc', 'escape', 'tab', 'ctrl', 'alt', 'backspace', 'mouse', 'click', 'drag', 'scroll', 'wheel', 'pointer', 'tap', 'swipe', 'touch', 'joystick', 'gamepad', 'gamepads', 'up', 'down', 'left', 'right']);
const KEY_PHRASES = [/^(left|right) shift$/i, /^right mouse$/i, /^mouse wheel$/i, /^right click$/i, /^left click$/i, /^arrow keys$/i, /^number keys$/i, /^movement pad$/i, /^point and click$/i];
const TOKENS = /[A-Za-z0-9–'!.-]+|[/+−,]/g;

function keyAt(words, i, first) {
  const word = words[i];
  if (!word) return false;
  for (const n of [3, 2]) {
    const run = words.slice(i, i + n);
    if (run.length === n && KEY_PHRASES.some((p) => p.test(run.join(' ')))) return true;
  }
  if (KEY_WORDS.has(word.toLowerCase())) return true;
  if (/^(shift|ctrl|alt|right)-(click|drag)$/i.test(word)) return true;
  if (/^[A-Z]$/.test(word) || /^F\d{1,2}$/.test(word)) return true;
  if (/^\d+(?:[–-]\d+)?$/.test(word)) return true;
  return word === '+' || word === '−' || (first && word === '/');
}

/** Whether a control opens with keys the Couch draws as keycaps ("WASD or arrows to move" does; "Move with WASD" doesn't). */
export function opensWithKeys(control) {
  const words = String(control ?? '').trim().replace(/^or\s+/i, '').match(TOKENS) || [];
  if (/^(hold|the|keys)$/i.test(words[0] ?? '') && keyAt(words, 1, false)) return true;
  return keyAt(words, 0, true);
}

/* --- reading a page -------------------------------------------------------- */

function attrsOf(source) {
  const out = {};
  for (const m of String(source).matchAll(/([^\s"'>/=]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
    const key = m[1].toLowerCase();
    if (!(key in out)) out[key] = decode(m[3] ?? m[4] ?? m[5] ?? '');
  }
  return out;
}

const blank = (s) => s.replace(/[^\n]/g, ' ');

/**
 * A page as a browser splits it: its scripts and styles (bodies kept), and the
 * tags of its head with every script body, style body and comment blanked
 * out, so text inside them can't pass for a tag. Offsets are the page's own.
 */
export function readPage(html) {
  const text = String(html ?? '');
  const scripts = [];
  const styles = [];
  let masked = '';
  let at = 0;
  const open = /<!--|<(script|style)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;
  for (let m; (m = open.exec(text)); ) {
    if (m[0] === '<!--') {
      const close = text.indexOf('-->', m.index + 4);
      const stop = close === -1 ? text.length : close + 3;
      masked += text.slice(at, m.index) + blank(text.slice(m.index, stop));
      at = open.lastIndex = stop;
      continue;
    }
    const kind = m[1].toLowerCase();
    const bodyStart = m.index + m[0].length;
    const close = new RegExp(`</${kind}[\\s/>]`, 'gi');
    close.lastIndex = bodyStart;
    const c = close.exec(text);
    const bodyEnd = c ? c.index : text.length;
    const gt = c ? text.indexOf('>', c.index) : -1;
    const element = { start: m.index, bodyStart, bodyEnd, end: gt === -1 ? text.length : gt + 1, attrs: attrsOf(m[2]), body: text.slice(bodyStart, bodyEnd) };
    (kind === 'script' ? scripts : styles).push(element);
    masked += text.slice(at, bodyStart) + blank(text.slice(bodyStart, bodyEnd));
    at = open.lastIndex = bodyEnd;
  }
  masked += text.slice(at);

  let headEnd = masked.search(/<\/head\s*>/i);
  if (headEnd === -1) headEnd = masked.search(/<body[\s>]/i);
  const hasHead = headEnd !== -1;
  if (!hasHead) headEnd = masked.length;

  let lang = null;
  let charset = null;
  let title = null;
  const metas = [];
  const links = [];
  const tag = /<(html|meta|title|link)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;
  for (let m; (m = tag.exec(masked)) && m.index < headEnd; ) {
    const kind = m[1].toLowerCase();
    const attrs = attrsOf(m[2]);
    if (kind === 'html') lang ??= attrs.lang?.trim() || null;
    else if (kind === 'title') {
      if (title) continue;
      const end = text.slice(tag.lastIndex).search(/<\/title\s*>/i);
      title = { at: m.index, text: squish(end === -1 ? '' : text.slice(tag.lastIndex, tag.lastIndex + end)) };
    } else if (kind === 'link') links.push({ at: m.index, rel: (attrs.rel || '').toLowerCase(), href: (attrs.href || '').trim() });
    else if ('charset' in attrs && !charset) charset = { at: m.index, end: tag.lastIndex, value: attrs.charset.trim().toLowerCase() };
    else {
      const name = (attrs.name || attrs.property || '').trim().toLowerCase();
      if (name && attrs.content !== undefined) metas.push({ at: m.index, name, content: squish(attrs.content) });
    }
  }
  const inHead = (element) => element.start < headEnd;
  return { text, masked, hasHead, headEnd, scripts, styles, headScripts: scripts.filter(inHead), headStyles: styles.filter(inHead), lang, charset, title, metas, links };
}

/** The session client (lib/hub/session.js), when the page's first script is it. */
export function sessionClient(page) {
  const first = page.scripts[0];
  if (!first || first.attrs.src !== undefined) return null;
  const banner = first.body.match(/^\s*\/\*! aihub-session (\S+)/);
  return banner ? { ...first, version: banner[1] } : null;
}

const JS_TYPES = /^(|module|text\/javascript|application\/javascript|text\/ecmascript|application\/ecmascript)$/i;

/** Null when the code parses, a message when it can't, undefined when this Node can't tell (a module without --experimental-vm-modules). */
export function parseError({ code, module }) {
  try {
    if (module) {
      if (!vm.SourceTextModule) return undefined;
      new vm.SourceTextModule(code);
    } else new vm.Script(code);
    return null;
  } catch (error) {
    if (error instanceof SyntaxError) return error.message;
    throw error;
  }
}

/* --- the page's code: what it reaches, and what it would break ------------- */

/**
 * The one thing a game may load from another site: three.js and Rapier from a
 * CDN, at a version the hub keeps on its shelf (lib/vendor/manifest.json, from
 * its minimum up). The import serves those from the hub's own copies, so
 * every game shares one. scripts/catalogue-check.test.mjs holds this to the
 * shelf and to the importer (scripts/lib/libraries.mjs).
 */
export const SHELF = Object.freeze({
  hosts: ['cdn.jsdelivr.net', 'unpkg.com', 'esm.sh', 'cdn.skypack.dev', 'ga.jspm.io', 'cdnjs.cloudflare.com'],
  three: ['0.180.0', '0.181.0', '0.181.1', '0.181.2', '0.182.0', '0.183.0', '0.183.1', '0.183.2', '0.184.0', '0.185.0', '0.185.1', '0.186.0', '0.186.1'],
  rapier: ['0.19.3', '0.20.0', '0.21.0'],
});
const SHELF_PACKAGE = /^(three|@dimforge\/rapier(?:2d|3d)(?:-(?:simd|deterministic))?(?:-compat)?)@([^/]+)(?:\/|$)/;

/** Whether the hub's import serves this URL from its own shelf. */
export function onShelf(reference) {
  let url;
  let value;
  try {
    url = new URL(reference.startsWith('//') ? `https:${reference}` : reference);
    value = decodeURIComponent(url.pathname).replace(/^\//, '');
  } catch {
    return false;
  }
  if (!SHELF.hosts.includes(url.hostname)) return false;
  if (url.hostname === 'cdnjs.cloudflare.com') return SHELF.three.includes(/^ajax\/libs\/three\.js\/([^/]+)\//.exec(value)?.[1]);
  if (url.hostname === 'cdn.jsdelivr.net') {
    const github = /^gh\/mrdoob\/three\.js@([^/]+)\//.exec(value);
    if (github) return SHELF.three.includes(github[1]);
    if (!value.startsWith('npm/')) return false;
    value = value.slice(4);
  } else if (url.hostname === 'esm.sh') value = value.replace(/^v\d+\//, '');
  else if (url.hostname === 'ga.jspm.io') value = value.replace(/^npm:/, '');
  const m = SHELF_PACKAGE.exec(value);
  return Boolean(m) && (m[1] === 'three' ? SHELF.three : SHELF.rapier).includes(m[2]);
}

const URL_AT = String.raw`((?:https?:)?\/\/[^"'\s>)\`]+)`;
const NETWORK = [
  [new RegExp(String.raw`<script\b[^>]*\bsrc\s*=\s*["']?${URL_AT}`, 'i'), 'loads a script from another site'],
  [new RegExp(String.raw`<link\b(?=[^>]*\brel\s*=\s*["']?[^"'>]*\b(?:stylesheet|preload|modulepreload|prefetch|icon|manifest)\b)[^>]*\bhref\s*=\s*["']?${URL_AT}`, 'i'), 'links a style, font or file from another site'],
  [new RegExp(String.raw`<(?:img|audio|video|source|track|iframe|embed|object)\b[^>]*\b(?:src|data|poster)\s*=\s*["']?${URL_AT}`, 'i'), 'shows an image, sound or page from another site'],
  [new RegExp(String.raw`\bimport\s*(?:[\w$*{}\s,]+?\s*from\s*)?["']${URL_AT}`), 'imports code from another site'],
  [new RegExp(String.raw`\bimport\s*\(\s*["'\`]${URL_AT}`), 'imports code from another site'],
  [new RegExp(String.raw`\bimportScripts\s*\(\s*["'\`]${URL_AT}`), 'loads a worker script from another site'],
  [new RegExp(String.raw`\bfetch\s*\(\s*["'\`]${URL_AT}`), 'fetches from another site'],
  [new RegExp(String.raw`\.open\s*\(\s*["'\`][A-Za-z]+["'\`]\s*,\s*["'\`]${URL_AT}`), 'requests from another site'],
  [new RegExp(String.raw`\burl\(\s*["']?${URL_AT}`, 'i'), 'a style loads a font or image from another site'],
  [new RegExp(String.raw`@import\s+(?:url\(\s*)?["']?${URL_AT}`, 'i'), 'a style imports from another site'],
  [/\bnew\s+(?:WebSocket|EventSource)\s*\(/, 'opens a connection to a server'],
  [/\bnavigator\.sendBeacon\s*\(/, 'sends data to a server'],
  [/\bnew\s+(?:window\.)?RTCPeerConnection\s*\(/, 'opens a peer-to-peer connection of its own'],
];
const SHELF_NOTE = 'only three.js and Rapier may come from a CDN, at a version the hub keeps';
const SHARED = [
  ['warning', /\b(?:localStorage|sessionStorage)\s*\.\s*clear\s*\(/, 'clears the storage the hub and every game share: on a page of its own that signs the player out of the hub (remove the game\'s own keys)'],
  ['error', /["'`]ai-hub:/, 'uses the hub\'s own storage keys (ai-hub:…)'],
  ['error', /\b(?:window\.|self\.)?(?:top|parent)\.location\s*(?:=(?!=)|\.(?:href\s*=(?!=)|replace\s*\(|assign\s*\())/, 'navigates the hub\'s page'],
  ['warning', /\bwindow\.open\s*\(/, 'opens a window or tab, which leaves the hub and isn\'t allowed in a session'],
  ['warning', /(?:\bwindow\.|(?<![.\w$]))(?:alert|confirm|prompt)\s*\(\s*["'`]/, 'shows a browser dialog, which isn\'t allowed in a session'],
];

/** The line a match sits on, and whether that line is a comment (a finding there is only worth a look). Matches of three.js or Rapier on the shelf are left out. */
function findings(text, pattern, skip) {
  const out = [];
  const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
  for (let m; (m = re.exec(text)) && out.length < 3; ) {
    if (m[0] === '') re.lastIndex++;
    if (skip.some(([a, b]) => m.index >= a && m.index < b)) continue;
    if (m[1] && onShelf(m[1])) continue;
    const from = text.lastIndexOf('\n', m.index) + 1;
    const to = text.indexOf('\n', m.index);
    const line = text.slice(from, to === -1 ? text.length : to).trim();
    out.push({ line: lineAt(text, m.index), comment: /^(\/\/|\/?\*|<!--)/.test(line), excerpt: line.slice(0, 100), url: m[1] });
  }
  return out;
}

/** What a page or a game's script or style reaches beyond its own files, and what it does to the hub. `skip` are [from, to) offsets left out. */
export function codeProblems(text, where, skip = []) {
  const problems = [];
  const seen = new Set();
  const report = (level, message, hits) => {
    for (const hit of hits) {
      // One line, one finding: an @import url(…) is both an import and a url().
      if (seen.has(hit.line)) continue;
      seen.add(hit.line);
      const quiet = hit.comment && level === 'error';
      problems.push({ level: quiet ? 'warning' : level, text: `${where}:${hit.line} ${message}${quiet ? ' (in a comment?)' : ''}${hit.url ? ` (${SHELF_NOTE})` : ''}: ${hit.excerpt}` });
    }
  };
  for (const [pattern, message] of NETWORK) report('error', message, findings(text, pattern, skip));
  for (const [level, pattern, message] of SHARED) report(level, message, findings(text, pattern, skip));
  return problems;
}

/** The URLs an import map sends a game to on other sites, beyond the shelf. */
export function importMapProblems(json, where) {
  let map;
  try {
    map = JSON.parse(json);
  } catch (e) {
    return [{ level: 'error', text: `${where}: the import map is not valid JSON (${e.message})` }];
  }
  const targets = [...Object.values(map?.imports ?? {}), ...Object.values(map?.scopes ?? {}).flatMap((scope) => Object.values(scope ?? {}))];
  return targets
    .filter((url) => typeof url === 'string' && /^(?:https?:)?\/\//i.test(url) && !onShelf(url))
    .slice(0, 5)
    .map((url) => ({ level: 'error', text: `${where}: the import map loads ${url} from another site (${SHELF_NOTE})` }));
}

/* --- the line list (AI Hub Languages v1) ----------------------------------- */

const LINE_ID = /^[a-z0-9_]+(\.[a-z0-9_]+)*$/;
const PLURAL_FORMS = ['zero', 'one', 'two', 'few', 'many', 'other'];

function blockOf(page, id) {
  const found = page.scripts.filter((s) => s.attrs.id === id);
  return found.length ? found : null;
}

/** Problems with a game-lines block's text. Returns { problems, block } with the parsed block when it parses. */
export function linesProblems(raw, { lang } = {}) {
  const problems = [];
  const error = (text) => problems.push({ level: 'error', text: `game-lines: ${text}` });
  if (raw.includes('<')) error('write every < as \\u003c, so no line can end the block early');
  let block;
  try {
    block = JSON.parse(raw);
  } catch (e) {
    error(`not valid JSON (${e.message})`);
    return { problems, block: null };
  }
  if (!block || typeof block !== 'object' || Array.isArray(block)) {
    error('not a JSON object');
    return { problems, block: null };
  }
  if (block.version !== 1) error('"version" is 1');
  if (!LANGUAGES.includes(block.language)) error(`"language" is one of the codes: ${list(LANGUAGES)}`);
  else if (lang && lang.toLowerCase() !== block.language.toLowerCase()) problems.push({ level: 'warning', text: `game-lines: "language" is ${block.language} and <html lang> is ${lang}` });
  const lines = block.lines;
  if (!lines || typeof lines !== 'object' || Array.isArray(lines) || !Object.keys(lines).length) {
    error('"lines" holds the words players read, each under its id');
    return { problems, block };
  }
  const bad = [];
  for (const [id, line] of Object.entries(lines)) {
    if (!LINE_ID.test(id)) bad.push(`${id}: not a valid id (lowercase words joined by dots)`);
    const texts = typeof line === 'string' ? [line] : line && typeof line === 'object' && !Array.isArray(line) ? Object.values(line) : null;
    if (!texts) {
      bad.push(`${id}: a line is text, or plural forms of text`);
      continue;
    }
    if (typeof line === 'string' && !line.trim()) bad.push(`${id}: empty`);
    if (typeof line === 'object') {
      const forms = Object.keys(line);
      if (forms.some((f) => !PLURAL_FORMS.includes(f))) bad.push(`${id}: plural forms are ${list(PLURAL_FORMS)}`);
      if (!line.other || (block.language === 'en' && !line.one)) bad.push(`${id}: plural forms need ${block.language === 'en' ? 'one and other' : 'other'}`);
      if (texts.some((s) => typeof s !== 'string')) bad.push(`${id}: a plural form isn't text`);
    }
    for (const s of texts) {
      if (typeof s !== 'string') continue;
      if (s.split('{').length !== s.split('}').length) bad.push(`${id}: unbalanced { }`);
      if (/<[a-z/!]/i.test(s)) bad.push(`${id}: a line is plain text, without HTML`);
    }
  }
  for (const key of ['notes', 'max']) {
    const value = block[key];
    if (value === undefined) continue;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      bad.push(`"${key}" is an object, by line id`);
      continue;
    }
    for (const [id, v] of Object.entries(value)) {
      if (!(id in lines)) bad.push(`${key}.${id}: no such line`);
      if (key === 'max' && !(Number.isInteger(v) && v > 0)) bad.push(`max.${id}: a width in letters`);
      if (key === 'notes' && typeof v !== 'string') bad.push(`notes.${id}: a note is text`);
    }
  }
  for (const text of bad.slice(0, 8)) error(text);
  if (bad.length > 8) error(`… and ${bad.length - 8} more like these`);
  if (!Array.isArray(block.names) || block.names.some((n) => typeof n !== 'string')) error('"names" is the list of proper names, as written (an empty list when there are none)');
  if (typeof block.brief !== 'string' || !block.brief.trim()) error('"brief" is the translator\'s brief');
  if (block.wordPlay !== undefined && typeof block.wordPlay !== 'boolean') error('"wordPlay" is true or false');
  return { problems, block };
}

function translationsProblems(raw, source) {
  const problems = [];
  const error = (text) => problems.push({ level: 'error', text: `game-translations: ${text}` });
  if (raw.includes('<')) error('write every < as \\u003c');
  let block;
  try {
    block = JSON.parse(raw);
  } catch (e) {
    error(`not valid JSON (${e.message})`);
    return problems;
  }
  if (!block || typeof block !== 'object' || Array.isArray(block)) return (error('an object, one entry per language code'), problems);
  for (const [code, entry] of Object.entries(block)) {
    if (!LANGUAGES.includes(code)) error(`${code} is not one of the codes: ${list(LANGUAGES)}`);
    else if (code === source?.language) error(`${code} is the game's own language`);
    if (!entry || typeof entry !== 'object') error(`${code}: an entry has "by" and "lines"`);
    else if (typeof entry.by !== 'string' || !entry.lines || typeof entry.lines !== 'object') error(`${code}: an entry has "by" and "lines"`);
  }
  return problems;
}

/* --- one page -------------------------------------------------------------- */

/**
 * Everything this page asks of a game's page, and the catalogue fields it
 * gives the wall. `folder` is set for a game in a folder: { files: Set of its
 * paths }, so its icon may be a file. `parse` parses inline scripts.
 * Returns { fields, problems, checks }.
 */
export function checkPage(html, { folder = null, parse = true, where = 'the page' } = {}) {
  const page = readPage(html);
  const problems = [];
  let checks = 0;
  const error = (text) => problems.push({ level: 'error', text });
  const warning = (text) => problems.push({ level: 'warning', text });
  const check = (ok, fail) => {
    checks++;
    if (!ok) fail();
    return ok;
  };

  if (!check(page.hasHead, () => error('no </head>: the tags below go in the page\'s <head>'))) return { fields: {}, problems, checks };

  const tags = new Map();
  for (const meta of page.metas) {
    if (!tags.has(meta.name)) tags.set(meta.name, []);
    tags.get(meta.name).push(meta);
  }
  const one = (name) => tags.get(name)?.[0]?.content ?? '';
  for (const [name, found] of tags) if (found.length > 1 && (name.startsWith('hub:') || ['description', 'theme-color', 'viewport'].includes(name))) error(`${name} is given ${found.length} times: give it once`);

  // Before anything else in the head: the scan reads the first 512 KB and takes the first of each tag.
  const client = sessionClient(page);
  check(page.lang, () => error('<html> has no lang: give the game\'s own language code, as in its game-lines block'));
  if (check(page.charset, () => error('no <meta charset="utf-8">'))) {
    check(page.charset.value === 'utf-8', () => error(`<meta charset> is ${page.charset.value}: use utf-8`));
    check(Buffer.byteLength(page.text.slice(0, page.charset.end)) <= LIMITS.charset, () => error('<meta charset> sits in the first 1,024 bytes of the page'));
  }
  const firstOther = [...page.headScripts.filter((s) => s.start !== client?.start), ...page.headStyles].sort((a, b) => a.start - b.start)[0];
  if (firstOther) {
    const late = [];
    if (page.title && page.title.at > firstOther.start) late.push('<title>');
    for (const meta of page.metas) if (meta.at > firstOther.start && (meta.name.startsWith('hub:') || ['description', 'theme-color', 'viewport'].includes(meta.name))) late.push(meta.name);
    for (const link of page.links) if (/\bicon\b/.test(link.rel) && link.at > firstOther.start) late.push('the icon');
    check(!late.length, () => error(`${list([...new Set(late)])} come${late.length === 1 ? 's' : ''} after a script or style: put the catalogue's tags first in <head>, after <meta charset> and the session client`));
  }

  // The tags this page defines, and only those.
  for (const name of tags.keys()) {
    if (!name.startsWith('hub:')) continue;
    check(CATALOGUE_TAGS.includes(name) || SESSION_TAGS.includes(name), () => error(`${name} is not a tag of this page or the session protocol: every hub:* tag becomes a field on the wall, so leave it out`));
  }
  check(one('hub:catalogue') === String(VERSION), () => error(tags.has('hub:catalogue') ? `hub:catalogue is ${quoted(one('hub:catalogue'))}: it is 1` : 'no <meta name="hub:catalogue" content="1">'));

  const viewport = one('viewport');
  check(/\bwidth\s*=\s*device-width\b/i.test(viewport), () => error('no <meta name="viewport" content="width=device-width, initial-scale=1">'));

  // Name and tagline: the title, split at its first separator, unless hub:name says otherwise.
  const titleText = page.title?.text ?? '';
  let { name, tagline } = splitTitle(titleText);
  check(titleText, () => error('no <title>: NAME — TAGLINE, or just NAME'));
  if (tags.has('hub:name')) {
    name = one('hub:name');
    tagline = tags.has('hub:tagline') ? one('hub:tagline') : tagline;
  } else if (tags.has('hub:tagline')) warning('hub:tagline only counts beside hub:name');
  if (titleText && !tags.has('hub:name') && separators(titleText) > 1) warning(`the title holds more than one separator: the wall reads the name as ${quoted(name)} and the tagline as ${quoted(tagline)}. If the name holds one, add hub:name and hub:tagline`);
  if (titleText) {
    check(name, () => error('the name is empty'));
    check(name.length <= LIMITS.name, () => error(`the name is ${name.length} characters: at most ${LIMITS.name}`));
    check(tagline.length <= LIMITS.tagline, () => error(`the tagline is ${tagline.length} characters: at most ${LIMITS.tagline}`));
  }

  const description = one('description');
  if (check(description, () => error('no <meta name="description">: one or two plain sentences'))) {
    check(description.length <= LIMITS.description, () => error(`the description is ${description.length} characters: at most ${LIMITS.description}`));
    check(!/<[a-z/!]/i.test(description), () => error('the description is plain text, without HTML'));
  }

  const theme = one('theme-color');
  check(/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(theme), () => error(theme ? `theme-color is ${quoted(theme)}: a colour as #RRGGBB` : 'no <meta name="theme-color" content="#RRGGBB">'));

  const icon = page.links.find((link) => /\bicon\b/.test(link.rel));
  if (check(icon?.href, () => error('no <link rel="icon">: a data: URI, or in a folder game a file beside the page'))) {
    if (icon.href.startsWith('data:')) {
      check(/^data:image\//i.test(icon.href), () => error('the icon is an image: data:image/…'));
      check(icon.href.length <= LIMITS.icon, () => error(`the icon is ${Math.round(icon.href.length / 1024)} KB: at most 32 KB`));
    } else if (!folder) error('a game in one file gives its icon as a data: URI');
    else {
      const file = safeJoin(icon.href);
      check(file && folder.files.has(file), () => error(`the icon ${icon.href} is not a file in the game's folder`));
    }
  }

  // The catalogue's fields.
  const type = one('hub:type');
  check(TYPES.includes(type), () => error(type ? `hub:type is ${quoted(type)}: one of ${list(TYPES)}` : `no hub:type: one of ${list(TYPES)}`));
  const genre = one('hub:genre');
  const genres = type === 'Game' || !TYPES.includes(type) ? GAME_GENRES : DEMO_GENRES;
  check(genres.includes(genre), () => error(genre ? `hub:genre is ${quoted(genre)}: for ${type === 'Game' || !type ? 'a game' : 'a tech demo or tool'}, one of ${list(genres)}` : `no hub:genre: one of ${list(genres)}`));

  const tagList = tags.has('hub:tags') ? one('hub:tags').split(',').map((t) => t.trim()).filter(Boolean) : [];
  if (check(tags.has('hub:tags'), () => error('no hub:tags: 2 to 5 tags from the list, comma-separated'))) {
    const unknown = tagList.filter((t) => !TAGS.includes(t));
    check(!unknown.length, () => error(`hub:tags has ${list(unknown.map(quoted))}, not in the list${unknown.map(near).filter(Boolean).map((s) => ` (${s})`).join('')}`));
    check(new Set(tagList).size === tagList.length, () => error('hub:tags names a tag twice'));
    check(tagList.length >= 2 && tagList.length <= 5, () => error(`hub:tags has ${tagList.length}: 2 to 5`));
  }

  const controls = one('hub:controls');
  if (check(controls, () => error('no hub:controls: the controls, KEYS to ACTION, separated by ;'))) {
    check(controls.length <= LIMITS.controls, () => error(`hub:controls is ${controls.length} characters: at most ${LIMITS.controls}`));
    check(!/<[a-z/!]/i.test(controls), () => error('hub:controls is plain text, without HTML'));
    const plain = controls.split(';').map((c) => c.trim()).filter(Boolean).filter((c) => !opensWithKeys(c.split(',')[0]));
    if (plain.length) warning(`the Couch shows ${list(plain.slice(0, 3).map(quoted))} as words, not keycaps: start each control with its keys`);
  }

  const model = one('hub:model');
  if (check(model && !NO_VALUE.test(model), () => error('no hub:model: the model that wrote the game, as its maker names it'))) {
    check(!API_ID.test(model), () => error(`hub:model is ${quoted(model)}: write the model's name as its maker does, not its API id`));
    check(model.length <= LIMITS.model, () => error(`hub:model is ${model.length} characters: at most ${LIMITS.model}`));
  }
  const effort = one('hub:effort');
  if (tags.has('hub:effort')) check(EFFORTS.includes(effort), () => error(`hub:effort is ${quoted(effort)}: one of ${list(EFFORTS)}`));
  else warning(`no hub:effort: leave it out only when the model ran with no effort setting among ${list(EFFORTS)}`);
  const harness = one('hub:harness');
  if (tags.has('hub:harness')) check(harness && !NO_VALUE.test(harness) && harness.length <= LIMITS.harness, () => error(`hub:harness is ${quoted(harness)}: the agent tool's product name, at most ${LIMITS.harness} characters`));
  else warning('no hub:harness: the agent tool that ran the model');

  const source = one('hub:source');
  if (tags.has('hub:source')) {
    check(source && !NO_VALUE.test(source), () => error(`hub:source is ${quoted(source)}: leave it out for an original game`));
    check(source.length <= LIMITS.source, () => error(`hub:source is ${source.length} characters: at most ${LIMITS.source}`));
  }
  const series = one('hub:series');
  if (tags.has('hub:series')) {
    check(tags.has('hub:source'), () => error('hub:series goes with hub:source'));
    check(series && series.toLowerCase() !== source.toLowerCase(), () => error('leave hub:series out when the series is the source itself'));
    check(series.length <= LIMITS.series, () => error(`hub:series is ${series.length} characters: at most ${LIMITS.series}`));
  }

  const playersText = one('hub:players');
  let players = null;
  if (tags.has('hub:players')) {
    const m = playersText.match(/^(\d+)\s*[-–]\s*(\d+)$|^(\d+)$/);
    players = m ? [Number(m[1] ?? m[3]), Number(m[2] ?? m[3])] : null;
    if (check(players, () => error(`hub:players is ${quoted(playersText)}: MIN-MAX`))) {
      check(players[0] >= 1 && players[1] >= players[0], () => error(`hub:players is ${quoted(playersText)}: MIN-MAX, MIN at least 1`));
      check(players[1] >= 2, () => error('leave hub:players out for a game one person plays at a time'));
    }
  }
  if (tags.has('hub:webgpu')) check(one('hub:webgpu') === 'required', () => error('hub:webgpu is "required", or left out'));

  // Sessions: the protocol's tags and client, and what the wall asks of a game friends play together.
  const session = one('hub:session');
  check(['0', '1'].includes(session), () => error(tags.has('hub:session') ? `hub:session is ${quoted(session)}: 1 or 0` : 'no hub:session: 1 when the game follows the session protocol, 0 when it has no score, time or finish to play a round by'));
  const mode = one('hub:session-mode');
  let seats = null;
  if (session === '1') {
    const seatsText = one('hub:session-players');
    const m = seatsText.match(/^(\d+)\s*[-–]\s*(\d+)$|^(\d+)$/);
    seats = m ? [Number(m[1] ?? m[3]), Number(m[2] ?? m[3])] : null;
    check(seats && seats[0] >= 1 && seats[0] <= seats[1] && seats[1] <= 4, () => error(`hub:session-players is ${quoted(seatsText)}: MIN-MAX, between 1 and 4`));
    check(MODES.includes(mode), () => error(`hub:session-mode is ${quoted(mode)}: one of ${list(MODES)}`));
    const goal = one('hub:session-goal');
    const howto = one('hub:session-howto');
    check(goal && goal.length <= LIMITS.sessionGoal, () => error(`hub:session-goal is how to win, at most ${LIMITS.sessionGoal} characters${goal ? ` (it is ${goal.length})` : ''}`));
    check(howto && howto.length <= LIMITS.sessionHowto, () => error(`hub:session-howto is the controls, at most ${LIMITS.sessionHowto} characters${howto ? ` (it is ${howto.length})` : ''}`));
    if (tags.has('hub:session-minutes')) check(Number(one('hub:session-minutes')) > 0, () => error('hub:session-minutes is a number of minutes'));
    if (check(client, () => error('hub:session is 1 but the session client is not the page\'s first script: paste session.js, unmodified, as the first script in <head>, after <meta charset>'))) {
      check(page.charset && page.charset.end <= client.start, () => error('<meta charset> comes before the session client'));
    }
    check(type !== 'Tech demo' && type !== 'Tool', () => error(`sessions deal games only: a ${type.toLowerCase()} gives hub:session 0`));
    if (mode === 'ghost' || mode === 'shared-world') {
      const want = mode === 'ghost' ? ['race'] : ['co-op', 'versus'];
      check(tagList.some((t) => want.includes(t)), () => error(`a ${mode} game is tagged ${want.map(quoted).join(' or ')}`));
      const most = seats ? Math.min(4, seats[1]) : 4;
      check(players && players[0] === 1 && players[1] >= most && players[1] <= 4, () => error(`a ${mode} game gives hub:players as 1-N, N from ${most} to 4: the seats its session takes`));
    }
  }
  const together = session === '1' && (mode === 'ghost' || mode === 'shared-world');
  if (players && players[1] >= 2 && !together) check(tagList.includes('co-op') || tagList.includes('versus'), () => error('a game several people play on one screen is tagged "co-op" or "versus"'));
  if (session !== '1') {
    const stray = SESSION_TAGS.filter((t) => tags.has(t));
    if (stray.length) warning(`${list(stray)} count only with hub:session 1`);
    if (client && session === '0') warning('the session client is only for hub:session 1');
  }

  // Languages: the line list.
  const linesBlocks = blockOf(page, 'game-lines');
  let lines = null;
  if (check(linesBlocks, () => error('no game-lines block: AI Hub Languages v1, *The line list*'))) {
    check(linesBlocks.length === 1, () => error('game-lines is given twice'));
    const block = linesBlocks[0];
    check(block.start < page.headEnd, () => error('the game-lines block goes in <head>'));
    check((block.attrs.type || '').toLowerCase() === 'application/json', () => error('the game-lines block is <script type="application/json" id="game-lines">'));
    const result = linesProblems(block.body, { lang: page.lang });
    problems.push(...result.problems);
    lines = result.block;
    checks++;
  }
  const translations = blockOf(page, 'game-translations');
  if (translations) {
    problems.push(...translationsProblems(translations[0].body, lines));
    check(!linesBlocks || translations[0].start > linesBlocks[0].start, () => error('the game-translations block comes after game-lines'));
  }

  // The page's code.
  const json = page.scripts.filter((s) => (s.attrs.type || '').toLowerCase() === 'application/json').map((s) => [s.bodyStart, s.bodyEnd]);
  const skip = [...json, ...(client ? [[client.bodyStart, client.bodyEnd]] : [])];
  const found = codeProblems(page.text, where, skip);
  checks += NETWORK.length + SHARED.length;
  problems.push(...found);
  for (const script of page.scripts) {
    if ((script.attrs.type || '').trim().toLowerCase() === 'importmap') problems.push(...importMapProblems(script.body, `${where}:${lineAt(page.text, script.start)}`));
  }
  if (parse) {
    page.scripts.forEach((script, i) => {
      const type = (script.attrs.type ?? '').trim();
      if (script.attrs.src !== undefined || !script.body.trim() || !JS_TYPES.test(type)) return;
      const message = parseError({ code: script.body, module: /^module$/i.test(type) });
      checks++;
      if (message) error(`script ${i + 1} (from line ${lineAt(page.text, script.start)}) does not parse, so the game never starts: ${message}`);
    });
  }

  const fields = {
    name, tagline, description, themeColor: theme, type, genre, tags: tagList, controls, model, effort, harness, source, series,
    players: playersText, session, sessionMode: mode, sessionPlayers: one('hub:session-players'), lang: page.lang, client: client?.version ?? null, language: lines?.language ?? null,
  };
  return { fields, problems, checks };
}

/** The tag a near miss meant: "pixel-art" is "pixel art". */
function near(tag) {
  const key = (s) => s.toLowerCase().replace(/[^a-z0-9.]/g, '');
  const match = TAGS.find((t) => key(t) === key(tag));
  if (match) return `${tag} is ${quoted(match)}`;
  const aliases = { controller: 'gamepad', multiplayer: 'co-op or versus', 'local multiplayer': 'co-op or versus', 'open-world': 'open world', destruction: 'demolition', 'webgpu-required': 'hub:webgpu' };
  return aliases[tag.toLowerCase()] ? `for ${tag}, use ${aliases[tag.toLowerCase()]}` : '';
}

/** A path inside a folder, or null when it leaves it or reaches another site. */
function safeJoin(href) {
  if (/^[a-z][a-z0-9+.-]*:|^\/|^#/i.test(href)) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(href.split(/[?#]/)[0]);
  } catch {
    return null;
  }
  const joined = path.posix.normalize(decoded);
  return joined.startsWith('../') || joined === '..' ? null : joined.replace(/^\.\//, '');
}

/* --- screenshots ------------------------------------------------------------- */

const STD_LUMA = [16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99];
const ZIGZAG = [0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63];
const lumaFor = (q) => {
  const scale = q < 50 ? 5000 / q : 200 - 2 * q;
  return STD_LUMA.map((b) => Math.min(255, Math.max(1, Math.floor((b * scale + 50) / 100))));
};

/**
 * A JPEG's size, whether it is progressive, and the quality its luminance
 * table was made at (the standard table every common encoder scales).
 * `exact` is false when the table isn't a scaled standard one.
 */
export function jpegInfo(buffer) {
  const buf = Buffer.from(buffer);
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return { jpeg: false };
  const out = { jpeg: true, width: 0, height: 0, progressive: false, quality: null, exact: false };
  let luma = null;
  let i = 2;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = buf[i + 1];
    if (marker === 0xd8 || marker === 0x01 || marker === 0xff || (marker >= 0xd0 && marker <= 0xd7)) {
      i += marker === 0xff ? 1 : 2;
      continue;
    }
    const length = buf.readUInt16BE(i + 2);
    if (marker === 0xdb && !luma) {
      for (let j = i + 4; j < i + 2 + length && j < buf.length; ) {
        const precision = buf[j] >> 4;
        const id = buf[j] & 15;
        j++;
        const table = [];
        for (let k = 0; k < 64; k++, j += precision ? 2 : 1) table.push(precision ? buf.readUInt16BE(j) : buf[j]);
        if (id === 0) luma = table;
      }
    }
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      out.height = buf.readUInt16BE(i + 5);
      out.width = buf.readUInt16BE(i + 7);
      out.progressive = marker === 0xc2 || marker === 0xc6 || marker === 0xca || marker === 0xce;
    }
    if (marker === 0xda) break;
    i += 2 + length;
  }
  if (luma) {
    const natural = new Array(64);
    ZIGZAG.forEach((at, k) => (natural[at] = luma[k]));
    let best = { quality: null, distance: Infinity };
    for (let q = 1; q <= 100; q++) {
      const table = lumaFor(q);
      const distance = table.reduce((sum, v, k) => sum + Math.abs(v - natural[k]), 0);
      if (distance < best.distance) best = { quality: q, distance };
    }
    out.quality = best.quality;
    out.exact = best.distance === 0;
  }
  return out;
}

/** A strip's problems: covers/SLUG/0.jpg, 1.jpg and 2.jpg, 640×480 baseline JPEG at quality 58, no two alike. `frames` maps a name to its bytes. */
export function stripProblems(frames, where = 'covers/SLUG') {
  const problems = [];
  const error = (text) => problems.push({ level: 'error', text: `${where}/${text}` });
  const seen = new Map();
  for (const name of STRIP.frames) {
    const data = frames.get(name);
    if (!data) {
      error(`${name} is missing: a strip is 0.jpg (the title or opening view), 1.jpg and 2.jpg (play)`);
      continue;
    }
    const info = jpegInfo(data);
    if (!info.jpeg) {
      error(`${name} is not a JPEG`);
      continue;
    }
    if (info.width !== STRIP.width || info.height !== STRIP.height) error(`${name} is ${info.width}×${info.height}: ${STRIP.width}×${STRIP.height}`);
    if (info.progressive) error(`${name} is a progressive JPEG: baseline`);
    if (info.quality !== STRIP.quality || !info.exact) error(`${name} is quality ${info.quality ?? '?'}${info.exact ? '' : ' or a table of its own'}: JPEG quality ${STRIP.quality}`);
    if (data.length < STRIP.small) problems.push({ level: 'warning', text: `${where}/${name} is ${(data.length / 1024).toFixed(1)} KB: very little in it, as in a blank, flat or loading screen` });
    const key = Buffer.from(data).toString('base64');
    if (seen.has(key)) error(`${name} is the same picture as ${seen.get(key)}: three different views`);
    else seen.set(key, name);
  }
  for (const name of frames.keys()) if (!STRIP.frames.includes(name)) problems.push({ level: 'warning', text: `${where}/${name} is not a frame: the hub ignores it` });
  return problems;
}

/* --- a game in a folder ------------------------------------------------------ */

const CLUTTER = /(^|\/)(node_modules|bower_components|\.git|\.svn|\.hg|\.idea|\.vscode|\.cache|__MACOSX|\.DS_Store|Thumbs\.db)(\/|$)/i;
const SECRET = /(^|\/)(\.env([-._ ~][^/]*)?|\.(aws|azure|docker|gnupg|kube|netlify|ssh|terraform|vercel)|\.npmrc|\.netrc|\.git-credentials|[^/]*\.(pem|key|p12|pfx|keystore|jks|ppk)|id_(rsa|dsa|ecdsa|ed25519)[^/]*|credentials\.json|client_secret[^/]*\.json|service[-_]account[^/]*\.json)(\/|$)/i;
const ROOT_REF = /\b(?:src|href|poster)\s*=\s*["']\/(?![/"'])[^"']*["']/gi;
const ROOT_IN_CODE = /["'`(]\/(?:assets|static|build|_app|src|js|css|img|images|audio|sounds|data)\//;

/** Every file in a folder, as posix paths relative to it. Links are not followed. */
export function filesIn(dir) {
  const out = [];
  const walk = (abs, rel) => {
    for (const entry of readdirSync(abs, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      const childAbs = path.join(abs, entry.name);
      if (entry.isSymbolicLink()) out.push({ rel: childRel, abs: childAbs, link: true, size: 0 });
      else if (entry.isDirectory()) walk(childAbs, childRel);
      else if (entry.isFile()) out.push({ rel: childRel, abs: childAbs, size: lstatSync(childAbs).size });
    }
  };
  walk(dir, '');
  return out;
}

/* --- a package --------------------------------------------------------------- */

/** One game: its page, its folder's files, and its strip when a package holds it. */
export function checkGame({ file, folder = null, coversDir = null, rel, library = null, parse = true }) {
  const problems = [];
  let checks = 0;
  const base = folder ? path.basename(folder) : path.basename(file).replace(/\.html?$/i, '');
  const { slug, version } = slugOf(base);
  if (!slug) problems.push({ level: 'error', text: `${rel}: the name makes no slug: letters, digits and hyphens` });
  else if (!/^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(base)) problems.push({ level: 'warning', text: `${rel}: name the file with letters, digits and hyphens (the wall calls it ${slug})` });

  let folderInfo = null;
  if (folder) {
    const files = filesIn(folder);
    folderInfo = { files: new Set(files.map((f) => f.rel)) };
    const total = files.reduce((n, f) => n + f.size, 0);
    checks += 3;
    if (files.length > LIMITS.folderFiles) problems.push({ level: 'error', text: `${rel}: ${files.length} files: at most ${LIMITS.folderFiles}` });
    if (total > LIMITS.folder) problems.push({ level: 'error', text: `${rel}: ${(total / MiB).toFixed(1)} MiB: at most 95 MiB` });
    for (const f of files) {
      if (f.link) problems.push({ level: 'error', text: `${rel}/${f.rel} is a link: put the file itself there` });
      else if (SECRET.test(f.rel)) problems.push({ level: 'error', text: `${rel}/${f.rel} looks like a key or login: never ship one` });
      else if (CLUTTER.test(f.rel)) problems.push({ level: 'error', text: `${rel}/${f.rel}: leave out ${f.rel.match(CLUTTER)[2]}` });
      else if (f.size > LIMITS.page) problems.push({ level: 'error', text: `${rel}/${f.rel} is ${(f.size / MiB).toFixed(1)} MiB: no file over 25 MiB` });
      else if (/\.(m?js|css|html?)$/i.test(f.rel) && f.rel !== 'index.html') {
        const text = readFileSync(f.abs, 'utf8');
        problems.push(...codeProblems(text, `${rel}/${f.rel}`));
        const root = /\.html?$/i.test(f.rel) ? text.match(ROOT_REF) : text.match(ROOT_IN_CODE);
        if (root) problems.push({ level: 'error', text: `${rel}/${f.rel} loads ${root[0].trim()} from the site root: inside the hub that is the hub's, not the game's. Use a relative path` });
      }
    }
  } else {
    const size = lstatSync(file).size;
    checks++;
    if (size > LIMITS.page) problems.push({ level: 'error', text: `${rel}: ${(size / MiB).toFixed(1)} MiB: a game in one file is at most 25 MiB` });
  }

  const html = readFileSync(file, 'utf8');
  const result = checkPage(html, { folder: folderInfo, parse, where: folder ? `${rel}/index.html` : rel });
  problems.push(...result.problems);
  checks += result.checks;
  if (folder) {
    const root = html.match(ROOT_REF);
    if (root) problems.push({ level: 'error', text: `${rel}/index.html loads ${root[0].trim()} from the site root: inside the hub that is the hub's, not the game's. Use a relative path` });
  }

  if (coversDir && slug) {
    const strip = path.join(coversDir, slug);
    checks++;
    if (!existsSync(strip)) problems.push({ level: 'error', text: `no screenshots: covers/${slug}/0.jpg, 1.jpg and 2.jpg` });
    else {
      const frames = new Map(readdirSync(strip).filter((name) => !name.startsWith('.')).map((name) => [name, readFileSync(path.join(strip, name))]));
      problems.push(...stripProblems(frames, `covers/${slug}`));
    }
  }

  if (library) problems.push(...libraryProblems({ slug, version, fields: result.fields }, library));
  return { path: rel, slug, version, name: result.fields.name, tagline: result.fields.tagline, fields: result.fields, problems, checks };
}

/** The games in a package's games/ folder: pages, and folders with an index.html. Anything else is reported. */
export function gamesIn(dir) {
  const games = [];
  const problems = [];
  const gamesDir = path.join(dir, 'games');
  for (const entry of readdirSync(gamesDir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue;
    const abs = path.join(gamesDir, entry.name);
    if (entry.isFile() && /\.html?$/i.test(entry.name)) games.push({ file: abs, rel: `games/${entry.name}` });
    else if (entry.isDirectory() && existsSync(path.join(abs, 'index.html'))) games.push({ file: path.join(abs, 'index.html'), folder: abs, rel: `games/${entry.name}` });
    else problems.push({ level: 'warning', text: `games/${entry.name}${entry.isDirectory() ? '/' : ''} is not a game: a package's games/ holds pages and folders with an index.html` });
  }
  return { games, problems };
}

/** Check a package folder, a game folder or a page. */
export function checkTarget(target, { library = null, parse = true } = {}) {
  const abs = path.resolve(target);
  const stats = lstatSync(abs);
  const packageProblems = [];
  let games = [];
  let coversDir = null;
  if (stats.isFile()) games = [{ file: abs, rel: path.basename(abs) }];
  else if (existsSync(path.join(abs, 'games'))) {
    const found = gamesIn(abs);
    games = found.games;
    packageProblems.push(...found.problems);
    coversDir = path.join(abs, 'covers');
    if (!games.length) packageProblems.push({ level: 'error', text: 'games/ holds no game' });
    for (const name of readdirSync(abs)) {
      if (!['games', 'covers'].includes(name) && !name.startsWith('.')) packageProblems.push({ level: 'warning', text: `${name} is not part of a package: only games/ and covers/ are imported` });
    }
  } else if (existsSync(path.join(abs, 'index.html'))) games = [{ file: path.join(abs, 'index.html'), folder: abs, rel: path.basename(abs) }];
  else throw new Error(`${target} is not a package (a folder with games/), a game folder or a page`);

  const results = games.map((game) => checkGame({ ...game, coversDir, library, parse }));
  const slugs = new Map();
  for (const result of results) {
    if (slugs.has(result.slug)) packageProblems.push({ level: 'error', text: `${result.path} and ${slugs.get(result.slug)} are both ${result.slug} on the wall: name them apart` });
    else slugs.set(result.slug, result.path);
  }
  if (coversDir && existsSync(coversDir)) {
    for (const name of readdirSync(coversDir)) {
      if (!name.startsWith('.') && !slugs.has(name)) packageProblems.push({ level: 'warning', text: `covers/${name} belongs to no game in games/ (the screenshots of games/NAME go in covers/ under its slug)` });
    }
  }
  const failed = results.filter((r) => r.problems.some((p) => p.level === 'error')).length + (packageProblems.some((p) => p.level === 'error') ? 1 : 0);
  return { version: VERSION, target, screenshots: Boolean(coversDir), games: results, problems: packageProblems, ok: failed === 0 };
}

/* --- the games already on the wall ------------------------------------------- */

const spelling = (s) => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const nameKey = (s) => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** What the wall already holds, for comparing a game with it: from games.json's games. */
export function indexLibrary(games) {
  const index = { slugs: new Map(), names: new Map(), sources: new Map(), series: new Map(), models: new Map(), harnesses: new Map() };
  const add = (map, value) => {
    if (typeof value !== 'string' || !value.trim()) return;
    const key = spelling(value);
    if (!map.has(key)) map.set(key, new Map());
    const spellings = map.get(key);
    spellings.set(value, (spellings.get(value) ?? 0) + 1);
  };
  for (const game of games) {
    index.slugs.set(game.slug, game);
    index.names.set(nameKey(game.plainName ?? game.name), game);
    if (game.source) {
      const series = game.series || game.source;
      if (!index.sources.has(game.source)) index.sources.set(game.source, new Map());
      const bySeries = index.sources.get(game.source);
      bySeries.set(series, (bySeries.get(series) ?? 0) + 1);
    }
    add(index.series, game.series);
    add(index.models, game.model);
    add(index.harnesses, game.harness);
  }
  index.sourceKeys = new Map();
  for (const source of index.sources.keys()) {
    const key = spelling(source);
    if (!index.sourceKeys.has(key)) index.sourceKeys.set(key, []);
    index.sourceKeys.get(key).push(source);
  }
  return index;
}

const mostOf = (counts) => [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];

/** A game against the wall: its slug free, its name its own, and its source, series, model and harness spelled as the wall spells them. */
export function libraryProblems({ slug, version, fields }, index) {
  const problems = [];
  const existing = index.slugs.get(slug);
  if (existing && !version) problems.push({ level: 'error', text: `the wall already has ${slug} (${existing.name}): choose another file name` });
  else if (existing) problems.push({ level: 'note', text: `${slug} is on the wall as ${existing.name}: this is its build ${version}` });
  const sameName = fields.name && index.names.get(nameKey(fields.name));
  if (sameName && sameName.slug !== slug) problems.push({ level: 'warning', text: `the wall already shows a game called ${quoted(fields.name)} (${sameName.slug}): this one would show as ${quoted(`${fields.name} (2)`)} or later` });

  if (fields.source) {
    const exact = index.sources.get(fields.source);
    const sameKey = (index.sourceKeys.get(spelling(fields.source)) || []).filter((s) => s !== fields.source);
    if (!exact && sameKey.length) problems.push({ level: 'error', text: `hub:source is spelled ${quoted(sameKey[0])} on the wall` });
    const series = fields.series || fields.source;
    const known = exact || (sameKey.length && index.sources.get(sameKey[0]));
    if (known) {
      const theirs = mostOf(known);
      if (spelling(theirs) !== spelling(series)) problems.push({ level: 'error', text: theirs === (exact ? fields.source : sameKey[0]) ? `the wall files ${fields.source} under no series of its own: leave hub:series out` : `the wall files ${fields.source} under the series ${quoted(theirs)}: hub:series is ${quoted(theirs)}` });
      else if (theirs !== series && fields.series) problems.push({ level: 'error', text: `hub:series is spelled ${quoted(theirs)} on the wall` });
    } else if (fields.series) {
      const spellings = index.series.get(spelling(fields.series));
      if (spellings && !spellings.has(fields.series)) problems.push({ level: 'error', text: `hub:series is spelled ${quoted(mostOf(spellings))} on the wall` });
    }
  }
  for (const [field, map, tag] of [['model', index.models, 'hub:model'], ['harness', index.harnesses, 'hub:harness']]) {
    const value = fields[field];
    const spellings = value && map.get(spelling(value));
    if (spellings && !spellings.has(value)) problems.push({ level: 'warning', text: `${tag} is spelled ${quoted(mostOf(spellings))} on the wall` });
  }
  return problems;
}

/** The wall's games: from a games.json file, or the live catalogue. Null, with why, when they can't be had. */
export async function loadLibrary({ offline = false, file = null } = {}) {
  if (offline) return { index: null, note: 'not compared with the wall (--offline)' };
  try {
    const manifest = file ? JSON.parse(readFileSync(file, 'utf8')) : await (await fetch(LIBRARY_URL, { signal: AbortSignal.timeout(30000) })).json();
    if (!Array.isArray(manifest?.games)) throw new Error('no games in it');
    return { index: indexLibrary(manifest.games), note: `compared with the ${manifest.games.length} games on the wall` };
  } catch (error) {
    return { index: null, note: `not compared with the wall: ${file ?? LIBRARY_URL} could not be read (${error.message})` };
  }
}

/* --- the command ------------------------------------------------------------- */

function print(report, note) {
  const mark = { error: '✗', warning: '!', note: '·' };
  const out = [`\nAI Hub Catalogue v${VERSION} · ${report.target}`, `  ${note}`, ''];
  for (const p of report.problems) out.push(`  ${mark[p.level]} ${p.text}`);
  if (report.problems.length) out.push('');
  for (const game of report.games) {
    const errors = game.problems.filter((p) => p.level === 'error').length;
    out.push(`${errors ? '✗' : '✓'} ${game.path}  →  ${game.slug || '?'}${game.name ? `  "${game.name}${game.tagline ? ` — ${game.tagline}` : ''}"` : ''}`);
    for (const p of game.problems) out.push(`    ${mark[p.level]} ${p.text}`);
    out.push(`    ${game.checks} checks${errors ? `, ${errors} failed` : ''}`, '');
  }
  if (!report.screenshots) out.push('  Screenshots not checked: give the package folder (games/ and covers/) to check them.', '');
  const failed = report.games.filter((g) => g.problems.some((p) => p.level === 'error')).length;
  const total = report.games.length;
  out.push(report.ok ? `All ${total} game${total === 1 ? '' : 's'} pass. Look at every !.` : `${failed} of ${total} game${total === 1 ? '' : 's'} fail${failed === 1 ? 's' : ''}${report.problems.some((p) => p.level === 'error') ? ', and the package has problems' : ''}. Fix every ✗, and look at every !.`);
  console.log(out.join('\n') + '\n');
}

async function main(argv) {
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const at = argv.indexOf('--library');
  const file = at === -1 ? null : argv[at + 1];
  const targets = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--library');
  if (targets.length !== 1 || flags.has('--help')) {
    console.log('Usage: node catalogue-check.mjs PACKAGE|GAME.html|FOLDER [--offline] [--library games.json] [--json]');
    return targets.length === 1 ? 0 : 1;
  }
  const { index, note } = await loadLibrary({ offline: flags.has('--offline'), file });
  let report;
  try {
    report = checkTarget(targets[0], { library: index });
  } catch (error) {
    console.error(error.message);
    return 1;
  }
  if (flags.has('--json')) console.log(JSON.stringify({ ...report, library: note }, null, 2));
  else print(report, note);
  return report.ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!vm.SourceTextModule) {
    // Parsing a module script needs Node's flag; run again with it.
    const again = spawnSync(process.execPath, ['--experimental-vm-modules', '--no-warnings', ...process.argv.slice(1)], { stdio: 'inherit' });
    process.exit(again.status ?? 1);
  }
  process.exit(await main(process.argv.slice(2)));
}
