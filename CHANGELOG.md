# Change Log

All notable changes to the "kdb-q-ext-vscode" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

### Fixed

- Run Selected Text sends each statement on its own line, so selections
  containing more than one statement run as they would in a q script
- Run Selected Text no longer mistakes a "/" in a string for a comment
- Run Selected Text preserves whitespace in strings
- Run Selected Text sends system commands, such as `\l /path/to/file.q`, as is
- Run Selected Text ignores the rest of an unterminated block comment

### Changed

- Run Selected Text warns when there is no active terminal
- The Ctrl/Cmd + Enter keybinding only applies when the editor has focus

## [1.0.2]

### Added

- Language configuration

## [1.0.1]

### Added

- Icon

## [1.0.0]

- Initial release
