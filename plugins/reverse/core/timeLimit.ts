// SPDX-License-Identifier: AGPL-3.0-only
// How long a sketch's fit may run. A fit is worked out on the page's own
// thread, start to finish: nothing outside it can stop it, a message to the
// page waits behind it, and a cut along a scan's scatter — hundreds of bits
// of outline, or one that wanders — has held a session for minutes. So the
// loops it spends its time in look at the clock themselves, and leave by a
// throw that the change it is part of turns into a refusal.

/** Thrown where a limited run is past its time. */
export class TimeUp extends Error {
  constructor(readonly limitMs: number) {
    super(`It did not finish in ${limitMs / 1000} s.`)
    this.name = 'TimeUp'
  }
}

let until = Infinity
let limit = Infinity

/** `run` given `ms` from now; the time of a run it is part of, where that
 *  ends first. */
export function withinTime<T>(ms: number, run: () => T): T {
  const was = { until, limit }
  const end = performance.now() + ms
  if (end < until) {
    until = end
    limit = ms
  }
  try {
    return run()
  } finally {
    until = was.until
    limit = was.limit
  }
}

/** The rest of the run under way let finish: past the point where stopping
 *  would leave half a change. */
export function timeKept(): void {
  until = Infinity
}

/** Leaves a limited run that is past its time; nothing in any other. */
export function checkTime(): void {
  if (until !== Infinity && performance.now() > until) throw new TimeUp(limit)
}
