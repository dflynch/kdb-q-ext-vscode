// Syntax errors q would refuse a script for: a bracket or string left open,
// and a close with nothing to close. Marked where the close was expected,
// as q's caret points, linked to where it opened, in TypeScript's words.
// Pure and total, as the scanner: it never throws.

import { scan, type Token } from "./scanner";

export type Span = { start: number; end: number };

export type Problem = Span & {
  message: string;
  related?: Span & { message: string };
};

const closes: Record<string, string> = { "(": ")", "[": "]", "{": "}" };

// Every problem in the text, by where it's marked; several at one place
// innermost first
export function syntaxErrors(text: string): Problem[] {
  const out: Problem[] = [];
  for (const { tokens } of scan(text).statements) {
    // k's lines, other languages' and system commands aren't q's to read
    const kind = tokens[0]?.kind;
    if (kind === "command" || kind === "k" || kind === "other") continue;
    const code = tokens.filter((t) => t.kind !== "comment");
    const last = code[code.length - 1];
    if (!last) continue;
    // Opens not yet closed, the innermost last
    const stack: Token[] = [];
    // Each open left unclosed, expected at the character given
    const unclosed = (open: Token, at: Span) => {
      const close = closes[text[open.start]];
      out.push({
        message: `${close} expected`,
        ...at,
        related: { message: `unclosed ${text[open.start]}`, ...open },
      });
    };
    for (const token of code) {
      if (token.kind === "open") {
        stack.push(token);
      } else if (token.kind === "close") {
        // The nearest open of its kind; those inside it were left open
        const c = text[token.start];
        let at = stack.length - 1;
        while (at >= 0 && closes[text[stack[at].start]] !== c) at--;
        if (at < 0) {
          out.push({ message: `unmatched ${c}`, ...token });
          continue;
        }
        while (stack.length - 1 > at) unclosed(stack.pop() as Token, token);
        stack.pop();
      } else if (token.unterminated) {
        // A string runs to the statement's end, so it's the last token
        out.push({
          message: '" expected',
          start: token.end - 1,
          end: token.end,
          related: {
            message: 'unclosed "',
            start: token.start,
            end: token.start + 1,
          },
        });
      }
    }
    const end = { start: last.end - 1, end: last.end };
    while (stack.length) unclosed(stack.pop() as Token, end);
  }
  // Stable, so innermost stays first
  return out.sort((a, b) => a.start - b.start);
}
