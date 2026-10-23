import * as os from "node:os";
import * as path from "node:path";
import * as tls from "node:tls";
import type { Tls } from "./servers";

// What a connection needs for TLS, as tls.connect takes it
export type Secure = Pick<
  tls.ConnectionOptions,
  "ca" | "cert" | "key" | "pfx" | "passphrase" | "checkServerIdentity"
>;

// A file's path, with a leading ~ as the home directory
export function resolve(file: string): string {
  return /^~[\\/]/.test(file) ? path.join(os.homedir(), file.slice(2)) : file;
}

// Where a client certificate's passphrase is kept: under its file, since
// one certificate can serve several servers. None without a certificate.
export function passphraseKey(settings: Tls): string | undefined {
  const file = settings.pfx ?? settings.key;
  return file === undefined ? undefined : `passphrase:${resolve(file)}`;
}

// The CAs Node trusts, and the system's, as a firm's own CA is often added
// there. Node before 22.15 has only its own.
function trusted(): string[] {
  if (typeof tls.getCACertificates !== "function") {
    return [...tls.rootCertificates];
  }
  return [
    ...new Set([
      ...tls.getCACertificates("default"),
      ...tls.getCACertificates("system"),
    ]),
  ];
}

// The options for a server's TLS settings, its files read with read. A CA
// given is trusted as well as the others, not instead. The server's
// certificate must chain to one of them, but needn't name the host, as q's
// client checks by default (SSL_VERIFY_SERVER=YES, where HOSTIP checks the
// name too): servers are reached by aliases and addresses their
// certificates don't list.
export function secure(
  settings: Tls,
  read: (file: string) => Buffer,
  passphrase?: string,
): Secure {
  const file = (name: string) => {
    try {
      return read(resolve(name));
    } catch (cause) {
      throw new Error("a tls file can't be read", { cause });
    }
  };
  const { ca, cert, key, pfx } = settings;
  return {
    ca: ca === undefined ? trusted() : [...trusted(), file(ca).toString()],
    ...(cert === undefined ? {} : { cert: file(cert) }),
    ...(key === undefined ? {} : { key: file(key) }),
    ...(pfx === undefined ? {} : { pfx: file(pfx) }),
    ...(passphrase === undefined ? {} : { passphrase }),
    checkServerIdentity: () => undefined,
  };
}
