# kdb-q-ext-vscode

A lightweight extension for kdb+/q programming.

## Features

- Syntax highlighting
- Run the selected text, or the current line, from \*.q files in the active
  terminal (e.g. a q session)

### Running selected text

The q REPL only accepts single-line input, so the selected text is sent one
statement at a time, following the same rules as a q script:
- A line starting at column 0 begins a new statement, and an indented line
  continues the previous one
- Comments are removed, including block comments and everything after a lone
  `\`
- System commands, such as `\l`, are sent as is

## Commands

| Command                   | Keybinding       | When                                   |
| ------------------------- | ---------------- | -------------------------------------- |
| kdb+/q: Run Selected Text | Ctrl/Cmd + Enter | editorTextFocus && editorLangId == 'q' |

## Release Notes

### 1.0.0

Initial release

### 1.0.1

Add icon

### 1.0.2

Add language configuration
