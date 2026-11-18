// Types for head.mjs (the head of a page built for 52in1), for the tests that read it.

/** The hub's client, vendored unmodified. */
export const SESSION_CLIENT: string;
/** A JSON block's text: every `<` escaped, so no line can end the block early. */
export function blockJson(data: unknown): string;
/** Everything that goes right after `<meta charset>`, in the order the hub reads it. */
export function hubHead(o: {
  title: string;
  description: string;
  themeColor: string;
  icon: string;
  tags: Record<string, string | undefined>;
  session: Record<string, string> | null;
  moments?: readonly string[];
  lines: unknown;
  translations?: unknown;
  client?: boolean;
}): string;
/** `html` (a built page) with `head` right after its `<meta charset>`; `lang` on `<html>`. */
export function hubPage(html: string, head: string, lang?: string): string;
/** A page's `<meta name content>` tags as the hub reads them: the first of each, or every one. */
export function readHead(html: string): { one(name: string): string | undefined; all(name: string): string[] };
