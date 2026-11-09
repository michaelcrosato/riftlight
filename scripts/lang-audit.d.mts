/** The words in a drawn string that aren't the test language (proper names, digits and symbols aside). */
export function strays(text: string, names: readonly string[]): string[];

export interface AuditReport {
  readonly lang: string;
  readonly screens: { name: string; texts: number; offenders: string[] }[];
  /** Distinct strings on screen that aren't lines. */
  readonly offenders: number;
  readonly all?: Record<string, string[]>;
  readonly errors: string[];
}

/** Play the built game under a test language and list every string on screen that isn't a line. */
export function audit(o: { root: string; lang?: string; names?: readonly string[]; out?: string }): Promise<AuditReport>;
