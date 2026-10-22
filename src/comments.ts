// The marker lines to add and remove to toggle block comments: "/" and "\"
// lines around each range of lines to add, and the lines to remove
export type BlockCommentToggle = {
  add: { start: number; end: number }[];
  remove: number[];
};

// An outermost block comment from its "/" line to its "\" line, or to the end
// when it is left open
export type BlockComment = { open: number; close?: number };

const blockStart = /^\/\s*$/;
const blockEnd = /^\\\s*$/;

// Find block comments as q reads them: blocks nest, so a lone "/" inside a
// block opens another and a lone "\" closes the innermost. Outside a block, a
// lone "\" comments out the rest of the script, from scriptEnd on.
export function findBlockComments(lines: string[]): {
  blocks: BlockComment[];
  scriptEnd: number;
} {
  const blocks: BlockComment[] = [];
  let open = 0;
  let depth = 0;
  let scriptEnd = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (blockStart.test(lines[i])) {
      if (depth === 0) {
        open = i;
      }
      depth++;
    } else if (blockEnd.test(lines[i])) {
      if (depth === 0) {
        scriptEnd = i;
        break;
      }
      depth--;
      if (depth === 0) {
        blocks.push({ open, close: i });
      }
    }
  }
  if (depth > 0) {
    blocks.push({ open });
  }
  return { blocks, scriptEnd };
}

// Decide how to toggle block comments over ranges of lines (inclusive): remove
// the markers of the outermost blocks a range touches, or else wrap the range
// in a new block. q only recognises markers alone on a line at column 0, which
// also works inside a multi-line function, so markers are always added there.
export function toggleBlockComment(
  lines: string[],
  ranges: { start: number; end: number }[],
): BlockCommentToggle {
  const { blocks, scriptEnd } = findBlockComments(lines);
  const add: { start: number; end: number }[] = [];
  const remove = new Set<number>();
  for (const { start, end } of ranges) {
    const touched = blocks.filter(
      (b) => b.open <= end && (b.close ?? lines.length - 1) >= start,
    );
    for (const b of touched) {
      remove.add(b.open);
      if (b.close !== undefined) {
        remove.add(b.close);
      }
    }
    // Lines after a "\" ending the script are already commented out
    if (touched.length === 0 && start < scriptEnd) {
      // Stop before that "\", which would otherwise close the block
      add.push({ start, end: Math.min(end, scriptEnd - 1) });
    }
  }

  // Ranges that overlap or meet share one block
  add.sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  for (const range of add) {
    const prev = merged[merged.length - 1];
    if (prev && range.start <= prev.end + 1) {
      prev.end = Math.max(prev.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  return { add: merged, remove: [...remove].sort((a, b) => a - b) };
}
