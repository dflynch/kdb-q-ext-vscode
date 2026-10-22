const utf8 = new TextEncoder();

// A query as q expects it from a client: a synchronous message holding the
// query's text as a char vector, so the server replies with the result
export function encode(query: string): Uint8Array {
  const text = utf8.encode(query);
  const message = new Uint8Array(14 + text.length);
  const view = new DataView(message.buffer);
  message[0] = 1; // little-endian
  message[1] = 1; // synchronous
  view.setUint32(4, message.length, true);
  message[8] = 10; // char vector, no attribute
  view.setUint32(10, text.length, true);
  message.set(text, 14);
  return message;
}
