// Where a text's lines start, and the line an offset is on, at any line
// ending: \n, \r\n or a lone \r; and a search of sorted offsets. Pure and
// total.

// Each line's start, the first at 0
export function lineStarts(text: string): number[] {
  const out = [0];
  for (const m of text.matchAll(/\r\n|\r|\n/g)) out.push(m.index + m[0].length);
  return out;
}

// The line the offset is on, from 0
export function lineOf(starts: readonly number[], offset: number): number {
  return Math.max(0, after(starts, offset) - 1);
}

// The index of the first of the sorted offsets after the offset
export function after(sorted: readonly number[], offset: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] <= offset) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
