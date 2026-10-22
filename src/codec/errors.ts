// The error q gives for a message it can't read. Whether the message is bad
// or the decoder is, there's nothing more to tell the user; what went wrong
// goes in the cause, for a bug report.
export function badmsg(detail: string): Error {
  return new Error("badmsg", { cause: detail });
}
