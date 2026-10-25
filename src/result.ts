import type { Result } from "./connection";
import { defaultSize, errorText, type Size } from "./format/console";
import type { ToView } from "./messages";

// What a query came to: its response, or the extension's own error
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

// What to show for a query in the Result view: its response, for the
// webview to decode and show at the console size, or the extension's own
// error as the q console shows errors
export function toView(outcome: Outcome, size: Size): ToView {
  return "result" in outcome
    ? {
        type: "result",
        message: outcome.result.message,
        wrapped: outcome.result.wrapped,
        size,
      }
    : { type: "error", text: errorText(outcome.error) };
}
