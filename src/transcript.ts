import { QError, type Result, type Timing } from "./connection";
import { defaultSize, type Size, show } from "./format/console";

// The console size, as q's \c takes it: lines, then width, each from 10 to
// 2000, as q allows. The problem is said for one that's wrong, and the
// default used.
export function consoleSize(setting: unknown): {
  size: Size;
  problems: string[];
} {
  if (setting === undefined) {
    return { size: defaultSize, problems: [] };
  }
  const inRange = (n: unknown) =>
    Number.isInteger(n) && (n as number) >= 10 && (n as number) <= 2000;
  if (
    Array.isArray(setting) &&
    setting.length === 2 &&
    setting.every(inRange)
  ) {
    const [lines, width] = setting as number[];
    return { size: { ...defaultSize, lines, width }, problems: [] };
  }
  return {
    size: defaultSize,
    problems: ["the console size isn't two whole numbers from 10 to 2000"],
  };
}

// Where a query ran and how long it took, as a q comment: the server's
// time, when there is one, and the roundtrip
function took(server: string, timing?: Timing): string {
  if (timing === undefined) {
    return `/ ${server}`;
  }
  const roundtrip = `${timing.roundtrip} ms roundtrip`;
  return timing.execution === undefined
    ? `/ ${server}: ${roundtrip}`
    : `/ ${server}: ${timing.execution} ms, ${roundtrip}`;
}

// A query run, as the q console shows it: after q)'s prompt, with where it
// ran and how long it took as a comment, then its result, or its error after
// a ' and with any backtrace. A result of :: shows nothing, as in q.
export function entry(
  query: string,
  server: string,
  outcome: { result: Result } | { error: Error },
  size: Size,
): string {
  const q =
    "error" in outcome && outcome.error instanceof QError
      ? outcome.error
      : undefined;
  const timing = "result" in outcome ? outcome.result.timing : q?.timing;
  const shown =
    "result" in outcome
      ? show(outcome.result.value, size)
      : `'${outcome.error.message}${q?.backtrace ? `\n${q.backtrace.trimEnd()}` : ""}`;
  const echo = `q)${query}  ${took(server, timing)}`;
  return shown === "" ? echo : `${echo}\n${shown}`;
}
