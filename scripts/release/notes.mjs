// The notes of the engine kit's GitHub Release (CI's release job, .github/workflows/ci.yml):
// what the release holds and how to start, then the version's CHANGELOG.md section.
//
//   node scripts/release/notes.mjs     the notes for package.json's version, on stdout
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The text under `## <version>` in a changelog, up to the next `## ` heading; throws when there is none. */
export function changelogSection(changelog, version) {
  const lines = changelog.split('\n');
  const start = lines.indexOf(`## ${version}`);
  if (start < 0) throw new Error(`CHANGELOG.md has no "## ${version}" section`);
  const end = lines.findIndex((line, i) => i > start && line.startsWith('## '));
  return lines
    .slice(start + 1, end < 0 ? undefined : end)
    .join('\n')
    .trim();
}

/** The release notes for `version` of the engine whose repository is `repo` (https://github.com/<owner>/<name>). */
export function releaseNotes({ changelog, version, repo }) {
  const section = changelogSection(changelog, version);
  return `Pixel Engine ${version} as the engine kit: \`pixel-engine.zip\` below holds the engine as one ES module, its guides, a starter game and \`check.mjs\`. Unzip it, then read \`README.md\` and \`GUIDE.md\`.

The newest release is always ${repo}/releases/latest/download/pixel-engine.zip; this one stays at ${repo}/releases/download/engine-v${version}/pixel-engine.zip.

## What changed in ${version}

${section}
`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = new URL('../../', import.meta.url);
  const meta = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
  const repo = String(meta.repository?.url ?? '').replace(/^git\+/, '').replace(/\.git$/, '');
  process.stdout.write(releaseNotes({ changelog: readFileSync(new URL('CHANGELOG.md', root), 'utf8'), version: meta.version, repo }));
}
