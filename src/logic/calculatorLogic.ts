// ─── Types ───────────────────────────────────────────────────────────────────

export type AngleUnit = 'deg' | 'rad';

export interface FinancialRegisters {
  n: number | null;
  i: number | null;
  pv: number | null;
  pmt: number | null;
  fv: number | null;
}

// ─── Utils ───────────────────────────────────────────────────────────────────

export function formatNumber(n: number, decimals: number, thousandsSep = false): string {
  if (!isFinite(n)) {
    return isNaN(n) ? 'Error' : n > 0 ? '∞' : '-∞';
  }
  const fixed = n.toFixed(decimals);
  if (!thousandsSep) return fixed;
  const [intPart, decPart] = fixed.split('.');
  const formatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return decPart !== undefined ? `${formatted}.${decPart}` : formatted;
}

// ─── Expression Entry Helpers ───────────────────────────────────────────────

const BINARY_OPERATORS = '+-×÷^';
const TERM_BREAKERS = '+-×÷^(';

function lastChar(value: string): string {
  return value[value.length - 1] ?? '';
}

function isDigit(value: string): boolean {
  return value >= '0' && value <= '9';
}

function findLastTermStart(expr: string): number {
  for (let i = expr.length - 1; i >= 0; i--) {
    const ch = expr[i];
    if (ch === '-') {
      if (i === 0 || TERM_BREAKERS.includes(expr[i - 1])) {
        continue;
      }
      return i + 1;
    }
    if (ch === '+' || ch === '×' || ch === '÷' || ch === '(' || ch === ',') {
      return i + 1;
    }
  }
  return 0;
}

export function appendDigitToExpression(expr: string, digit: string): string {
  if (!isDigit(digit)) {
    return expr;
  }
  const start = findLastTermStart(expr);
  const term = expr.slice(start);
  if (term === '0') {
    return expr.slice(0, start) + digit;
  }
  if (term === '-0') {
    return expr.slice(0, start) + '-' + digit;
  }
  return expr + digit;
}

export function appendDecimalToExpression(expr: string): string {
  const start = findLastTermStart(expr);
  const term = expr.slice(start);
  const last = lastChar(expr);
  if (term.includes('.')) {
    return expr;
  }
  if (!expr || BINARY_OPERATORS.includes(last) || last === '(' || last === ',') {
    return expr + '0.';
  }
  if (last === '%' || last === '!' || last === ')') {
    return expr;
  }
  return expr + '.';
}

export function appendOperatorToExpression(expr: string, op: string): string {
  if (!BINARY_OPERATORS.includes(op)) {
    return expr;
  }
  if (!expr) {
    return op === '-' ? '-' : expr;
  }
  const last = lastChar(expr);
  if (last === '.') {
    expr = expr.slice(0, -1);
  }
  const cleanedLast = lastChar(expr);
  if (cleanedLast === '(' || cleanedLast === ',') {
    return op === '-' ? expr + '-' : expr;
  }
  if (BINARY_OPERATORS.includes(cleanedLast)) {
    const prev = expr[expr.length - 2] ?? '';
    if (op === '-' && cleanedLast !== '-' && cleanedLast !== '+') {
      return expr + '-';
    }
    if (cleanedLast === '-' && BINARY_OPERATORS.includes(prev)) {
      return expr.slice(0, -2) + op;
    }
    return expr.slice(0, -1) + op;
  }
  return expr + op;
}

export function appendPercentToExpression(expr: string): string {
  if (!expr) {
    return expr;
  }
  const last = lastChar(expr);
  if (BINARY_OPERATORS.includes(last) || last === '(' || last === ',' || last === '.' || last === '%' || last === '!') {
    return expr;
  }
  return expr + '%';
}

export function toggleExpressionSign(expr: string): string {
  if (!expr) {
    return '-';
  }
  const start = findLastTermStart(expr);
  const term = expr.slice(start);
  if (!term || term === '-') {
    return expr;
  }
  if (term.startsWith('-')) {
    return expr.slice(0, start) + term.slice(1);
  }
  return expr.slice(0, start) + '-' + term;
}

export function balanceExpression(expr: string): string {
  let depth = 0;
  for (const ch of expr) {
    if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      depth = Math.max(0, depth - 1);
    }
  }
  const last = lastChar(expr);
  if (!expr || BINARY_OPERATORS.includes(last) || last === '(' || last === ',' || last === '.') {
    return expr;
  }
  return expr + ')'.repeat(depth);
}

export function calculationErrorMessage(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  if (msg.includes('Div0')) return 'Division by zero';
  if (msg.includes('Domain')) return 'Domain error';
  if (msg.includes('Expect )')) return 'Missing )';
  if (msg.includes('Expect (')) return 'Missing (';
  if (msg.includes('Num?')) return 'Expected number';
  if (msg.includes('Bad factorial')) return 'Factorial needs whole number';
  if (msg.includes('Unexpected')) return 'Unexpected input';
  return 'Error';
}

export function normalizeSimpleArithmeticExpression(raw: string): string {
  let expr = raw
    .trim()
    .replace(/[−–—]/g, '-')
    .replace(/[·•]/g, '×')
    .replace(/[ｘXx]/g, '×')
    .replace(/[／]/g, '/')
    .replace(/[＋]/g, '+')
    .replace(/[＝]/g, '=')
    .replace(/,/g, '')
    .replace(/\s+/g, '');

  if (expr.includes('=')) {
    expr = expr.slice(0, expr.indexOf('='));
  }
  expr = expr.replace(/[=]+$/g, '');
  if (!expr || !/\d/.test(expr)) {
    throw new Error('No arithmetic found');
  }
  if (/[^0-9.+\-*/×÷()%]/.test(expr)) {
    throw new Error('Unsupported notation');
  }
  const balanced = balanceExpression(expr);
  if (!balanced || /[+\-*/×÷(.]$/.test(balanced)) {
    throw new Error('Incomplete arithmetic');
  }
  return balanced;
}

function decimalPlacesInInput(expr: string): number {
  const nums: string[] = expr.match(/\d+\.\d+|\.\d+/g) ?? [];
  return nums.reduce((max: number, num: string) => {
    const dec = num.split('.')[1] ?? '';
    return Math.max(max, dec.length);
  }, 0);
}

export function formatLassoCalculationResult(expr: string, result: number): string {
  if (!Number.isFinite(result)) {
    return 'Error';
  }
  const inputDecimals = decimalPlacesInInput(expr);
  if (Number.isInteger(result)) {
    return result.toFixed(inputDecimals);
  }
  const rounded = result.toFixed(Math.max(inputDecimals, 8));
  return rounded.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

export function buildLassoCalculationOutput(raw: string, resultOnly = false): string {
  const expression = normalizeSimpleArithmeticExpression(raw);
  const result = evaluateExpr(expression, 'deg');
  if (!Number.isFinite(result)) {
    throw new Error('Calculation did not produce a number');
  }
  const formatted = formatLassoCalculationResult(expression, result);
  return resultOnly ? formatted : `${expression} = ${formatted}`;
}

// ─── Expression Parser ───────────────────────────────────────────────────────

export function evaluateExpr(expr: string, angleUnit: AngleUnit): number {
  const s = expr.replace(/\s/g, '')
                .replace(/×/g, '*')
                .replace(/÷/g, '/')
                .replace(/ʸ√/g, 'root')
                .replace(/∛/g, 'cbrt')
                .replace(/√/g, 'sqrt')
                .replace(/²/g, '**2')
                .replace(/³/g, '**3')
                .replace(/\^/g, '**')
                .replace(/π/g, 'Math.PI')
                .replace(/([^0-9A-Za-z])e([^0-9A-Za-z])/g, '$1Math.E$2')
                .replace(/^e([^0-9A-Za-z])/g, 'Math.E$1')
                .replace(/([^0-9A-Za-z])e$/g, '$1Math.E')
                .replace(/^e$/g, 'Math.E');
  if (!s) return 0;
  
  let pos = 0;
  const peek = () => s[pos] ?? '';
  const consume = () => s[pos++] ?? '';

  function toRad(val: number) { return angleUnit === 'deg' ? val * Math.PI / 180 : val; }
  function fromRad(val: number) { return angleUnit === 'deg' ? val * 180 / Math.PI : val; }
  function requireDomain(ok: boolean): void {
    if (!ok) throw new Error('Domain');
  }

  function parseNumber(): number {
    if (s.slice(pos, pos+7) === 'Math.PI') { pos += 7; return Math.PI; }
    if (s.slice(pos, pos+6) === 'Math.E') { pos += 6; return Math.E; }
    
    // Check for functions
    const funcMatch = s.slice(pos).match(/^(sinh|cosh|tanh|asinh|acosh|atanh|sin|cos|tan|asin|acos|atan|ln|log2|log|sqrt|cbrt|exp|abs|rand|root|mod)/);
    if (funcMatch) {
        const func = funcMatch[0];
        pos += func.length;
        if (func === 'rand') {
            if (peek() === '(') { consume(); if (peek() === ')') consume(); }
            return Math.random();
        }
        if (peek() !== '(') throw new Error('Expect (');
        consume(); // (
        const args: number[] = [];
        args.push(parseAddSub());
        while (peek() === ',') {
            consume();
            args.push(parseAddSub());
        }
        if (consume() !== ')') throw new Error('Expect )');
        
        const val = args[0];
        switch (func) {
            case 'sin': return Math.sin(toRad(val));
            case 'cos': return Math.cos(toRad(val));
            case 'tan': return Math.tan(toRad(val));
            case 'asin': requireDomain(val >= -1 && val <= 1); return fromRad(Math.asin(val));
            case 'acos': requireDomain(val >= -1 && val <= 1); return fromRad(Math.acos(val));
            case 'atan': return fromRad(Math.atan(val));
            case 'sinh': return Math.sinh(val);
            case 'cosh': return Math.cosh(val);
            case 'tanh': return Math.tanh(val);
            case 'asinh': return Math.asinh(val);
            case 'acosh': requireDomain(val >= 1); return Math.acosh(val);
            case 'atanh': requireDomain(val > -1 && val < 1); return Math.atanh(val);
            case 'ln': requireDomain(val > 0); return Math.log(val);
            case 'log': requireDomain(val > 0); return Math.log10(val);
            case 'log2': requireDomain(val > 0); return Math.log2(val);
            case 'sqrt': requireDomain(val >= 0); return Math.sqrt(val);
            case 'cbrt': return Math.cbrt(val);
            case 'exp': return Math.exp(val);
            case 'abs': return Math.abs(val);
            case 'root': {
                const root = args[1] || 2;
                requireDomain(root !== 0);
                const isOddIntegerRoot = Number.isInteger(root) && Math.abs(root % 2) === 1;
                requireDomain(val >= 0 || isOddIntegerRoot);
                if (val < 0 && isOddIntegerRoot) {
                    return -Math.pow(Math.abs(val), 1 / root);
                }
                return Math.pow(val, 1 / root);
            }
            case 'mod': {
                const divisor = args[1] ?? 1;
                if (divisor === 0) throw new Error('Div0');
                return val % divisor;
            }
            default: return 0;
        }
    }

    if (peek() === '(') {
        consume(); // (
        const val = parseAddSub();
        if (consume() !== ')') throw new Error('Expect )');
        return val;
    }

    const match = s.slice(pos).match(/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:E-?\d+)?/);
    if (!match) throw new Error('Num?');
    const str = match[0];
    pos += str.length;
    let val = parseFloat(str);

    // Suffix operators: % and !
    while (peek() === '%' || peek() === '!') {
        const op = consume();
        if (op === '%') val /= 100;
        else if (op === '!') {
            if (val < 0 || !Number.isInteger(val)) {
                throw new Error('Bad factorial');
            }
            let res = 1;
            for (let i = 2; i <= Math.floor(val); i++) res *= i;
            val = res;
        }
    }
    return val;
  }

  function parsePower(): number {
      let left = parseNumber();
      if (pos < s.length && s.slice(pos, pos+2) === '**') {
          pos += 2;
          const right = parsePower();
          left = Math.pow(left, right);
      }
      return left;
  }

  function parseTerm(): number {
    let left = parsePower();
    while (pos < s.length) {
      if (peek() === '*' || peek() === '/') {
        const op = consume();
        const right = parsePower();
        if (op === '*') left *= right;
        else { if (right === 0) throw new Error('Div0'); left /= right; }
      } else if (s.slice(pos, pos + 3) === 'mod') {
        pos += 3;
        const right = parsePower();
        if (right === 0) throw new Error('Div0');
        left = left % right;
      } else if (peek() === '(' || s.slice(pos, pos + 7) === 'Math.PI' || s.slice(pos, pos + 6) === 'Math.E') {
        left *= parsePower();
      } else if (peek() === 'e') {
        pos++;
        left *= Math.E;
      } else if (/^(sinh|cosh|tanh|asinh|acosh|atanh|sin|cos|tan|asin|acos|atan|ln|log2|log|sqrt|cbrt|exp|abs|rand|root)/.test(s.slice(pos))) {
        left *= parsePower();
      } else break;
    }
    return left;
  }

  function parseAddSub(): number {
    let left = parseTerm();
    while (pos < s.length && (peek() === '+' || peek() === '-')) {
      const op = consume();
      const right = parseTerm();
      left = op === '+' ? left + right : left - right;
    }
    return left;
  }

  const result = parseAddSub();
  if (pos < s.length) throw new Error('Unexpected: ' + s[pos]);
  return result;
}

// ─── TVM Solver Logic ────────────────────────────────────────────────────────

export function solveTVM(target: keyof FinancialRegisters, regs: FinancialRegisters): number {
  const n = regs.n ?? 0;
  const i = (regs.i ?? 0) / 100;
  const pv = regs.pv ?? 0;
  const pmt = regs.pmt ?? 0;
  const fv = regs.fv ?? 0;
  const type = 0;

  if (target === 'fv') {
    if (i === 0) return -(pv + pmt * n);
    const q = Math.pow(1 + i, n);
    return -(pv * q + pmt * (1 + i * type) * (q - 1) / i);
  }
  if (target === 'pv') {
    if (i === 0) return -(fv + pmt * n);
    const q = Math.pow(1 + i, n);
    return -(fv + pmt * (1 + i * type) * (q - 1) / i) / q;
  }
  if (target === 'n') {
    if (i === 0) return pmt === 0 ? 0 : -(fv + pv) / pmt;
    const A = pmt * (1 + i * type) / i;
    const val = (A - fv) / (pv + A);
    if (val <= 0) return 0;
    return Math.log(val) / Math.log(1 + i);
  }
  if (target === 'pmt') {
    if (i === 0) return n === 0 ? 0 : -(pv + fv) / n;
    const q = Math.pow(1 + i, n);
    return -(fv + pv * q) / ((1 + i * type) * (q - 1) / i);
  }
  if (target === 'i') {
    let rate = 0.01;
    for (let j = 0; j < 150; j++) {
      const q = Math.pow(1 + rate, n);
      const q1 = Math.pow(1 + rate, n - 1);
      const f = pv * q + pmt * (1 + rate * type) * (q - 1) / rate + fv;
      const df = n * pv * q1 + pmt * (type * (q - 1) + (1 + rate * type) * (n * rate * q1 - (q - 1)) / (rate * rate));
      if (Math.abs(df) < 1e-22) break;
      const nextRate = rate - f / df;
      if (Math.abs(nextRate - rate) < 1e-18) return nextRate * 100;
      rate = nextRate;
    }
    return rate * 100;
  }
  return 0;
}
