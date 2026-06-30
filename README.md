# SnCalc Pro for Supernote



https://github.com/user-attachments/assets/cbfb4f3f-7f6a-4d4b-8c81-f48797578e3e


SnCalc Pro is a calculator plugin for the Supernote Nomad and Manta (A5X2) with four modes: Standard, Unit Conversion, Financial, and Scientific. Results can be stamped directly into the current note page.

## Quick Lasso Calc

SnCalc also appears in the note lasso menu as **Calc**. Use it when you have a simple handwritten or typed calculation already on the page and want the result inserted without opening the full calculator panel.

1. Lasso a simple arithmetic expression, such as `10+30=` or `10.0+30.0=`.
2. Tap **Calc** in the lasso menu.
3. Review or correct the recognized expression in the popup.
4. Choose **Full** to insert `10+30 = 40`, or **Result** to insert only `40`.
5. Tap **Insert**.

Lasso Calc supports digits, decimals, parentheses, percent, and `+`, `-`, `×`, `x`, `*`, `/`, and `÷`. It intentionally rejects more complex handwritten notation such as square-root symbols or spatial exponents. Results are inserted below the selected expression when there is room.

If the recognized expression needs more work, tap **Open Calculator** to carry it into Standard mode for editing and evaluation.

## Compact / Full Panel

The calculator header includes a **Compact / Full** toggle.

- **Compact** mode keeps mode tabs, a one-line display, and the keypad visible while hiding the larger display area and insert controls.
- **Full** mode restores the larger display/register area, decimal and stamp controls, and the **Insert** button.

Compact mode is intended for data entry while reading from the note underneath. Switch back to Full mode when you are ready to review, adjust stamp settings, or insert the result.

## Modes

### Standard

A 5-column algebraic calculator for everyday arithmetic. Supports parentheses, percentage, and standard operator precedence.
The entry field scrolls for long expressions and rejects repeated operator runs such as `+++` or `---`.

### Conversion

Unit conversion across 12 categories: Area, Data, Energy, Force, Length, Power, Pressure, Speed, Temperature, Time, Volume, and Weight.

Tap the category label to switch categories. Tap either unit label to open a selector grid. Both the From and To fields accept direct input — editing either field recalculates the other automatically.

### Financial (RPN)

An RPN financial calculator modeled on HP 12C conventions.

- **RPN tape:** Full Record insert for ordinary RPN arithmetic stamps each entered value/operator with a running total
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
The entry field scrolls for long expressions and reports common domain/input errors instead of silently returning invalid values.

## Bottom Bar Controls

Present in all modes:

- **Compact / Full:** Toggle the calculator between a shorter data-entry panel and the full panel. Compact mode keeps mode tabs, a one-line display, and the keypad visible while hiding insert controls.
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
- Financial RPN arithmetic: a tape-style record with each entry/operator and the running total
- Financial TVM: all register values (n, i, PV, PMT, FV)
- Financial IRR / NPV: the full cash flow schedule and result
- Financial Amortization: periods, principal, interest, and remaining balance

The selected stamp mode is remembered for the rest of the session, so it stays set even after closing and reopening the calculator.

Smart placement detects the lowest existing element on the page and inserts below it when there is room. Insert placement is calibrated for Nomad and Manta page coordinates so stamped results stay visible on the current page.

## Installation

1. Download `SnCalc.snplg` from the latest release.
2. Connect your Supernote to your computer.
3. Copy `SnCalc.snplg` into the `MyStyle` folder on your device.
4. On your Supernote, go to **Toolbar Plugins icon > Manage Plugins > Add Plugin** and select `SnCalc.snplg`.
5. Open a note, tap the plugin icon in the toolbar, and select **SnCalc Pro**.

## Usage Notes

- This is a beta release. Verify critical results independently.
- Lasso **Calc** is meant for simple arithmetic only; use **Open Calculator** or the full calculator toolbar button for scientific notation, TVM, cash flows, and deeper expression editing.
- Compact calculator mode is for data entry. Switch back to Full mode to review the larger display, adjust insert settings, or stamp results into the page.
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
