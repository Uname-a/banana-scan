// SPDX-License-Identifier: AGPL-3.0-only
// Sparse symmetric solves for laying a surface out flat (core/flatten): a
// matrix with rows compressed, conjugate gradients, and a sparse Cholesky
// factor to precondition them with.
//
// The factor is the textbook up-looking one — each row of L found by
// walking the elimination tree from the row's entries, then a sparse
// triangular solve — over an ordering by nested dissection: the vertices
// split in two across the middle of the part, the layer of them that
// touches the other half put last, each half split the same way. A mesh is
// nearly planar as a graph, so the factor stays a few dozen entries a row
// where the matrix's own order would fill it in to the bandwidth.
//
// The factor preconditions rather than solves outright: a matrix that is
// only positive semi-definite by a hair — a cotangent Laplacian of a scan
// with slivers in it — may come out of the factorisation with a pivot
// nudged off zero, and conjugate gradients make up whatever that cost.

/** A sparse symmetric matrix, rows compressed, every entry of a row in it. */
export interface Csr {
  n: number
  start: Int32Array
  col: Int32Array
  val: Float64Array
  diag: Float64Array
}

/** A matrix from (row, column, value) entries, those at one place summed. */
export function csrOf(n: number, rows: ArrayLike<number>, cols: ArrayLike<number>, vals: ArrayLike<number>): Csr {
  const count = new Int32Array(n + 1)
  for (let k = 0; k < rows.length; k++) count[rows[k] + 1]++
  for (let i = 0; i < n; i++) count[i + 1] += count[i]
  const fill = count.slice(0, n)
  const col = new Int32Array(rows.length)
  const val = new Float64Array(rows.length)
  for (let k = 0; k < rows.length; k++) {
    const at = fill[rows[k]]++
    col[at] = cols[k]
    val[at] = vals[k]
  }
  const start = new Int32Array(n + 1)
  const outCol = new Int32Array(rows.length)
  const outVal = new Float64Array(rows.length)
  const diag = new Float64Array(n)
  const seen = new Int32Array(n).fill(-1)
  let m = 0
  for (let r = 0; r < n; r++) {
    start[r] = m
    for (let k = count[r]; k < count[r + 1]; k++) {
      const c = col[k]
      if (seen[c] >= start[r]) {
        outVal[seen[c]] += val[k]
      } else {
        seen[c] = m
        outCol[m] = c
        outVal[m] = val[k]
        m++
      }
    }
    for (let k = start[r]; k < m; k++) if (outCol[k] === r) diag[r] = outVal[k]
  }
  start[n] = m
  return { n, start, col: outCol.slice(0, m), val: outVal.slice(0, m), diag }
}

export function multiply(a: Csr, x: Float64Array, out: Float64Array): void {
  for (let r = 0; r < a.n; r++) {
    let s = 0
    for (let k = a.start[r]; k < a.start[r + 1]; k++) s += a.val[k] * x[a.col[k]]
    out[r] = s
  }
}

/** z = M⁻¹ r for a preconditioner M. */
export type Preconditioner = (r: Float64Array, z: Float64Array) => void

/** The diagonal as a preconditioner. */
export function jacobi(a: Csr): Preconditioner {
  const inv = new Float64Array(a.n)
  for (let i = 0; i < a.n; i++) inv[i] = a.diag[i] > 0 ? 1 / a.diag[i] : 1
  return (r, z) => {
    for (let i = 0; i < r.length; i++) z[i] = r[i] * inv[i]
  }
}

/** Preconditioned conjugate gradients for a x = b, from `x` as it stands,
 *  until the residual is `tolerance` of b's size or `maxIterations` are
 *  spent. Returns the iterations taken. */
export function solve(a: Csr, b: Float64Array, x: Float64Array, tolerance: number, maxIterations: number, precondition: Preconditioner = jacobi(a)): number {
  const n = a.n
  const r = new Float64Array(n)
  const z = new Float64Array(n)
  const p = new Float64Array(n)
  const q = new Float64Array(n)
  multiply(a, x, q)
  let bNorm = 0
  for (let i = 0; i < n; i++) {
    r[i] = b[i] - q[i]
    bNorm += b[i] * b[i]
  }
  bNorm = Math.sqrt(bNorm) || 1
  precondition(r, z)
  let rz = 0
  for (let i = 0; i < n; i++) {
    p[i] = z[i]
    rz += r[i] * z[i]
  }
  for (let it = 0; it < maxIterations; it++) {
    let rr = 0
    for (let i = 0; i < n; i++) rr += r[i] * r[i]
    if (Math.sqrt(rr) <= tolerance * bNorm) return it
    multiply(a, p, q)
    let pq = 0
    for (let i = 0; i < n; i++) pq += p[i] * q[i]
    if (!(pq > 0)) return it
    const alpha = rz / pq
    for (let i = 0; i < n; i++) {
      x[i] += alpha * p[i]
      r[i] -= alpha * q[i]
    }
    precondition(r, z)
    let rzNext = 0
    for (let i = 0; i < n; i++) rzNext += r[i] * z[i]
    const beta = rzNext / rz
    rz = rzNext
    for (let i = 0; i < n; i++) p[i] = z[i] + beta * p[i]
  }
  return maxIterations
}

// ---- ordering ---------------------------------------------------------------------------

/** A part this small is ordered as it comes. */
const DISSECT_LEAF = 48

/**
 * An elimination order for a matrix whose unknowns stand at points in
 * space (x,y,z each): nested dissection by coordinate, each part split at
 * the median of its longest extent, the unknowns of the first half next to
 * the second put after both. Returns the order: perm[k] is the unknown
 * eliminated k-th.
 */
export function dissect(a: Csr, points: ArrayLike<number>): Int32Array {
  const n = a.n
  const perm = new Int32Array(n)
  let filled = n
  // Which part each unknown is in now, to tell a neighbour in the other
  // half from one already set aside.
  const part = new Int32Array(n)
  let nextPart = 1
  // Parts still to split, each a list of unknowns; filled from the end, so
  // the separators of the coarsest splits come last, as they must.
  const stack: Int32Array[] = [Int32Array.from({ length: n }, (_, i) => i)]
  const out: Int32Array[] = []
  while (stack.length) {
    const ids = stack.pop()!
    if (ids.length <= DISSECT_LEAF) {
      out.push(ids)
      continue
    }
    let axis = 0
    let extent = -1
    for (let d = 0; d < 3; d++) {
      let lo = Infinity
      let hi = -Infinity
      for (const i of ids) {
        const v = points[i * 3 + d]
        if (v < lo) lo = v
        if (v > hi) hi = v
      }
      if (hi - lo > extent) {
        extent = hi - lo
        axis = d
      }
    }
    const sorted = Array.from(ids).sort((x, y) => points[x * 3 + axis] - points[y * 3 + axis])
    const half = sorted.length >> 1
    const left = nextPart++
    const right = nextPart++
    for (let k = 0; k < sorted.length; k++) part[sorted[k]] = k < half ? left : right
    const sep: number[] = []
    const a1: number[] = []
    for (let k = 0; k < half; k++) {
      const i = sorted[k]
      let touches = false
      for (let p = a.start[i]; p < a.start[i + 1]; p++) {
        if (part[a.col[p]] === right) {
          touches = true
          break
        }
      }
      if (touches) sep.push(i)
      else a1.push(i)
    }
    for (const i of sep) part[i] = -1
    // Last eliminated first onto the output, which is read backwards.
    out.push(Int32Array.from(sep))
    stack.push(Int32Array.from(a1))
    stack.push(Int32Array.from(sorted.slice(half)))
  }
  // `out` holds parts in the order they were finished: separators before
  // the halves they divide. Eliminating them in reverse puts each
  // separator after its halves.
  for (const ids of out) {
    for (let k = ids.length - 1; k >= 0; k--) perm[--filled] = ids[k]
  }
  return perm
}

// ---- Cholesky ---------------------------------------------------------------------------

export interface Cholesky {
  n: number
  perm: Int32Array
  /** L by columns, its diagonal first in each. */
  start: Int32Array
  row: Int32Array
  val: Float64Array
  /** Pivots that came out at or below zero and were nudged up. */
  nudged: number
}

/**
 * The Cholesky factor of P A Pᵀ, P the order `perm` (see dissect): the
 * up-looking algorithm, each row's pattern from the elimination tree.
 */
export function cholesky(a: Csr, perm: Int32Array): Cholesky {
  const n = a.n
  const inv = new Int32Array(n)
  for (let k = 0; k < n; k++) inv[perm[k]] = k
  // The permuted matrix's upper triangle by columns: column k holds the
  // entries (i, k) with i ≤ k.
  const cStart = new Int32Array(n + 1)
  for (let k = 0; k < n; k++) {
    const r = perm[k]
    for (let p = a.start[r]; p < a.start[r + 1]; p++) if (inv[a.col[p]] <= k) cStart[k + 1]++
  }
  for (let k = 0; k < n; k++) cStart[k + 1] += cStart[k]
  const cRow = new Int32Array(cStart[n])
  const cVal = new Float64Array(cStart[n])
  for (let k = 0; k < n; k++) {
    const r = perm[k]
    let at = cStart[k]
    for (let p = a.start[r]; p < a.start[r + 1]; p++) {
      const i = inv[a.col[p]]
      if (i <= k) {
        cRow[at] = i
        cVal[at] = a.val[p]
        at++
      }
    }
  }
  // The elimination tree.
  const parent = new Int32Array(n).fill(-1)
  const ancestor = new Int32Array(n).fill(-1)
  for (let k = 0; k < n; k++) {
    for (let p = cStart[k]; p < cStart[k + 1]; p++) {
      let i = cRow[p]
      while (i !== -1 && i < k) {
        const next = ancestor[i]
        ancestor[i] = k
        if (next === -1) parent[i] = k
        i = next
      }
    }
  }
  const mark = new Int32Array(n).fill(-1)
  const stack = new Int32Array(n)
  /** Row k of L's pattern, columns before k, into stack[top…n). */
  const reach = (k: number): number => {
    let top = n
    mark[k] = k
    for (let p = cStart[k]; p < cStart[k + 1]; p++) {
      let i = cRow[p]
      if (i > k) continue
      let len = 0
      while (mark[i] !== k) {
        stack[len++] = i
        mark[i] = k
        i = parent[i]
      }
      while (len > 0) stack[--top] = stack[--len]
    }
    return top
  }
  // Column counts, from every row's pattern.
  const counts = new Int32Array(n).fill(1)
  for (let k = 0; k < n; k++) {
    for (let t = reach(k); t < n; t++) counts[stack[t]]++
  }
  mark.fill(-1)
  const start = new Int32Array(n + 1)
  for (let k = 0; k < n; k++) start[k + 1] = start[k] + counts[k]
  const row = new Int32Array(start[n])
  const val = new Float64Array(start[n])
  const next = start.slice(0, n)
  const x = new Float64Array(n)
  let nudged = 0
  for (let k = 0; k < n; k++) {
    const top = reach(k)
    x[k] = 0
    for (let p = cStart[k]; p < cStart[k + 1]; p++) x[cRow[p]] = cVal[p]
    let d = x[k]
    const scale = Math.abs(d)
    x[k] = 0
    for (let t = top; t < n; t++) {
      const i = stack[t]
      const lki = x[i] / val[start[i]]
      x[i] = 0
      for (let p = start[i] + 1; p < next[i]; p++) x[row[p]] -= val[p] * lki
      d -= lki * lki
      const p = next[i]++
      row[p] = k
      val[p] = lki
    }
    if (!(d > 1e-12 * scale) || !Number.isFinite(d)) {
      d = Math.max(scale, 1e-300) * 1e-6
      nudged++
    }
    const p = next[k]++
    row[p] = k
    val[p] = Math.sqrt(d)
  }
  return { n, perm, start, row, val, nudged }
}

/** The factor as a preconditioner: z = (L Lᵀ)⁻¹ r in the matrix's own
 *  order. */
export function choleskySolver(f: Cholesky): Preconditioner {
  const y = new Float64Array(f.n)
  return (r, z) => {
    const { n, perm, start, row, val } = f
    for (let k = 0; k < n; k++) y[k] = r[perm[k]]
    for (let j = 0; j < n; j++) {
      const yj = (y[j] /= val[start[j]])
      for (let p = start[j] + 1; p < start[j + 1]; p++) y[row[p]] -= val[p] * yj
    }
    for (let j = n - 1; j >= 0; j--) {
      let s = y[j]
      for (let p = start[j] + 1; p < start[j + 1]; p++) s -= val[p] * y[row[p]]
      y[j] = s / val[start[j]]
    }
    for (let k = 0; k < n; k++) z[perm[k]] = y[k]
  }
}
