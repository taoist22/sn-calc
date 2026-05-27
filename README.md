# SnCalc Pro for Supernote



https://github.com/user-attachments/assets/cbfb4f3f-7f6a-4d4b-8c81-f48797578e3e


SnCalc Pro is a calculator plugin for the Supernote Nomad and Manta (A5X2) with four modes: Standard, Unit Conversion, Financial, and Scientific. Results can be stamped directly into the current note page.

## Modes

### Standard

A 5-column algebraic calculator for everyday arithmetic. Supports parentheses, percentage, and standard operator precedence.

### Conversion

Unit conversion across 12 categories: Area, Data, Energy, Force, Length, Power, Pressure, Speed, Temperature, Time, Volume, and Weight.

Tap the category label to switch categories. Tap either unit label to open a selector grid. Both the From and To fields accept direct input — editing either field recalculates the other automatically.

### Financial (RPN)

An RPN financial calculator modeled on HP 12C conventions.

- **TVM:** Solve for any of n, i, PV, PMT, or FV by entering four known values and tapping the unknown
- **Amortization:** Enter the number of periods in X, press AMORT to compute principal, interest, and remaining balance
- **Cash Flows / NPV / IRR:** Use g + PV for CFo, g + PMT for CFj, f + PV for NPV, f + PMT for IRR
- **f + [0-9]:** Set decimal display precision

### Scientific

A 7-column algebraic calculator.

- Trigonometry: sin, cos, tan and inverses asin, acos, atan
- Hyperbolic trigonometry: sinh, cosh, tanh
- Logarithms: ln, log (base 10), log2
- Exponentials: e^x, 10^x, x^y
- Powers and roots: x², x³, square root, cube root, y-th root
- Other: factorial, mod (infix operator), 1/x, absolute value, random
- Constants: pi, e
- Memory: MC, MR, M-, M+
- DEG/RAD toggle; scientific notation entry via EE
- Implicit multiplication is supported: 2pi, 3sin(30), and 4(2+1) are all valid expressions

## Bottom Bar Controls

Present in all modes:

- **Hist navigation (back/forward):** Browse previously evaluated expressions (Standard and Scientific)
- **Decimal places (- / +):** Adjust the number of decimal places shown, from 0 to 8
- **,000:** Toggle thousands separator on or off
- **No label / With label** *(Conversion mode)* or **Result Only / Full Record** *(other modes)*: Controls what is stamped into the note
- **Insert:** Stamps the current result into the note page at the cursor position

## Stamp Modes

The output toggle controls how results are stamped. The labels change depending on the active mode.

### Conversion mode

| Toggle | Output |
|--------|--------|
| **No label** | `1 nmi = 1.852 km` |
| **With label** | `Length: 1 nmi = 1.852 km` |

### All other modes

**Result Only** stamps only the numeric result.

**Full Record** stamps:

- Standard / Scientific: the full expression and result
- Financial TVM: all register values (n, i, PV, PMT, FV)
- Financial IRR / NPV: the full cash flow schedule and result
- Financial Amortization: periods, principal, interest, and remaining balance

The selected stamp mode is remembered for the rest of the session, so it stays set even after closing and reopening the calculator.

Smart placement detects the lowest existing element on the page and inserts below it.

## Installation

1. Download `SnCalc.snplg` from the latest release.
2. Connect your Supernote to your computer.
3. Copy `SnCalc.snplg` into the `MyStyle` folder on your device.
4. On your Supernote, go to **Toolbar Plugins icon > Manage Plugins > Add Plugin** and select `SnCalc.snplg`.
5. Open a note, tap the plugin icon in the toolbar, and select **SnCalc Pro**.

## Usage Notes

- This is a beta release. Verify critical results independently.
- Financial mode uses RPN (Reverse Polish Notation). Values are pushed onto a 4-register stack (X, Y, Z, T).
- The DEG/RAD indicator appears in the top-left of the Scientific display.
- The memory indicator (M) appears in the display when the memory register holds a non-zero value.

## Building from Source

### Prerequisites

- Node.js (v18+)
- npm

### Build

```bash
npm install
./buildPlugin.sh
```

Output: `build/outputs/SnCalc.snplg`

### Note on bundle files

If you rename the `name` field in `package.json`, delete any old `.bundle` files from `build/generated/` before rebuilding. The Supernote plugin loader picks up the first bundle it finds — a leftover bundle from a previous name will silently override your new code.

## License

[MIT](LICENSE)
