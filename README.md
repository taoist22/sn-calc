# SnCalc for Supernote

**SnCalc** is a calculator plugin for the Supernote Nomad that evaluates arithmetic expressions and stamps the result — or the full expression — directly onto your current note page, placed below existing content so it never lands on top of your writing.

> **Pre-release:** This plugin requires the Supernote beta firmware and is not yet intended for general use.

## Features

- **10-key calculator layout** — familiar Apple Calculator-style keypad with numbers, operators, backspace, and sign toggle
- **Two stamp modes** — choose between stamping the result only (e.g. `42`) or the full expression (e.g. `6 × 7 = 42`)
- **Smart placement** — reads all elements on the current page and places the stamp below the lowest piece of content, so it never overlaps existing notes or handwriting

## Installation

1. Download `SnCalc.snplg` from the [latest release](https://github.com/taoist22/sn-calc/releases).
2. Connect your Supernote to your computer using the Supernote Partner app or Browse & Access.
3. Copy `SnCalc.snplg` into the `MyStyle` folder on your device.
4. On your Supernote, open a note, tap the **plugin icon** in the toolbar, go to **Manage Plugins**, tap **Add Plugin**, and select `SnCalc`.

## Usage

1. Open a note and tap the **plugin icon** in the toolbar.
2. Select **SnCalc** to open the calculator panel.
3. Enter your expression using the keypad.
   - **⌫** deletes the last character
   - **AC** clears the entire expression
   - **+/-** toggles the sign of the current number
   - **%** converts the current number to a percentage
4. Select your stamp mode:
   - **Result only** — stamps just the computed result (e.g. `42`)
   - **Full expression** — stamps the expression and result (e.g. `6 × 7 = 42`)
5. Tap **Insert** — the text is stamped below all existing content on the current page.

## Building from Source

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- npm

### Build

```bash
npm install
./buildPlugin.sh
```

The plugin file will be generated at `build/outputs/SnCalc.snplg`.

> **Note:** If you rename the `name` field in `package.json`, check `build/generated/` for any leftover `*.bundle` files from the previous name and delete them before rebuilding. The Supernote plugin loader will silently load the old bundle if both are present in the package.

## License

[MIT](LICENSE)
