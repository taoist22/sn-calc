import React, {useCallback, useRef, useState} from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {PluginCommAPI, PluginFileAPI, PluginManager, PluginNoteAPI} from 'sn-plugin-lib';

import {
  AngleUnit,
  FinancialRegisters,
  formatNumber,
  evaluateExpr,
  solveTVM
} from './logic/calculatorLogic';
import { CONV_CATEGORIES } from './logic/conversionData';

// ─── Types ───────────────────────────────────────────────────────────────────

type CalcMode = 'standard' | 'conversion' | 'financial' | 'scientific';
const MODE_LABELS: Record<CalcMode, string> = { standard: 'STD', conversion: 'CONV', financial: 'FIN', scientific: 'SCI' };
type StampMode = 'result' | 'expression';
type ApiRes<T> = {success: boolean; result?: T; error?: {message?: string}} | null | undefined;

// ─── Constants ───────────────────────────────────────────────────────────────

const PANEL_WIDTH = 480;
const PANEL_PADDING = 15;
const BTN_GAP = 5;
const BTN_HEIGHT = 44;
const STAMP_FONT_SIZE = 40;
const LINE_HEIGHT_PAD = 10;
const SMART_PLACEMENT_GAP = 40;
const BOTTOM_MARGIN = 160;
const LEFT_MARGIN = 180;
const DEFAULT_PAGE_WIDTH = 1404;
const DEFAULT_PAGE_HEIGHT = 1872;
const ERROR_DISPLAY_MS = 2500;

// ─── Smart placement ─────────────────────────────────────────────────────────

async function findInsertTop(filePath: string, pageNum: number, pageHeight: number, boxHeight: number): Promise<number> {
  try {
    const res = (await PluginFileAPI.getElements(pageNum, filePath)) as ApiRes<any[]>;
    if (res?.success && Array.isArray(res.result) && res.result.length > 0) {
      const lowestEdge = Math.max(...res.result.map((el: any) => el.maxY ?? 0));
      const candidate = lowestEdge + SMART_PLACEMENT_GAP;
      if (candidate + boxHeight + 20 < pageHeight) return candidate;
    }
  } catch {}
  return pageHeight - BOTTOM_MARGIN - boxHeight;
}

async function doInsert(text: string): Promise<void> {
  let pageWidth = DEFAULT_PAGE_WIDTH, pageHeight = DEFAULT_PAGE_HEIGHT, filePath: string | undefined, pageNum: number | undefined;
  try {
    const pathRes = (await PluginCommAPI.getCurrentFilePath()) as ApiRes<string>;
    const pageRes = (await PluginCommAPI.getCurrentPageNum()) as ApiRes<number>;
    if (pathRes?.success && pageRes?.success) {
      filePath = pathRes.result; pageNum = pageRes.result;
      const sizeRes = (await PluginFileAPI.getPageSize(filePath!, pageNum!)) as ApiRes<{width: number; height: number}>;
      if (sizeRes?.success && sizeRes.result) { pageWidth = sizeRes.result.width; pageHeight = sizeRes.result.height; }
    }
  } catch {}
  
  const lines = text.split('\n');
  const lineCount = lines.length;
  const maxLineLength = Math.max(...lines.map(l => l.length));
  const boxWidth = Math.max(STAMP_FONT_SIZE * 6, Math.min(Math.ceil(maxLineLength * STAMP_FONT_SIZE * 0.7), pageWidth - 100));
  const boxHeight = lineCount * (STAMP_FONT_SIZE + LINE_HEIGHT_PAD);
  const top = (filePath !== undefined && pageNum !== undefined) ? await findInsertTop(filePath, pageNum, pageHeight, boxHeight) : pageHeight - BOTTOM_MARGIN - boxHeight;

  const textRect = { left: LEFT_MARGIN, top, right: LEFT_MARGIN + boxWidth, bottom: top + boxHeight };
  const res = (await PluginNoteAPI.insertText({ textContentFull: text, textRect, fontSize: STAMP_FONT_SIZE, textBold: 1, textItalics: 0, textAlign: 0, textEditable: 1, showLassoAfterInsert: true })) as ApiRes<boolean>;
  if (!res?.success) throw new Error(res?.error?.message ?? 'Fail');
  try { await PluginCommAPI.lassoElements(textRect); } catch {}
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function CalcPanelPro() {
  const [mode, setMode] = useState<CalcMode>('standard');
  const [angleUnit, setAngleUnit] = useState<AngleUnit>('deg');
  const [stack, setStack] = useState<[number, number, number, number]>([0, 0, 0, 0]);
  const [inputBuffer, setInputBuffer] = useState('');
  const [isEntering, setIsEntering] = useState(false);
  const [liftEnabled, setLiftEnabled] = useState(true);
  const [decimalPlaces, setDecimalPlaces] = useState(2);
  const [fKeyState, setFKeyState] = useState(false);
  const [gKeyState, setGKeyState] = useState(false);
  const [finRegs, setFinRegs] = useState<FinancialRegisters>({ n: null, i: null, pv: null, pmt: null, fv: null });
  const [cashFlows, setCashFlows] = useState<{v: number, n: number}[]>([]);
  const [lastX, setLastX] = useState(0);
  const [amortPeriodsTotal, setAmortPeriodsTotal] = useState(0);
  const [expression, setExpression] = useState('');
  const [stdResult, setStdResult] = useState<number | null>(null);
  const [evaluated, setEvaluated] = useState(false);
  const [stampMode, setStampMode] = useState<StampMode>('result');
  const [inserting, setInserting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [thousandsSep, setThousandsSep] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState<number | null>(null);
  const [savedExpr, setSavedExpr] = useState('');
  const [memoryRegister, setMemoryRegister] = useState(0);
  const [convCatIdx, setConvCatIdx] = useState(4);  // default: Length
  const [convFromIdx, setConvFromIdx] = useState(2); // default: m
  const [convToIdx, setConvToIdx] = useState(5);     // default: ft
  const [convFromVal, setConvFromVal] = useState('');
  const [convToVal, setConvToVal] = useState('');
  const [convActive, setConvActive] = useState<'from'|'to'>('from');
  const [convPicker, setConvPicker] = useState<'cat'|'from'|'to'|null>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showError = useCallback((msg: string) => {
    setError(msg);
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    errorTimerRef.current = setTimeout(() => setError(null), ERROR_DISPLAY_MS);
  }, []);

  const handleClose = useCallback(() => { if (!inserting) PluginManager.closePluginView(); }, [inserting]);

  const handleHistoryPrev = () => {
    if (history.length === 0) return;
    if (historyIdx === null) {
      setSavedExpr(expression);
      const idx = history.length - 1;
      setHistoryIdx(idx);
      setExpression(history[idx]);
      setStdResult(null); setEvaluated(false);
    } else if (historyIdx > 0) {
      const idx = historyIdx - 1;
      setHistoryIdx(idx);
      setExpression(history[idx]);
      setStdResult(null); setEvaluated(false);
    }
  };

  const handleHistoryNext = () => {
    if (historyIdx === null) return;
    if (historyIdx < history.length - 1) {
      const idx = historyIdx + 1;
      setHistoryIdx(idx);
      setExpression(history[idx]);
      setStdResult(null); setEvaluated(false);
    } else {
      setHistoryIdx(null);
      setExpression(savedExpr);
    }
  };

  const getCurrentValue = (): number | null => {
    if (evaluated && stdResult !== null) return stdResult;
    try { return evaluateExpr(expression || '0', angleUnit); } catch { return null; }
  };
  const handleMPlus  = () => { const v = getCurrentValue(); if (v !== null) setMemoryRegister(p => p + v); };
  const handleMMinus = () => { const v = getCurrentValue(); if (v !== null) setMemoryRegister(p => p - v); };
  const handleMR     = () => {
    const s = memoryRegister.toString();
    if (evaluated) { setExpression(s); setStdResult(null); setEvaluated(false); }
    else setExpression(p => p + s);
  };
  const handleMC = () => setMemoryRegister(0);

  // ─── Conversion helpers ───────────────────────────────────────────────────

  const doConvert = (val: string, fromIdx: number, toIdx: number, catIdx: number): string => {
    const num = parseFloat(val);
    if (!val || isNaN(num)) return '';
    const cat = CONV_CATEGORIES[catIdx];
    const base = cat.units[fromIdx].toBase(num);
    const result = cat.units[toIdx].fromBase(base);
    return parseFloat(result.toPrecision(10)).toString();
  };

  const handleConvDigit = (d: string) => {
    if (convActive === 'from') {
      if (d === '.' && convFromVal.includes('.')) return;
      const next = convFromVal === '0' && d !== '.' ? d : convFromVal + d;
      setConvFromVal(next);
      setConvToVal(doConvert(next, convFromIdx, convToIdx, convCatIdx));
    } else {
      if (d === '.' && convToVal.includes('.')) return;
      const next = convToVal === '0' && d !== '.' ? d : convToVal + d;
      setConvToVal(next);
      setConvFromVal(doConvert(next, convToIdx, convFromIdx, convCatIdx));
    }
  };

  const handleConvBackspace = () => {
    if (convActive === 'from') {
      const next = convFromVal.slice(0, -1);
      setConvFromVal(next);
      setConvToVal(next ? doConvert(next, convFromIdx, convToIdx, convCatIdx) : '');
    } else {
      const next = convToVal.slice(0, -1);
      setConvToVal(next);
      setConvFromVal(next ? doConvert(next, convToIdx, convFromIdx, convCatIdx) : '');
    }
  };

  const handleConvClear = () => { setConvFromVal(''); setConvToVal(''); };

  const handleConvNegate = () => {
    if (convActive === 'from') {
      const next = convFromVal.startsWith('-') ? convFromVal.slice(1) : (convFromVal ? '-' + convFromVal : '-');
      setConvFromVal(next);
      setConvToVal(doConvert(next, convFromIdx, convToIdx, convCatIdx));
    } else {
      const next = convToVal.startsWith('-') ? convToVal.slice(1) : (convToVal ? '-' + convToVal : '-');
      setConvToVal(next);
      setConvFromVal(doConvert(next, convToIdx, convFromIdx, convCatIdx));
    }
  };

  const handleConvSwap = () => {
    const fi = convToIdx, ti = convFromIdx, fv = convToVal, tv = convFromVal;
    setConvFromIdx(fi); setConvToIdx(ti); setConvFromVal(fv); setConvToVal(tv);
  };

  const handleCatSelect = (idx: number) => {
    setConvCatIdx(idx);
    setConvFromIdx(0);
    setConvToIdx(Math.min(1, CONV_CATEGORIES[idx].units.length - 1));
    setConvFromVal(''); setConvToVal('');
    setConvPicker(null);
  };

  const handleUnitSelect = (idx: number) => {
    if (convPicker === 'from') {
      setConvFromIdx(idx);
      setConvToVal(convFromVal ? doConvert(convFromVal, idx, convToIdx, convCatIdx) : '');
    } else if (convPicker === 'to') {
      setConvToIdx(idx);
      setConvToVal(convFromVal ? doConvert(convFromVal, convFromIdx, idx, convCatIdx) : '');
    }
    setConvPicker(null);
  };

  const handleDigit = (d: string) => {
    setError(null);
    if (fKeyState) {
        const val = parseInt(d, 10);
        if (!isNaN(val)) setDecimalPlaces(val);
        setFKeyState(false);
        return;
    }
    if (gKeyState) {
        setGKeyState(false);
    }

    if (mode === 'financial') {
        if (!isEntering) {
            const newStack: [number, number, number, number] = liftEnabled ? [0, stack[0], stack[1], stack[2]] : [...stack];
            setStack(newStack);
            setInputBuffer(d === '.' ? '0.' : d);
            setIsEntering(true); setLiftEnabled(true);
        } else {
            if (d === '.' && inputBuffer.includes('.')) return;
            setInputBuffer(prev => prev + d);
        }
    } else {
      if (evaluated) { setExpression(d); setStdResult(null); setEvaluated(false); } 
      else setExpression(prev => prev + d);
    }
  };

  const handleOperator = (op: string) => {
    setError(null);
    if (mode === 'financial') {
      const x = isEntering ? parseFloat(inputBuffer || '0') : stack[0];
      setLastX(x);
      const y = stack[1];
      let res = 0;
      if (op === '+') res = y + x;
      else if (op === '-') res = y - x;
      else if (op === '×') res = y * x;
      else if (op === '÷') res = x === 0 ? 0 : y / x;
      setStack([res, stack[2], stack[3], stack[3]]);
      setInputBuffer(''); setIsEntering(false); setLiftEnabled(true);
    } else {
      if (evaluated && stdResult !== null) { setExpression(stdResult.toString() + op); setStdResult(null); setEvaluated(false); }
      else setExpression(prev => prev + op);
    }
  };

  const handleEnter = () => {
    const val = isEntering ? parseFloat(inputBuffer || '0') : stack[0];
    setStack([val, val, stack[1], stack[2]]);
    setInputBuffer(''); setIsEntering(false); setLiftEnabled(false);
  };

  const handleFinReg = (reg: keyof FinancialRegisters) => {
    if (isEntering) {
        const val = parseFloat(inputBuffer || '0');
        setFinRegs(prev => ({ ...prev, [reg]: val }));
        setIsEntering(false); setInputBuffer(''); setLiftEnabled(true);
    } else {
        handleSolve(reg);
    }
  };

  const handleSolve = (reg: keyof FinancialRegisters) => {
    try {
      const res = solveTVM(reg, finRegs);
      setFinRegs(prev => ({ ...prev, [reg]: res }));
      setStack(prev => [res, prev[1], prev[2], prev[3]]);
      setIsEntering(false); setInputBuffer(''); setLiftEnabled(true);
    } catch (e) { showError('Check Inputs'); }
  };

  const solveNPV = () => {
    if (cashFlows.length === 0) { showError('No Cash Flows'); return; }
    const i = (finRegs.i ?? 0) / 100;
    let npv = cashFlows[0].v;
    let period = 1;
    for (let j = 1; j < cashFlows.length; j++) {
        for (let k = 0; k < cashFlows[j].n; k++) {
            npv += cashFlows[j].v / Math.pow(1 + i, period);
            period++;
        }
    }
    pushX(npv, true);
  };

  const solveIRR = () => {
    if (cashFlows.length === 0) { showError('No Cash Flows'); return; }
    let rate = 0.1; 
    for (let iteration = 0; iteration < 100; iteration++) {
        let npv = cashFlows[0].v;
        let dNpv = 0;
        let period = 1;
        for (let j = 1; j < cashFlows.length; j++) {
            for (let k = 0; k < cashFlows[j].n; k++) {
                const disc = Math.pow(1 + rate, period);
                npv += cashFlows[j].v / disc;
                dNpv -= (period * cashFlows[j].v) / (disc * (1 + rate));
                period++;
            }
        }
        if (Math.abs(dNpv) < 1e-12) break;
        const nextRate = rate - npv / dNpv;
        if (Math.abs(nextRate - rate) < 1e-10) {
            pushX(nextRate * 100, true);
            return;
        }
        rate = nextRate;
    }
    showError('IRR: No convergence');
  };

  const handleCFo = () => {
    const val = isEntering ? parseFloat(inputBuffer || '0') : stack[0];
    setCashFlows([{v: val, n: 1}]);
    setIsEntering(false); setInputBuffer(''); setLiftEnabled(true);
  };

  const handleCFj = () => {
    const val = isEntering ? parseFloat(inputBuffer || '0') : stack[0];
    setCashFlows(prev => [...prev, {v: val, n: 1}]);
    setIsEntering(false); setInputBuffer(''); setLiftEnabled(true);
  };

  const handleNj = () => {
    const val = Math.floor(isEntering ? parseFloat(inputBuffer || '0') : stack[0]);
    if (val < 1 || cashFlows.length < 2) { showError('Invalid Nj'); return; }
    setCashFlows(prev => {
        const last = prev[prev.length - 1];
        return [...prev.slice(0, -1), { ...last, n: val }];
    });
    setIsEntering(false); setInputBuffer(''); setLiftEnabled(true);
  };

  const handleLastX = () => {
    pushX(lastX, true);
  };

  const handleClearStack = () => {
    setStack([0, 0, 0, 0]);
    setIsEntering(false);
    setInputBuffer('');
  };

  const handleAmort = () => {
    const periodsToAmort = isEntering ? parseFloat(inputBuffer || '0') : stack[0];
    if (periodsToAmort <= 0 || !finRegs.pv || !finRegs.i || !finRegs.pmt) {
        showError('Set n, i, PV, PMT'); return;
    }
    
    const i = (finRegs.i ?? 0) / 100;
    let balance = finRegs.pv ?? 0;
    const pmt = finRegs.pmt ?? 0;
    let totalInterest = 0;
    let totalPrincipal = 0;

    for (let p = 0; p < periodsToAmort; p++) {
        const interest = balance * i;
        const principal = pmt + interest; // PMT is negative
        totalInterest += interest;
        totalPrincipal += principal;
        balance += principal;
    }

    setAmortPeriodsTotal(prev => prev + periodsToAmort);
    setFinRegs(prev => ({ ...prev, pv: balance }));
    // X = Principal, Y = Interest, Z = Balance
    setStack([totalPrincipal, totalInterest, balance, stack[2]]);
    setIsEntering(false); setInputBuffer(''); setLiftEnabled(true);
  };

  const handleInsert = useCallback(async () => {
    if (inserting) return;
    let text = "";
    if (mode === 'conversion') {
      const cat = CONV_CATEGORIES[convCatIdx];
      const fromUnit = cat.units[convFromIdx].label;
      const toUnit = cat.units[convToIdx].label;
      const fv = convFromVal || '0';
      const tv = convToVal || doConvert(fv, convFromIdx, convToIdx, convCatIdx);
      text = stampMode === 'result'
        ? `${fv} ${fromUnit} = ${tv} ${toUnit}`
        : `${cat.name}: ${fv} ${fromUnit} = ${tv} ${toUnit}`;
    } else if (mode === 'financial') {
        const valX = isEntering ? parseFloat(inputBuffer || '0') : stack[0];
        if (stampMode === 'result') { text = formatNumber(valX, decimalPlaces, thousandsSep); }
        else {
            const parts = [];
            if (cashFlows.length > 0) {
                parts.push('--- CASH FLOWS ---');
                cashFlows.forEach((cf, idx) => {
                    parts.push(`CF${idx}: ${formatNumber(cf.v, 2, thousandsSep)}${cf.n > 1 ? ` (n:${cf.n})` : ''}`);
                });
                parts.push('------------------');
            } else if (amortPeriodsTotal > 0) {
                parts.push('--- AMORTIZATION ---');
                parts.push(`Periods: ${amortPeriodsTotal}`);
                parts.push(`Principal: ${formatNumber(stack[0], decimalPlaces, thousandsSep)}`);
                parts.push(`Interest: ${formatNumber(stack[1], decimalPlaces, thousandsSep)}`);
                parts.push(`Remaining: ${formatNumber(stack[2], decimalPlaces, thousandsSep)}`);
                parts.push('--------------------');
            } else {
                if (finRegs.n !== null) parts.push(`n: ${formatNumber(finRegs.n, 2)}`);
                if (finRegs.i !== null) parts.push(`i: ${formatNumber(finRegs.i, 2)}%`);
                if (finRegs.pv !== null) parts.push(`PV: ${formatNumber(finRegs.pv, 2, thousandsSep)}`);
                if (finRegs.pmt !== null) parts.push(`PMT: ${formatNumber(finRegs.pmt, 2, thousandsSep)}`);
                if (finRegs.fv !== null) parts.push(`FV: ${formatNumber(finRegs.fv, 2, thousandsSep)}`);
                parts.push('------------------');
            }
            text = `${parts.join('\n')}\nResult: ${formatNumber(valX, decimalPlaces, thousandsSep)}`;
        }
    } else {
      try {
        const val = evaluated && stdResult !== null ? stdResult : evaluateExpr(expression || '0', angleUnit);
        text = stampMode === 'result' ? formatNumber(val, decimalPlaces, thousandsSep) : `${expression} = ${formatNumber(val, decimalPlaces, thousandsSep)}`;
      } catch (e) { showError('Error'); return; }
    }
    setInserting(true);
    try { await doInsert(text); PluginManager.closePluginView(); }
    catch (e) { showError('Insert failed'); } finally { setInserting(false); }
  }, [inserting, mode, stack, inputBuffer, isEntering, finRegs, decimalPlaces, expression, stdResult, evaluated, stampMode, showError, amortPeriodsTotal, cashFlows, angleUnit, thousandsSep, convCatIdx, convFromIdx, convToIdx, convFromVal, convToVal]);

  const handleShiftedAction = (fAction: () => void, gAction: () => void, normalAction: () => void) => {
    if (fKeyState) { fAction(); setFKeyState(false); }
    else if (gKeyState) { gAction(); setGKeyState(false); }
    else normalAction();
  };

  const pushX = (val: number, lift: boolean) => {
    if (lift) setStack(prev => [val, prev[0], prev[1], prev[2]]);
    else setStack(prev => [val, prev[1], prev[2], prev[3]]);
    setIsEntering(false); setInputBuffer(''); setLiftEnabled(true);
  };

  const handleSciFunc = (func: string) => {
    setError(null);
    const suffix = func === 'rand' ? '()' : '(';
    if (evaluated) {
        setExpression(func + suffix); setStdResult(null); setEvaluated(false);
    } else {
        setExpression(prev => prev + func + suffix);
    }
  };

  const handleEqual = () => {
    try {
        const res = evaluateExpr(expression, angleUnit);
        setStdResult(res);
        setEvaluated(true);
        setHistory(prev => [...prev.slice(-19), expression]);
        setHistoryIdx(null);
    } catch (e) { showError('Error'); }
  };

  const layouts = {
    standard: {
      cols: 5,
      buttons: [
        {label: '7', action: () => handleDigit('7')},
        {label: '8', action: () => handleDigit('8')},
        {label: '9', action: () => handleDigit('9')},
        {label: '÷', action: () => handleOperator('÷'), variant: 'operator'},
        {label: '⌫', action: () => setExpression(p => p.slice(0, -1)), variant: 'utility'},

        {label: '4', action: () => handleDigit('4')},
        {label: '5', action: () => handleDigit('5')},
        {label: '6', action: () => handleDigit('6')},
        {label: '×', action: () => handleOperator('×'), variant: 'operator'},
        {label: 'AC', action: () => { setExpression(''); setStdResult(null); setEvaluated(false); }, variant: 'highlight'},

        {label: '1', action: () => handleDigit('1')},
        {label: '2', action: () => handleDigit('2')},
        {label: '3', action: () => handleDigit('3')},
        {label: '-', action: () => handleOperator('-'), variant: 'operator'},
        {label: '%', action: () => setExpression(p => p + '%'), variant: 'utility'},

        {label: '+/-', action: () => {
            if (evaluated && stdResult !== null) setStdResult(-stdResult);
            else setExpression(prev => prev.startsWith('-') ? prev.slice(1) : '-' + prev);
        }, variant: 'utility'},
        {label: '0', action: () => handleDigit('0')},
        {label: '.', action: () => handleDigit('.'), variant: 'number'},
        {label: '+', action: () => handleOperator('+'), variant: 'operator'},
        {label: '=', action: handleEqual, variant: 'equals'},
      ]
    },
    financial: {
      cols: 5,
      buttons: [
        // Row 1: Primary Financials with Shifts
        {
            label: fKeyState ? 'n' : gKeyState ? 'n*12' : 'n', 
            action: () => handleShiftedAction(
                () => handleFinReg('n'),
                () => { const val = (isEntering ? parseFloat(inputBuffer || '0') : stack[0]) * 12; setFinRegs(prev => ({...prev, n: val})); pushX(val, true); },
                () => handleFinReg('n')
            ), 
            variant: 'function'
        },
        {
            label: fKeyState ? 'i' : gKeyState ? 'i/12' : 'i', 
            action: () => handleShiftedAction(
                () => handleFinReg('i'),
                () => { const val = (isEntering ? parseFloat(inputBuffer || '0') : stack[0]) / 12; setFinRegs(prev => ({...prev, i: val})); pushX(val, true); },
                () => handleFinReg('i')
            ), 
            variant: 'function'
        },
        {
            label: fKeyState ? 'NPV' : gKeyState ? 'CFo' : 'PV', 
            action: () => handleShiftedAction(
                () => solveNPV(),
                () => handleCFo(),
                () => handleFinReg('pv')
            ), 
            variant: 'function'
        },
        {
            label: fKeyState ? 'IRR' : gKeyState ? 'CFj' : 'PMT', 
            action: () => handleShiftedAction(
                () => solveIRR(),
                () => handleCFj(),
                () => handleFinReg('pmt')
            ), 
            variant: 'function'
        },
        {
            label: fKeyState ? 'FV' : gKeyState ? 'Nj' : 'FV', 
            action: () => handleShiftedAction(
                () => handleFinReg('fv'),
                () => handleNj(),
                () => handleFinReg('fv')
            ), 
            variant: 'function'
        },

        // Row 2: Control & Misc
        {label: 'f', action: () => { setFKeyState(!fKeyState); setGKeyState(false); }, variant: 'fKey'},
        {label: 'g', action: () => { setGKeyState(!gKeyState); setFKeyState(false); }, variant: 'gKey'},
        {label: 'AMORT', action: handleAmort, variant: 'function'},
        {label: 'R↓', action: () => { setStack([stack[1], stack[2], stack[3], stack[0]]); }, variant: 'utility'},
        {label: 'x≮≯y', action: () => {
            const x = isEntering ? parseFloat(inputBuffer || '0') : stack[0];
            setStack([stack[1], x, stack[2], stack[3]]);
            setInputBuffer(''); setIsEntering(false); setLiftEnabled(false);
        }, variant: 'utility'},

        // Row 3: Digits & Operators
        {label: '7', action: () => handleDigit('7')},
        {label: '8', action: () => handleDigit('8')},
        {label: '9', action: () => handleDigit('9')},
        {label: '÷', action: () => handleOperator('÷'), variant: 'operator'},
        {label: 'AC', action: () => handleShiftedAction(
            () => handleClearStack(),
            () => { setCashFlows([]); showError('CF Cleared'); },
            () => {
                setStack([0,0,0,0]); setInputBuffer(''); setLiftEnabled(true);
                setFinRegs({n: null, i: null, pv: null, pmt: null, fv: null}); 
                setCashFlows([]); setAmortPeriodsTotal(0);
            }
        ), variant: 'highlight'},

        {label: '4', action: () => handleDigit('4')},
        {label: '5', action: () => handleDigit('5')},
        {label: '6', action: () => handleDigit('6')},
        {label: '×', action: () => handleOperator('×'), variant: 'operator'},
        {label: 'CLX', action: () => { setInputBuffer(''); setIsEntering(false); }, variant: 'utility'},

        {label: '1', action: () => handleDigit('1')},
        {label: '2', action: () => handleDigit('2')},
        {label: '3', action: () => handleDigit('3')},
        {label: '-', action: () => handleOperator('-'), variant: 'operator'},
        {label: 'ENT', action: handleEnter, variant: 'equals'},

        {label: '.', action: () => handleDigit('.'), variant: 'number'},
        {label: '0', action: () => handleDigit('0')},
        {label: '+/-', action: () => {
            if (isEntering) setInputBuffer(b => b.startsWith('-') ? b.slice(1) : '-' + b);
            else setStack([ -stack[0], stack[1], stack[2], stack[3] ]);
        }, variant: 'utility'},
        {label: '+', action: () => handleOperator('+'), variant: 'operator'},
        {label: 'Last X', action: () => handleLastX(), variant: 'utility'},
      ]
    },
    scientific: {
      cols: 7,
      buttons: [
        // Row 1: Primary trig
        {label: 'sin',  action: () => handleSciFunc('sin'),  variant: 'function'},
        {label: 'cos',  action: () => handleSciFunc('cos'),  variant: 'function'},
        {label: 'tan',  action: () => handleSciFunc('tan'),  variant: 'function'},
        {label: '7', action: () => handleDigit('7')},
        {label: '8', action: () => handleDigit('8')},
        {label: '9', action: () => handleDigit('9')},
        {label: '÷', action: () => handleOperator('÷'), variant: 'operator'},

        // Row 2: Inverse trig
        {label: 'asin', action: () => handleSciFunc('asin'), variant: 'function'},
        {label: 'acos', action: () => handleSciFunc('acos'), variant: 'function'},
        {label: 'atan', action: () => handleSciFunc('atan'), variant: 'function'},
        {label: '4', action: () => handleDigit('4')},
        {label: '5', action: () => handleDigit('5')},
        {label: '6', action: () => handleDigit('6')},
        {label: '×', action: () => handleOperator('×'), variant: 'operator'},

        // Row 3: Hyperbolic trig
        {label: 'sinh', action: () => handleSciFunc('sinh'), variant: 'function'},
        {label: 'cosh', action: () => handleSciFunc('cosh'), variant: 'function'},
        {label: 'tanh', action: () => handleSciFunc('tanh'), variant: 'function'},
        {label: '1', action: () => handleDigit('1')},
        {label: '2', action: () => handleDigit('2')},
        {label: '3', action: () => handleDigit('3')},
        {label: '-', action: () => handleOperator('-'), variant: 'operator'},

        // Row 4: Logarithms
        {label: 'ln',   action: () => handleSciFunc('ln'),   variant: 'function'},
        {label: 'log',  action: () => handleSciFunc('log'),  variant: 'function'},
        {label: 'log2', action: () => handleSciFunc('log2'), variant: 'function'},
        {label: '+/-', action: () => {
            if (evaluated && stdResult !== null) setStdResult(-stdResult);
            else setExpression(prev => prev.startsWith('-') ? prev.slice(1) : '-' + prev);
        }, variant: 'utility'},
        {label: '0', action: () => handleDigit('0')},
        {label: '.', action: () => handleDigit('.'), variant: 'number'},
        {label: '+', action: () => handleOperator('+'), variant: 'operator'},

        // Row 5: Exponentials + power
        {label: 'eˣ',  action: () => handleSciFunc('e^'),          variant: 'function'},
        {label: '10ˣ', action: () => setExpression(p => p + '10^'), variant: 'function'},
        {label: 'xʸ',  action: () => setExpression(p => p + '^'),   variant: 'function'},
        {label: '⌫', action: () => setExpression(p => p.slice(0, -1)), variant: 'utility'},
        {label: 'AC', action: () => { setExpression(''); setStdResult(null); setEvaluated(false); }, variant: 'highlight'},
        {label: '%', action: () => setExpression(p => p + '%'), variant: 'utility'},
        {label: '=', action: handleEqual, variant: 'equals'},

        // Row 6: Power shortcuts, factorial, parens, mod
        {label: 'x²', action: () => setExpression(p => p + '²'), variant: 'function'},
        {label: 'x³', action: () => setExpression(p => p + '³'), variant: 'function'},
        {label: 'x!', action: () => setExpression(p => p + '!'), variant: 'function'},
        {label: '(', action: () => setExpression(p => p + '('), variant: 'function'},
        {label: ')', action: () => setExpression(p => p + ')'), variant: 'function'},
        {label: ',', action: () => setExpression(p => p + ','), variant: 'number'},
        {label: 'mod', action: () => {
            if (evaluated && stdResult !== null) { setExpression(stdResult.toString() + 'mod'); setStdResult(null); setEvaluated(false); }
            else setExpression(p => p + 'mod');
        }, variant: 'function'},

        // Row 7: Roots + Memory
        {label: '√',   action: () => handleSciFunc('√'),  variant: 'function'},
        {label: '³√',  action: () => handleSciFunc('∛'),  variant: 'function'},
        {label: 'ʸ√x', action: () => handleSciFunc('ʸ√'), variant: 'function'},
        {label: 'MC',  action: handleMC,     variant: 'utility'},
        {label: 'MR',  action: handleMR,     variant: 'utility'},
        {label: 'M-',  action: handleMMinus, variant: 'utility'},
        {label: 'M+',  action: handleMPlus,  variant: 'utility'},

        // Row 8: Misc
        {label: '1/x', action: () => setExpression(p => p + '1/('), variant: 'function'},
        {label: '|x|', action: () => handleSciFunc('abs'),           variant: 'function'},
        {label: 'Rand', action: () => handleSciFunc('rand'),          variant: 'function'},
        {label: 'π', action: () => setExpression(p => p + 'π'), variant: 'function'},
        {label: 'e', action: () => setExpression(p => p + 'e'), variant: 'function'},
        {label: angleUnit === 'deg' ? 'Rad' : 'Deg', action: () => setAngleUnit(angleUnit === 'deg' ? 'rad' : 'deg'), variant: 'utility'},
        {label: 'EE', action: () => setExpression(p => p + 'E'), variant: 'function'},
      ]
    }
  };

  const modeLayout = mode !== 'conversion' ? layouts[mode as 'standard' | 'financial' | 'scientific'] : null;
  const colCount = modeLayout ? modeLayout.cols : 4;
  const btnWidth = (PANEL_WIDTH - 2 * PANEL_PADDING - (colCount - 1) * BTN_GAP) / colCount;

  return (
    <Pressable style={styles.overlay} onPress={handleClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Pressable style={styles.panel} onPress={e => e.stopPropagation()}>
          <View style={styles.header}>
            <Text style={styles.title}>SnCalc Pro</Text>
            <View style={styles.modeCapsule}>
              {(['standard', 'conversion', 'financial', 'scientific'] as CalcMode[]).map(m => (
                <Pressable key={m} onPress={() => { setMode(m); setError(null); setConvPicker(null); }} style={[styles.modeTab, mode === m && styles.modeTabActive]}>
                  <Text style={[styles.modeTabText, mode === m && styles.modeTabTextActive]}>{MODE_LABELS[m]}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable onPress={handleClose} style={styles.closeBtn}><Text style={styles.closeText}>✕</Text></Pressable>
          </View>
          <View style={styles.divider} />
          
          <View style={styles.displayArea}>
            {mode === 'financial' ? (
                <View style={styles.finDisplay}>
                    <View style={styles.regRow}>
                        <RegItem label="n" val={finRegs.n} />
                        <RegItem label="i%" val={finRegs.i} />
                        <RegItem label="PV" val={finRegs.pv} />
                        <RegItem label="PMT" val={finRegs.pmt} />
                        <RegItem label="FV" val={finRegs.fv} />
                    </View>
                    <View style={styles.stackArea}>
                        <View style={styles.stackLine}><Text style={styles.stackLabel}>T</Text><Text style={styles.stackVal}>{formatNumber(stack[3], decimalPlaces, thousandsSep)}</Text></View>
                        <View style={styles.stackLine}><Text style={styles.stackLabel}>Z</Text><Text style={styles.stackVal}>{formatNumber(stack[2], decimalPlaces, thousandsSep)}</Text></View>
                        <View style={styles.stackLine}><Text style={styles.stackLabel}>Y</Text><Text style={styles.stackVal}>{formatNumber(stack[1], decimalPlaces, thousandsSep)}</Text></View>
                        <View style={styles.stackLineActive}>
                            <Text style={styles.stackLabelActive}>{fKeyState ? 'f' : gKeyState ? 'g' : 'X'}</Text>
                            <Text style={styles.stackX}>{isEntering ? (inputBuffer || '0') : formatNumber(stack[0], decimalPlaces, thousandsSep)}</Text>
                        </View>
                    </View>
                </View>
            ) : mode === 'conversion' ? (
                <View style={styles.convDisplay}>
                  <View style={styles.convCatRow}>
                    <Pressable onPress={() => setConvPicker(convPicker === 'cat' ? null : 'cat')} style={[styles.convCatBtn, convPicker === 'cat' && styles.convCatBtnActive]}>
                      <Text style={[styles.convCatText, convPicker === 'cat' && styles.convCatTextActive]}>{CONV_CATEGORIES[convCatIdx].name} ▼</Text>
                    </Pressable>
                  </View>
                  <View style={styles.convRow}>
                    <Pressable onPress={() => { setConvActive('from'); setConvPicker(convPicker === 'from' ? null : 'from'); }} style={[styles.convUnitBtn, convPicker === 'from' && styles.convUnitBtnActive]}>
                      <Text style={[styles.convUnitText, convPicker === 'from' && styles.convUnitTextActive]}>{CONV_CATEGORIES[convCatIdx].units[convFromIdx].label} ▼</Text>
                    </Pressable>
                    <Pressable onPress={() => { setConvActive('from'); setConvPicker(null); }} style={[styles.convValueArea, convActive === 'from' && convPicker === null && styles.convValueAreaActive]}>
                      <Text style={styles.convValueText}>
                        {convActive === 'from'
                          ? (convFromVal || '0')
                          : (convFromVal ? formatNumber(parseFloat(convFromVal), decimalPlaces, thousandsSep) : '0')}
                      </Text>
                    </Pressable>
                  </View>
                  <View style={styles.convRow}>
                    <Pressable onPress={() => { setConvActive('to'); setConvPicker(convPicker === 'to' ? null : 'to'); }} style={[styles.convUnitBtn, convPicker === 'to' && styles.convUnitBtnActive]}>
                      <Text style={[styles.convUnitText, convPicker === 'to' && styles.convUnitTextActive]}>{CONV_CATEGORIES[convCatIdx].units[convToIdx].label} ▼</Text>
                    </Pressable>
                    <Pressable onPress={() => { setConvActive('to'); setConvPicker(null); }} style={[styles.convValueArea, convActive === 'to' && convPicker === null && styles.convValueAreaActive]}>
                      <Text style={styles.convValueText}>
                        {convActive === 'to'
                          ? (convToVal || '0')
                          : (convToVal ? formatNumber(parseFloat(convToVal), decimalPlaces, thousandsSep) : '0')}
                      </Text>
                    </Pressable>
                  </View>
                </View>
            ) : (
                <View style={styles.stdDisplay}>
                    <View style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%', marginBottom: 5}}>
                        {mode === 'scientific' && (
                          <View style={{flexDirection: 'row'}}>
                            <Text style={{fontSize: 12, fontWeight: 'bold', color: '#888', backgroundColor: '#EEE', paddingHorizontal: 4, borderRadius: 3}}>{angleUnit.toUpperCase()}</Text>
                            {memoryRegister !== 0 && <Text style={{fontSize: 12, fontWeight: 'bold', color: '#FFF', backgroundColor: '#555', paddingHorizontal: 4, borderRadius: 3, marginLeft: 4}}>M</Text>}
                          </View>
                        )}
                        <Text style={styles.displayExpr}>{evaluated ? expression + ' =' : ''}</Text>
                    </View>
                    <Text style={styles.displayMain}>{evaluated ? (stdResult !== null ? formatNumber(stdResult, decimalPlaces, thousandsSep) : '0') : expression || '0'}</Text>
                </View>
            )}
          </View>

          <View style={styles.divider} />
          {error && <View style={styles.errorBanner}><Text style={styles.errorText}>{error}</Text></View>}
          {mode === 'conversion' ? (
            convPicker !== null ? (() => {
              const items = convPicker === 'cat'
                ? CONV_CATEGORIES.map((c, i) => ({ label: c.name, idx: i, active: i === convCatIdx }))
                : CONV_CATEGORIES[convCatIdx].units.map((u, i) => ({ label: u.label, idx: i, active: i === (convPicker === 'from' ? convFromIdx : convToIdx) }));
              const pCols = 3;
              const pBtnW = (PANEL_WIDTH - 2 * PANEL_PADDING - (pCols - 1) * BTN_GAP) / pCols;
              const pBtnH = 40;
              return (
                <View>
                  <View style={styles.pickerHeader}>
                    <Text style={styles.pickerHeaderText}>{convPicker === 'cat' ? 'Select Category' : convPicker === 'from' ? 'Select From Unit' : 'Select To Unit'}</Text>
                  </View>
                  <View style={[styles.grid, {height: Math.ceil(items.length / pCols) * (pBtnH + BTN_GAP) + 10}]}>
                    {items.map((item, i) => (
                      <Pressable key={i} onPress={() => convPicker === 'cat' ? handleCatSelect(item.idx) : handleUnitSelect(item.idx)}
                        style={[styles.pickerItem, {
                          position: 'absolute',
                          top: Math.floor(i / pCols) * (pBtnH + BTN_GAP),
                          left: (i % pCols) * (pBtnW + BTN_GAP),
                          width: pBtnW, height: pBtnH,
                        }, item.active && styles.pickerItemActive]}>
                        <Text style={[styles.pickerItemText, item.active && styles.pickerItemTextActive]}>{item.label}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              );
            })() : (() => {
              const cCols = 4;
              const cBtnW = (PANEL_WIDTH - 2 * PANEL_PADDING - (cCols - 1) * BTN_GAP) / cCols;
              const convBtns = [
                {label: '7', action: () => handleConvDigit('7'), variant: 'number'},
                {label: '8', action: () => handleConvDigit('8'), variant: 'number'},
                {label: '9', action: () => handleConvDigit('9'), variant: 'number'},
                {label: '⌫', action: handleConvBackspace, variant: 'utility'},
                {label: '4', action: () => handleConvDigit('4'), variant: 'number'},
                {label: '5', action: () => handleConvDigit('5'), variant: 'number'},
                {label: '6', action: () => handleConvDigit('6'), variant: 'number'},
                {label: 'AC', action: handleConvClear, variant: 'highlight'},
                {label: '1', action: () => handleConvDigit('1'), variant: 'number'},
                {label: '2', action: () => handleConvDigit('2'), variant: 'number'},
                {label: '3', action: () => handleConvDigit('3'), variant: 'number'},
                {label: '+/-', action: handleConvNegate, variant: 'utility'},
                {label: '.', action: () => handleConvDigit('.'), variant: 'number'},
                {label: '0', action: () => handleConvDigit('0'), variant: 'number'},
                {label: '⇌', action: handleConvSwap, variant: 'utility'},
              ];
              return (
                <View style={[styles.grid, {height: Math.ceil(convBtns.length / cCols) * (BTN_HEIGHT + BTN_GAP) + 10}]}>
                  {convBtns.map((btn, i) => (
                    <CalcBtn key={i} label={btn.label} onPress={btn.action} variant={btn.variant as any}
                      pos={{ position: 'absolute', top: Math.floor(i / cCols) * (BTN_HEIGHT + BTN_GAP), left: (i % cCols) * (cBtnW + BTN_GAP), width: cBtnW, height: BTN_HEIGHT }} />
                  ))}
                </View>
              );
            })()
          ) : (
            <View style={[styles.grid, {height: Math.ceil(modeLayout!.buttons.length / colCount) * (BTN_HEIGHT + BTN_GAP) + 10}]}>
              {modeLayout!.buttons.map((btn, i) => (
                <CalcBtn key={`${mode}-${i}`} label={btn.label} onPress={btn.action} variant={btn.variant as any}
                  pos={{ position: 'absolute', top: Math.floor(i / colCount) * (BTN_HEIGHT + BTN_GAP), left: (i % colCount) * (btnWidth + BTN_GAP), width: btnWidth, height: BTN_HEIGHT }} />
              ))}
            </View>
          )}
          <View style={styles.divider} />
          <View style={styles.bottomArea}>
            <View style={styles.controlRow}>
              <View style={styles.controlGroup}>
                <Pressable onPress={handleHistoryPrev} style={styles.controlBtn}><Text style={styles.controlBtnText}>◀</Text></Pressable>
                <Text style={styles.controlLabel}>Hist</Text>
                <Pressable onPress={handleHistoryNext} style={styles.controlBtn}><Text style={styles.controlBtnText}>▶</Text></Pressable>
              </View>
              <View style={styles.controlGroup}>
                <Pressable onPress={() => setDecimalPlaces(p => Math.max(0, p - 1))} style={styles.controlBtn}><Text style={styles.controlBtnText}>−</Text></Pressable>
                <Text style={styles.controlLabel}>{decimalPlaces}dp</Text>
                <Pressable onPress={() => setDecimalPlaces(p => Math.min(8, p + 1))} style={styles.controlBtn}><Text style={styles.controlBtnText}>+</Text></Pressable>
              </View>
              <Pressable onPress={() => setThousandsSep(p => !p)} style={[styles.controlBtn, styles.controlBtnWide, thousandsSep && styles.controlBtnActive]}>
                <Text style={[styles.controlBtnText, thousandsSep && styles.controlBtnTextActive]}>,000</Text>
              </Pressable>
            </View>
            <View style={styles.toggleRow}>
              <Pressable style={[styles.toggleBtn, stampMode === 'result' && styles.toggleBtnActive]} onPress={() => setStampMode('result')}><Text style={[styles.toggleText, stampMode === 'result' && styles.toggleTextActive]}>Result only</Text></Pressable>
              <View style={styles.toggleBtnSpacer} />
              <Pressable style={[styles.toggleBtn, stampMode === 'expression' && styles.toggleBtnActive]} onPress={() => setStampMode('expression')}><Text style={[styles.toggleText, stampMode === 'expression' && styles.toggleTextActive]}>Full record</Text></Pressable>
            </View>
            <Pressable onPress={handleInsert} disabled={inserting} style={styles.insertBtn}><Text style={styles.insertBtnText}>{inserting ? 'Inserting...' : 'Insert'}</Text></Pressable>
          </View>
        </Pressable>
      </KeyboardAvoidingView>
    </Pressable>
  );
}

function RegItem({label, val}: {label: string, val: number | null}) {
  return (<View style={styles.regItem}><Text style={styles.regLabel}>{label}</Text><Text style={styles.regVal} numberOfLines={1}>{val === null ? '--' : val.toString()}</Text></View>);
}

function CalcBtn({label, onPress, variant = 'number', pos}: {label: string, onPress: () => void, variant?: 'number' | 'utility' | 'operator' | 'equals' | 'function' | 'highlight' | 'fKey' | 'gKey', pos: any}) {
  return (
    <Pressable onPress={onPress} style={[styles.btn, pos, 
        variant === 'utility' && styles.btnUtility, 
        variant === 'operator' && styles.btnOperator, 
        variant === 'equals' && styles.btnEquals, 
        variant === 'function' && styles.btnFunction, 
        variant === 'highlight' && styles.btnHighlight,
        variant === 'fKey' && styles.btnFKey,
        variant === 'gKey' && styles.btnGKey
    ]}>
      <Text style={[styles.btnText, 
        variant === 'equals' && styles.btnTextEquals, 
        variant === 'highlight' && styles.btnTextHighlight,
        variant === 'fKey' && styles.btnTextFKey,
        variant === 'gKey' && styles.btnTextGKey,
        label.length === 5 && {fontSize: 11},
        label.length > 5 && {fontSize: 9}
      ]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  panel: { width: PANEL_WIDTH, backgroundColor: '#FFFFFF', borderRadius: 12, borderWidth: 1.5, borderColor: '#000000' },
  header: { paddingHorizontal: 10, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 18, fontWeight: 'bold' },
  modeCapsule: { flexDirection: 'row', backgroundColor: '#F0F0F0', borderRadius: 20, padding: 2 },
  modeTab: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 18 },
  modeTabActive: { backgroundColor: '#000000' },
  modeTabText: { fontSize: 10, fontWeight: 'bold', color: '#666666' },
  modeTabTextActive: { color: '#FFFFFF' },
  closeBtn: { width: 30, height: 30, borderRadius: 15, borderWidth: 1.5, borderColor: '#000', alignItems: 'center', justifyContent: 'center' },
  closeText: { fontSize: 14, fontWeight: 'bold' },
  divider: { height: 1, backgroundColor: '#000000' },
  
  displayArea: { minHeight: 140, backgroundColor: '#FDFDFD' },
  finDisplay: { padding: 10 },
  regRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  regItem: { alignItems: 'center', flex: 1 },
  regLabel: { fontSize: 9, color: '#444', fontWeight: 'bold' },
  regVal: { fontSize: 11, color: '#000', fontWeight: '600' },
  
  stackArea: { borderTopWidth: 1, borderColor: '#DDD', paddingTop: 4 },
  stackLine: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 1, height: 16 },
  stackLineActive: { flexDirection: 'row', justifyContent: 'space-between', height: 36, alignItems: 'center' },
  stackLabel: { fontSize: 10, color: '#999', fontWeight: 'bold' },
  stackLabelActive: { fontSize: 14, color: '#000', fontWeight: 'bold' },
  stackVal: { fontSize: 13, color: '#666' },
  stackX: { fontSize: 28, fontWeight: 'bold', color: '#000' },

  stdDisplay: { padding: 15, alignItems: 'flex-end', justifyContent: 'center', height: 140 },
  displayExpr: { fontSize: 16, color: '#888', marginBottom: 10 },
  displayMain: { fontSize: 44, fontWeight: 'bold', color: '#000' },

  errorBanner: { padding: 4, backgroundColor: '#000', margin: 4, borderRadius: 4 },
  errorText: { color: '#FFF', fontSize: 11, textAlign: 'center' },
  
  grid: { paddingHorizontal: PANEL_PADDING, paddingVertical: 5 },
  btn: { borderRadius: 4, borderWidth: 1, borderColor: '#CCC', backgroundColor: '#F8F8F8', alignItems: 'center', justifyContent: 'center' },
  btnUtility: { backgroundColor: '#E8E8E8' },
  btnOperator: { backgroundColor: '#EFEFEF' },
  btnFunction: { backgroundColor: '#F0F0F0' },
  btnEquals: { backgroundColor: '#000000' },
  btnHighlight: { backgroundColor: '#BBBBBB', borderColor: '#888888' },
  btnFKey: { backgroundColor: '#DDDDDD', borderColor: '#AAAAAA' },
  btnGKey: { backgroundColor: '#999999', borderColor: '#666666' },
  btnText: { fontSize: 15, fontWeight: '500' },
  btnTextEquals: { color: '#FFFFFF', fontWeight: 'bold' },
  btnTextHighlight: { color: '#000000', fontWeight: 'bold' },
  btnTextFKey: { color: '#000000', fontWeight: 'bold' },
  btnTextGKey: { color: '#FFFFFF', fontWeight: 'bold' },
  
  bottomArea: { padding: 8 },
  controlRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  controlGroup: { flexDirection: 'row', alignItems: 'center' },
  controlLabel: { fontSize: 11, fontWeight: 'bold', color: '#444', marginHorizontal: 4, minWidth: 28, textAlign: 'center' },
  controlBtn: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4, borderWidth: 1, borderColor: '#CCC', backgroundColor: '#F0F0F0' },
  controlBtnWide: { paddingHorizontal: 12 },
  controlBtnActive: { backgroundColor: '#000', borderColor: '#000' },
  controlBtnText: { fontSize: 12, fontWeight: 'bold', color: '#333' },
  controlBtnTextActive: { color: '#FFF' },
  toggleRow: { flexDirection: 'row', marginBottom: 4 },
  toggleBtn: { flex: 1, padding: 6, alignItems: 'center', borderRadius: 4, borderWidth: 1, borderColor: '#CCC' },
  toggleBtnActive: { backgroundColor: '#000', borderColor: '#000' },
  toggleBtnSpacer: { width: 8 },
  toggleText: { fontSize: 10, color: '#888', fontWeight: 'bold' },
  toggleTextActive: { color: '#FFF' },
  insertBtn: { padding: 10, alignItems: 'center', borderRadius: 6, borderWidth: 1.5, borderColor: '#000' },
  insertBtnText: { fontWeight: 'bold', fontSize: 16 },

  convDisplay: { padding: 10, justifyContent: 'center', minHeight: 140 },
  convCatRow: { alignItems: 'center', marginBottom: 8 },
  convCatBtn: { paddingHorizontal: 20, paddingVertical: 6, borderRadius: 20, borderWidth: 1.5, borderColor: '#000', backgroundColor: '#EEE' },
  convCatBtnActive: { backgroundColor: '#000' },
  convCatText: { fontSize: 15, fontWeight: 'bold', color: '#000' },
  convCatTextActive: { color: '#FFF' },
  convRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  convUnitBtn: { width: 72, paddingVertical: 10, borderRadius: 6, borderWidth: 1, borderColor: '#888', backgroundColor: '#F0F0F0', alignItems: 'center' },
  convUnitBtnActive: { backgroundColor: '#000', borderColor: '#000' },
  convUnitText: { fontSize: 13, fontWeight: 'bold', color: '#000' },
  convUnitTextActive: { color: '#FFF' },
  convValueArea: { flex: 1, marginLeft: 8, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 6, borderWidth: 1, borderColor: '#DDD', backgroundColor: '#FAFAFA', alignItems: 'flex-end' },
  convValueAreaActive: { borderColor: '#000', borderWidth: 2, backgroundColor: '#FFF' },
  convValueText: { fontSize: 26, fontWeight: 'bold', color: '#000' },

  pickerHeader: { paddingHorizontal: PANEL_PADDING, paddingVertical: 4, backgroundColor: '#F4F4F4', borderBottomWidth: 1, borderColor: '#DDD' },
  pickerHeaderText: { fontSize: 11, fontWeight: 'bold', color: '#555', textAlign: 'center' },
  pickerItem: { borderRadius: 4, borderWidth: 1, borderColor: '#CCC', backgroundColor: '#F8F8F8', alignItems: 'center', justifyContent: 'center' },
  pickerItemActive: { backgroundColor: '#000', borderColor: '#000' },
  pickerItemText: { fontSize: 13, fontWeight: '500', color: '#000' },
  pickerItemTextActive: { color: '#FFF' },
});