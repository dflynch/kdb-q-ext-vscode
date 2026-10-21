// How to toggle a block comment over a range of lines: add "/" and "\" marker
// lines around them, remove the markers of the blocks they touch, or nothing
// when they are already commented out by a "\" ending the script
export type BlockCommentToggle =
  | { kind: "add"; start: number; end: number }
  | { kind: "remove"; lines: number[] }
  | { kind: "none" };

// A block comment from its "/" line to its "\" line, or to the end when it
// is left open
export type BlockComment = { open: number; close?: number };

const blockStart = /^\/\s*$/;
const blockEnd = /^\\\s*$/;

// Find block comments as q reads them: a lone "\" closes an open block,
// otherwise it comments out the rest of the script, from scriptEnd on
export function findBlockComments(lines: string[]): {
  blocks: BlockComment[];
  scriptEnd: number;
} {
  const blocks: BlockComment[] = [];
  let open: number | undefined;
  let scriptEnd = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (open !== undefined) {
      if (blockEnd.test(lines[i])) {
        blocks.push({ open, close: i });
        open = undefined;
      }
    } else if (blockStart.test(lines[i])) {
      open = i;
    } else if (blockEnd.test(lines[i])) {
      scriptEnd = i;
      break;
    }
  }
  if (open !== undefined) {
    blocks.push({ open });
  }
  return { blocks, scriptEnd };
}

// Decide how to toggle a block comment over lines start to end (inclusive).
// q only recognises markers alone on a line at column 0, which also works
// inside a multi-line function, so markers are always added there.
export function toggleBlockComment(
  lines: string[],
  start: number,
  end: number,
): BlockCommentToggle {
  const { blocks, scriptEnd } = findBlockComments(lines);
  const touched = blocks.filter(
    (b) => b.open <= end && (b.close ?? lines.length - 1) >= start,
  );
  if (touched.length > 0) {
    return {
      kind: "remove",
      lines: touched.flatMap((b) =>
        b.close === undefined ? [b.open] : [b.open, b.close],
      ),
    };
  }
  if (start >= scriptEnd) {
    return { kind: "none" };
  }
  // Stop before a "\" ending the script, which would otherwise close the block
  return { kind: "add", start, end: Math.min(end, scriptEnd - 1) };
}
