/** A choice from the page's URL (`?asset=`), or null where there is no page (headless, docs/engine/headless.md). */
export function pageParam(name: string): string | null {
  return typeof location === 'undefined' ? null : new URLSearchParams(location.search).get(name);
}
