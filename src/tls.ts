import { X509Certificate } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as tls from "node:tls";
import type { Tls } from "./servers";

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

// A file's path as written in the settings: from ~ if it's in the home
// directory, so that a workspace's settings serve whoever opens it
export function home(file: string): string {
  const relative = path.relative(os.homedir(), file);
  return relative !== "" &&
    relative.split(path.sep)[0] !== ".." &&
    !path.isAbsolute(relative)
    ? `~${path.sep}${relative}`
    : file;
}

// Where a client certificate's passphrase is kept: under its file, since
// one certificate can serve several servers. None without a certificate.
export function passphraseKey(settings?: Tls): string | undefined {
  const file = settings?.pfx ?? settings?.key;
  return file === undefined ? undefined : `passphrase:${resolve(file)}`;
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

// The options for a server's TLS settings, its files read with get.
// - The server's certificate must chain to one of them, whatever
//   NODE_TLS_REJECT_UNAUTHORIZED says, but needn't name the host, as q's
//   client checks by default (SSL_VERIFY_SERVER=YES, where HOSTIP checks
//   the name too): servers are reached by aliases and addresses their
//   certificates don't list
export async function secure(
  settings: Tls,
  passphrase?: string,
  get: (file: string) => Promise<Buffer> = read,
): Promise<Secure> {
  const file = (name: string | undefined) =>
    name === undefined ? undefined : get(resolve(name));
  const [caFile, cert, key, pfx] = await Promise.all(
    [settings.ca, settings.cert, settings.key, settings.pfx].map(file),
  );
  const ca = authorities(caFile);
  let secureContext: tls.SecureContext;
  try {
    secureContext = tls.createSecureContext({
      ca,
      ...(cert === undefined ? {} : { cert }),
      ...(key === undefined ? {} : { key }),
      ...(pfx === undefined ? {} : { pfx }),
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
