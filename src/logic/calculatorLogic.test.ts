import {
  appendDecimalToExpression,
  appendDigitToExpression,
  appendOperatorToExpression,
  appendPercentToExpression,
  balanceExpression,
  buildLassoCalculationOutput,
  calculationErrorMessage,
  evaluateExpr,
  formatLassoCalculationResult,
  normalizeSimpleArithmeticExpression,
  solveTVM,
  toggleExpressionSign,
} from './calculatorLogic';

describe('Expression input helpers', () => {
  test('replaces repeated binary operators instead of creating nonsense', () => {
    expect(appendOperatorToExpression('', '+')).toBe('');
    expect(appendOperatorToExpression('', '-')).toBe('-');
    expect(appendOperatorToExpression('12+', '+')).toBe('12+');
    expect(appendOperatorToExpression('12+', '×')).toBe('12×');
    expect(appendOperatorToExpression('12×-', '+')).toBe('12+');
    const dashed = ['-', '-', '-'].reduce(appendOperatorToExpression, '12');
    const plussed = ['+', '+', '+'].reduce(appendOperatorToExpression, '12');
    expect(dashed).toBe('12-');
    expect(plussed).toBe('12+');
  });

  test('allows a unary minus after multiplication or division', () => {
    expect(appendOperatorToExpression('12×', '-')).toBe('12×-');
    expect(evaluateExpr('12×-3', 'deg')).toBe(-36);
  });

  test('keeps one decimal point per number segment', () => {
    expect(appendDecimalToExpression('')).toBe('0.');
    expect(appendDecimalToExpression('12')).toBe('12.');
    expect(appendDecimalToExpression('12.3')).toBe('12.3');
    expect(appendDecimalToExpression('12+')).toBe('12+0.');
  });

  test('normalizes leading zeroes while entering digits', () => {
    expect(appendDigitToExpression('0', '7')).toBe('7');
    expect(appendDigitToExpression('-0', '7')).toBe('-7');
    expect(appendDigitToExpression('10+', '0')).toBe('10+0');
  });

  test('only appends percent after a value', () => {
    expect(appendPercentToExpression('')).toBe('');
    expect(appendPercentToExpression('12+')).toBe('12+');
    expect(appendPercentToExpression('12')).toBe('12%');
    expect(appendPercentToExpression('12%')).toBe('12%');
  });

  test('toggles only the current term sign', () => {
    expect(toggleExpressionSign('12+3')).toBe('12+-3');
    expect(toggleExpressionSign('12+-3')).toBe('12+3');
    expect(toggleExpressionSign('')).toBe('-');
  });

  test('auto-balances open parentheses only when expression can be evaluated', () => {
    expect(balanceExpression('sin(90')).toBe('sin(90)');
    expect(balanceExpression('sin(')).toBe('sin(');
    expect(balanceExpression('12+')).toBe('12+');
  });

  test('normalizes simple OCR arithmetic for lasso calculation', () => {
    expect(normalizeSimpleArithmeticExpression('1+51+81=')).toBe('1+51+81');
    expect(normalizeSimpleArithmeticExpression('3 x 4')).toBe('3×4');
    expect(normalizeSimpleArithmeticExpression('10−2')).toBe('10-2');
    expect(evaluateExpr(normalizeSimpleArithmeticExpression('1+51+81='), 'deg')).toBe(133);
  });

  test('rejects unsupported OCR notation for lasso calculation', () => {
    expect(() => normalizeSimpleArithmeticExpression('√9=')).toThrow('Unsupported notation');
    expect(() => normalizeSimpleArithmeticExpression('1+')).toThrow('Incomplete arithmetic');
  });

  test('formats lasso calculation output from input precision', () => {
    expect(buildLassoCalculationOutput('10+30=')).toBe('10+30 = 40');
    expect(buildLassoCalculationOutput('10.0+30.0=')).toBe('10.0+30.0 = 40.0');
    expect(buildLassoCalculationOutput('10.00+30.00=')).toBe('10.00+30.00 = 40.00');
    expect(buildLassoCalculationOutput('10/4=')).toBe('10/4 = 2.5');
    expect(buildLassoCalculationOutput('10/3=')).toBe('10/3 = 3.33333333');
    expect(buildLassoCalculationOutput('10+30=', true)).toBe('40');
    expect(formatLassoCalculationResult('10.0/4.0', 2.5)).toBe('2.5');
  });
});

describe('Scientific Parser (evaluateExpr)', () => {
  test('evaluates basic arithmetic', () => {
    expect(evaluateExpr('2 + 3 * 4', 'deg')).toBe(14);
  });

  test('evaluates square roots with symbols', () => {
    expect(evaluateExpr('√(144)', 'deg')).toBe(12);
  });

  test('evaluates cubics and powers', () => {
    expect(evaluateExpr('5³', 'deg')).toBe(125);
    expect(evaluateExpr('2^3', 'deg')).toBe(8);
  });

  test('handles n-th roots (multi-argument)', () => {
    expect(evaluateExpr('ʸ√(64, 6)', 'deg')).toBe(2);
  });

  test('uses right-associative powers', () => {
    expect(evaluateExpr('2^3^2', 'deg')).toBe(512);
  });

  test('rejects incomplete exponent notation', () => {
    expect(() => evaluateExpr('1E', 'deg')).toThrow();
  });

  test('rejects invalid factorial values', () => {
    expect(() => evaluateExpr('2.5!', 'deg')).toThrow();
    expect(() => evaluateExpr('-3!', 'deg')).toThrow();
  });

  test('reports common scientific domain errors clearly', () => {
    expect(() => evaluateExpr('√(-1)', 'deg')).toThrow('Domain');
    expect(() => evaluateExpr('asin(2)', 'deg')).toThrow('Domain');
    expect(calculationErrorMessage(new Error('Domain'))).toBe('Domain error');
    expect(calculationErrorMessage(new Error('Expect )'))).toBe('Missing )');
  });

  test('supports odd roots of negative numbers', () => {
    expect(evaluateExpr('ʸ√(-8, 3)', 'deg')).toBe(-2);
  });

  test('respects angle units for trig', () => {
    expect(evaluateExpr('sin(90)', 'deg')).toBe(1);
    expect(evaluateExpr('sin(π/2)', 'rad')).toBe(1);
  });
});

describe('Financial Solver (solveTVM)', () => {
  const standardRegs = {
    n: 360,
    i: 0.5, // 6% annual / 12 months
    pv: -200000,
    pmt: 1199.10,
    fv: 0
  };

  test('solves for future value', () => {
    const res = solveTVM('fv', { ...standardRegs, fv: null });
    // Should be close to 0 (small error expected due to rounded 1199.10 PMT)
    expect(res).toBeLessThan(2); 
    expect(res).toBeGreaterThan(-2);
  });

  test('solves for monthly payment', () => {
    const res = solveTVM('pmt', { ...standardRegs, pmt: null });
    expect(res).toBeCloseTo(1199.10, 1);
  });
});
