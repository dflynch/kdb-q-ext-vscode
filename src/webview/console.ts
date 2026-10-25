import { decode } from "../codec/decode";
import { show } from "../format/console";
import type { ToView } from "../messages";

// What the Console view shows: a result as the q console shows it, with ::
// as nothing, or an error as the extension gave it. A result that can't be
// decoded shows the decoder's error, after a ' as q's.
export function consoleText(message: ToView): string {
  if (message.type === "error") {
    return message.text;
  }
  try {
    return show(decode(message.message), message.size);
  } catch (error) {
    return `'${error instanceof Error ? error.message : String(error)}`;
  }
}
