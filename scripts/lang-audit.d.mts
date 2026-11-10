export { strays } from './lang-strays.mjs';

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
