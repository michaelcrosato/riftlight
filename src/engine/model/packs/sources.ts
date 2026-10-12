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
}

export const PACK_SOURCES: readonly PackSource[] = [];
