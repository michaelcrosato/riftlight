/** The text under `## <version>` in a changelog, up to the next `## ` heading; throws when there is none. */
export function changelogSection(changelog: string, version: string): string;

/** The release notes for `version` of the engine whose repository is `repo` (https://github.com/<owner>/<name>). */
export function releaseNotes(options: { changelog: string; version: string; repo: string }): string;
