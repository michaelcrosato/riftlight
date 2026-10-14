/**
 * Licences an imported model may carry, as data (docs/plans/asset-system.md §7.1, §7.7). Our own
 * work (`LicenseRef-own`, its `source.url` a path in this repository or its GitHub URL) is allowed
 * anywhere. Anyone else's work, CC0 included and a single file too, comes only from a pack whose
 * `PACK_SOURCES` entry links the repository owner's approving comment on the licence escalation
 * (#49) for that licence (CC0, or CC-BY pack by pack): `source.pack` names it. Everything else
 * (share-alike, no-derivatives, non-commercial, "no redistribution") is not allowed.
 * `validateModel` reports a model whose provenance this refuses as a problem, `model -- credits`
 * reads `credit`, and `model -- import-pack` reads `marks` in the download's licence files.
 */
import { PALETTE } from '../../palette';
import type { Provenance } from '../types';
import { PACK_SOURCES, type PackSource } from './sources';

/** Our own work: made in this repository (a round trip of our own models, a fixture). */
export const OWN_LICENCE = 'LicenseRef-own';

export interface LicenceTerms {
  readonly name: string;
  /** 'allowed' outside a pack too, or only in a pack whose `PACK_SOURCES` entry is approved. */
  readonly use: 'allowed' | 'per-pack';
  /** What `model -- credits` owes the author. */
  readonly credit: 'none' | 'optional' | 'required';
  /** Patterns (case aside) one of which a pack's licence file must contain to be this licence. */
  readonly marks: readonly string[];
}

export const LICENCES: Readonly<Record<string, LicenceTerms>> = {
  'CC0-1.0': { name: 'Creative Commons Zero 1.0 (public domain dedication)', use: 'per-pack', credit: 'optional', marks: ['\\bCC0\\b', 'Creative\\s+Commons\\s+Zero', 'creativecommons\\.org/publicdomain/zero'] },
  [OWN_LICENCE]: { name: 'our own work', use: 'allowed', credit: 'none', marks: [] },
  'CC-BY-3.0': { name: 'Creative Commons Attribution 3.0', use: 'per-pack', credit: 'required', marks: ['\\bCC[\\s-]?BY[\\s-]?3\\.0\\b', '\\bAttribution\\s+3\\.0\\b', 'creativecommons\\.org/licenses/by/3\\.0'] },
  'CC-BY-4.0': { name: 'Creative Commons Attribution 4.0', use: 'per-pack', credit: 'required', marks: ['\\bCC[\\s-]?BY[\\s-]?4\\.0\\b', '\\bAttribution\\s+4\\.0\\b', 'creativecommons\\.org/licenses/by/4\\.0'] },
};

/** Licences allowed without a pack's approval (our own work alone). */
export const ALLOWED_LICENCES: readonly string[] = Object.keys(LICENCES).filter((k) => LICENCES[k]!.use === 'allowed');

/**
 * What an approval links: a comment on the licence escalation. Agents here act through the
 * owner's GitHub account, so no code can prove a comment's author is human: approval is the
 * repository owner's own comment on #49, never an agent's.
 */
export const APPROVAL = /^https:\/\/github\.com\/michaelcrosato\/riftlight\/issues\/49#issuecomment-\d+$/;
/** Pack ids: they name files (`public/packs/<id>.json`) and prefix model ids. */
export const PACK_ID = /^[a-z0-9][a-z0-9-]*$/;

const isApproved = (p: PackSource) => APPROVAL.test(p.approved);

/** Where our own work may say it comes from: this repository on GitHub, or a path inside it. */
export const OWN_SOURCE = /^https:\/\/github\.com\/michaelcrosato\/riftlight\//;

/** The top-level folders a repo-relative source may start with. */
const REPO_ROOTS: readonly string[] = ['src', 'scripts', 'public', 'docs'];

/**
 * A path in this repository (under one of `REPO_ROOTS`, no '..'), or a URL into it on GitHub
 * (parsed, so `..` and `%2e%2e` segments can't climb out of it).
 */
function insideRepo(url: string): boolean {
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//')) {
    try {
      const u = new URL(url);
      return u.protocol === 'https:' && u.host === 'github.com' && OWN_SOURCE.test(`https://github.com${u.pathname}`);
    } catch {
      return false;
    }
  }
  const parts = url.split(/[\\/]/);
  return REPO_ROOTS.includes(parts[0]!) && !parts.includes('..');
}

/** Why a model's provenance can't ship (no url, no licence, a licence or a pack not allowed), or null. */
export function licenceProblem(source: Provenance, packs: readonly PackSource[] = PACK_SOURCES): string | null {
  if (!source.url) return `its source has no url: record where it came from (provenance is data)`;
  if (!source.licence) return `its source has no licence: record its SPDX id (${ALLOWED_LICENCES.join(', ')})`;
  const terms = Object.hasOwn(LICENCES, source.licence) ? LICENCES[source.licence]! : null;
  const perPack = Object.keys(LICENCES).filter((k) => LICENCES[k]!.use === 'per-pack');
  if (!terms) return `its source licence '${source.licence}' is not allowed (${ALLOWED_LICENCES.join(', ')}; ${perPack.join(', ')} pack by pack, once approved on #49): use another source`;
  if (source.licence === OWN_LICENCE) return insideRepo(source.url) ? null : `own work with an outside source: '${source.url}' is not in this repository; LicenseRef-own needs a path in it or a https://github.com/michaelcrosato/riftlight/ URL (someone else's work comes from an approved pack)`;
  if (source.pack) {
    // someone else's pack: only through its own approved entry, for this licence
    const pack = packs.find((p) => p.id === source.pack);
    if (!pack || !isApproved(pack)) return `its source comes from pack '${source.pack}', which is not approved in PACK_SOURCES (a link to the owner's approving comment on #49): use another source`;
    if (pack.licence !== source.licence) return `its source says ${source.licence}, but pack '${source.pack}' is approved for ${pack.licence}, not ${source.licence}: fix the source or the approval`;
    return null;
  }
  if (terms.use === 'allowed') return null;
  return `its source licence '${source.licence}' is not allowed without an approved pack (it names no pack: say which approved PACK_SOURCES entry it comes from, \`--pack <id>\`; approval waits on #49): use another source`;
}

/** What is wrong with `PACK_SOURCES` entries (ids, hashes, licences, approval links), one line each. */
export function packSourceProblems(sources: readonly PackSource[] = PACK_SOURCES): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of sources) {
    const who = `pack '${p.id}'`;
    if (!PACK_ID.test(p.id)) out.push(`${who}: its id must match ${PACK_ID}`);
    if (seen.has(p.id)) out.push(`${who} is listed twice`);
    seen.add(p.id);
    if (!/^https:\/\//.test(p.url)) out.push(`${who}: its url must be https`);
    if (!/^[0-9a-f]{64}$/.test(p.sha256)) out.push(`${who}: its sha256 must be 64 lower-case hex digits`);
    if (!Object.hasOwn(LICENCES, p.licence) || p.licence === OWN_LICENCE) out.push(`${who}: its licence '${p.licence}' is not one of ${Object.keys(LICENCES).filter((k) => k !== OWN_LICENCE).join(', ')}`);
    if (!isApproved(p)) out.push(`${who}: approved must link the owner's comment on #49 (${APPROVAL})`);
    if (!p.author || !p.homepage) out.push(`${who}: name its author and homepage`);
    if (p.scale !== undefined && !(Number.isFinite(p.scale) && p.scale > 0)) out.push(`${who}: scale ${p.scale} isn't a number above 0 (source units to metres)`);
    for (const t of p.tags ?? []) if (!TAG.test(t)) out.push(`${who}: tag '${t}' isn't lower-case letters, digits and dashes`);
    for (const [slot, c] of Object.entries(p.palette ?? {})) if (!Object.hasOwn(PALETTE, c)) out.push(`${who}: palette binds slot '${slot}' to '${c}', which isn't a PALETTE entry`);
    for (const sh of p.sheets ?? []) {
      const where = `${who}, sheet '${sh.file}'`;
      if (!sh.file) out.push(`${who}: a sheet needs the file to slice`);
      if (!Array.isArray(sh.grid) || sh.grid.length !== 2 || !sh.grid.every((g) => Number.isInteger(g) && g > 0)) out.push(`${where}: grid must be [width, height] in whole pixels`);
      const names = (sh.names ?? []).filter(Boolean);
      for (const n of names) if (!TAG.test(n)) out.push(`${where}: cell name '${n}' isn't lower-case letters, digits and dashes`);
      const dup = names.find((n, i) => names.indexOf(n) !== i);
      if (dup) out.push(`${where}: cell name '${dup}' is given twice`);
      for (const t of sh.tiles ?? []) if (!names.includes(t)) out.push(`${where}: tiles names '${t}', which no cell is called`);
      for (const t of sh.tags ?? []) if (!TAG.test(t)) out.push(`${where}: tag '${t}' isn't lower-case letters, digits and dashes`);
      for (const [slot, c] of Object.entries(sh.palette ?? {})) if (!Object.hasOwn(PALETTE, c)) out.push(`${where}: palette binds slot '${slot}' to '${c}', which isn't a PALETTE entry`);
    }
  }
  return out;
}

/** Tags and cell names: lower-case words joined by dashes. */
const TAG = /^[a-z0-9][a-z0-9-]*$/;

/** Files in a download that may hold its licence: text named, or filed, as a licence. */
export const isLicenceFile = (path: string) => /licen[cs]e|copying|copyright/i.test(path) && !/\.(glb|gltf|bin|png|jpe?g|webp|obj|mtl|fbx|vox|blend)$/i.test(path);
/** Terms no allowed licence has: a licence file that names one is refused, whatever else it says. */
const FORBIDDEN = /\b(ShareAlike|NonCommercial|NoDerivatives|NoDerivs|BY-(?:NC|ND|SA))\b/i;

/**
 * Why a download's licence files don't show its licence, or null: one of them must name it (its
 * `marks`; "public domain" alone is not CC0), and none may name terms no allowed licence has.
 */
export function licenceFileProblem(licence: string, files: readonly { readonly name: string; readonly text: string }[]): string | null {
  const terms = Object.hasOwn(LICENCES, licence) ? LICENCES[licence]! : null;
  if (!terms || !terms.marks.length) return `'${licence}' is not a licence a download can carry`;
  if (!files.length) return `the download has no licence file (licence, license, copying, copyright): it can't be checked as ${licence}`;
  const named = files.filter((f) => terms.marks.some((m) => new RegExp(m, 'i').test(f.text)));
  if (!named.length) return `no licence file (${files.map((f) => f.name).join(', ')}) names ${licence}`;
  const bad = files.find((f) => FORBIDDEN.test(f.text));
  if (bad) return `${bad.name} names terms that aren't allowed (${FORBIDDEN.exec(bad.text)![0]})`;
  return null;
}
