// The head of a page built for the AI Hub (AI Hub Catalogue v1, Session Protocol v1, Languages v1):
// `hubHead(o)` writes everything that goes right after `<meta charset>`, in the order the hub
// reads it: the session client (session.js, unmodified, the page's first script), the viewport,
// the title, description, theme colour and icon, the `hub:*` tags, the session's tags, then the
// `game-lines` block and (the hand-over build only) `game-translations`. `hubPage(html, head)`
// puts it into a built page, replacing what the page had of the same.
//
// docs/game/session.md, docs/engine/hub.md, docs/engine/lang.md.
import { readFileSync } from 'node:fs';

/** The hub's client, vendored unmodified (the hub replaces an unmodified copy with each new version). */
export const SESSION_CLIENT = readFileSync(new URL('./session.js', import.meta.url), 'utf8');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** A JSON block's text: every `<` as <, so no line can end the block early. */
export const blockJson = (data) => JSON.stringify(data).replace(/</g, '\\u003c');

/**
 * @param {object} o
 * @param {string} o.title            `NAME — TAGLINE`
 * @param {string} o.description
 * @param {string} o.themeColor       `#RRGGBB`
 * @param {string} o.icon             a data: URI
 * @param {Record<string, string | undefined>} o.tags     `hub:*` catalogue tags in order (undefined: left out)
 * @param {Record<string, string> | null} o.session        `hub:session-*` tags, or null (hub:session 0)
 * @param {object} o.lines            the game-lines block
 * @param {object | null} [o.translations]  the game-translations block (hand-over build)
 * @param {boolean} [o.client]        carry the session client (pages with hub:session 1)
 */
export function hubHead(o) {
  const out = [];
  if (o.client) out.push(`<script>${SESSION_CLIENT}</script>`); // byte for byte: an unmodified copy is replaced with each new version
  out.push('<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">');
  out.push(`<title>${esc(o.title)}</title>`);
  out.push(`<meta name="description" content="${esc(o.description)}">`);
  out.push(`<meta name="theme-color" content="${esc(o.themeColor)}">`);
  out.push(`<link rel="icon" href="${o.icon}">`);
  for (const [name, content] of Object.entries(o.tags)) if (content !== undefined && content !== '') out.push(`<meta name="${name}" content="${esc(content)}">`);
  for (const [name, content] of Object.entries(o.session ?? {})) out.push(`<meta name="${name}" content="${esc(content)}">`);
  out.push(`<script type="application/json" id="game-lines">${blockJson(o.lines)}</script>`);
  if (o.translations && Object.keys(o.translations).length) out.push(`<script type="application/json" id="game-translations">${blockJson(o.translations)}</script>`);
  return out.join('\n');
}

/**
 * `html` (a built page) with `head` right after its `<meta charset>`, and the page's own viewport,
 * title and icon taken out (the head has them now). `lang` goes on `<html>`.
 */
export function hubPage(html, head, lang = 'en') {
  let page = html
    .replace(/<meta name="viewport"[^>]*>\s*/i, '')
    .replace(/<title>[\s\S]*?<\/title>\s*/i, '')
    .replace(/<link rel="icon"[^>]*>\s*/i, '');
  page = page.replace(/<html[^>]*>/i, `<html lang="${esc(lang)}">`);
  const charset = /<meta charset="[^"]*"\s*\/?>/i;
  if (!charset.test(page)) throw new Error('hubPage: the page has no <meta charset>');
  return page.replace(charset, () => `<meta charset="utf-8">\n${head}`);
}
