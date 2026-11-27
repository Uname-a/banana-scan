// SPDX-License-Identifier: AGPL-3.0-only
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { registerCoreCommands } from '../src/commands/core'
import { listGuides } from '../src/commands/guides'
import { listCommands, runsHeadless } from '../src/commands/registry'
import type { JsonSchema } from '../src/commands/schema'
import type { CommandInfo } from '../src/commands/types'
import type { BananaScanPlugin } from '../src/plugins/api'
import { installPlugins } from '../src/plugins/registry'
// @ts-expect-error — the MCP server is plain JavaScript, with no types
import { toolFor } from '../mcp/src/tools.js'

/** The command reference in docs/api/commands/: every command a build with
 *  this repository's plugins offers, written from the registry itself — the
 *  same names, schemas and descriptions an agent is given — so it is never
 *  a copy that drifted. */
const DIR = new URL('../docs/api/commands/', import.meta.url)
const APP = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version as string
const REGENERATE = 'UPDATE_API_DOC=1 npx vitest run tests/apiDoc.test.ts'

type Schema = JsonSchema & Record<string, unknown>

/** A Markdown table cell: one line, no bare pipes. */
const cell = (s: string) => s.replace(/\r?\n+/g, ' ').replace(/\|/g, '\\|').trim()

const quote = (v: unknown) => (typeof v === 'string' ? `"${v}"` : JSON.stringify(v))

/** A schema's type, as a short line: `number[3]`, `"a" | "b"`, `integer | string`. */
function typeOf(s: Schema | undefined): string {
  if (!s || typeof s !== 'object') return 'any'
  if (Array.isArray(s.enum)) return (s.enum as unknown[]).map(quote).join(' | ')
  if (Array.isArray(s.oneOf)) return (s.oneOf as Schema[]).map((v) => (v.type === 'object' ? objectShape(v) : typeOf(v))).join(' | ')
  if (Array.isArray(s.anyOf)) return (s.anyOf as Schema[]).map(typeOf).join(' | ')
  const t = s.type
  if (Array.isArray(t)) return t.join(' | ')
  if (t === 'string' && s.format === 'binary') return 'bytes'
  if (t === 'array') {
    const items = s.items as Schema | undefined
    const inner = typeOf(items)
    const wrapped = /\s/.test(inner) ? `(${inner})` : inner
    const lo = s.minItems as number | undefined
    const hi = s.maxItems as number | undefined
    return lo !== undefined && lo === hi ? `${wrapped}[${lo}]` : `${wrapped}[]`
  }
  if (t === 'object') return 'object'
  return typeof t === 'string' ? t : 'any'
}

/** An object as its keys: `{ element }`. */
const objectShape = (s: Schema) => `{ ${Object.keys((s.properties as Record<string, Schema>) ?? {}).join(', ') || '…'} }`

/** The bounds and lengths a schema holds a value to, as words. */
function limits(s: Schema): string[] {
  const out: string[] = []
  if (s.minimum !== undefined) out.push(`≥ ${s.minimum}`)
  if (s.exclusiveMinimum !== undefined) out.push(`> ${s.exclusiveMinimum}`)
  if (s.maximum !== undefined) out.push(`≤ ${s.maximum}`)
  if (s.exclusiveMaximum !== undefined) out.push(`< ${s.exclusiveMaximum}`)
  if (s.type === 'array') {
    const lo = s.minItems as number | undefined
    const hi = s.maxItems as number | undefined
    if (!(lo !== undefined && lo === hi)) {
      if (lo !== undefined && hi !== undefined) out.push(`${lo}–${hi} items`)
      else if (lo !== undefined) out.push(`at least ${lo} item${lo === 1 ? '' : 's'}`)
      else if (hi !== undefined) out.push(`at most ${hi} items`)
    }
  }
  if (s.minLength !== undefined && s.minLength !== 1) out.push(`at least ${s.minLength} characters`)
  if (s.default !== undefined) out.push(`default ${quote(s.default)}`)
  return out
}

interface Row {
  field: string
  type: string
  required: boolean
  about: string
}

/** How deep a field's path is listed; deeper ones are named by their type. */
const DEPTH = 4

/** The rows of an object's fields, nested ones by dotted paths — `a.b`,
 *  `a[].b` for a list's items — and a choice of shapes (oneOf) a row per
 *  field of each, marked by which form it belongs to. */
function rows(s: Schema, prefix = '', depth = 1, form = ''): Row[] {
  const props = (s.properties as Record<string, Schema>) ?? {}
  const required = new Set((s.required as string[]) ?? [])
  const out: Row[] = []
  for (const [key, p] of Object.entries(props)) {
    const field = `${prefix}${key}`
    const words = [form, ...limits(p).map((l) => `*${l}*`)].filter(Boolean)
    const description = typeof p.description === 'string' ? p.description : ''
    out.push({ field, type: typeOf(p), required: required.has(key), about: [description, words.length ? `(${words.join(', ')})` : ''].filter(Boolean).join(' ') })
    if (depth >= DEPTH) continue
    out.push(...nested(p, field, depth))
  }
  return out
}

function nested(p: Schema, field: string, depth: number): Row[] {
  if (p.type === 'object' && p.properties) return rows(p, `${field}.`, depth + 1)
  if (p.type === 'array' && (p.items as Schema | undefined)?.type === 'object') return rows(p.items as Schema, `${field}[].`, depth + 1)
  if (p.type === 'array' && Array.isArray((p.items as Schema | undefined)?.oneOf)) return nested(p.items as Schema, `${field}[]`, depth)
  if (Array.isArray(p.oneOf)) {
    const forms = (p.oneOf as Schema[]).filter((v) => v.type === 'object' && v.properties)
    return forms.flatMap((v) => rows(v, `${field}.`, depth + 1, `form ${(p.oneOf as Schema[]).indexOf(v) + 1}: ${objectShape(v)}`))
  }
  return []
}

const FLAG_WORDS: [keyof CommandInfo | 'headless', string][] = [
  ['readOnly', 'read-only'],
  ['returnsImage', 'returns a picture'],
  ['returnsFile', 'returns a file'],
  ['long', 'long (runs as a job)'],
  ['exact', 'exact numbers'],
  ['headless', 'runs headless'],
]

/** What the MCP server adds to or takes from a command's input when it
 *  makes it a tool (mcp/src/tools.js). */
function asTool(c: CommandInfo): string {
  const tool = toolFor(c, { outDir: '<out>', cwd: '<cwd>' }) as { name: string; inputSchema: Schema }
  const mine = Object.keys((c.input.properties as Record<string, unknown>) ?? {})
  const theirs = Object.keys((tool.inputSchema.properties as Record<string, unknown>) ?? {})
  const added = theirs.filter((k) => !mine.includes(k))
  const removed = mine.filter((k) => !theirs.includes(k))
  const parts = [`MCP tool \`${tool.name}\``]
  if (removed.length) parts.push(`takes \`path\` in place of ${removed.map((k) => `\`${k}\``).join(', ')}`)
  const extra = added.filter((k) => !(removed.length && k === 'path'))
  if (extra.length) parts.push(`adds ${extra.map((k) => `\`${k}\``).join(', ')}`)
  return parts.join(' — ')
}

const anchor = (name: string) => name.replace(/\./g, '_')

function commandSection(c: CommandInfo & { headless: boolean }): string {
  const flags = FLAG_WORDS.filter(([k]) => (c as unknown as Record<string, unknown>)[k]).map(([, w]) => w)
  if (!c.readOnly) flags.unshift('change — one undo step')
  const lines = [`<a id="${anchor(c.name)}"></a>`, `### \`${c.name}\``, '', `**${c.title}** · ${flags.join(' · ')}  `, `${asTool(c)}`, '', c.description, '']
  const table = rows(c.input as Schema)
  if (table.length) {
    lines.push('| Field | Type | Req. | Description |', '|---|---|:-:|---|')
    for (const r of table) lines.push(`| \`${r.field}\` | ${cell(r.type)} | ${r.required ? '✓' : ''} | ${cell(r.about)} |`)
  } else lines.push('*No input.*')
  if (c.names) lines.push('', `Names new things at ${c.names.at.map((a) => `\`${a}\``).join(', ')}, unique among ${c.names.space}.`)
  if (c.askForLess) lines.push('', `Too long an answer: ask for ${c.askForLess}.`)
  lines.push('')
  return lines.join('\n')
}

const HEADER = (what: string) =>
  `<!-- SPDX-License-Identifier: AGPL-3.0-only -->\n<!-- Generated from the command registry by tests/apiDoc.test.ts: do not edit by hand. ${REGENERATE} -->\n# ${what}\n`

/** Where each namespace's commands come from. */
function owner(ns: string, plugins: readonly BananaScanPlugin[]): string {
  const p = plugins.find((x) => x.id === ns || x.workspace?.id === ns)
  return p ? `the [\`${p.id}\`](../../../plugins/${p.id}/) plugin` : 'the app'
}

function render(plugins: readonly BananaScanPlugin[]): Map<string, string> {
  const commands = listCommands().map((c) => ({ ...c, headless: runsHeadless(c.name) }))
  const byNs = new Map<string, typeof commands>()
  for (const c of commands) {
    const ns = c.name.split('.')[0]
    if (!byNs.has(ns)) byNs.set(ns, [])
    byNs.get(ns)!.push(c)
  }
  const files = new Map<string, string>()
  for (const [ns, list] of byNs) {
    const body = [
      HEADER(`\`${ns}.*\` commands`),
      `${list.length} command${list.length === 1 ? '' : 's'}, from ${owner(ns, plugins)}, Banana Scan ${APP}. How to call them, and what every answer and refusal looks like: [the API overview](../README.md). All commands: [index](README.md).`,
      '',
      ...list.map((c) => `- [\`${c.name}\`](#${anchor(c.name)}) — ${c.title}`),
      '',
      ...list.map(commandSection),
    ]
    files.set(`${ns}.md`, body.join('\n'))
  }
  const index = [
    HEADER('Command reference'),
    `Every command of Banana Scan ${APP} with the plugins in this repository: ${commands.length} in all, ${commands.filter((c) => c.readOnly).length} read-only. An MCP tool's name is the command's with dots as underscores (\`element.fit\` → \`element_fit\`). How commands are called, and what answers and refusals look like: [the API overview](../README.md).`,
    '',
    'Kinds: **R** read-only, **C** a change (one undo step), **P** returns a picture, **F** returns a file, **L** long (an MCP server runs it as a job), **H** runs headless.',
    '',
    '| Namespace | From | Commands |',
    '|---|---|--:|',
    ...[...byNs].map(([ns, list]) => `| [\`${ns}\`](${ns}.md) | ${owner(ns, plugins)} | ${list.length} |`),
    '',
  ]
  for (const [ns, list] of byNs) {
    index.push(`## [\`${ns}\`](${ns}.md)`, '', '| Command | Title | Kind |', '|---|---|---|')
    for (const c of list) {
      const kind = [c.readOnly ? 'R' : 'C', c.returnsImage ? 'P' : '', c.returnsFile && !c.returnsImage ? 'F' : '', c.long ? 'L' : '', c.headless ? 'H' : ''].filter(Boolean).join(' ')
      index.push(`| [\`${c.name}\`](${ns}.md#${anchor(c.name)}) | ${cell(c.title)} | ${kind} |`)
    }
    index.push('')
  }
  index.push(
    '## Guides',
    '',
    'What `guide.read` serves an agent before a task — the workflow and judgement the tools do not carry, written for this build. `guide.read` with no topic lists them; with `topic` and `section` it gives a part.',
    '',
    '| Topic | Title | For | Read with |',
    '|---|---|---|---|',
    ...listGuides().map((g) => `| \`${g.id}\` | ${cell(g.title)} | ${cell(g.when)} | ${(g.with ?? []).map((w) => `\`${w}\``).join(', ')} |`),
    '',
  )
  files.set('README.md', index.join('\n'))
  return files
}

// Not a check every run makes: a command's wording changes often, on
// branches of their own. CHECK_API_DOC=1 checks it; UPDATE_API_DOC=1 writes it.
describe.runIf(process.env.UPDATE_API_DOC || process.env.CHECK_API_DOC)('the command reference in docs/api/commands', () => {
  it('is the registry’s own', async () => {
    registerCoreCommands()
    // Every plugin in the repository, as a build with all of them has it.
    const files = render(installPlugins())
    if (process.env.UPDATE_API_DOC) {
      rmSync(DIR, { recursive: true, force: true })
      mkdirSync(DIR, { recursive: true })
      for (const [name, text] of files) writeFileSync(new URL(name, DIR), text)
    }
    const hint = `docs/api/commands is out of date — run ${REGENERATE}`
    const kept = (() => {
      try {
        return readdirSync(DIR).sort()
      } catch {
        return []
      }
    })()
    expect(kept, hint).toEqual([...files.keys()].sort())
    // A checkout may have given the files Windows line ends.
    for (const [name, text] of files) expect(readFileSync(new URL(name, DIR), 'utf8').replace(/\r\n/g, '\n'), `${hint} (${name})`).toBe(text)
  })
})
