// Flatten each multi-line statement in q source onto a single line, as the q
// REPL only accepts single-line input. As in a q script, a line starting at
// column 0 begins a new statement and an indented line continues the previous
// one. Comments are removed, so that joining lines cannot comment out code.
export function flatten(text: string): string[] {
  const statements: string[] = [];
  let inBlockComment = false;

  for (const line of text.split(/\r\n|\n|\r/)) {
    // A lone "\" closes a block comment, otherwise it comments out the rest
    if (/^\\\s*$/.test(line)) {
      if (inBlockComment) {
        inBlockComment = false;
        continue;
      }
      break;
    }
    if (inBlockComment) {
      continue;
    }
    // A lone "/" opens a block comment, which may be left unterminated
    if (/^\/\s*$/.test(line)) {
      inBlockComment = true;
      continue;
    }
    // System commands are sent verbatim, as paths such as "\l /a/b.q" may
    // contain what would otherwise look like a comment
    if (line.startsWith("\\")) {
      statements.push(line.trimEnd());
      continue;
    }

    const code = stripComment(line);
    const trimmed = code.trim();
    if (!trimmed) {
      continue;
    }
    // Join continuation lines onto the statement they belong to
    if (/^\s/.test(code) && statements.length > 0) {
      statements[statements.length - 1] += ` ${trimmed}`;
    } else {
      statements.push(trimmed);
    }
  }

  return statements;
}

// Remove a trailing comment, i.e. a "/" at the start of the line or preceded
// by whitespace, ignoring any that appear within strings
function stripComment(line: string): string {
  let inString = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inString) {
      if (c === "\\") {
        i++; // Skip the escaped character
      } else if (c === '"') {
        inString = false;
      }
    } else if (c === '"') {
      inString = true;
    } else if (
      c === "/" &&
      (i === 0 || line[i - 1] === " " || line[i - 1] === "\t")
    ) {
      return line.slice(0, i);
    }
  }
  return line;
}
