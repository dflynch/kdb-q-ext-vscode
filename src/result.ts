import { QError, type Result, type Timing } from "./connection";
import { defaultSize, type Size, show } from "./format/console";

// What a query came to: its result, or the error it failed with
export type Outcome = { result: Result } | { error: Error };

// The console size, as q's \c takes it: lines, then width, each from 10 to
// 2000, as q allows. The problem is said for one that's wrong, and the
// default used.
export function sizeSetting(setting: unknown): {
  size: Size;
  problem?: string;
} {
  if (setting === undefined) {
    return { size: defaultSize };
  }
  if (
    Array.isArray(setting) &&
    setting.length === 2 &&
    setting.every((n) => Number.isInteger(n) && n >= 10 && n <= 2000)
  ) {
    const [lines, width] = setting;
    return { size: { ...defaultSize, lines, width } };
  }
  return {
    size: defaultSize,
    problem: "the console size isn't two whole numbers from 10 to 2000",
  };
}

// A query's result as the q console shows it, or its error after a ' and
// with any backtrace. A result of :: shows nothing, as in q.
export function consoleText(outcome: Outcome, size: Size): string {
  if ("result" in outcome) {
    return show(outcome.result.value, size);
  }
  const error = outcome.error;
  const backtrace =
    error instanceof QError && error.backtrace
      ? `\n${error.backtrace.trimEnd()}`
      : "";
  return `'${error.message}${backtrace}`;
}

// How long a query took: as a result, or an error the server signalled, but
// not one of ours, which has no time
export function timing(outcome: Outcome): Timing | undefined {
  return "result" in outcome
    ? outcome.result.timing
    : outcome.error instanceof QError
      ? outcome.error.timing
      : undefined;
}
