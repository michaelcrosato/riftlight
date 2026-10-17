// Every CLI's manual is the comment at the top of its file. `help` (first), `--help` or `-h`
// prints it and exits 0 before the tool does anything else:
//
//   import { helpExit } from './manual.mjs';
//   helpExit(import.meta.url); // first thing in the module body
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Did the command line ask for the manual: `help` as the first word, or `--help` / `-h` anywhere? */
export function wantsHelp(argv = process.argv.slice(2)) {
  return argv[0] === 'help' || argv.includes('--help') || argv.includes('-h');
}

/** The leading `//` comment of a file (a `#!` line skipped), without the slashes. */
export function manual(fileUrl) {
  const lines = readFileSync(fileUrl instanceof URL || String(fileUrl).startsWith('file:') ? fileURLToPath(fileUrl) : fileUrl, 'utf8').split('\n');
  const from = lines[0]?.startsWith('#!') ? 1 : 0;
  const end = lines.findIndex((l, i) => i >= from && !l.startsWith('//'));
  return lines
    .slice(from, end < 0 ? lines.length : end)
    .map((l) => l.replace(/^\/\/ ?/, ''))
    .join('\n');
}

/** Print the file's manual and exit 0 when the command line asks for it (see wantsHelp). */
export function helpExit(fileUrl, argv = process.argv.slice(2)) {
  if (!wantsHelp(argv)) return;
  console.log(manual(fileUrl));
  process.exit(0);
}
