import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {PluginCommAPI, PluginFileAPI, PluginManager, PluginNoteAPI} from 'sn-plugin-lib';

import {
  AngleUnit,
  FinancialRegisters,
  appendDecimalToExpression,
  appendDigitToExpression,
  appendOperatorToExpression,
  appendPercentToExpression,
  balanceExpression,
  calculationErrorMessage,
  formatNumber,
  evaluateExpr,
  solveTVM,
  toggleExpressionSign
} from './logic/calculatorLogic';
import { CONV_CATEGORIES } from './logic/conversionData';

// ─── Types ───────────────────────────────────────────────────────────────────

type CalcMode = 'standard' | 'conversion' | 'financial' | 'scientific';
const MODE_LABELS: Record<CalcMode, string> = { standard: 'STD', conversion: 'CONV', financial: 'FIN', scientific: 'SCI' };
type StampMode = 'result' | 'expression';
type ApiRes<T> = {success: boolean; result?: T; error?: {message?: string}} | null | undefined;
type FinRecord = {
  title: string;
  lines: string[];
  result: number;
};
type FinTapeEntry = {
  entry: string;
  total: number;
};

// ─── Constants ───────────────────────────────────────────────────────────────

const STAMP_FONT_SIZE = 40;
const MIN_STAMP_FONT_SIZE = 24;
const LINE_HEIGHT_PAD = 10;
const SMART_PLACEMENT_GAP = 40;
const BOTTOM_MARGIN = 160;
const LEFT_MARGIN = 180;
const PAGE_EDGE_MARGIN = 40;
const DEFAULT_PAGE_WIDTH = 1404;
const DEFAULT_PAGE_HEIGHT = 1872;
const ERROR_DISPLAY_MS = 2500;
const DEVICE_NATIVE_PORTRAIT: Record<number, {width: number; height: number}> = {
  3: {width: 1404, height: 1872}, // A5X
  4: {width: 1404, height: 1872}, // Nomad
  5: {width: 1920, height: 2560}, // Manta
};

// ─── Persistent preferences ──────────────────────────────────────────────────
// Module-level object: survives React remounts (toolbar re-open) but resets on
// full JS bundle reload (cold app start). Keeps user preferences like stamp
// mode and decimal settings across sessions without needing AsyncStorage.
const prefs = {
  stampMode: 'result' as StampMode,
  decimalPlaces: 2,
  thousandsSep: false,
};

// ─── Smart placement ─────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function nativePlacementSizeFor(
  pageWidth: number,
  pageHeight: number,
  deviceType: number | null,
): {width: number; height: number} {
  if (deviceType == null) return {width: pageWidth, height: pageHeight};
  const native = DEVICE_NATIVE_PORTRAIT[deviceType];
  if (!native) return {width: pageWidth, height: pageHeight};
  const isLandscape = pageWidth > pageHeight;
  const nativeWidth = isLandscape ? native.height : native.width;
  const nativeHeight = isLandscape ? native.width : native.height;
  return {
    width: Math.min(pageWidth, nativeWidth),
    height: Math.min(pageHeight, nativeHeight),
  };
}

async function getDeviceTypeSafe(): Promise<number | null> {
  try {
    const deviceType = (await PluginManager.getDeviceType()) as unknown;
    if (typeof deviceType === 'number') return deviceType;
    if (typeof (deviceType as any)?.result === 'number') return (deviceType as any).result;
  } catch {}
  return null;
}

async function findInsertTop(filePath: string, pageNum: number, pageHeight: number, boxHeight: number): Promise<number> {
  const lowestSafeTop = Math.max(PAGE_EDGE_MARGIN, pageHeight - PAGE_EDGE_MARGIN - boxHeight);
  try {
    const res = (await PluginFileAPI.getElements(pageNum, filePath)) as ApiRes<any[]>;
    if (res?.success && Array.isArray(res.result) && res.result.length > 0) {
      const lowestEdge = Math.max(...res.result.map((el: any) => el.maxY ?? 0));
      const candidate = lowestEdge + SMART_PLACEMENT_GAP;
      if (candidate + boxHeight + PAGE_EDGE_MARGIN <= pageHeight) {
        return clamp(candidate, PAGE_EDGE_MARGIN, lowestSafeTop);
      }
    }
  } catch {}
  return clamp(pageHeight - BOTTOM_MARGIN - boxHeight, PAGE_EDGE_MARGIN, lowestSafeTop);
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
  const deviceType = await getDeviceTypeSafe();
  const placementSize = nativePlacementSizeFor(pageWidth, pageHeight, deviceType);
  pageWidth = placementSize.width;
  pageHeight = placementSize.height;
  
  const lines = text.split('\n');
  const lineCount = lines.length;
  const maxLineLength = Math.max(...lines.map(l => l.length));
  const maxBoxHeight = Math.max(MIN_STAMP_FONT_SIZE + LINE_HEIGHT_PAD, pageHeight - PAGE_EDGE_MARGIN * 2);
  const stampFontSize = lineCount * (STAMP_FONT_SIZE + LINE_HEIGHT_PAD) > maxBoxHeight
    ? Math.max(MIN_STAMP_FONT_SIZE, Math.floor(maxBoxHeight / lineCount) - LINE_HEIGHT_PAD)
    : STAMP_FONT_SIZE;
  const boxHeight = Math.min(lineCount * (stampFontSize + LINE_HEIGHT_PAD), maxBoxHeight);
  const fallbackTop = clamp(
    pageHeight - BOTTOM_MARGIN - boxHeight,
    PAGE_EDGE_MARGIN,
    Math.max(PAGE_EDGE_MARGIN, pageHeight - PAGE_EDGE_MARGIN - boxHeight),
  );
  const top = (filePath !== undefined && pageNum !== undefined) ? await findInsertTop(filePath, pageNum, pageHeight, boxHeight) : fallbackTop;
  const left = Math.min(LEFT_MARGIN, Math.max(PAGE_EDGE_MARGIN, Math.floor(pageWidth * 0.12)));
  const availableWidth = Math.max(stampFontSize * 6, pageWidth - left - PAGE_EDGE_MARGIN);
  const boxWidth = Math.min(Math.max(stampFontSize * 6, Math.ceil(maxLineLength * stampFontSize * 0.7)), availableWidth);

  const safeRect = { left, top, right: left + boxWidth, bottom: top + boxHeight };
  const res = (await PluginNoteAPI.insertText({ textContentFull: text, textRect: safeRect, fontSize: stampFontSize, textBold: 1, textItalics: 0, textAlign: 0, textEditable: 1, showLassoAfterInsert: true })) as ApiRes<boolean>;
  if (!res?.success) throw new Error(res?.error?.message ?? 'Fail');
}

// ─── Scaled styles ────────────────────────────────────────────────────────────

function makeStyles(s: number) {
  const pp = Math.round(15 * s);
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
    panel: { width: Math.round(480 * s), backgroundColor: '#FFFFFF', borderRadius: Math.round(12 * s), borderWidth: 1.5, borderColor: '#000000' },
    header: { paddingHorizontal: Math.round(10 * s), paddingVertical: Math.round(6 * s), flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    title: { fontSize: Math.round(18 * s), fontWeight: 'bold' },
    modeCapsule: { flexDirection: 'row', backgroundColor: '#F0F0F0', borderRadius: 20, padding: 2 },
    modeTab: { paddingHorizontal: Math.round(8 * s), paddingVertical: Math.round(4 * s), borderRadius: 18 },
    modeTabActive: { backgroundColor: '#000000' },
    modeTabText: { fontSize: Math.round(10 * s), fontWeight: 'bold', color: '#666666' },
    modeTabTextActive: { color: '#FFFFFF' },
    closeBtn: { width: Math.round(30 * s), height: Math.round(30 * s), borderRadius: Math.round(15 * s), borderWidth: 1.5, borderColor: '#000', alignItems: 'center', justifyContent: 'center' },
    closeText: { fontSize: Math.round(14 * s), fontWeight: 'bold' },
    divider: { height: 1, backgroundColor: '#000000' },
    displayArea: { minHeight: Math.round(140 * s), backgroundColor: '#FDFDFD' },
    finDisplay: { padding: Math.round(10 * s) },
    regRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
    regItem: { alignItems: 'center', flex: 1 },
    regLabel: { fontSize: Math.round(9 * s), color: '#444', fontWeight: 'bold' },
    regVal: { fontSize: Math.round(11 * s), color: '#000', fontWeight: '600' },
    stackArea: { borderTopWidth: 1, borderColor: '#DDD', paddingTop: 4 },
    stackLine: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 1, height: Math.round(16 * s) },
    stackLineActive: { flexDirection: 'row', justifyContent: 'space-between', height: Math.round(36 * s), alignItems: 'center' },
    stackLabel: { fontSize: Math.round(10 * s), color: '#999', fontWeight: 'bold' },
    stackLabelActive: { fontSize: Math.round(14 * s), color: '#000', fontWeight: 'bold' },
    stackVal: { fontSize: Math.round(13 * s), color: '#666' },
    stackX: { fontSize: Math.round(28 * s), fontWeight: 'bold', color: '#000' },
    stdDisplay: { padding: Math.round(15 * s), alignItems: 'flex-end', justifyContent: 'center', height: Math.round(140 * s) },
    displayScroll: { flex: 1, width: '100%' },
    displayScrollContent: { flexGrow: 1, alignItems: 'flex-end', justifyContent: 'flex-end' },
    displayExpr: { fontSize: Math.round(16 * s), color: '#888', marginBottom: 10 },
    displayMain: { fontSize: Math.round(44 * s), fontWeight: 'bold', color: '#000' },
    errorBanner: { padding: 4, backgroundColor: '#000', margin: 4, borderRadius: 4 },
    errorText: { color: '#FFF', fontSize: Math.round(11 * s), textAlign: 'center' },
    grid: { paddingHorizontal: pp, paddingVertical: 5 },
    btn: { borderRadius: 4, borderWidth: 1, borderColor: '#CCC', backgroundColor: '#F8F8F8', alignItems: 'center', justifyContent: 'center' },
    btnUtility: { backgroundColor: '#E8E8E8' },
    btnOperator: { backgroundColor: '#EFEFEF' },
    btnFunction: { backgroundColor: '#F0F0F0' },
    btnEquals: { backgroundColor: '#000000' },
    btnHighlight: { backgroundColor: '#BBBBBB', borderColor: '#888888' },
    btnFKey: { backgroundColor: '#DDDDDD', borderColor: '#AAAAAA' },
    btnGKey: { backgroundColor: '#999999', borderColor: '#666666' },
    btnText: { fontSize: Math.round(15 * s), fontWeight: '500' },
    btnTextEquals: { color: '#FFFFFF', fontWeight: 'bold' },
    btnTextHighlight: { color: '#000000', fontWeight: 'bold' },
    btnTextFKey: { color: '#000000', fontWeight: 'bold' },
    btnTextGKey: { color: '#FFFFFF', fontWeight: 'bold' },
    bottomArea: { padding: Math.round(8 * s) },
    controlRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
    controlGroup: { flexDirection: 'row', alignItems: 'center' },
    controlLabel: { fontSize: Math.round(11 * s), fontWeight: 'bold', color: '#444', marginHorizontal: 4, minWidth: Math.round(28 * s), textAlign: 'center' },
    controlBtn: { paddingHorizontal: Math.round(8 * s), paddingVertical: Math.round(4 * s), borderRadius: 4, borderWidth: 1, borderColor: '#CCC', backgroundColor: '#F0F0F0' },
    controlBtnWide: { paddingHorizontal: Math.round(12 * s) },
    controlBtnActive: { backgroundColor: '#000', borderColor: '#000' },
    controlBtnText: { fontSize: Math.round(12 * s), fontWeight: 'bold', color: '#333' },
    controlBtnTextActive: { color: '#FFF' },
    toggleRow: { flexDirection: 'row', marginBottom: 4 },
    toggleBtn: { flex: 1, padding: Math.round(6 * s), alignItems: 'center', borderRadius: 4, borderWidth: 1, borderColor: '#CCC' },
    toggleBtnActive: { backgroundColor: '#000', borderColor: '#000' },
    toggleBtnSpacer: { width: Math.round(8 * s) },
    toggleText: { fontSize: Math.round(10 * s), color: '#888', fontWeight: 'bold' },
    toggleTextActive: { color: '#FFF' },
    insertBtn: { padding: Math.round(10 * s), alignItems: 'center', borderRadius: 6, borderWidth: 1.5, borderColor: '#000' },
    insertBtnText: { fontWeight: 'bold', fontSize: Math.round(16 * s) },
    convDisplay: { padding: Math.round(10 * s), justifyContent: 'center', minHeight: Math.round(140 * s) },
    convCatRow: { alignItems: 'center', marginBottom: 8 },
    convCatBtn: { paddingHorizontal: Math.round(20 * s), paddingVertical: Math.round(6 * s), borderRadius: 20, borderWidth: 1.5, borderColor: '#000', backgroundColor: '#EEE' },
    convCatBtnActive: { backgroundColor: '#000' },
    convCatText: { fontSize: Math.round(15 * s), fontWeight: 'bold', color: '#000' },
    convCatTextActive: { color: '#FFF' },
    convRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
    convUnitBtn: { width: Math.round(72 * s), paddingVertical: Math.round(10 * s), borderRadius: 6, borderWidth: 1, borderColor: '#888', backgroundColor: '#F0F0F0', alignItems: 'center' },
    convUnitBtnActive: { backgroundColor: '#000', borderColor: '#000' },
    convUnitText: { fontSize: Math.round(13 * s), fontWeight: 'bold', color: '#000' },
    convUnitTextActive: { color: '#FFF' },
    convValueArea: { flex: 1, marginLeft: Math.round(8 * s), paddingHorizontal: Math.round(10 * s), paddingVertical: Math.round(8 * s), borderRadius: 6, borderWidth: 1, borderColor: '#DDD', backgroundColor: '#FAFAFA', alignItems: 'flex-end' },
    convValueAreaActive: { borderColor: '#000', borderWidth: 2, backgroundColor: '#FFF' },
    convValueScroll: { maxWidth: '100%' },
    convValueText: { fontSize: Math.round(26 * s), fontWeight: 'bold', color: '#000' },
    pickerHeader: { paddingHorizontal: pp, paddingVertical: 4, backgroundColor: '#F4F4F4', borderBottomWidth: 1, borderColor: '#DDD' },
    pickerHeaderText: { fontSize: Math.round(11 * s), fontWeight: 'bold', color: '#555', textAlign: 'center' },
    pickerItem: { borderRadius: 4, borderWidth: 1, borderColor: '#CCC', backgroundColor: '#F8F8F8', alignItems: 'center', justifyContent: 'center' },
    pickerItemActive: { backgroundColor: '#000', borderColor: '#000' },
    pickerItemText: { fontSize: Math.round(13 * s), fontWeight: '500', color: '#000' },
    pickerItemTextActive: { color: '#FFF' },
    finHint: { fontSize: Math.round(10 * s), color: '#555', fontWeight: '600', textAlign: 'center', marginBottom: 5 },
    cfSummary: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderColor: '#DDD', paddingTop: 4, marginTop: 4 },
    cfSummaryText: { fontSize: Math.round(10 * s), color: '#444', fontWeight: '600' },
  });
}
const baseStyles = makeStyles(1);

// ─── Component ───────────────────────────────────────────────────────────────

export default function CalcPanelPro({scale = 1}: {scale?: number}) {
  const PANEL_WIDTH = Math.round(480 * scale);
  const PANEL_PADDING = Math.round(15 * scale);
  const BTN_GAP = Math.round(5 * scale);
  const BTN_HEIGHT = Math.round(44 * scale);
  const styles = useMemo(() => makeStyles(scale), [scale]);
  const [mode, setMode] = useState<CalcMode>('standard');
  const [angleUnit, setAngleUnit] = useState<AngleUnit>('deg');
  const [stack, setStack] = useState<[number, number, number, number]>([0, 0, 0, 0]);
  const [inputBuffer, setInputBuffer] = useState('');
  const [isEntering, setIsEntering] = useState(false);
  const [liftEnabled, setLiftEnabled] = useState(true);
  const [decimalPlaces, setDecimalPlaces] = useState(prefs.decimalPlaces);
  const [fKeyState, setFKeyState] = useState(false);
  const [gKeyState, setGKeyState] = useState(false);
  const [finRegs, setFinRegs] = useState<FinancialRegisters>({ n: null, i: null, pv: null, pmt: null, fv: null });
  const [cashFlows, setCashFlows] = useState<{v: number, n: number}[]>([]);
  const [lastFinRecord, setLastFinRecord] = useState<FinRecord | null>(null);
  const [finTape, setFinTape] = useState<FinTapeEntry[]>([]);
  const [lastX, setLastX] = useState(0);
  const [amortPeriodsTotal, setAmortPeriodsTotal] = useState(0);
  const [expression, setExpression] = useState('');
  const [stdResult, setStdResult] = useState<number | null>(null);
  const [evaluated, setEvaluated] = useState(false);
  const [stampMode, setStampMode] = useState<StampMode>(prefs.stampMode);
  const [inserting, setInserting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [thousandsSep, setThousandsSep] = useState(prefs.thousandsSep);
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

  // Sync preferences back to module-level prefs so they survive remounts
  useEffect(() => { prefs.stampMode = stampMode; }, [stampMode]);
  useEffect(() => { prefs.decimalPlaces = decimalPlaces; }, [decimalPlaces]);
  useEffect(() => { prefs.thousandsSep = thousandsSep; }, [thousandsSep]);

  const showError = useCallback((msg: string) => {
    setError(msg);
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    errorTimerRef.current = setTimeout(() => setError(null), ERROR_DISPLAY_MS);
  }, []);

  const handleClose = useCallback(() => { if (!inserting) PluginManager.closePluginView(); }, [inserting]);

  const fmtFin = useCallback(
    (value: number, dp = decimalPlaces) => formatNumber(value, dp, thousandsSep),
    [decimalPlaces, thousandsSep],
  );

  const fmtFinTapeOperand = useCallback((value: number) => {
    return Number.isInteger(value) ? value.toString() : fmtFin(value);
  }, [fmtFin]);

  const formatFinTape = useCallback((entries: FinTapeEntry[], result: number) => {
    const maxEntryLength = entries.reduce((max, item) => Math.max(max, item.entry.length), 0);
    const lines = entries.map(item => `${item.entry.padEnd(maxEntryLength)} -> ${fmtFin(item.total)}`);
    lines.push('');
    lines.push(`${fmtFin(result)} =`);
    return lines.join('\n');
  }, [fmtFin]);

  const finLabel = useCallback((reg: keyof FinancialRegisters): string => {
    const labels: Record<keyof FinancialRegisters, string> = {
      n: 'n',
      i: 'i%',
      pv: 'PV',
      pmt: 'PMT',
      fv: 'FV',
    };
    return labels[reg];
  }, []);

  const tvmLine = useCallback(
    (regs: FinancialRegisters, target?: keyof FinancialRegisters) => {
      return (Object.keys(regs) as (keyof FinancialRegisters)[])
        .filter(key => regs[key] !== null && key !== target)
        .map(key => `${finLabel(key)}=${key === 'i' ? fmtFin(regs[key] as number, 4) + '%' : fmtFin(regs[key] as number)}`)
        .join(', ');
    },
    [finLabel, fmtFin],
  );

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
    try { return evaluateExpr(balanceExpression(expression || '0'), angleUnit); } catch { return null; }
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

  const formatConvDisplay = (value: string): string => {
    if (!value || value === '-') return value || '0';
    const num = parseFloat(value);
    if (!Number.isFinite(num)) return value;
    const plain = formatNumber(num, decimalPlaces, thousandsSep);
    if (plain.length <= 16) return plain;
    return num.toExponential(Math.min(6, Math.max(0, decimalPlaces)));
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
      if (d === '.') {
        if (evaluated) {
          setExpression('0.');
          setStdResult(null);
          setEvaluated(false);
        } else {
          setExpression(prev => appendDecimalToExpression(prev));
        }
        return;
      }
      if (evaluated) { setExpression(d); setStdResult(null); setEvaluated(false); }
      else setExpression(prev => appendDigitToExpression(prev, d));
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
      else if (op === '÷') {
        if (x === 0) {
          showError('Division by zero');
          return;
        }
        res = y / x;
      }
      setLastFinRecord({
        title: 'RPN arithmetic',
        lines: [`${fmtFin(y)} ${op} ${fmtFin(x)} = ${fmtFin(res)}`],
        result: res,
      });
      setFinTape(prev => [...prev, {entry: `${fmtFinTapeOperand(x)} ${op}`, total: res}]);
      setStack([res, stack[2], stack[3], stack[3]]);
      setInputBuffer(''); setIsEntering(false); setLiftEnabled(true);
    } else {
      if (evaluated && stdResult !== null) { setExpression(appendOperatorToExpression(stdResult.toString(), op)); setStdResult(null); setEvaluated(false); }
      else setExpression(prev => appendOperatorToExpression(prev, op));
    }
  };

  const handleEnter = () => {
    const val = isEntering ? parseFloat(inputBuffer || '0') : stack[0];
    setStack([val, val, stack[1], stack[2]]);
    setLastFinRecord({
      title: 'RPN enter',
      lines: [`ENTER ${fmtFin(val)}`],
      result: val,
    });
    setFinTape(prev => [...prev, {entry: `${fmtFinTapeOperand(val)} Enter`, total: val}]);
    setInputBuffer(''); setIsEntering(false); setLiftEnabled(false);
  };

  const handleFinReg = (reg: keyof FinancialRegisters) => {
    if (isEntering) {
        const val = parseFloat(inputBuffer || '0');
        setFinRegs(prev => ({ ...prev, [reg]: val }));
        setLastFinRecord({
          title: 'TVM store',
          lines: [`${finLabel(reg)} = ${reg === 'i' ? fmtFin(val, 4) + '%' : fmtFin(val)}`],
          result: val,
        });
        setFinTape([]);
        setIsEntering(false); setInputBuffer(''); setLiftEnabled(true);
    } else {
        handleSolve(reg);
    }
  };

  const handleSolve = (reg: keyof FinancialRegisters) => {
    try {
      const knownInputs = (Object.keys(finRegs) as (keyof FinancialRegisters)[])
        .filter(key => key !== reg && finRegs[key] !== null)
        .length;
      if (knownInputs < 3) {
        showError('Set more TVM values');
        return;
      }
      const res = solveTVM(reg, finRegs);
      if (!Number.isFinite(res)) {
        showError('No solution');
        return;
      }
      setLastFinRecord({
        title: 'TVM solve',
        lines: [
          `${tvmLine(finRegs, reg)} -> ${finLabel(reg)} = ${reg === 'i' ? fmtFin(res, 4) + '%' : fmtFin(res)}`,
        ],
        result: res,
      });
      setFinTape([]);
      setFinRegs(prev => ({ ...prev, [reg]: res }));
      setStack(prev => [res, prev[1], prev[2], prev[3]]);
      setIsEntering(false); setInputBuffer(''); setLiftEnabled(true);
    } catch (e) { showError('Check Inputs'); }
  };

  const solveNPV = () => {
    if (cashFlows.length === 0) { showError('No Cash Flows'); return; }
    if (finRegs.i === null) { showError('Set i%'); return; }
    const i = (finRegs.i ?? 0) / 100;
    let npv = cashFlows[0].v;
    let period = 1;
    for (let j = 1; j < cashFlows.length; j++) {
        for (let k = 0; k < cashFlows[j].n; k++) {
            npv += cashFlows[j].v / Math.pow(1 + i, period);
            period++;
        }
    }
    setLastFinRecord({
      title: 'NPV',
      lines: [
        `i=${fmtFin(finRegs.i ?? 0, 4)}%`,
        ...cashFlows.map((cf, idx) => `CF${idx}=${fmtFin(cf.v)}${cf.n > 1 ? ` x${cf.n}` : ''}`),
        `NPV = ${fmtFin(npv)}`,
      ],
      result: npv,
    });
    setFinTape([]);
    pushX(npv, true);
  };

  const solveIRR = () => {
    if (cashFlows.length < 2) { showError('Need CF0 and CFj'); return; }
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
            setLastFinRecord({
              title: 'IRR',
              lines: [
                ...cashFlows.map((cf, idx) => `CF${idx}=${fmtFin(cf.v)}${cf.n > 1 ? ` x${cf.n}` : ''}`),
                `IRR = ${fmtFin(nextRate * 100, 4)}%`,
              ],
              result: nextRate * 100,
            });
            setFinTape([]);
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
    setLastFinRecord({
      title: 'Cash flow',
      lines: [`CF0 = ${fmtFin(val)}`],
      result: val,
    });
    setFinTape([]);
    setIsEntering(false); setInputBuffer(''); setLiftEnabled(true);
  };

  const handleCFj = () => {
    const val = isEntering ? parseFloat(inputBuffer || '0') : stack[0];
    setCashFlows(prev => [...prev, {v: val, n: 1}]);
    setLastFinRecord({
      title: 'Cash flow',
      lines: [`CF${cashFlows.length} = ${fmtFin(val)}`],
      result: val,
    });
    setFinTape([]);
    setIsEntering(false); setInputBuffer(''); setLiftEnabled(true);
  };

  const handleNj = () => {
    const val = Math.floor(isEntering ? parseFloat(inputBuffer || '0') : stack[0]);
    if (val < 1 || cashFlows.length < 2) { showError('Invalid Nj'); return; }
    setCashFlows(prev => {
        const last = prev[prev.length - 1];
        return [...prev.slice(0, -1), { ...last, n: val }];
    });
    setLastFinRecord({
      title: 'Cash flow count',
      lines: [`N${cashFlows.length - 1} = ${fmtFin(val, 0)}`],
      result: val,
    });
    setFinTape([]);
    setIsEntering(false); setInputBuffer(''); setLiftEnabled(true);
  };

  const handleLastX = () => {
    setLastFinRecord({
      title: 'Last X',
      lines: [`Last X = ${fmtFin(lastX)}`],
      result: lastX,
    });
    setFinTape(prev => [...prev, {entry: `${fmtFinTapeOperand(lastX)} Last X`, total: lastX}]);
    pushX(lastX, true);
  };

  const handleClearStack = () => {
    setStack([0, 0, 0, 0]);
    setIsEntering(false);
    setInputBuffer('');
    setLastFinRecord(null);
    setFinTape([]);
  };

  const handleAmort = () => {
    const periodsToAmort = isEntering ? parseFloat(inputBuffer || '0') : stack[0];
    if (periodsToAmort <= 0 || finRegs.pv === null || finRegs.i === null || finRegs.pmt === null) {
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
    setLastFinRecord({
      title: 'Amortization',
      lines: [
        `Periods=${fmtFin(periodsToAmort, 0)}`,
        `PV=${fmtFin(finRegs.pv)}`,
        `i=${fmtFin(finRegs.i, 4)}%`,
        `PMT=${fmtFin(finRegs.pmt)}`,
        `Principal=${fmtFin(totalPrincipal)}`,
        `Interest=${fmtFin(totalInterest)}`,
        `Balance=${fmtFin(balance)}`,
      ],
      result: totalPrincipal,
    });
    setFinTape([]);
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
            if (finTape.length > 0) {
                text = formatFinTape(finTape, valX);
            } else if (lastFinRecord) {
                parts.push(`--- ${lastFinRecord.title.toUpperCase()} ---`);
                parts.push(...lastFinRecord.lines);
                parts.push(`Result: ${fmtFin(lastFinRecord.result)}`);
                parts.push('------------------');
            }
            if (finTape.length === 0 && cashFlows.length > 0) {
                parts.push('Cash flows:');
                cashFlows.forEach((cf, idx) => {
                    parts.push(`CF${idx}: ${fmtFin(cf.v)}${cf.n > 1 ? ` (n:${cf.n})` : ''}`);
                });
            } else if (finTape.length === 0 && amortPeriodsTotal > 0 && !lastFinRecord) {
                parts.push('Amortization:');
                parts.push(`Periods: ${amortPeriodsTotal}`);
                parts.push(`Principal: ${fmtFin(stack[0])}`);
                parts.push(`Interest: ${fmtFin(stack[1])}`);
                parts.push(`Remaining: ${fmtFin(stack[2])}`);
            } else if (finTape.length === 0 && !lastFinRecord) {
                if (finRegs.n !== null) parts.push(`n: ${formatNumber(finRegs.n, 2)}`);
                if (finRegs.i !== null) parts.push(`i: ${formatNumber(finRegs.i, 2)}%`);
                if (finRegs.pv !== null) parts.push(`PV: ${formatNumber(finRegs.pv, 2, thousandsSep)}`);
                if (finRegs.pmt !== null) parts.push(`PMT: ${formatNumber(finRegs.pmt, 2, thousandsSep)}`);
                if (finRegs.fv !== null) parts.push(`FV: ${formatNumber(finRegs.fv, 2, thousandsSep)}`);
            }
            if (finTape.length === 0 && !lastFinRecord) {
              parts.push(`Result: ${fmtFin(valX)}`);
            }
            if (finTape.length === 0) {
              text = parts.join('\n');
            }
        }
    } else {
      try {
        const balanced = balanceExpression(expression || '0');
        const val = evaluated && stdResult !== null ? stdResult : evaluateExpr(balanced, angleUnit);
        text = stampMode === 'result' ? formatNumber(val, decimalPlaces, thousandsSep) : `${balanced} = ${formatNumber(val, decimalPlaces, thousandsSep)}`;
      } catch (e) { showError(calculationErrorMessage(e)); return; }
    }
    setInserting(true);
    try { await doInsert(text); PluginManager.closePluginView(); }
    catch (e) { showError('Insert failed'); } finally { setInserting(false); }
  }, [inserting, mode, stack, inputBuffer, isEntering, finRegs, decimalPlaces, expression, stdResult, evaluated, stampMode, showError, amortPeriodsTotal, cashFlows, angleUnit, thousandsSep, convCatIdx, convFromIdx, convToIdx, convFromVal, convToVal, lastFinRecord, fmtFin, finTape, formatFinTape]);

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

  const appendExpressionToken = (token: string) => {
    setError(null);
    if (evaluated) {
      setExpression(token);
      setStdResult(null);
      setEvaluated(false);
    } else {
      setExpression(prev => prev + token);
    }
  };

  const closeParen = () => {
    setError(null);
    setExpression(prev => {
      const base = evaluated && stdResult !== null ? stdResult.toString() : prev;
      const opens = (base.match(/\(/g) ?? []).length;
      const closes = (base.match(/\)/g) ?? []).length;
      if (opens <= closes) {
        return base;
      }
      const last = base[base.length - 1] ?? '';
      if ('+-×÷^(. ,'.includes(last)) {
        return base;
      }
      return base + ')';
    });
    setStdResult(null);
    setEvaluated(false);
  };

  const appendExpressionSuffix = (token: string) => {
    setError(null);
    setExpression(prev => {
      const base = evaluated && stdResult !== null ? stdResult.toString() : prev;
      const last = base[base.length - 1] ?? '';
      if (!base || '+-×÷^(. ,'.includes(last) || last === '%' || last === '!') {
        return base;
      }
      return base + token;
    });
    setStdResult(null);
    setEvaluated(false);
  };

  const appendModOperator = () => {
    setError(null);
    setExpression(prev => {
      const base = evaluated && stdResult !== null ? stdResult.toString() : prev;
      const last = base[base.length - 1] ?? '';
      if (!base || '+-×÷^(. ,'.includes(last) || base.endsWith('mod')) {
        return base;
      }
      return base + 'mod';
    });
    setStdResult(null);
    setEvaluated(false);
  };

  const handleEqual = () => {
    try {
        const balanced = balanceExpression(expression);
        const res = evaluateExpr(balanced, angleUnit);
        if (!Number.isFinite(res)) {
          showError('Invalid input');
          return;
        }
        setStdResult(res);
        setEvaluated(true);
        setExpression(balanced);
        if (balanced.trim()) {
          setHistory(prev => [...prev.slice(-19), balanced]);
        }
        setHistoryIdx(null);
    } catch (e) { showError(calculationErrorMessage(e)); }
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
        {label: '%', action: () => setExpression(p => appendPercentToExpression(p)), variant: 'utility'},

        {label: '+/-', action: () => {
            if (evaluated && stdResult !== null) setStdResult(-stdResult);
            else setExpression(prev => toggleExpressionSign(prev));
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
                () => {
                  const input = isEntering ? parseFloat(inputBuffer || '0') : stack[0];
                  const val = input * 12;
                  setFinRegs(prev => ({...prev, n: val}));
                  setLastFinRecord({title: 'TVM store', lines: [`n = ${fmtFin(input)} x 12 = ${fmtFin(val)}`], result: val});
                  setFinTape([]);
                  pushX(val, true);
                },
                () => handleFinReg('n')
            ), 
            variant: 'function'
        },
        {
            label: fKeyState ? 'i' : gKeyState ? 'i/12' : 'i', 
            action: () => handleShiftedAction(
                () => handleFinReg('i'),
                () => {
                  const input = isEntering ? parseFloat(inputBuffer || '0') : stack[0];
                  const val = input / 12;
                  setFinRegs(prev => ({...prev, i: val}));
                  setLastFinRecord({title: 'TVM store', lines: [`i% = ${fmtFin(input, 4)}% / 12 = ${fmtFin(val, 4)}%`], result: val});
                  setFinTape([]);
                  pushX(val, true);
                },
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
            () => { setCashFlows([]); setFinTape([]); setLastFinRecord({title: 'Cash flows cleared', lines: ['Cash-flow register cleared'], result: stack[0]}); showError('CF Cleared'); },
            () => {
                setStack([0,0,0,0]); setInputBuffer(''); setLiftEnabled(true);
                setFinRegs({n: null, i: null, pv: null, pmt: null, fv: null}); 
                setCashFlows([]); setAmortPeriodsTotal(0); setLastFinRecord(null); setFinTape([]);
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
            else setExpression(prev => toggleExpressionSign(prev));
        }, variant: 'utility'},
        {label: '0', action: () => handleDigit('0')},
        {label: '.', action: () => handleDigit('.'), variant: 'number'},
        {label: '+', action: () => handleOperator('+'), variant: 'operator'},

        // Row 5: Exponentials + power
        {label: 'eˣ',  action: () => handleSciFunc('e^'),          variant: 'function'},
        {label: '10ˣ', action: () => appendExpressionToken('10^'), variant: 'function'},
        {label: 'xʸ',  action: () => setExpression(p => appendOperatorToExpression(p, '^')),   variant: 'function'},
        {label: '⌫', action: () => setExpression(p => p.slice(0, -1)), variant: 'utility'},
        {label: 'AC', action: () => { setExpression(''); setStdResult(null); setEvaluated(false); }, variant: 'highlight'},
        {label: '%', action: () => setExpression(p => appendPercentToExpression(p)), variant: 'utility'},
        {label: '=', action: handleEqual, variant: 'equals'},

        // Row 6: Power shortcuts, factorial, parens, mod
        {label: 'x²', action: () => appendExpressionSuffix('²'), variant: 'function'},
        {label: 'x³', action: () => appendExpressionSuffix('³'), variant: 'function'},
        {label: 'x!', action: () => appendExpressionSuffix('!'), variant: 'function'},
        {label: '(', action: () => appendExpressionToken('('), variant: 'function'},
        {label: ')', action: closeParen, variant: 'function'},
        {label: ',', action: () => appendExpressionToken(','), variant: 'number'},
        {label: 'mod', action: appendModOperator, variant: 'function'},

        // Row 7: Roots + Memory
        {label: '√',   action: () => handleSciFunc('√'),  variant: 'function'},
        {label: '³√',  action: () => handleSciFunc('∛'),  variant: 'function'},
        {label: 'ʸ√x', action: () => handleSciFunc('ʸ√'), variant: 'function'},
        {label: 'MC',  action: handleMC,     variant: 'utility'},
        {label: 'MR',  action: handleMR,     variant: 'utility'},
        {label: 'M-',  action: handleMMinus, variant: 'utility'},
        {label: 'M+',  action: handleMPlus,  variant: 'utility'},

        // Row 8: Misc
        {label: '1/x', action: () => appendExpressionToken('1/('), variant: 'function'},
        {label: '|x|', action: () => handleSciFunc('abs'),           variant: 'function'},
        {label: 'Rand', action: () => handleSciFunc('rand'),          variant: 'function'},
        {label: 'π', action: () => appendExpressionToken('π'), variant: 'function'},
        {label: 'e', action: () => appendExpressionToken('e'), variant: 'function'},
        {label: angleUnit === 'deg' ? 'Rad' : 'Deg', action: () => setAngleUnit(angleUnit === 'deg' ? 'rad' : 'deg'), variant: 'utility'},
        {label: 'EE', action: () => appendExpressionSuffix('E'), variant: 'function'},
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
            <Text style={styles.title}>Calculator</Text>
            <View style={styles.modeCapsule}>
              {(['standard', 'conversion', 'financial', 'scientific'] as CalcMode[]).map(m => (
                <Pressable key={m} onPress={() => { setMode(m); setError(null); setConvPicker(null); setFKeyState(false); setGKeyState(false); }} style={[styles.modeTab, mode === m && styles.modeTabActive]}>
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
                    {(fKeyState || gKeyState) && (
                      <Text style={styles.finHint}>
                        {fKeyState ? 'f shift: n/i store, NPV, IRR, FV' : 'g shift: n x12, i /12, CFo, CFj, Nj'}
                      </Text>
                    )}
                    <View style={styles.regRow}>
                        <RegItem label="n" val={finRegs.n} scale={scale} />
                        <RegItem label="i%" val={finRegs.i} scale={scale} />
                        <RegItem label="PV" val={finRegs.pv} scale={scale} />
                        <RegItem label="PMT" val={finRegs.pmt} scale={scale} />
                        <RegItem label="FV" val={finRegs.fv} scale={scale} />
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
                    {(cashFlows.length > 0 || amortPeriodsTotal > 0) && (
                      <View style={styles.cfSummary}>
                        <Text style={styles.cfSummaryText}>
                          {cashFlows.length > 0 ? `CF: ${cashFlows.length}` : `AMORT: ${amortPeriodsTotal} periods`}
                        </Text>
                        <Text style={styles.cfSummaryText}>
                          {cashFlows.length > 0
                            ? `Last ${cashFlows[cashFlows.length - 1].n}x ${formatNumber(cashFlows[cashFlows.length - 1].v, decimalPlaces, thousandsSep)}`
                            : `Bal ${formatNumber(stack[2], decimalPlaces, thousandsSep)}`}
                        </Text>
                      </View>
                    )}
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
                      <ScrollView horizontal style={styles.convValueScroll}>
                        <Text style={styles.convValueText}>
                          {convActive === 'from'
                            ? (convFromVal || '0')
                            : formatConvDisplay(convFromVal)}
                        </Text>
                      </ScrollView>
                    </Pressable>
                  </View>
                  <View style={styles.convRow}>
                    <Pressable onPress={() => { setConvActive('to'); setConvPicker(convPicker === 'to' ? null : 'to'); }} style={[styles.convUnitBtn, convPicker === 'to' && styles.convUnitBtnActive]}>
                      <Text style={[styles.convUnitText, convPicker === 'to' && styles.convUnitTextActive]}>{CONV_CATEGORIES[convCatIdx].units[convToIdx].label} ▼</Text>
                    </Pressable>
                    <Pressable onPress={() => { setConvActive('to'); setConvPicker(null); }} style={[styles.convValueArea, convActive === 'to' && convPicker === null && styles.convValueAreaActive]}>
                      <ScrollView horizontal style={styles.convValueScroll}>
                        <Text style={styles.convValueText}>
                          {convActive === 'to'
                            ? (convToVal || '0')
                            : formatConvDisplay(convToVal)}
                        </Text>
                      </ScrollView>
                    </Pressable>
                  </View>
                </View>
            ) : (
                <View style={styles.stdDisplay}>
                  <ScrollView
                    style={styles.displayScroll}
                    contentContainerStyle={styles.displayScrollContent}
                    persistentScrollbar>
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
                  </ScrollView>
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
              const pBtnH = Math.round(40 * scale);
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
                    <CalcBtn key={i} label={btn.label} onPress={btn.action} variant={btn.variant as any} scale={scale}
                      pos={{ position: 'absolute', top: Math.floor(i / cCols) * (BTN_HEIGHT + BTN_GAP), left: (i % cCols) * (cBtnW + BTN_GAP), width: cBtnW, height: BTN_HEIGHT }} />
                  ))}
                </View>
              );
            })()
          ) : (
            <View style={[styles.grid, {height: Math.ceil(modeLayout!.buttons.length / colCount) * (BTN_HEIGHT + BTN_GAP) + 10}]}>
              {modeLayout!.buttons.map((btn, i) => (
                <CalcBtn key={`${mode}-${i}`} label={btn.label} onPress={btn.action} variant={btn.variant as any} scale={scale}
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
              <Pressable style={[styles.toggleBtn, stampMode === 'result' && styles.toggleBtnActive]} onPress={() => setStampMode('result')}><Text style={[styles.toggleText, stampMode === 'result' && styles.toggleTextActive]}>{mode === 'conversion' ? 'No label' : 'Result only'}</Text></Pressable>
              <View style={styles.toggleBtnSpacer} />
              <Pressable style={[styles.toggleBtn, stampMode === 'expression' && styles.toggleBtnActive]} onPress={() => setStampMode('expression')}><Text style={[styles.toggleText, stampMode === 'expression' && styles.toggleTextActive]}>{mode === 'conversion' ? 'With label' : 'Full record'}</Text></Pressable>
            </View>
            <Pressable onPress={handleInsert} disabled={inserting} style={styles.insertBtn}><Text style={styles.insertBtnText}>{inserting ? 'Inserting...' : 'Insert'}</Text></Pressable>
          </View>
        </Pressable>
      </KeyboardAvoidingView>
    </Pressable>
  );
}

function RegItem({label, val, scale = 1}: {label: string, val: number | null, scale?: number}) {
  return (
    <View style={baseStyles.regItem}>
      <Text style={[baseStyles.regLabel, {fontSize: Math.round(9 * scale)}]}>{label}</Text>
      <Text style={[baseStyles.regVal, {fontSize: Math.round(11 * scale)}]} numberOfLines={1}>{val === null ? '--' : val.toString()}</Text>
    </View>
  );
}

function CalcBtn({label, onPress, variant = 'number', pos, scale = 1}: {label: string, onPress: () => void, variant?: 'number' | 'utility' | 'operator' | 'equals' | 'function' | 'highlight' | 'fKey' | 'gKey', pos: any, scale?: number}) {
  return (
    <Pressable onPress={onPress} style={[baseStyles.btn, pos,
        variant === 'utility' && baseStyles.btnUtility,
        variant === 'operator' && baseStyles.btnOperator,
        variant === 'equals' && baseStyles.btnEquals,
        variant === 'function' && baseStyles.btnFunction,
        variant === 'highlight' && baseStyles.btnHighlight,
        variant === 'fKey' && baseStyles.btnFKey,
        variant === 'gKey' && baseStyles.btnGKey
    ]}>
      <Text style={[baseStyles.btnText,
        {fontSize: Math.round(15 * scale)},
        variant === 'equals' && baseStyles.btnTextEquals,
        variant === 'highlight' && baseStyles.btnTextHighlight,
        variant === 'fKey' && baseStyles.btnTextFKey,
        variant === 'gKey' && baseStyles.btnTextGKey,
        label.length === 5 && {fontSize: Math.round(11 * scale)},
        label.length > 5 && {fontSize: Math.round(9 * scale)}
      ]}>{label}</Text>
    </Pressable>
  );
}
