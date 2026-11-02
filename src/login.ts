// What q takes as a login, user:password, ending at a 0 byte: checked where
// the settings are read, and in the server form's webview, so no Node here

// A user q can take
export function userProblem(user: string): boolean {
  return /[:\0]/.test(user);
}

// A password q can take
export function passwordProblem(password: string): string | undefined {
  return password.includes("\0")
    ? "a password can't contain a 0 byte"
    : undefined;
}
