import { errorText, show } from "../format/console";
import type { ToView } from "../messages";
import { QError, reply } from "../protection";

// What the Console view shows for what the extension posts: a result as the
// q console shows it, with :: as nothing, or an error, after a ' as q's;
// and how long the server took, where protected evaluation said
export function consoleView(message: ToView): {
  text: string;
  execution?: number;
} {
  if (message.type === "error") {
    return { text: message.text };
  }
  let shown: { text: string; execution?: number };
  try {
    const { value, execution } = reply(message.message, message.wrapped);
    shown = { text: show(value, message.size), execution };
  } catch (error) {
    const thrown = error instanceof Error ? error : new Error(String(error));
    shown = {
      text: errorText(thrown),
      execution: thrown instanceof QError ? thrown.execution : undefined,
    };
  }
  return shown.execution === undefined ? { text: shown.text } : shown;
}
