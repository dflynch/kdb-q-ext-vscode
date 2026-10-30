import { X509Certificate } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as tls from "node:tls";

// The files TLS can need besides the system's, from the settings, for every
// server, as q takes them for the process: a CA to trust as well as the
// system's, and a client certificate and its key, for a server that
// verifies its clients
export type Files = { ca?: string; cert?: string; key?: string };

// What a connection needs for TLS, as tls.connect takes it
export type Secure = Pick<
  tls.ConnectionOptions,
  "secureContext" | "rejectUnauthorized" | "checkServerIdentity"
>;

// A path tls files can have: absolute, as on Windows or not, whichever the
// system, or from the home directory. The settings' schema has the same.
export const filePath = /^(\/|\\\\|[A-Za-z]:[\\/]|~[\\/])/;

// A file's path, with a leading ~ as the home directory
export function resolve(file: string): string {
  return /^~[\\/]/.test(file) ? path.join(os.homedir(), file.slice(2)) : file;
}

// The TLS files as their settings give them, an empty one unset; with the
// problem said for any that's wrong, and the rest kept, so that a wrong CA
// doesn't hide the key a passphrase is kept under
export function files(
  ca: unknown,
  cert: unknown,
  key: unknown,
): { files: Files; problem?: string } {
  const settings = { ca: "tlsCaFile", cert: "tlsCertFile", key: "tlsKeyFile" };
  const files: Files = {};
  const wrong: string[] = [];
  for (const [field, file] of Object.entries({ ca, cert, key })) {
    if (file === undefined || file === null || file === "") {
      continue;
    }
    if (typeof file === "string" && filePath.test(file)) {
      files[field as keyof Files] = file;
    } else {
      wrong.push(settings[field as keyof Files]);
    }
  }
  if (wrong.length > 0) {
    return {
      files,
      problem: `${wrong.join(", ")}: not an absolute path or one from ~/`,
    };
  }
  return (files.cert === undefined) !== (files.key === undefined)
    ? { files, problem: "tlsCertFile and tlsKeyFile go together" }
    : { files };
}

// Where the client certificate's passphrase is kept: under its key's file,
// so that it isn't used for another key. None without a key file.
export function passphraseKey(files: Files): string | undefined {
  return files.key === undefined
    ? undefined
    : `passphrase:${resolve(files.key)}`;
}

// Certificates and keys are small, so anything bigger isn't one
const largest = 1e6;

// A tls file's contents. Only a file of at most a megabyte, so that a path
// in the settings to a pipe, a device or something huge can't hold up the
// extension host.
export async function read(file: string): Promise<Buffer> {
  try {
    const info = await stat(file);
    if (!info.isFile() || info.size > largest) {
      throw new Error(`not a file of at most ${largest} bytes`);
    }
    return await readFile(file);
  } catch (cause) {
    throw new Error("TLS file unreadable", { cause: { file, cause } });
  }
}

// The CA certificates in a file in PEM, each checked, as TLS ignores one it
// can't use and fails later only for want of it
function certificates(pem: Buffer): string[] {
  const found =
    pem
      .toString()
      .match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ??
    [];
  try {
    if (found.length === 0) {
      throw new Error("no PEM certificate");
    }
    for (const certificate of found) {
      new X509Certificate(certificate);
    }
  } catch (cause) {
    throw new Error("invalid TLS CA", { cause });
  }
  return found;
}

// The CAs to trust: Node's, the system's, as a firm's own CA is often added
// there, and those in a file given, as well rather than instead
export function authorities(file?: Buffer): string[] {
  return [
    ...new Set([
      ...tls.getCACertificates("default"),
      ...tls.getCACertificates("system"),
      ...(file === undefined ? [] : certificates(file)),
    ]),
  ];
}

// The options for TLS, its files read with get.
// - The server's certificate must chain to one of them, whatever
//   NODE_TLS_REJECT_UNAUTHORIZED says, but needn't name the host, as q's
//   client checks by default (SSL_VERIFY_SERVER=YES, where HOSTIP checks
//   the name too): servers are reached by aliases and addresses their
//   certificates don't list
export async function secure(
  settings: Files,
  passphrase?: string,
  get: (file: string) => Promise<Buffer> = read,
): Promise<Secure> {
  const file = (name: string | undefined) =>
    name === undefined ? undefined : get(resolve(name));
  const [caFile, cert, key] = await Promise.all(
    [settings.ca, settings.cert, settings.key].map(file),
  );
  const ca = authorities(caFile);
  let secureContext: tls.SecureContext;
  try {
    secureContext = tls.createSecureContext({
      ca,
      ...(cert === undefined ? {} : { cert }),
      ...(key === undefined ? {} : { key }),
      ...(passphrase === undefined ? {} : { passphrase }),
    });
  } catch (cause) {
    // A key that can't be decrypted with the passphrase, or doesn't go with
    // its certificate
    throw new Error("invalid client certificate", { cause });
  }
  return {
    secureContext,
    rejectUnauthorized: true,
    checkServerIdentity: () => undefined,
  };
}
