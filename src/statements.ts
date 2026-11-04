import { type Statement, scan } from "./scanner";

// Flatten each multi-line statement in q source onto a single line, as the q
// REPL only accepts single-line input. Comments are removed, so that joining
// lines cannot comment out code.
export function flatten(text: string): string[] {
  return scan(text).statements.map((s) => join(text, s));
}

// A statement's tokens as written, with comments dropped and line breaks
// between tokens read as a space
function join(text: string, statement: Statement): string {
  let out = "";
  let last: number | undefined;
  const k = statement.tokens[0].kind === "k";
  for (const token of statement.tokens) {
    if (token.kind === "comment") continue;
    if (last !== undefined) {
      const gap = text.slice(last, token.start);
      // A line break is a space in q, and a ; in k
      out += /[\r\n]/.test(gap) ? (k ? ";" : " ") : gap;
    }
    const written = text.slice(token.start, token.end);
    out += token.kind === "string" ? oneLine(written) : written;
    last = token.end;
  }
  return out;
}

// A string over several lines keeps its line breaks as \n escapes. As in a q
// script, trailing whitespace is dropped and a tab at column 0 reads as a
// space.
function oneLine(written: string): string {
  const lines = written.split(/\r\n|\n|\r/);
  return lines
    .map((line, i) => {
      const read = i > 0 ? line.replace(/^\t/, " ") : line;
      return i < lines.length - 1 ? read.trimEnd() : read;
    })
    .join("\\n");
}
