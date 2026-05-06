import { evaluateExpr, solveTVM } from './calculatorLogic';

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
