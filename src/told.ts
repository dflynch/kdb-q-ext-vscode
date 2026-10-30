// The problems in each setting that the user's been told of. A problem the
// extension works around, such as a server it leaves out or a default it
// uses, is told when it's first found, not at every use, which would teach
// the user to dismiss the warning unread. One that's fixed is forgotten, so
// that it's told again if it comes back; a new window tells them all again.
export class Told {
  private told = new Map<string, Set<string>>();

  // The problems found in a setting that haven't been told
  news(setting: string, problems: string[]): string[] {
    const before = this.told.get(setting) ?? new Set();
    this.told.set(setting, new Set(problems));
    return problems.filter((problem) => !before.has(problem));
  }
}
