// Where a text's lines start, and the line an offset is on, at any line
// ending: \n, \r\n or a lone \r. Pure and total.

// Each line's start, the first at 0
export function lineStarts(text: string): number[] {
  const out = [0];
  for (const m of text.matchAll(/\r\n|\r|\n/g)) out.push(m.index + m[0].length);
  return out;
}

// The line the offset is on, from 0
export function lineOf(starts: readonly number[], offset: number): number {
  let lo = 0;
  let hi = starts.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid] <= offset) lo = mid + 1;
    else hi = mid;
  }
  return Math.max(0, lo - 1);
}
