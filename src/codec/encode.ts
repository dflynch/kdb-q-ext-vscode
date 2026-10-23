const utf8 = new TextEncoder();

// A query as q expects it from a client: a synchronous message holding the
// query's text as a char vector, so the server replies with the result. With
// a wrapper, it holds a general list of the wrapper, as a lambda defined at
// the root, and the query's text, which q's .z.pg evaluates as the wrapper
// applied to the query: value does by default, and reval does too.
export function encode(query: string, wrapper?: string): Uint8Array {
  const text = utf8.encode(query);
  const source = wrapper === undefined ? undefined : utf8.encode(wrapper);
  // A general list's header, and a lambda's type and its context, "" ending
  // in a 0 byte, before its source
  const lambda = source === undefined ? 0 : 6 + 2 + 6 + source.length;
  const size = 8 + lambda + 6 + text.length;
  const message = new Uint8Array(size);
  const view = new DataView(message.buffer);
  message[0] = 1; // little-endian
  message[1] = 1; // synchronous
  view.setUint32(4, size, true);
  let at = 8;
  const chars = (bytes: Uint8Array) => {
    message[at] = 10; // char vector, no attribute
    view.setUint32(at + 2, bytes.length, true);
    message.set(bytes, at + 6);
    at += 6 + bytes.length;
  };
  if (source !== undefined) {
    message[at] = 0; // general list, no attribute
    view.setUint32(at + 2, 2, true);
    message[at + 6] = 100; // lambda, then its context's 0 byte
    at += 8;
    chars(source);
  }
  chars(text);
  return message;
}
