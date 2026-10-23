const utf8 = new TextEncoder();

// A query as q expects it from a client: a synchronous message holding the
// query's text as a char vector, so the server replies with the result. With
// a wrapper, it holds a general list of the wrapper's text and the query's,
// which q's default .z.pg evaluates as the wrapper applied to the query.
export function encode(query: string, wrapper?: string): Uint8Array {
  const texts = (wrapper === undefined ? [query] : [wrapper, query]).map(
    (text) => utf8.encode(text),
  );
  const list = texts.length > 1 ? 6 : 0;
  const size = texts.reduce((sum, text) => sum + 6 + text.length, 8 + list);
  const message = new Uint8Array(size);
  const view = new DataView(message.buffer);
  message[0] = 1; // little-endian
  message[1] = 1; // synchronous
  view.setUint32(4, size, true);
  let at = 8;
  if (list) {
    message[at] = 0; // general list, no attribute
    view.setUint32(at + 2, texts.length, true);
    at += list;
  }
  for (const text of texts) {
    message[at] = 10; // char vector, no attribute
    view.setUint32(at + 2, text.length, true);
    message.set(text, at + 6);
    at += 6 + text.length;
  }
  return message;
}
