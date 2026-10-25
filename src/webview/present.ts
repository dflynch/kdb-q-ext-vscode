import { errorText, show } from "../format/console";
import type { ToView } from "../messages";
import { QError, reply } from "../protection";
import { type Sheet, sheet } from "./table";

// What the Result view shows for what the extension posts: the Console
// view's text, a result as the q console shows it, with :: as nothing, or an
// error, after a ' as q's; a table, a keyed table or a dictionary as a sheet
// for the Grid view too; and how long the server took, where protected
// evaluation said
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
    text = show(replied.value, message.size);
    table = sheet(replied.value);
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
