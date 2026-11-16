<!-- SPDX-License-Identifier: AGPL-3.0-only -->

# Banana Scan and ScanRuler

Banana Scan is a fork of [ScanRuler](https://github.com/CNCKitchen/ScanRuler)
by Stefan Hermann (CNC Kitchen), made on 13 November 2026 from ScanRuler
0.11.2 (commit `89ca713`, 11 November 2026) with its full history. ScanRuler is
under the GNU AGPL-3.0-only, and so is Banana Scan. The `upstream` remote is
CNC Kitchen's repository, for fetching only: its push address is `no_push`.

## What is different

- **The name.** The ScanRuler name and the CNC Kitchen name and logo are CNC
  Kitchen's trademarks, which a fork may not use. `scripts/rebrand.mjs` renames
  them in every tracked text file: "Banana Scan" in prose, `banana-scan` for
  packages, folders and containers, `bananascan` for the agent's tool names
  (`bananascan_status`), settings keys and the project extension, and
  `BANANA_SCAN_` for environment variables. The logo in `public/` and
  `docs/brand/` is Banana Scan's own. Copyright notices, `LICENSE` and the
  changelogs' history are left as they are.
- **Projects** are saved as `.bananascan` with `app: "Banana Scan"`.
  ScanRuler's `.scanruler` projects still open, and are saved as Banana
  Scan's (`src/core/project/manifest.ts`, and the agent server's file kinds).
- **The agent server** (`mcp/`, `banana-scan-mcp`) is not on npm. It runs from
  this repository, `node /path/to/banana-scan/mcp/bin/banana-scan-mcp.js`, and
  is updated with it. Its self-update from npm is off while `PUBLISHED` in
  `mcp/src/update.js` is false, since a copy that went looking for a package
  name nobody holds would run whatever was published under it. The pairing
  link opens the dev server (`http://localhost:5173/`), and the server lets in
  pages from this computer and `--allow-origin` addresses only, no longer
  scanruler.com.
- **About & Privacy** replaces ScanRuler's imprint, which named CNC Kitchen as
  the site's operator. It credits ScanRuler, carries the AGPL notices and links
  this version's source. A public deployment adds its own operator details
  there (`src/ui/Imprint.tsx`), and has to offer its users this version's
  source (the AGPL's section 13). This repository, public at
  https://github.com/Uname-a/banana-scan, is that source for the code it
  holds, and About & Privacy links it; a deployment of a changed version links
  its own.
- **The support card** for CNC Kitchen's store and tips stays, as a credit to
  them, but is off unless switched on in Settings.
- **No file store** for short links (`/s/<name>`) until a build is given one
  with `VITE_FILES_URL`; ScanRuler's pointed at its own.
- **Gone:** CNC Kitchen's contributor agreement (`CLA.md`) and the workflow
  that collected it, their commercial-licensing page (`COMMERCIAL.md`) and
  their logo files. Only CNC Kitchen can license their code commercially;
  the README's license section says what applies here.
- **The default navigation scheme** is labelled Banana Scan, not CNC Kitchen.

## Taking in ScanRuler's later work

```bash
git fetch upstream
git switch -c upstream-merge         # work on a branch
git merge upstream/main
```

Most conflicts will be lines CNC Kitchen changed that Banana Scan renamed. In a
file whose conflicts are all of that kind, take their side and let the script
rename it again:

```bash
git checkout --theirs -- <file>
node scripts/rebrand.mjs             # renames what came in; lists what needs a person
```

These files were changed by hand beyond the rename, so their conflicts need
a real merge, keeping both sides' intent:

- the app: `src/ui/Imprint.tsx`, `src/ui/SupportCard.tsx`,
  `src/ui/StatusStrip.tsx`, `src/ui/TopBar.tsx`, `src/ui/SettingsModal.tsx`,
  `src/ui/ConnectorBar.tsx`, `src/state/prefsStore.ts`, `src/state/palette.ts`,
  `src/styles.css` (comments), `src/version.ts`, `src/viewer/navSchemes.ts`,
  `src/core/project/manifest.ts`, `src/app/addressOpen.ts`,
  `src/commands/agentLink.ts`, `src/commands/bridge.ts`, `.env`
- the agent server: `mcp/src/update.js`, `mcp/src/link.js`,
  `mcp/src/main.js`, `mcp/src/mcp.js`, `mcp/src/tools.js`,
  `mcp/package.json`
- the guides an agent reads: `src/commands/guides/measure.md`,
  `plugins/reverse/guides/model.md`, `plugins/reverse/guides/scan-to-cad.md`
  (the last two are held to a size limit, `plugins/reverse/tests/reGuides.test.ts`)
- tests: `tests/agentBridge.test.ts`, `tests/navSchemes.test.ts`,
  `tests/project.test.ts`, `tests/projectFileName.test.ts`,
  `scripts/e2e-nav.mjs`, `mcp/tests/update.test.js`, `mcp/tests/link.test.js`,
  `mcp/tests/browser.test.js`, `mcp/tests/fakePage.js`
- documents: `README.md`, `mcp/README.md`, `CONTRIBUTING.md`, `AGENTS.md`,
  `CHANGELOG.md` (the top), `docs/development.md`, `docs/docker.md`,
  `docs/manual.md`, `plugins/README.md`, `plugins/mesh-tools/README.md`,
  `plugins/reverse/README.md`
- the rest: `Dockerfile`, `.github/ISSUE_TEMPLATE/*`,
  `.github/workflows/license-check.yml`, `public/favicon.svg`,
  `public/favicon.ico`

A file CNC Kitchen changed that Banana Scan deleted (`CLA.md`,
`COMMERCIAL.md`, `.github/workflows/cla.yml`, `docs/brand/scanruler-*`)
stays deleted: `git rm` it. A new picture or logo of theirs is listed by the
script and is not renamed: it is still their logo. Their changelog entries
come in under their own version headings, as their history.

Then, before merging the branch:

```bash
node scripts/rebrand.mjs --check     # nothing left to rename, nothing listed
node scripts/check-plugin-boundary.mjs && node scripts/check-units.mjs
npm test && npm --prefix mcp test && npm run build && npm run e2e:ci
UPDATE_MCP_COMMANDS=1 npx vitest run tests/mcpCommands.test.ts   # when the version changed
```

`rebrand.mjs` leaves alone any line marked `rebrand:keep`, anything between
lines marked `rebrand:off` and `rebrand:on`, any copyright line, `LICENSE` and
the changelogs. It never rewrites a line naming scanruler.com: it lists it, for
a person to say where it should point now.
