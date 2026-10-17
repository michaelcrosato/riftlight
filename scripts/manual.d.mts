/** Did the command line ask for the manual: `help` as the first word, or `--help` / `-h` anywhere? */
export function wantsHelp(argv?: string[]): boolean;

/** The leading `//` comment of a file (a `#!` line skipped), without the slashes. */
export function manual(fileUrl: string | URL): string;

/** Print the file's manual and exit 0 when the command line asks for it (see wantsHelp). */
export function helpExit(fileUrl: string | URL, argv?: string[]): void;
