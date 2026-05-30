# editext

A VS Code extension providing advanced text editing commands inspired by Emacs keybindings.

## Features

- **Delete line**: Remove entire line (Ctrl+Y)
- **Delete to end of line**: Delete from cursor to end of line (Ctrl+K)
- **Delete word**: Remove current word (Ctrl+T)
- **Yank**: Copy and save line (Ctrl+L)
- **Word complete**: Auto-complete current word (Ctrl+N)
- **Navigation**: Move by words and lines with selection support
- **Marks**: Set and jump to marks in your code (Esc+Space, Esc+P)
- **Macros**: Record and replay editing sequences (Esc+[, Ctrl+[)

## Commands

All commands are accessible via the Command Palette (Ctrl+Shift+P) with the "edit" or "move" or "macro" prefix.

## Keybindings

| Command | Windows/Linux | macOS |
|---------|---|---|
| Delete line | Ctrl+Y | Ctrl+Y |
| Delete to end of line | Ctrl+K | Ctrl+K |
| Delete word | Ctrl+T | Ctrl+T |
| Yank | Ctrl+L | Ctrl+L |
| Word complete | Ctrl+N | Ctrl+N |
| Next word | Ctrl+F | Ctrl+F |
| Previous word | Ctrl+A | Ctrl+A |
| Set mark | Esc+Space | Esc+Space |
| Goto mark | Esc+P | Esc+P |
| Swap mark | Ctrl+P | Ctrl+P |
| Record macro | Esc+[ | Esc+[ |
| Replay macro | Ctrl+[ | Ctrl+[ |

## Release Notes

### 0.0.1

Initial release with basic text editing commands.
