/**
 * Third-party packs the importer may fetch (`npm run model -- import-pack <id>`,
 * docs/plans/asset-system.md §7.1). Committing someone else's content is a licence decision, so a
 * pack joins this list only once the repository owner approves it on the licence escalation (#49,
 * https://github.com/michaelcrosato/riftlight/issues/49), and `approved` links that comment
 * (`APPROVAL` checks the link's form). Agents here act through the owner's GitHub account, so no
 * code can prove a comment's author is human: approval is the owner's own comment, never one an
 * agent wrote. Until then the list stays empty and nothing third-party is imported.
 * `packSourceProblems` (tested) checks every entry: id, https url, sha256, licence and approval.
 */
import type { PaletteColor } from '../../palette';

export interface PackSource {
  readonly id: string;
  /** The archive (zip) or single file to download. */
  readonly url: string;
  /** Its sha256 (64 lower-case hex digits): a download that differs is refused. */
  readonly sha256: string;
  /** SPDX id (a key of `LICENCES`), checked against the licence files in the download. */
  readonly licence: string;
  readonly author: string;
  readonly homepage: string;
  /** Link to the owner's approving comment on #49. */
  readonly approved: string;
  /** The pack's name as people know it ("Kenney Nature Kit 2.1"): each asset's `about` says it. */
  readonly title?: string;
  /** Library tags every asset of the pack gets (docs/ASSETS.md *Importing*), beside those its name adds. */
  readonly tags?: readonly string[];
  /**
   * Slots of the pack's models' colour map bound to other PALETTE entries: an agent's choice,
   * made once from the import's swatches (`model -- import-pack` prints them), so the pack sits
   * in the engine's style. A sheet has a colour map of its own: `PackSheet.palette`.
   */
  readonly palette?: Readonly<Record<string, PaletteColor>>;
  /** 2D: pixel-art sheets in the download to slice into textures (`npm run tex -- import-pack`). */
  readonly sheets?: readonly PackSheet[];
}

/** One pixel-art sheet in a pack's download, sliced on a grid into one texture per cell. */
export interface PackSheet {
  /** Its path in the download. */
  readonly file: string;
  /** Cell size in pixels. */
  readonly grid: readonly [w: number, h: number];
  /** Cell names by reading-order index (`''` or missing: the cell's index); ids are `<pack>/<name>`. */
  readonly names?: readonly string[];
  /** Names of the cells that tile seamlessly (floors, walls, grass). */
  readonly tiles?: readonly string[];
  /** Tags every texture of this sheet gets. */
  readonly tags?: readonly string[];
  /** Slots of this sheet's colour map bound to other PALETTE entries (`tex -- import-pack` prints them). */
  readonly palette?: Readonly<Record<string, PaletteColor>>;
}

export const PACK_SOURCES: readonly PackSource[] = [];
