import type ts from 'typescript';

/** API.md from the bundle's TypeScript program (see api.mjs): its markdown and every export's name. */
export function generateApi(program: ts.Program, entryFile: string, srcDir: string, meta: { version: string; build: string }): { markdown: string; names: string[] };
