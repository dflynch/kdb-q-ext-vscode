import { decode } from "./codec/decode";
import type { Value } from "./codec/types";

// Protected evaluation: q's .z.pg applies this to the query, which it runs
// under .Q.trp. It returns ``result`elapsed!(::;result;ms), or
// ``error`backtrace`elapsed!(::;error;backtrace;ms): named so that more
// can be added, and the null key's :: keeps the values a general list, as a
// namespace's does.
// - value is composed with a flag rather than wrapped in a lambda, so it
//   adds no frame, and the flag tells a result from an error whatever the
//   query returns
// - The time is taken once .Q.trp returns, before a backtrace is formatted,
//   from .z.p, as .z.n goes back at midnight
// - The backtrace keeps the frames inside .Q.trp's, the one inside this
//   function's (.z.s), which are the query's, numbered from the query's as
//   0. Those outside, this function's and a customised .z.pg's, go. The
//   frames' layout isn't documented, so if stripping them fails, the
//   backtrace is shown whole rather than the error lost
// - The wrapper's frame is found with ~/:, not ?, which misses when the
//   list starts with (), as a frame for the query's own text holds
// - The query, evaluated by value, sees only globals, so these locals can't
//   clash with its names. None is named for a q keyword, such as trim, which
//   can't be assigned
// The extension sends it; the webview, which decodes results, reads what it
// returns.
export const wrapper = [
  "{[query]",
  "  started:.z.p;",
  "  outcome:.Q.trp['[(1b;);value];query;(0b;;)];",
  "  elapsed:(`long$.z.p-started)div 1000000;",
  "  if[outcome 0;:``result`elapsed!(::;outcome 1;elapsed)];",
  "  strip:{[self;stack]",
  "    stack:(-1+last where self~/:stack[;0;0])#stack;",
  "    .[stack;(::;3);-;last stack[;3]]};",
  "  backtrace:.Q.sbt @[strip .z.s;outcome 2;outcome 2];",
  "  ``error`backtrace`elapsed!(::;outcome 1;backtrace;elapsed)}",
].join("\n");

// An error the server signalled, with q's text as the message, and, where
// protected evaluation caught it, how long the server took, in whole
// milliseconds, and the stack as q shows it; and any hint
export class QError extends Error {
  readonly execution?: number;
  readonly backtrace?: string;
  readonly hint?: string;
  constructor(
    message: string,
    { execution, backtrace, hint }: Omit<QError, keyof Error> = {},
  ) {
    super(message);
    if (execution !== undefined) {
      this.execution = execution;
    }
    if (backtrace !== undefined) {
      this.backtrace = backtrace;
    }
    if (hint !== undefined) {
      this.hint = hint;
    }
  }
}

// The hint under an error that protected evaluation would have caught, or a
// response it didn't give: the server likely refused to evaluate it, as one
// that enforces an allowlist does
const unprotected =
  "protected evaluation may have been refused: turn off protect when the server enforces an allowlist";

const utf8 = new TextDecoder("utf-8", { ignoreBOM: true });

// A response's result, with how long the server took running it if it was
// protected. An error it signalled, or one protected evaluation caught,
// throws a QError; a response that isn't q's throws the decoder's error.
export function reply(
  message: Uint8Array,
  wrapped: boolean,
): { value: Value; execution?: number } {
  const value = decode(message);
  if (value.type === -128) {
    // With protected evaluation on, a signalled error means the query
    // wasn't run under it
    throw new QError(value.message, wrapped ? { hint: unprotected } : {});
  }
  return wrapped ? unwrap(value) : { value };
}

// Protected evaluation's dictionary by name, or undefined if it isn't one
function fields(value: Value): Map<string, Value> | undefined {
  if (value.type !== 99) {
    return undefined;
  }
  const { keys, values } = value;
  if (keys.type !== 11 || values.type !== 0 || !("items" in values)) {
    return undefined;
  }
  const { bytes, offsets } = keys.data;
  const names = Array.from(offsets.subarray(1), (end, i) =>
    utf8.decode(bytes.subarray(offsets[i], end)),
  );
  const [head] = values.items;
  if (names[0] !== "" || head?.type !== 101 || head.code !== 0) {
    return undefined;
  }
  return new Map(names.map((name, i) => [name, values.items[i]]));
}

// The result inside protected evaluation's dictionary, or the error it
// caught. Names it doesn't know are left for later.
function unwrap(value: Value): { value: Value; execution: number } {
  const named = fields(value);
  const result = named?.get("result");
  const error = named?.get("error");
  const backtrace = named?.get("backtrace");
  const elapsed = named?.get("elapsed");
  if (elapsed?.type === -7) {
    const execution = Number(elapsed.value);
    if (result) {
      return { value: result, execution };
    }
    if (error?.type === 10 && backtrace?.type === 10) {
      throw new QError(utf8.decode(error.data), {
        execution,
        backtrace: utf8.decode(backtrace.data),
      });
    }
  }
  throw Object.assign(new Error("unrecognised response"), {
    hint: unprotected,
  });
}
