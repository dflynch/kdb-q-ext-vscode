#!/usr/bin/env bash
# Certificates for the TLS tests, valid for 100 years: a CA, a server's for
# localhost and 127.0.0.1, one for another host, one that expired in 2001, a
# self-signed one, and a client's, with its key encrypted and as PKCS#12 too, both with passphrase
# "secret". Test-only keys; nothing trusts this CA. Run from this directory.
set -euo pipefail
days=36500
openssl req -x509 -newkey rsa:2048 -nodes -keyout ca.key -out ca.pem -days $days \
  -subj "/CN=Quirk test CA" -addext basicConstraints=critical,CA:TRUE \
  -addext keyUsage=critical,keyCertSign,cRLSign
signed() { # name, subject, extensions, and how long it's valid
  openssl req -newkey rsa:2048 -nodes -keyout "$1.key" -out "$1.csr" -subj "$2"
  openssl x509 -req -in "$1.csr" -CA ca.pem -CAkey ca.key -CAcreateserial \
    -out "$1.pem" ${4:--days $days} -extfile <(printf '%b' "$3")
}
signed server /CN=localhost "subjectAltName=DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth"
signed elsewhere /CN=elsewhere.invalid "subjectAltName=DNS:elsewhere.invalid\nextendedKeyUsage=serverAuth"
signed expired /CN=localhost "subjectAltName=DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth" \
  "-not_before 20000101000000Z -not_after 20010101000000Z"
signed client /CN=quirk-client "extendedKeyUsage=clientAuth"
openssl req -x509 -newkey rsa:2048 -nodes -keyout self.key -out self.pem -days $days \
  -subj /CN=localhost -addext subjectAltName=DNS:localhost,IP:127.0.0.1
openssl pkey -in client.key -aes256 -passout pass:secret -out client.encrypted.key
openssl pkcs12 -export -in client.pem -inkey client.key -certfile ca.pem \
  -passout pass:secret -out client.p12
rm -f ./*.csr ./*.srl ca.key
