import { type Hinted, QError, type Result, type Timing } from "./connection";
import { defaultSize, type Size } from "./format/console";
import type { ToView } from "./messages";

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

// What to show for a query in the Result view: its result, for the webview
// to decode and show at the console size, or its error as the q console
// shows it, after a ' and with any backtrace, then any hint
export function toView(outcome: Outcome, size: Size): ToView {
  if ("result" in outcome) {
    return { type: "result", message: outcome.result.message, size };
  }
  const error = outcome.error;
  const backtrace =
    error instanceof QError && error.backtrace
      ? `\n${error.backtrace.trimEnd()}`
      : "";
  const hint = (error as Hinted).hint;
  return {
    type: "error",
    text: `'${error.message}${backtrace}${hint ? `\n${hint}` : ""}`,
  };
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
