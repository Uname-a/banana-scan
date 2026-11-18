// SPDX-License-Identifier: AGPL-3.0-only
// Mesh Tools' guide (plugins/mesh-tools/guides) names only tools that
// exist — every tool name in backticks is a command the app registers with
// every plugin installed, as the server lists it, or one of the server's
// own — and guide.read serves it whole, with the guide it is read with.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { registerCoreCommands } from '../../../src/commands/core'
import { listGuides } from '../../../src/commands/guides'
import { listCommands, runCommand } from '../../../src/commands/registry'
import { installPlugins } from '../../../src/plugins/registry'

const FILE = new URL('../guides/flat-patterns.md', import.meta.url)
const MCP = readFileSync(new URL('../../../mcp/src/mcp.js', import.meta.url), 'utf8')
const text = readFileSync(FILE, 'utf8').split('\r\n').join('\n')

describe('the flat-patterns guide', () => {
  it('names only tools that exist, and teaches the workspace’s own', () => {
    installPlugins()
    registerCoreCommands()
    const known = new Set([...listCommands().map((c) => c.name.split('.').join('_')), ...[...MCP.matchAll(/name: '(bananascan_[a-z_]+)'/g)].map((m) => m[1])])
    const spaces = new Set([...known].map((n) => n.split('_')[0]))
    const named = [...new Set([...text.matchAll(/`([a-z][a-z0-9]*_[a-z0-9_]+)`/g)].map((m) => m[1]))].filter((n) => spaces.has(n.split('_')[0]))
    expect(named.filter((n) => !known.has(n))).toEqual([])
    expect(named).toEqual(expect.arrayContaining(['mesh_unroll', 'mesh_flatten', 'mesh_export_pattern']))
  })

  it('is served whole, read with the measure guide', async () => {
    installPlugins()
    registerCoreCommands()
    const g = listGuides().find((x) => x.id === 'flat-patterns')
    expect(g?.with).toEqual(['measure'])
    expect(listGuides().map((x) => x.id)).toContain('measure')
    const answer = (await runCommand('guide.read', { topic: 'flat-patterns' })) as { guides: { topic: string; text: string }[] }
    const served = answer.guides.find((x) => x.topic === 'flat-patterns')!
    expect(text.trim().endsWith(served.text.slice(-200).trim())).toBe(true)
  })
})
