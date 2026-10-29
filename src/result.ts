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

// How many significant digits floats and reals are written to, as q's \P
// takes it: a whole number from 0, for as many as each holds, to 17. The
// problem is said for one that's wrong, and the default used.
export function precisionSetting(setting: unknown): {
  precision: number;
  problem?: string;
} {
  if (setting === undefined) {
    return { precision: defaultSize.precision };
  }
  if (
    Number.isInteger(setting) &&
    (setting as number) >= 0 &&
    (setting as number) <= 17
  ) {
    return { precision: setting as number };
  }
  return {
    precision: defaultSize.precision,
    problem: "the precision isn't a whole number from 0 to 17",
  };
}

// The most rows a result, or a cell's value drilled into, can have to be
// shown: a whole number from 1. The problem is said for one that's wrong,
// and the default used.
export function rowLimitSetting(setting: unknown): {
  rowLimit: number;
  problem?: string;
} {
  if (setting === undefined) {
    return { rowLimit: defaultSize.rowLimit };
  }
  if (Number.isInteger(setting) && (setting as number) >= 1) {
    return { rowLimit: setting as number };
  }
  return {
    rowLimit: defaultSize.rowLimit,
    problem: "the row limit isn't a whole number from 1",
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
