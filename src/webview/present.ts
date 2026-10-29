import type { Value } from "../codec/types";
import { errorText, type Size, show } from "../format/console";
import type { ToView } from "../messages";
import { QError, reply } from "../protection";
import { type Sheet, sheet } from "./table";

// What the Result view shows for what the extension posts: the Console
// view's text, a result as the q console shows it, with :: as nothing, or an
// error, after a ' as q's; a sheet for the Grid view too, where the result
// has one; and how long the server took, where protected evaluation said
export function present(message: ToView): {
  text: string;
  sheet?: Sheet;
  execution?: number;
} {
  if (message.type === "error") {
    return { text: message.text };
  }
  let text: string;
  let table: Sheet | undefined;
  let execution: number | undefined;
  try {
    const replied = reply(message.message, message.wrapped);
    ({ text, sheet: table } = presented(replied.value, message.size));
    execution = replied.execution;
  } catch (error) {
    const thrown = error instanceof Error ? error : new Error(String(error));
    text = errorText(thrown);
    execution = thrown instanceof QError ? thrown.execution : undefined;
  }
  return {
    text,
    ...(table && { sheet: table }),
    ...(execution !== undefined && { execution }),
  };
}

// A value as the Console view shows it, and as a sheet for the Grid view if
// it has one: a result, or a cell's value drilled into
export function presented(
  value: Value,
  size: Size,
): { text: string; sheet?: Sheet } {
  const table = sheet(value, size.precision);
  return { text: show(value, size), ...(table && { sheet: table }) };
}
