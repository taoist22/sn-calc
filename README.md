# SnCalc Pro for Supernote

https://github.com/user-attachments/assets/3e2ba367-f692-4523-825e-2592ad9c354b

**SnCalc Pro** is a high-precision, professional-grade calculator plugin for the Supernote Nomad. It transforms your device into a powerful engineering and financial instrument, featuring three distinct modes and a smart "Audit Trail" system that stamps calculations directly into your notes.

> **Note:** This plugin is optimized for the Supernote Nomad and utilizes advanced plugin APIs for native text insertion.

## 🚀 Key Features

### 📐 Three Professional Modes
- **Standard:** A familiar algebraic calculator for quick daily tasks, featuring an ergonomic 5-column layout with percentage support.
- **Financial (HP 12C Logic):** A full-featured RPN financial engine. Calculate TVM (Time Value of Money), Amortization (Principal/Interest breakdown), IRR (Internal Rate of Return), and NPV (Net Present Value) with 100% hardware-verified accuracy.
- **Scientific:** A dense 7-column algebraic grid featuring over 50 functions, including hyperbolic trigonometry, logarithms (ln, log10, log2), powers, roots (including custom root solvers), and scientific notation.

### 📝 Smart Audit Trails
- **"Full Record" Stamps:** Beyond just results, SnCalc Pro can stamp detailed reports into your notes.
  - **Amortization:** Stamps a formatted block showing periods, principal paid, interest paid, and remaining balance.
  - **Cash Flows:** Stamps your entire investment schedule (CF0, CFj, Nj) alongside the IRR/NPV results.
  - **Scientific:** Stamps the full algebraic expression and the result.
- **Smart Placement:** Automatically detects the lowest element on your page and places the stamp below your handwriting, ensuring no overlaps.

### 🧠 High-Precision Engine
- **Deterministic Math:** Uses a custom recursive descent parser for algebraic expressions and the Newton-Raphson method for financial roots.
- **Hardware Verified:** Solvers are verified for accuracy against physical HP 12C hardware.

## 🛠️ Installation

1. Download `SnCalc.snplg` from the latest release.
2. Connect your Supernote to your computer.
3. Copy `SnCalc.snplg` into the `MyStyle` folder on your device.
4. On your Supernote, go to **Settings > Manage Plugins > Add Plugin** and choose **SnCalc.snplg**.
5. Open a note, tap the **Plugin icon** in the toolbar, and select **SnCalc Pro**.

## 📖 Usage Guide for Pro Addons

### Financial Workflow (RPN)
1. Use **g + PV** to enter Initial Cash Flow (`CFo`).
2. Use **g + PMT** to enter Periodic Cash Flows (`CFj`).
3. Use **f + PV** to solve for **NPV** or **f + PMT** to solve for **IRR**.
4. Set display decimals using **f + [0-9]**.

### Scientific Workflow
1. Use the **DEG/RAD** toggle at the bottom right to switch angle units.
2. The **Ans** key recalls the result of your previous calculation.
3. Supports nested parentheses and complex operator precedence.

## 🏗️ Building from Source

### Prerequisites
- [Node.js](https://nodejs.org/) (v18+)
- npm

### Build Command
```bash
npm install
./buildPlugin.sh
```
The production package will be generated at `build/outputs/SnCalc.snplg`.

## 📜 License
[MIT](LICENSE)
