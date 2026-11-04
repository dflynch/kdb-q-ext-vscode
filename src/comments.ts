import { scan } from "./scanner";

// The marker lines to add and remove to toggle block comments: "/" and "\"
// lines around each range of lines to add, and the lines to remove
export type BlockCommentToggle = {
  add: { start: number; end: number }[];
  remove: number[];
};

// Decide how to toggle block comments over ranges of lines (inclusive): remove
// the markers of the outermost blocks a range touches, or else wrap the range
// in a new block. q only recognises markers alone on a line at column 0, which
// also works inside a multi-line function, so markers are always added there.
export function toggleBlockComment(
  lines: string[],
  ranges: { start: number; end: number }[],
): BlockCommentToggle {
  const script = scan(lines.join("\n"));
  const blocks = script.blocks;
  // Outside a block, a lone "\" comments out the rest of the script
  const scriptEnd = script.end ?? lines.length;
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
