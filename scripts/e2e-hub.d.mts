// Types for e2e-hub.mjs (the `hub` e2e suite's 52in1 session harness runs), for the tests that read them.

/** An online mode a built page offers, as the hub reads it (`modesOf`): where, how, and its seats. */
export interface HubOfferMode {
  readonly where: string;
  readonly play?: string | null;
  readonly seats: readonly [number, number];
}
/** The online modes a built page offers, and the ids of its moments. */
export function pageModes(html: string): { modes: HubOfferMode[]; moments: string[] };
/** The harness runs (each a query) for each online mode a page offers; `full`: the hub's own set. */
export function protocolRuns(offer: { readonly modes: readonly HubOfferMode[]; readonly moments: readonly string[] }, options?: { full?: boolean }): string[];
/** Where the `hub` suite's runs that fail leave their evidence (CI keeps it). */
export const EVIDENCE: string;
/** An empty evidence folder at `dir`; returns where the run `query`, the `index`th of its set, leaves its evidence there. */
export function evidenceFolder(dir: string): Promise<(index: number, query: string) => string>;
