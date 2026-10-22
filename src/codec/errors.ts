// The error q gives for a message it can't read. Whether the message is bad
// or the decoder is, there's nothing more to tell the user; what went wrong
// goes in the cause, for a bug report.
export function badmsg(detail: string): Error {
  return new Error("badmsg", { cause: detail });
}

// A result too big to hold: the extension host's heap is capped, and going
// over it kills the host, so results are refused well before. What the
// limit is and how to change it go in the message.
export class OverBudget extends Error {
  constructor(
    readonly size: number | undefined,
    readonly budget: number,
    stage: string,
  ) {
    super(
      size === undefined
        ? `the result is over the ${bytes(budget)} limit ${stage}`
        : `the result is ${bytes(size)} ${stage}, over the ${bytes(budget)} limit`,
    );
  }
}

// A size in the largest unit that keeps it at 1 or more
export function bytes(n: number): string {
  for (const [unit, scale] of [
    ["GB", 1e9],
    ["MB", 1e6],
    ["KB", 1e3],
  ] as const) {
    if (n >= scale) {
      return `${Number((n / scale).toFixed(1))} ${unit}`;
    }
  }
  return `${n} bytes`;
}
