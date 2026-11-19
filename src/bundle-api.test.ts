// The kit's API.md (scripts/bundle/api.mjs) says every export whole: an agent outside this repo
// reads it for exact names (README: "every export with its signature and doc"), so no doc is cut
// mid-sentence or after its first paragraph (Engine.loadGame's unload contract, Hud.legend's
// example), no code table in a doc loses its rows, and no type reads `... 4 more ...` (KEYMAP's
// pad buttons were cut off both ways). A small program of long docs and long types, run through
// the same generator the bundle uses.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';
import { afterAll, describe, expect, it } from 'vitest';
import { generateApi } from '../scripts/bundle/api.mjs';

const dir = mkdtempSync(join(tmpdir(), 'bundle-api-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** A sentence `n` times, then the doc's last words: what a cut would lose. */
const long = (n: number, last: string) => `${'Every word here is one the reader needs to see. '.repeat(n)}${last}`;
/** Twelve actions, a key and a pad button each: a type TypeScript shortens unless asked not to. */
const ACTIONS = Array.from({ length: 12 }, (_, i) => `act${i}: ['Key${String.fromCharCode(65 + i)}', 'Pad${i}']`);

function api(): string {
  const src = join(dir, 'src');
  mkdirSync(join(src, 'engine'), { recursive: true });
  writeFileSync(
    join(src, 'engine/thing.ts'),
    `/**
 * ${long(20, 'The map ends with its table:')}
 *
 *   Space · Cross    jump
 *   C · Circle       crouch
 *   B · L3           sit (THE TABLE'S LAST ROW)
 */
export const KEYS = { ${ACTIONS.join(', ')} } as const;

/** ${long(25, 'THE CLASS DOC ENDS HERE.')} */
export class Thing {
  /** ${long(8, 'THE MEMBER DOC ENDS HERE.')} */
  wide = { ${ACTIONS.join(', ')} };
  /**
   * ${long(3, 'THE FIRST PARAGRAPH ENDS HERE.')}
   *
   * THE SECOND PARAGRAPH: what goes and what stays,
   * over two lines.
   *
   *   thing.go(1); // THE MEMBER'S EXAMPLE
   */
  go(n: number): void {}
  constructor(${Array.from({ length: 10 }, (_, i) => `argumentNumber${i}: string`).join(', ')}) {}
}

/** ${long(20, 'THE INTERFACE DOC ENDS HERE.')} */
export interface Opts {
  /** ${long(8, 'THE FIELD DOC ENDS HERE.')} */
  pick?: ${Array.from({ length: 30 }, (_, i) => `'choice-${i}'`).join(' | ')};
}

/** ${long(20, 'THE TYPE DOC ENDS HERE.')} */
export type Choice = ${Array.from({ length: 40 }, (_, i) => `'option-${i}'`).join(' | ')};

/** ${long(20, 'THE FUNCTION DOC ENDS HERE.')} */
export function make() {
  return KEYS;
}
`,
  );
  writeFileSync(join(src, 'bundle.ts'), "export { KEYS, make, Thing, type Choice, type Opts } from './engine/thing';\n");
  const program = ts.createProgram([join(src, 'bundle.ts')], { strict: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, noEmit: true });
  return generateApi(program, join(src, 'bundle.ts'), src, { version: '0.0.0', build: 'test' }).markdown;
}

describe("the kit's API.md", () => {
  const md = api();

  it('cuts no doc short: every one ends as written, its code table whole', () => {
    for (const end of ['THE CLASS DOC ENDS HERE.', 'THE MEMBER DOC ENDS HERE.', 'THE INTERFACE DOC ENDS HERE.', 'THE FIELD DOC ENDS HERE.', 'THE TYPE DOC ENDS HERE.', 'THE FUNCTION DOC ENDS HERE.', "B · L3           sit (THE TABLE'S LAST ROW)"]) {
      expect(md, end).toContain(end);
    }
    expect(md).not.toMatch(/…/);
  });

  it("writes a member's doc whole: every later paragraph under its bullet, an example as written", () => {
    const item = md.slice(md.indexOf('- `go(n: number): void`: ')).split(/\n(?=- |#)/)[0]!; // up to the next member or entry
    expect(item).toContain('THE FIRST PARAGRAPH ENDS HERE.\n\n  THE SECOND PARAGRAPH: what goes and what stays,\n  over two lines.\n\n');
    expect(item).toContain("\n    thing.go(1); // THE MEMBER'S EXAMPLE");
  });

  it('writes every type and signature whole (no "... 4 more ...")', () => {
    expect(md).not.toMatch(/\.\.\. \d+ more \.\.\./);
    expect(md).toContain(`readonly act11: readonly ["KeyL", "Pad11"]; }`); // KEYS: its last action
    expect(md).toContain(`act11: string[]; }`); // Thing.wide, a member's type from the checker
    expect(md).toContain('argumentNumber9: string)'); // the constructor's last parameter
    expect(md).toContain("'choice-29'"); // Opts.pick's last choice
    expect(md).toContain("'option-39'"); // Choice's last option
    expect(md).toMatch(/function make\(\): \{ readonly act0: .*readonly act11: readonly \["KeyL", "Pad11"\]; \}/); // an inferred return type
  });
});
