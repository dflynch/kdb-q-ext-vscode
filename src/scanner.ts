// Scans q source into statements and tokens, as q reads a script: first the
// layout splits the text into statements by line, then each statement splits
// into tokens at the boundaries q's own lexer (-4!) gives. Pure and total: no
// VS Code or Node imports, and it never throws, as editors hold half-typed
// code.

export type Kind =
  | "name" // x, a_b, .servers.getservers, a.1
  | "symbol" // `a, `a`b, `:a/b.q (a symbol list is one token, as in q)
  | "string" // "a\"b", possibly over several lines
  | "number" // -1, 1e-1, 0x0aff, 101b, 0N, 2026.11.04D12:00, 3f
  | "operator" // + - : :: +: ,: 0: and the rest
  | "iterator" // ' / \ ': /: \:
  | "open" // ( [ {
  | "close" // ) ] }
  | "separator" // ;
  | "comment" // a trailing comment, a comment line or a block comment
  | "command" // a system command line, such as \d .ns, verbatim
  | "k" // a k) line, not read further
  | "unknown"; // anything else

export type Token = {
  kind: Kind;
  // Offsets into the text, end exclusive
  start: number;
  end: number;
  // A string still open where its statement ends
  unterminated?: true;
};

export type Statement = { start: number; end: number; tokens: Token[] };

// An outermost block comment from its "/" line to its "\" line, or to the end
// when it is left open
export type BlockComment = { open: number; close?: number };

export type Script = {
  statements: Statement[];
  // Comment lines and block comments between statements. Those inside a
  // statement, between its lines, are among its tokens
  comments: Token[];
  // By line number
  blocks: BlockComment[];
  // The line of a lone "\" that ends the script, if there is one
  end?: number;
};

const blockStart = /^\/\s*$/;
const blockEnd = /^\\\s*$/;

type Line = { start: number; text: string };

function lines(text: string): Line[] {
  const out: Line[] = [];
  const breaks = /\r\n|\n|\r/g;
  let start = 0;
  for (let m = breaks.exec(text); m; m = breaks.exec(text)) {
    out.push({ start, text: text.slice(start, m.index) });
    start = m.index + m[0].length;
  }
  out.push({ start, text: text.slice(start) });
  return out;
}

const isSpace = (c: string | undefined) => c === " " || c === "\t";
const isDigit = (c: string | undefined) =>
  c !== undefined && c >= "0" && c <= "9";
const isLetter = (c: string | undefined) =>
  c !== undefined && ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z"));
const isNameChar = (c: string | undefined) =>
  isLetter(c) || isDigit(c) || c === "." || c === "_";
// Kinds of token that a "-" right after them subtracts from
const values: Kind[] = ["name", "number", "symbol", "string", "close"];
const operators = "+-*%!&|<>=~,^#_$?@.:";

// Index of the end of the line's text without trailing whitespace
function trimmedEnd(text: string): number {
  let end = text.length;
  while (end > 0 && /\s/.test(text[end - 1])) end--;
  return end;
}

// Scans the rest of a string from i: the index after its closing quote, or
// -1 when the line ends first
function stringEnd(text: string, i: number): number {
  for (; i < text.length; i++) {
    if (text[i] === "\\") i++;
    else if (text[i] === '"') return i + 1;
  }
  return -1;
}

// The tokens of one line of a statement from column i. When the line starts
// inside a string, open is that string's token, to extend. Returns the string
// token still open at the end of the line, if any.
function lexLine(
  line: Line,
  i: number,
  tokens: Token[],
  open: Token | undefined,
): Token | undefined {
  const { text, start: base } = line;
  const push = (kind: Kind, from: number, to: number) => {
    tokens.push({ kind, start: base + from, end: base + to });
  };
  // Whether column i is right after a value, so a "-" there subtracts
  const follows = (i: number) => {
    const last = tokens[tokens.length - 1];
    return last?.end === base + i && values.includes(last.kind);
  };

  if (open) {
    const end = stringEnd(text, 0);
    if (end < 0) {
      // Blank lines extend it only once more of it follows
      if (trimmedEnd(text) > 0) open.end = base + trimmedEnd(text);
      return open;
    }
    open.end = base + end;
    i = end;
  }

  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    if (isSpace(c)) {
      i++;
    } else if (c === "/" && (i === 0 || isSpace(text[i - 1]))) {
      push("comment", i, trimmedEnd(text));
      return undefined;
    } else if (c === '"') {
      const end = stringEnd(text, i + 1);
      if (end < 0) {
        push("string", i, trimmedEnd(text));
        return tokens[tokens.length - 1];
      }
      push("string", i, end);
      i = end;
    } else if (c === "`") {
      let j = i;
      while (text[j] === "`") {
        j++;
        const path = text[j] === ":";
        while (
          j < text.length &&
          (isNameChar(text[j]) || text[j] === ":" || (path && text[j] === "/"))
        ) {
          j++;
        }
      }
      push("symbol", i, j);
      i = j;
    } else if (
      isDigit(c) ||
      (c === "." && isDigit(next)) ||
      (c === "-" &&
        !follows(i) &&
        (isDigit(next) || (next === "." && isDigit(text[i + 2]))))
    ) {
      let j = c === "-" ? i + 1 : i;
      while (j < text.length) {
        const d = text[j];
        // A colon only inside a time, as 12:00
        if (
          isLetter(d) ||
          isDigit(d) ||
          d === "." ||
          (d === ":" && isDigit(text[j + 1]))
        ) {
          j++;
        } else if (
          (d === "-" || d === "+") &&
          text[j - 1] === "e" &&
          isDigit(text[j + 1]) &&
          /^-?(\d+\.?\d*|\.\d+)e$/.test(text.slice(i, j))
        ) {
          j++; // An exponent's sign: 1e-1
        } else {
          break;
        }
      }
      // The file verbs 0: 1: 2: are operators
      if (j === i + 1 && text[j] === ":") {
        push("operator", i, j + 1);
        i = j + 1;
        continue;
      }
      push("number", i, j);
      i = j;
    } else if (isLetter(c) || (c === "." && isLetter(next))) {
      let j = i + 1;
      while (isNameChar(text[j])) j++;
      push("name", i, j);
      i = j;
    } else if (c === "'" || c === "/" || c === "\\") {
      const j = next === ":" ? i + 2 : i + 1;
      push("iterator", i, j);
      i = j;
    } else if (operators.includes(c)) {
      const pair =
        next === ":" ||
        (c === "<" && (next === ">" || next === "=")) ||
        (c === ">" && next === "=");
      let j = pair ? i + 2 : i + 1;
      // Amending a global: x+::1
      if (c !== ":" && next === ":" && text[j] === ":") j++;
      push("operator", i, j);
      i = j;
    } else if (c === "(" || c === "[" || c === "{") {
      push("open", i, i + 1);
      i++;
    } else if (c === ")" || c === "]" || c === "}") {
      push("close", i, i + 1);
      i++;
    } else if (c === ";") {
      push("separator", i, i + 1);
      i++;
    } else {
      push("unknown", i, i + 1);
      i++;
    }
  }
  return undefined;
}

// The end of a k line's code, before any trailing comment: k's strings and
// comments are written as q's
function kCodeEnd(text: string): number {
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '"') {
      const end = stringEnd(text, i + 1);
      if (end < 0) break;
      i = end - 1;
    } else if (text[i] === "/" && isSpace(text[i - 1])) {
      return trimmedEnd(text.slice(0, i));
    }
  }
  return trimmedEnd(text);
}

export function scan(text: string): Script {
  const script: Script = { statements: [], comments: [], blocks: [] };
  const all = lines(text);
  let current: Statement | undefined;
  // Whether the current statement is k, whose continuation lines are k too
  let k = false;
  // A string token left open at the end of the last line
  let open: Token | undefined;
  // Comment lines after the current statement, which belong to it only if a
  // continuation line follows
  let pending: Token[] = [];
  let depth = 0;
  let blockOpen = 0;

  const finish = () => {
    if (current) {
      if (open) open.unterminated = true;
      current.end = current.tokens[current.tokens.length - 1].end;
      script.statements.push(current);
    }
    for (const t of pending) script.comments.push(t);
    pending = [];
    current = undefined;
    open = undefined;
    k = false;
  };
  const begin = (start: number) => {
    finish();
    current = { start, end: start, tokens: [] };
  };

  for (let n = 0; n < all.length; n++) {
    const line = all[n];
    const t = line.text;

    if (depth > 0) {
      if (blockStart.test(t)) {
        depth++;
      } else if (blockEnd.test(t)) {
        depth--;
        if (depth === 0) {
          script.blocks.push({ open: blockOpen, close: n });
          pending.push({
            kind: "comment",
            start: all[blockOpen].start,
            end: line.start + trimmedEnd(t),
          });
        }
      }
      continue;
    }

    const indented = isSpace(t[0]);

    // A line inside a string continues it, unless it starts at column 0. An
    // empty line is in the string too
    if (open && (indented || t.length === 0)) {
      open = lexLine(line, 0, (current as Statement).tokens, open);
      continue;
    }
    if (open) {
      open.unterminated = true;
      open = undefined;
    }

    if (n === 0 && t.startsWith("#!")) {
      continue;
    }
    if (blockStart.test(t)) {
      depth = 1;
      blockOpen = n;
      continue;
    }
    if (blockEnd.test(t)) {
      script.end = n;
      break;
    }
    const first = t.search(/\S/);
    if (first < 0) continue;

    // A comment line, at column 0 or indented, belongs to the statement only
    // if a continuation line follows it
    if (t[first] === "/") {
      pending.push({
        kind: "comment",
        start: line.start + first,
        end: line.start + trimmedEnd(t),
      });
      continue;
    }

    if (!indented || !current) {
      begin(line.start + first);
    } else {
      // A continuation line: comment lines since the last line are inside
      for (const t of pending) current.tokens.push(t);
      pending = [];
    }
    const statement = current as Statement;

    if (!indented && t[0] === "\\") {
      statement.tokens.push({
        kind: "command",
        start: line.start,
        end: line.start + trimmedEnd(t),
      });
    } else if ((!indented && t.startsWith("k)")) || (k && indented)) {
      k = true;
      const end = kCodeEnd(t);
      if (end > first) {
        statement.tokens.push({
          kind: "k",
          start: line.start + first,
          end: line.start + end,
        });
      }
      if (end < trimmedEnd(t)) {
        lexLine(line, t.indexOf("/", end), statement.tokens, undefined);
      }
    } else {
      open = lexLine(line, first, statement.tokens, undefined);
    }
  }

  if (depth > 0) {
    script.blocks.push({ open: blockOpen });
    pending.push({
      kind: "comment",
      start: all[blockOpen].start,
      end: text.length,
    });
  }
  finish();
  return script;
}
