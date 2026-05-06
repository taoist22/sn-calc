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

export function formatNumber(n: number, decimals: number): string {
  if (!isFinite(n)) {
    return isNaN(n) ? 'Error' : n > 0 ? '∞' : '-∞';
  }
  return n.toFixed(decimals);
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

  function parseNumber(): number {
    if (s.slice(pos, pos+7) === 'Math.PI') { pos += 7; return Math.PI; }
    if (s.slice(pos, pos+6) === 'Math.E') { pos += 6; return Math.E; }
    
    // Check for functions
    const funcMatch = s.slice(pos).match(/^(sinh|cosh|tanh|asinh|acosh|atanh|sin|cos|tan|asin|acos|atan|ln|log|log2|sqrt|cbrt|exp|abs|rand|root)/);
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
            case 'asin': return fromRad(Math.asin(val));
            case 'acos': return fromRad(Math.acos(val));
            case 'atan': return fromRad(Math.atan(val));
            case 'sinh': return Math.sinh(val);
            case 'cosh': return Math.cosh(val);
            case 'tanh': return Math.tanh(val);
            case 'asinh': return Math.asinh(val);
            case 'acosh': return Math.acosh(val);
            case 'atanh': return Math.atanh(val);
            case 'ln': return Math.log(val);
            case 'log': return Math.log10(val);
            case 'log2': return Math.log2(val);
            case 'sqrt': return Math.sqrt(val);
            case 'cbrt': return Math.cbrt(val);
            case 'exp': return Math.exp(val);
            case 'abs': return Math.abs(val);
            case 'root': return Math.pow(val, 1 / (args[1] || 2));
            default: return 0;
        }
    }

    if (peek() === '(') {
        consume(); // (
        const val = parseAddSub();
        if (consume() !== ')') throw new Error('Expect )');
        return val;
    }

    let str = '';
    if (peek() === '-') str += consume();
    while (pos < s.length && ((peek() >= '0' && peek() <= '9') || peek() === '.' || peek() === 'E' || (str.includes('E') && (str.endsWith('E') && peek() === '-')))) str += consume();
    if (!str || str === '-') throw new Error('Num?');
    let val = parseFloat(str);

    // Suffix operators: % and !
    while (peek() === '%' || peek() === '!') {
        const op = consume();
        if (op === '%') val /= 100;
        else if (op === '!') {
            let res = 1;
            for (let i = 2; i <= Math.floor(val); i++) res *= i;
            val = res;
        }
    }
    return val;
  }

  function parsePower(): number {
      let left = parseNumber();
      while (pos < s.length && s.slice(pos, pos+2) === '**') {
          pos += 2;
          const right = parseNumber();
          left = Math.pow(left, right);
      }
      return left;
  }

  function parseTerm(): number {
    let left = parsePower();
    while (pos < s.length && (peek() === '*' || peek() === '/')) {
      const op = consume();
      const right = parsePower();
      if (op === '*') left *= right;
      else if (op === '/') { if (right === 0) throw new Error('Div0'); left /= right; }
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

  return parseAddSub();
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
