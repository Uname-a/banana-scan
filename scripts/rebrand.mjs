// SPDX-License-Identifier: AGPL-3.0-only
// Banana Scan is a fork of ScanRuler (github.com/CNCKitchen/ScanRuler). The
// ScanRuler name and the CNC Kitchen name and logo are trademarks that a fork
// may not use, so this renames what still carries them in every tracked text
// file. It is run again after each merge from upstream (docs/upstream.md):
// text already renamed has nothing left for it to match, so a second run
// changes nothing.
//
//   node scripts/rebrand.mjs           rename, then list what needs a person
//   node scripts/rebrand.mjs --check   change nothing; exit 1 if a rename is
//                                      due or anything needs a person
//
// Never touched: LICENSE; the changelogs, which are ScanRuler's history; any
// line with a copyright notice; a line marked `rebrand:keep`; anything
// between lines marked `rebrand:off` and `rebrand:on` (the credit to
// ScanRuler, and the code that still opens ScanRuler's project files); and a
// line naming scanruler.com, which needs a person to say where it points now.

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const checkOnly = process.argv.includes('--check')

/** Files left as they are. */
const SKIP_FILES = [/^LICENSE$/, /(^|\/)CHANGELOG\.md$/, /^scripts\/rebrand\.mjs$/, /^docs\/upstream\.md$/]

/** Not text, or a picture: renamed by a person, never rewritten. */
const BINARY = /\.(png|jpe?g|gif|ico|webp|svg|woff2?|ttf|otf|wasm|zip|stl|3mf|ply|obj|step|stp|pdf)$/i

/** Lines kept in one file, by what they say. */
const KEEP_LINES = {
  // npm's hash of a real spec, checked against a folder seen in a real cache:
  // a known answer that does not depend on this package's name.
  'mcp/tests/update.test.js': [/4250227d2a5c2d2b|seen on a real cache/],
}

/** Rules for one file, applied before RULES. */
const FILE_RULES = {
  // The namespace of the server's own tools, the part before the first
  // underscore of bananascan_status.
  'tests/skillNames.test.ts': [[/'scanruler'/g, "'bananascan'"]],
  // A bare name the same as the extension is still not a project.
  'tests/projectFileName.test.ts': [[/'scanruler'/g, "'bananascan'"]],
}

/** In order, the particular before the general. Tool names, settings keys
 *  and the extension go to `bananascan`, with no separator, since a tool's
 *  namespace is the part of its name before the first underscore; packages,
 *  folders and containers go to `banana-scan`; prose to "Banana Scan". */
const RULES = [
  [/ScanRuler by CNC Kitchen/g, 'Banana Scan'],
  [/github\.com\/CNCKitchen\/scanruler/gi, 'github.com/Uname-a/banana-scan'],
  [/\bCNCKitchen\/scanruler\b/gi, 'Uname-a/banana-scan'],
  [/scanruler\.example/g, 'banana-scan.example'],
  [/scanruler-mcp/g, 'banana-scan-mcp'],
  [/scanruler_/g, 'bananascan_'],
  [/SCANRULER_/g, 'BANANA_SCAN_'],
  [/__scanruler/g, '__bananascan'],
  [/(PROJECT_EXTENSION = ')scanruler'/g, "$1bananascan'"],
  [/`scanruler status`/g, '`bananascan status`'],
  // Codex's config table for the server, named as `codex mcp add` names it.
  [/mcp_servers\.scanruler/g, 'mcp_servers.banana-scan'],
  // The project file's extension: hinge.scanruler, \.scanruler in a pattern —
  // but not a property, s.scanrulerMs, which the camelCase rule takes.
  [/\.scanruler(?![A-Z])/g, '.bananascan'],
  [/\.SCANRULER(?!_)/g, '.BANANASCAN'],
  // Settings keys: 'scanruler.units', and scanruler\.[a-z0-9.]+ in a pattern.
  [/(?<![\w./-])scanruler(?=\\?\.[a-z[])/g, 'bananascan'],
  // camelCase: scanrulerMs.
  [/scanruler(?=[A-Z])/g, 'bananaScan'],
  // Inside a name or a path: ScanRulerPlugin, ~/ScanRuler — not prose after
  // a \n in a string.
  [/(?<![\\][nrt])(?<=[\w/~])ScanRuler|ScanRuler(?=\w)/g, 'BananaScan'],
  [/ScanRuler/g, 'Banana Scan'],
  [/scanruler-/g, 'banana-scan-'],
  [/scanruler/g, 'banana-scan'],
]

/** What a person has to look at, after the rules. */
const LEFT = [
  { why: 'still names ScanRuler', test: /scan[ _-]?ruler/i },
  {
    why: 'names CNC Kitchen',
    test: /cnc[ _-]?kitchen/i,
    // Credit, provenance and a product the code sizes holes for: not the
    // fork's name.
    fine: /github\.com\/CNCKitchen\/(meshStep|stlTexturizer)|heat-set insert|CNC Kitchen range|"author": "Stefan Hermann/i,
  },
  {
    why: 'runs banana-scan-mcp from npm, where it is not published',
    test: /npx[^\n]*banana-scan-mcp|"-y", "banana-scan-mcp|banana-scan-mcp@(latest|\d)/,
    // The self-update for once it is published, held off by PUBLISHED, and
    // its tests.
    skip: /^mcp\/(src\/update\.js|tests\/update\.test\.js)$/,
  },
]

const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean)

const applyAll = (text, rules) => rules.reduce((t, [from, to]) => t.replace(from, to), text)

let changedFiles = 0
let changedLines = 0
const left = []
/** With --check, what a run would change. */
const due = []

for (const file of tracked) {
  if (SKIP_FILES.some((re) => re.test(file)) || BINARY.test(file)) continue
  let text
  try {
    text = readFileSync(join(root, file), 'utf8')
  } catch {
    continue // deleted in the working tree
  }
  if (text.includes('\0')) continue
  const rules = [...(FILE_RULES[file] ?? []), ...RULES]
  const keep = KEEP_LINES[file] ?? []
  let off = false
  let changed = 0
  const lines = text.split('\n').map((line, i) => {
    if (line.includes('rebrand:off')) off = true
    if (line.includes('rebrand:on')) {
      off = false
      return line
    }
    if (off || line.includes('rebrand:keep') || /\bCopyright\b/.test(line) || keep.some((re) => re.test(line))) return line
    if (/scanruler\.com/i.test(line)) {
      left.push({ file, line: i + 1, why: 'names scanruler.com', text: line })
      return line
    }
    const next = applyAll(line, rules)
    if (next !== line) {
      changed++
      if (checkOnly) due.push({ file, line: i + 1, from: line, to: next })
    }
    for (const { why, test, fine, skip } of LEFT) {
      if (test.test(next) && !(fine && fine.test(next)) && !(skip && skip.test(file))) left.push({ file, line: i + 1, why, text: next })
    }
    return next
  })
  if (changed > 0) {
    changedFiles++
    changedLines += changed
    if (!checkOnly) writeFileSync(join(root, file), lines.join('\n'))
  }
}

// Files whose path carries the name: text files move with the rules, and a
// picture is left for a person, since a renamed logo is still the old logo.
let moved = 0
for (const file of tracked) {
  if (!/scanruler/i.test(file)) continue
  if (BINARY.test(file)) {
    left.push({ file, line: 0, why: 'a picture or binary named for ScanRuler', text: '' })
    continue
  }
  const to = applyAll(file, RULES)
  if (to === file) continue
  moved++
  if (!checkOnly) execFileSync('git', ['mv', file, to], { cwd: root })
  else left.push({ file, line: 0, why: `would move to ${to}`, text: '' })
}

const verb = checkOnly ? 'would change' : 'changed'
console.log(`${verb} ${changedLines} lines in ${changedFiles} files, ${checkOnly ? 'would move' : 'moved'} ${moved} files.`)
for (const { file, line, from, to } of due) console.log(`  ${file}:${line}\n    - ${from.trim().slice(0, 150)}\n    + ${to.trim().slice(0, 150)}`)
if (left.length > 0) {
  console.log(`\n${left.length} for a person to look at:`)
  for (const { file, line, why, text } of left) {
    const where = line ? `${file}:${line}` : file
    console.log(`  ${where} — ${why}${text ? `\n      ${text.trim().slice(0, 160)}` : ''}`)
  }
}
if (checkOnly && (changedLines > 0 || moved > 0 || left.length > 0)) process.exitCode = 1
