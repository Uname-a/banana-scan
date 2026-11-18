// SPDX-License-Identifier: AGPL-3.0-only
// Unroll / flatten, the Mesh Tools tool that makes a flat pattern of a
// region of the scan — beside it, never an edit of it: a cylinder or cone
// unrolled by the element fitted to it, or a bent sheet flattened (see
// core/unroll and core/flatten). What the tool is set to, and the pattern
// last made, which the panel draws and exports as a DXF or an SVG. Kept
// apart from the edits' settings: nothing here is a step of the undo
// history, or goes into a project — a pattern is made again in a moment.

import { create } from 'zustand'
import type { UnrollReport } from '../core/unroll'
import type { FlattenReport } from '../core/flatten'
import type { FlatPattern } from '../core/flatPattern'

/** Unroll by a cylinder's or a cone's geometry, or flatten a sheet with the
 *  least distortion. */
export type PatternMode = 'unroll' | 'flatten'

/** What an unroll lays out: the surface of the scan on the element, found
 *  by itself, or a region marked on the part. A flattening always takes a
 *  marked region. */
export type PatternScope = 'surface' | 'marked'

/** Surface marked for a pattern: a magenta, none of the other markings'
 *  colours. */
export const PATTERN_MARK_COLOR = '#d6409f'

export type PatternMade = FlatPattern &
  (
    | { mode: 'unroll'; report: UnrollReport; offset: number }
    | { mode: 'flatten'; report: FlattenReport }
  ) & {
    /** What it was made of, for the file's title: the element's name, or
     *  "region". */
    source: string
  }

interface PatternState {
  mode: PatternMode
  scope: PatternScope
  /** The cylinder or cone to unroll by, by id — null for none chosen. */
  element: number | null
  /** How far outside the fitted surface to lay it out, mm — inside,
   *  negative: half the thickness, for sheet metal's neutral fibre. */
  offset: number
  running: boolean
  message: string | null
  made: PatternMade | null
  /** Bumped whenever a pattern lands or goes. */
  version: number
  setMode: (mode: PatternMode) => void
  setScope: (scope: PatternScope) => void
  setElement: (element: number | null) => void
  setOffset: (offset: number) => void
  begin: () => void
  resolve: (made: PatternMade) => void
  fail: (message: string) => void
  clear: () => void
}

export const usePattern = create<PatternState>((set) => ({
  mode: 'unroll',
  scope: 'surface',
  element: null,
  offset: 0,
  running: false,
  message: null,
  made: null,
  version: 0,
  setMode: (mode) => set({ mode }),
  setScope: (scope) => set({ scope }),
  setElement: (element) => set({ element }),
  setOffset: (offset) => set({ offset }),
  begin: () => set({ running: true, message: null }),
  resolve: (made) => set((s) => ({ running: false, message: null, made, version: s.version + 1 })),
  fail: (message) => set({ running: false, message }),
  // The scan the pattern was made of went.
  clear: () => set((s) => ({ running: false, message: null, made: null, element: null, version: s.version + 1 })),
}))

/** Whether the tool wants surface marked on the part. */
export const patternMarks = (s: Pick<PatternState, 'mode' | 'scope'>): boolean => s.mode === 'flatten' || s.scope === 'marked'
