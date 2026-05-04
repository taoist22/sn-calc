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

// ─── Constants ───────────────────────────────────────────────────────────────

const PANEL_WIDTH = 480;
const PANEL_PADDING = 15;
const BTN_GAP = 5;
const BTN_HEIGHT = 58;
// Exact integer: (480 - 2*15 - 4*5) / 5 = 430/5 = 86
const BTN_WIDTH = 86;
const COL_STEP = BTN_WIDTH + BTN_GAP;   // 91
const ROW_STEP = BTN_HEIGHT + BTN_GAP;  // 63
const GRID_HEIGHT = 4 * ROW_STEP - BTN_GAP; // 247

function p(row: number, col: number) {
  return {position: 'absolute' as const, top: row * ROW_STEP, left: col * COL_STEP};
}

const STAMP_FONT_SIZE = 40;
const STAMP_BOX_HEIGHT = 80;
const SMART_PLACEMENT_GAP = 40;
const BOTTOM_MARGIN = 160;
const LEFT_MARGIN = 180;
const DEFAULT_PAGE_WIDTH = 1404;
const DEFAULT_PAGE_HEIGHT = 1872;
const ERROR_DISPLAY_MS = 2500;

type StampMode = 'result' | 'expression';
type ApiRes<T> = {success: boolean; result?: T; error?: {message?: string}} | null | undefined;

// ─── Expression evaluator ────────────────────────────────────────────────────

function evaluateExpr(expr: string): number {
  const s = expr.replace(/\s/g, '').replace(/×/g, '*').replace(/÷/g, '/');
  let pos = 0;

  const peek = (): string => s[pos] ?? '';
  const consume = (): string => s[pos++] ?? '';

  function parseNumber(): number {
    let str = '';
    if (peek() === '-') {
      str += consume();
    }
    while (pos < s.length && ((peek() >= '0' && peek() <= '9') || peek() === '.')) {
      str += consume();
    }
    if (!str || str === '-') {
      throw new Error('Expected number');
    }
    const n = parseFloat(str);
    if (isNaN(n)) {
      throw new Error('Invalid number');
    }
    return n;
  }

  function parseTerm(): number {
    let left = parseNumber();
    while (pos < s.length && (peek() === '*' || peek() === '/' || peek() === '%')) {
      const op = consume();
      const right = parseNumber();
      if (op === '*') {
        left = left * right;
      } else if (op === '/') {
        if (right === 0) {
          throw new Error('Division by zero');
        }
        left = left / right;
      } else {
        left = left % right;
      }
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
  if (pos < s.length) {
    throw new Error(`Unexpected: ${s[pos]}`);
  }
  return result;
}

function formatNumber(n: number): string {
  if (!isFinite(n)) {
    return isNaN(n) ? 'Error' : n > 0 ? '∞' : '-∞';
  }
  if (Number.isInteger(n)) {
    return n.toString();
  }
  return parseFloat(n.toPrecision(10)).toString();
}

// ─── Smart placement ─────────────────────────────────────────────────────────

async function findInsertTop(
  filePath: string,
  pageNum: number,
  pageHeight: number,
): Promise<number> {
  try {
    const res = (await PluginFileAPI.getElements(pageNum, filePath)) as ApiRes<any[]>;
    if (res?.success && Array.isArray(res.result) && res.result.length > 0) {
      const lowestEdge = Math.max(...res.result.map((el: any) => el.maxY ?? 0));
      const candidate = lowestEdge + SMART_PLACEMENT_GAP;
      if (candidate + STAMP_BOX_HEIGHT + 20 < pageHeight) {
        return candidate;
      }
    }
  } catch {}
  return pageHeight - BOTTOM_MARGIN - STAMP_BOX_HEIGHT;
}

async function doInsert(text: string): Promise<void> {
  let pageWidth = DEFAULT_PAGE_WIDTH;
  let pageHeight = DEFAULT_PAGE_HEIGHT;
  let filePath: string | undefined;
  let pageNum: number | undefined;

  try {
    const pathRes = (await PluginCommAPI.getCurrentFilePath()) as ApiRes<string>;
    const pageRes = (await PluginCommAPI.getCurrentPageNum()) as ApiRes<number>;
    if (pathRes?.success && pageRes?.success) {
      filePath = pathRes.result as string;
      pageNum = pageRes.result as number;
      const sizeRes = (await PluginFileAPI.getPageSize(
        filePath,
        pageNum,
      )) as ApiRes<{width: number; height: number}>;
      if (sizeRes?.success && sizeRes.result) {
        pageWidth = sizeRes.result.width;
        pageHeight = sizeRes.result.height;
      }
    }
  } catch {}

  const top =
    filePath !== undefined && pageNum !== undefined
      ? await findInsertTop(filePath, pageNum, pageHeight)
      : pageHeight - BOTTOM_MARGIN - STAMP_BOX_HEIGHT;

  const boxWidth = Math.max(
    STAMP_FONT_SIZE * 6,
    Math.min(
      Math.ceil(text.length * STAMP_FONT_SIZE * 0.75 * 1.4),
      pageWidth - 200,
    ),
  );
  const textRect = {
    left: LEFT_MARGIN,
    top,
    right: LEFT_MARGIN + boxWidth,
    bottom: top + STAMP_BOX_HEIGHT,
  };

  const res = (await PluginNoteAPI.insertText({
    textContentFull: text,
    textRect,
    fontSize: STAMP_FONT_SIZE,
    textBold: 1,
    textItalics: 0,
    textAlign: 0,
    textEditable: 1,
    showLassoAfterInsert: true,
  })) as ApiRes<boolean>;

  if (!res?.success) {
    throw new Error(res?.error?.message ?? 'insertText failed');
  }

  try {
    await PluginCommAPI.lassoElements(textRect);
  } catch {}
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function CalcPanel() {
  const [expression, setExpression] = useState('');
  const [result, setResult] = useState<number | null>(null);
  const [evaluated, setEvaluated] = useState(false);
  const [stampMode, setStampMode] = useState<StampMode>('result');
  const [inserting, setInserting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showError = useCallback((msg: string) => {
    setError(msg);
    if (errorTimerRef.current) {
      clearTimeout(errorTimerRef.current);
    }
    errorTimerRef.current = setTimeout(() => setError(null), ERROR_DISPLAY_MS);
  }, []);

  const handleClose = useCallback(() => {
    if (!inserting) {
      PluginManager.closePluginView();
    }
  }, [inserting]);

  const handleDigit = useCallback(
    (digit: string) => {
      setError(null);
      if (evaluated) {
        setExpression(digit);
        setResult(null);
        setEvaluated(false);
      } else {
        setExpression(prev => prev + digit);
      }
    },
    [evaluated],
  );

  const handleOperator = useCallback(
    (op: string) => {
      setError(null);
      if (evaluated && result !== null) {
        setExpression(formatNumber(result) + op);
        setResult(null);
        setEvaluated(false);
      } else {
        setExpression(prev => {
          if (prev === '' && op === '-') {
            return '-';
          }
          if (prev === '') {
            return prev;
          }
          const last = prev[prev.length - 1];
          if ('×÷+-%'.includes(last)) {
            return prev.slice(0, -1) + op;
          }
          return prev + op;
        });
        setEvaluated(false);
      }
    },
    [evaluated, result],
  );

  const handleDecimal = useCallback(() => {
    setError(null);
    if (evaluated) {
      setExpression('0.');
      setResult(null);
      setEvaluated(false);
      return;
    }
    setExpression(prev => {
      const lastOpIdx = Math.max(
        prev.lastIndexOf('+'),
        prev.lastIndexOf('-'),
        prev.lastIndexOf('×'),
        prev.lastIndexOf('÷'),
        prev.lastIndexOf('%'),
      );
      const lastSegment = prev.slice(lastOpIdx + 1);
      if (lastSegment.includes('.')) {
        return prev;
      }
      if (lastSegment === '') {
        return prev + '0.';
      }
      return prev + '.';
    });
  }, [evaluated]);

  const handleToggleSign = useCallback(() => {
    setError(null);
    if (evaluated && result !== null) {
      const negated = -result;
      setExpression(formatNumber(negated));
      setResult(null);
      setEvaluated(false);
      return;
    }
    setExpression(prev => {
      if (!prev) {
        return '-';
      }
      // Find where the last number segment starts
      let splitIdx = -1;
      for (let i = prev.length - 1; i > 0; i--) {
        const ch = prev[i - 1];
        if ('×÷+%'.includes(ch)) {
          splitIdx = i;
          break;
        }
        if (ch === '-') {
          splitIdx = i;
          break;
        }
      }
      const before = prev.slice(0, splitIdx);
      const lastNum = prev.slice(splitIdx);
      if (!lastNum || lastNum === '-') {
        return prev;
      }
      if (lastNum.startsWith('-')) {
        return before + lastNum.slice(1);
      }
      return before + '-' + lastNum;
    });
  }, [evaluated, result]);

  const handleClear = useCallback(() => {
    setExpression('');
    setResult(null);
    setEvaluated(false);
    setError(null);
  }, []);

  const handleBackspace = useCallback(() => {
    if (evaluated) {
      setExpression('');
      setResult(null);
      setEvaluated(false);
      return;
    }
    setExpression(prev => prev.slice(0, -1));
  }, [evaluated]);

  const handleEquals = useCallback(() => {
    if (!expression) {
      return;
    }
    try {
      const r = evaluateExpr(expression);
      setResult(r);
      setEvaluated(true);
      setError(null);
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Error');
    }
  }, [expression, showError]);

  const handleInsert = useCallback(async () => {
    if (inserting) {
      return;
    }
    let insertResult = result;
    let insertExpr = expression;

    if (!evaluated) {
      if (!expression) {
        showError('Nothing to insert');
        return;
      }
      try {
        insertResult = evaluateExpr(expression);
        setResult(insertResult);
        setEvaluated(true);
      } catch (e) {
        showError(e instanceof Error ? e.message : 'Error');
        return;
      }
    }

    if (insertResult === null) {
      showError('Nothing to insert');
      return;
    }

    const text =
      stampMode === 'result'
        ? formatNumber(insertResult)
        : `${insertExpr} = ${formatNumber(insertResult)}`;

    setInserting(true);
    try {
      await doInsert(text);
      PluginManager.closePluginView();
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Insert failed');
    } finally {
      setInserting(false);
    }
  }, [inserting, result, evaluated, expression, stampMode, showError]);

  const displayExprLine = evaluated ? expression + ' =' : '';
  const displayMainLine =
    evaluated && result !== null ? formatNumber(result) : expression || '0';

  return (
    <Pressable style={styles.overlay} onPress={handleClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Pressable style={styles.panel} onPress={e => e.stopPropagation()}>

          {/* ── Header ── */}
          <View style={styles.header}>
            <Text style={styles.title}>Calculator</Text>
            <Pressable
              onPress={handleClose}
              style={({pressed}) => [styles.closeBtn, pressed && styles.btnPressed]}>
              <Text style={styles.closeText}>{'✕'}</Text>
            </Pressable>
          </View>
          <View style={styles.divider} />

          {/* ── Display ── */}
          <View style={styles.display}>
            <Text style={styles.displayExpr} numberOfLines={1} adjustsFontSizeToFit>
              {displayExprLine}
            </Text>
            <Text style={styles.displayMain} numberOfLines={1} adjustsFontSizeToFit>
              {displayMainLine}
            </Text>
          </View>
          <View style={styles.divider} />

          {/* ── Error banner ── */}
          {error != null && (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {/* ── Button grid (absolute positioned, bypasses flexbox) ──
               Row 0:  7    8    9    ⌫   ÷
               Row 1:  4    5    6    AC   ×
               Row 2:  1    2    3    %    -
               Row 3:  +/-  0    .    =    +
          */}
          <View style={styles.grid}>
            <CalcBtn label="7"   onPress={() => handleDigit('7')}        pos={p(0,0)} />
            <CalcBtn label="8"   onPress={() => handleDigit('8')}        pos={p(0,1)} />
            <CalcBtn label="9"   onPress={() => handleDigit('9')}        pos={p(0,2)} />
            <CalcBtn label="⌫"  onPress={handleBackspace}               pos={p(0,3)} variant="utility" />
            <CalcBtn label="÷"   onPress={() => handleOperator('÷')}    pos={p(0,4)} variant="operator" />

            <CalcBtn label="4"   onPress={() => handleDigit('4')}        pos={p(1,0)} />
            <CalcBtn label="5"   onPress={() => handleDigit('5')}        pos={p(1,1)} />
            <CalcBtn label="6"   onPress={() => handleDigit('6')}        pos={p(1,2)} />
            <CalcBtn label="AC"  onPress={handleClear}                   pos={p(1,3)} variant="utility" />
            <CalcBtn label="×"   onPress={() => handleOperator('×')}    pos={p(1,4)} variant="operator" />

            <CalcBtn label="1"   onPress={() => handleDigit('1')}        pos={p(2,0)} />
            <CalcBtn label="2"   onPress={() => handleDigit('2')}        pos={p(2,1)} />
            <CalcBtn label="3"   onPress={() => handleDigit('3')}        pos={p(2,2)} />
            <CalcBtn label="%"   onPress={() => handleOperator('%')}     pos={p(2,3)} variant="operator" />
            <CalcBtn label="-"   onPress={() => handleOperator('-')}     pos={p(2,4)} variant="operator" />

            <CalcBtn label="+/-" onPress={handleToggleSign}              pos={p(3,0)} variant="utility" />
            <CalcBtn label="0"   onPress={() => handleDigit('0')}        pos={p(3,1)} />
            <CalcBtn label="."   onPress={handleDecimal}                 pos={p(3,2)} />
            <CalcBtn label="="   onPress={handleEquals}                  pos={p(3,3)} variant="equals" />
            <CalcBtn label="+"   onPress={() => handleOperator('+')}     pos={p(3,4)} variant="operator" />
          </View>

          {/* ── Insert mode toggle + Insert button ── */}
          <View style={styles.divider} />
          <View style={styles.bottomArea}>
            <View style={styles.toggleRow}>
              <Pressable
                style={[styles.toggleBtn, stampMode === 'result' && styles.toggleBtnActive]}
                onPress={() => setStampMode('result')}>
                <Text style={[styles.toggleText, stampMode === 'result' && styles.toggleTextActive]}>
                  Result only
                </Text>
              </Pressable>
              <View style={styles.toggleBtnSpacer} />
              <Pressable
                style={[styles.toggleBtn, stampMode === 'expression' && styles.toggleBtnActive]}
                onPress={() => setStampMode('expression')}>
                <Text
                  style={[
                    styles.toggleText,
                    stampMode === 'expression' && styles.toggleTextActive,
                  ]}>
                  Full expression
                </Text>
              </Pressable>
            </View>
            <Pressable
              onPress={handleInsert}
              disabled={inserting}
              style={({pressed}) => [
                styles.insertBtn,
                pressed && styles.btnPressed,
                inserting && styles.insertBtnDisabled,
              ]}>
              <Text style={styles.insertBtnText}>{inserting ? 'Inserting…' : 'Insert'}</Text>
            </Pressable>
          </View>

        </Pressable>
      </KeyboardAvoidingView>
    </Pressable>
  );
}

// ─── CalcBtn ─────────────────────────────────────────────────────────────────

function CalcBtn({
  label,
  onPress,
  variant = 'number',
  pos,
}: {
  label: string;
  onPress: () => void;
  variant?: 'number' | 'utility' | 'operator' | 'equals';
  pos: {position: 'absolute'; top: number; left: number};
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({pressed}) => [
        styles.btn,
        pos,
        variant === 'utility' && styles.btnUtility,
        variant === 'operator' && styles.btnOperator,
        variant === 'equals' && styles.btnEquals,
        pressed && styles.btnPressed,
      ]}>
      <Text
        style={[
          styles.btnText,
          variant === 'utility' && styles.btnTextUtility,
          variant === 'operator' && styles.btnTextOperator,
          variant === 'equals' && styles.btnTextEquals,
        ]}>
        {label}
      </Text>
    </Pressable>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  panel: {
    width: PANEL_WIDTH,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#000000',
  },

  // Header
  header: {
    paddingHorizontal: PANEL_PADDING,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
  },
  title: {
    flex: 1,
    fontSize: 22,
    fontWeight: 'bold',
    color: '#000000',
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1.5,
    borderColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#000000',
  },
  divider: {
    height: 1,
    backgroundColor: '#000000',
  },
  btnPressed: {
    backgroundColor: '#E0E0E0',
  },

  // Display
  display: {
    paddingHorizontal: PANEL_PADDING,
    paddingTop: 12,
    paddingBottom: 12,
    alignItems: 'flex-end',
    minHeight: 90,
  },
  displayExpr: {
    fontSize: 16,
    color: '#888888',
    marginBottom: 4,
  },
  displayMain: {
    fontSize: 40,
    fontWeight: '600',
    color: '#000000',
  },

  // Error
  errorBanner: {
    marginHorizontal: PANEL_PADDING,
    marginVertical: 6,
    backgroundColor: '#1A1A1A',
    borderRadius: 4,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  errorText: {
    color: '#FFFFFF',
    fontSize: 13,
    textAlign: 'center',
  },

  // Button grid — absolute positioning, no flexbox
  grid: {
    paddingHorizontal: PANEL_PADDING,
    paddingTop: 10,
    paddingBottom: 10,
    height: GRID_HEIGHT + 20,
  },
  btn: {
    width: BTN_WIDTH,
    height: BTN_HEIGHT,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#CCCCCC',
    backgroundColor: '#F8F8F8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnUtility: {
    backgroundColor: '#E8E8E8',
    borderColor: '#AAAAAA',
  },
  btnOperator: {
    backgroundColor: '#EFEFEF',
    borderColor: '#AAAAAA',
  },
  btnEquals: {
    backgroundColor: '#000000',
    borderColor: '#000000',
  },
  btnText: {
    fontSize: 22,
    fontWeight: '500',
    color: '#000000',
  },
  btnTextUtility: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333333',
  },
  btnTextOperator: {
    fontWeight: '600',
    color: '#333333',
  },
  btnTextEquals: {
    color: '#FFFFFF',
    fontWeight: '700',
  },

  // Bottom area (toggle + insert)
  bottomArea: {
    padding: PANEL_PADDING,
  },
  toggleRow: {
    flexDirection: 'row',
    marginBottom: 10,
  },
  toggleBtnSpacer: {
    width: 8,
  },
  toggleBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: '#BBBBBB',
    alignItems: 'center',
  },
  toggleBtnActive: {
    borderColor: '#000000',
    backgroundColor: '#000000',
  },
  toggleText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#888888',
  },
  toggleTextActive: {
    color: '#FFFFFF',
  },
  insertBtn: {
    paddingVertical: 14,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: '#000000',
    alignItems: 'center',
  },
  insertBtnDisabled: {
    opacity: 0.5,
  },
  insertBtnText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#000000',
  },
});
