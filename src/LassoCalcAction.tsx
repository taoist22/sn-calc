import React, {useEffect, useRef, useState} from 'react';
import {Pressable, StyleSheet, Text, TextInput, View} from 'react-native';
import {
  PluginCommAPI,
  PluginFileAPI,
  PluginManager,
  PluginNoteAPI,
  type Point,
  type Rect,
} from 'sn-plugin-lib';
import {doInsert} from './CalcPanelPro';
import {
  buildLassoCalculationOutput,
  calculationErrorMessage,
  normalizeSimpleArithmeticExpression,
} from './logic/calculatorLogic';
import {type InsertAnchorRect, type InsertPlacementMode} from './logic/insertPlacement';

type ApiRes<T> = {success: boolean; result?: T; error?: {message?: string}} | null | undefined;
type Phase =
  | {kind: 'loading'; msg: string}
  | {kind: 'ready'}
  | {kind: 'error'; msg: string};
type LassoRead = {text: string; rect?: InsertAnchorRect};
type OutputMode = 'full' | 'result';

type Props = {
  onOpenCalculator: (expression: string) => void;
};

const API_TIMEOUT_MS = 8000;
const OCR_TIMEOUT_MS = 15000;
const RECOGNIZER_SETTLE_MS = 400;
const DEFAULT_PAGE_SIZE = {width: 1404, height: 1872};
const LASSO_RECT_MARGIN = 8;

class NoActiveLassoError extends Error {
  constructor() {
    super('No active lasso selection');
  }
}

class NoLassoStrokesError extends Error {
  constructor() {
    super('No strokes to recognize');
  }
}

function withTimeout<T>(promise: Promise<T>, label: string, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function requireApiResult<T>(res: ApiRes<T>, fallback: string): T {
  if (res?.success && res.result !== undefined && res.result !== null) {
    return res.result;
  }
  throw new Error(res?.error?.message ?? fallback);
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message || fallback : fallback;
}

async function getCurrentFilePath(): Promise<string> {
  const pathRes = (await withTimeout(
    PluginCommAPI.getCurrentFilePath(),
    'Current file lookup',
    API_TIMEOUT_MS,
  )) as ApiRes<string>;
  return requireApiResult(pathRes, 'Could not read current file');
}

async function getCurrentPageNum(): Promise<number> {
  const pageRes = (await withTimeout(
    PluginCommAPI.getCurrentPageNum(),
    'Current page lookup',
    API_TIMEOUT_MS,
  )) as ApiRes<number>;
  return requireApiResult(pageRes, 'Could not read current page');
}

async function getCurrentLassoRect(): Promise<Rect> {
  const rectRes = (await withTimeout(
    PluginCommAPI.getLassoRect(),
    'Current lasso lookup',
    API_TIMEOUT_MS,
  )) as unknown as ApiRes<Rect>;
  const rect = requireApiResult(rectRes, 'Could not read lasso selection');
  if (rect.right <= rect.left || rect.bottom <= rect.top) {
    throw new Error('Lasso selection is empty');
  }
  return rect;
}

async function getCurrentPageSize(pageNum?: number): Promise<{width: number; height: number}> {
  const filePath = await getCurrentFilePath();
  const resolvedPageNum = pageNum ?? (await getCurrentPageNum());
  const sizeRes = (await withTimeout(
    PluginFileAPI.getPageSize(filePath, resolvedPageNum),
    'Page size lookup',
    API_TIMEOUT_MS,
  )) as ApiRes<{width: number; height: number}>;
  return requireApiResult(sizeRes, 'Could not read page size');
}

async function recycleElements(elements: any[]): Promise<void> {
  for (const el of elements) {
    try {
      await el.recycle?.();
    } catch (error) {
      console.warn('[LassoCalc] recycle failed:', error);
    }
  }
}

function clearElementCache(): void {
  try {
    PluginCommAPI.clearElementCache();
  } catch (error) {
    console.warn('[LassoCalc] clearElementCache failed:', error);
  }
}

async function removeLassoBox(): Promise<void> {
  try {
    await withTimeout(
      PluginCommAPI.setLassoBoxState(2),
      'Clearing lasso selection',
      API_TIMEOUT_MS,
    );
  } catch (error) {
    console.warn('[LassoCalc] setLassoBoxState failed:', error);
  }
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return (
    a.left <= b.right + LASSO_RECT_MARGIN &&
    a.right >= b.left - LASSO_RECT_MARGIN &&
    a.top <= b.bottom + LASSO_RECT_MARGIN &&
    a.bottom >= b.top - LASSO_RECT_MARGIN
  );
}

async function getElementContourRect(element: any): Promise<Rect | null> {
  const contours = element.contoursSrc;
  if (!contours?.size || !contours?.getRange) return null;
  const contourCount = await contours.size();
  if (!contourCount) return null;
  const contourGroups = (await contours.getRange(0, contourCount)) as Point[][];
  const points = contourGroups.flat().filter(Boolean);
  if (!points.length) return null;
  return points.reduce(
    (bounds, point) => ({
      left: Math.min(bounds.left, point.x),
      top: Math.min(bounds.top, point.y),
      right: Math.max(bounds.right, point.x),
      bottom: Math.max(bounds.bottom, point.y),
    }),
    {
      left: Number.POSITIVE_INFINITY,
      top: Number.POSITIVE_INFINITY,
      right: Number.NEGATIVE_INFINITY,
      bottom: Number.NEGATIVE_INFINITY,
    },
  );
}

async function getCurrentLassoStrokes(elements: any[], pageNum: number, lassoRect: Rect): Promise<any[]> {
  const strokes: any[] = [];
  for (const element of elements) {
    if (element.type !== 0 || element.pageNum !== pageNum) continue;
    try {
      const elementRect = await getElementContourRect(element);
      if (elementRect && rectsOverlap(elementRect, lassoRect)) {
        strokes.push(element);
      }
    } catch (error) {
      console.warn('[LassoCalc] contour lookup failed:', error);
    }
  }
  return strokes;
}

async function extractLassoOcr(onStatus: (msg: string) => void, rect: Rect): Promise<string> {
  onStatus('Recognizing handwriting...');
  const pageNum = await getCurrentPageNum();
  clearElementCache();
  const elementsRes = (await withTimeout(
    PluginCommAPI.getLassoElements(),
    'Reading selected handwriting',
    API_TIMEOUT_MS,
  )) as ApiRes<any[]>;
  if (!elementsRes?.success || !elementsRes.result?.length) {
    throw new NoActiveLassoError();
  }

  const elements = elementsRes.result;
  try {
    const strokes = await getCurrentLassoStrokes(elements, pageNum, rect);
    if (strokes.length === 0) {
      throw new NoLassoStrokesError();
    }

    let pageSize = DEFAULT_PAGE_SIZE;
    try {
      pageSize = await getCurrentPageSize(pageNum);
    } catch (error) {
      console.warn('[LassoCalc] page size lookup failed:', error);
      throw new Error('Could not read page size for handwriting recognition');
    }

    try {
      await withTimeout(PluginCommAPI.cancelRecognize(), 'Reset recognizer', API_TIMEOUT_MS);
    } catch (error) {
      console.warn('[LassoCalc] cancelRecognize failed:', error);
    }
    await new Promise<void>(resolve => setTimeout(resolve, RECOGNIZER_SETTLE_MS));

    const recogRes = (await withTimeout(
      PluginCommAPI.recognizeElements(strokes, pageSize),
      'Handwriting recognition',
      OCR_TIMEOUT_MS,
    )) as ApiRes<string>;
    if (!recogRes?.success || !recogRes.result?.trim()) {
      throw new Error(recogRes?.error?.message ?? 'Could not recognize handwriting');
    }
    return recogRes.result.trim();
  } finally {
    await recycleElements(elements);
    clearElementCache();
  }
}

async function extractLassoText(onStatus: (msg: string) => void): Promise<LassoRead> {
  const filePath = await getCurrentFilePath();
  const isNote = filePath.toLowerCase().endsWith('.note');
  const rect = await getCurrentLassoRect();
  let typedText = '';

  if (isNote) {
    try {
      onStatus('Reading typed text...');
      const lassoTextRes = (await withTimeout(
        PluginNoteAPI.getLassoText(),
        'Reading selected typed text',
        API_TIMEOUT_MS,
      )) as ApiRes<Array<{textContentFull: string}>>;
      if (lassoTextRes?.success && lassoTextRes.result?.length) {
        typedText = lassoTextRes.result
          .map(tb => tb.textContentFull?.trim())
          .filter(Boolean)
          .join('');
      }
    } catch (error) {
      console.warn('[LassoCalc] getLassoText failed, trying handwriting OCR:', error);
    }
  }

  try {
    const handwritingText = await extractLassoOcr(onStatus, rect);
    const combined = `${typedText}${handwritingText}`.trim();
    if (combined) {
      return {text: combined, rect};
    }
    throw new Error('Nothing to recognize in selection');
  } catch (error) {
    if (typedText && (error instanceof NoActiveLassoError || error instanceof NoLassoStrokesError)) {
      return {text: typedText, rect};
    }
    if (error instanceof NoActiveLassoError || error instanceof NoLassoStrokesError) {
      throw new Error('Nothing to recognize in selection');
    }
    throw error;
  } finally {
    await removeLassoBox();
  }
}

async function readSelection(onStatus: (msg: string) => void): Promise<LassoRead> {
  onStatus('Reading selection...');
  return extractLassoText(onStatus);
}

function calculateText(text: string, outputMode: OutputMode): string {
  return buildLassoCalculationOutput(text, outputMode === 'result');
}

export default function LassoCalcAction({onOpenCalculator}: Props) {
  const inputRef = useRef<TextInput>(null);
  const [phase, setPhase] = useState<Phase>({kind: 'loading', msg: 'Reading selection...'});
  const [text, setText] = useState('');
  const [anchorRect, setAnchorRect] = useState<InsertAnchorRect | undefined>();
  const [preview, setPreview] = useState('');
  const [outputMode, setOutputMode] = useState<OutputMode>('full');
  const [inputSelection, setInputSelection] = useState({start: 0, end: 0});
  const [inserting, setInserting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    readSelection(msg => {
      if (!cancelled) setPhase({kind: 'loading', msg});
    })
      .then(read => {
        if (cancelled) return;
        setText(read.text);
        setInputSelection({start: read.text.length, end: read.text.length});
        setAnchorRect(read.rect);
        try {
          setPreview(calculateText(read.text, 'full'));
        } catch {
          setPreview('');
        }
        setPhase({kind: 'ready'});
        setTimeout(() => inputRef.current?.focus(), 0);
      })
      .catch(error => {
        if (!cancelled) {
          const msg = getErrorMessage(error, 'Could not calculate selection');
          setPhase({kind: 'error', msg: calculationErrorMessage(error) === 'Error' ? msg : calculationErrorMessage(error)});
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const close = () => PluginManager.closePluginView();
  const handleTextChange = (value: string) => {
    setText(value);
    setPhase({kind: 'ready'});
    try {
      setPreview(calculateText(value, outputMode));
    } catch {
      setPreview('');
    }
  };

  const handleOutputModeChange = (next: OutputMode) => {
    setOutputMode(next);
    try {
      setPreview(calculateText(text, next));
    } catch {
      setPreview('');
    }
  };

  const handleInsert = async () => {
    if (inserting) return;
    setInserting(true);
    try {
      const output = calculateText(text, outputMode);
      const placementMode: InsertPlacementMode = outputMode === 'result' ? 'right-of-anchor' : 'default';
      await doInsert(output, anchorRect, placementMode);
      PluginManager.closePluginView();
    } catch (error) {
      const msg = getErrorMessage(error, 'Could not calculate selection');
      setPhase({kind: 'error', msg: calculationErrorMessage(error) === 'Error' ? msg : calculationErrorMessage(error)});
    } finally {
      setInserting(false);
    }
  };

  const handleOpenCalculator = () => {
    try {
      onOpenCalculator(normalizeSimpleArithmeticExpression(text));
    } catch {
      onOpenCalculator(text.trim());
    }
  };

  return (
    <Pressable style={styles.overlay} onPress={close}>
      <Pressable style={styles.panel} onPress={e => e.stopPropagation()}>
        <Text style={styles.title}>Calc Selection</Text>
        <View style={styles.divider} />
        {phase.kind === 'loading' ? (
          <Text style={styles.statusText}>{phase.msg}</Text>
        ) : (
          <View style={styles.body}>
            {phase.kind === 'error' && <Text style={styles.errorText}>{phase.msg}</Text>}
            <Text style={styles.label}>Recognized expression</Text>
            <TextInput
              ref={inputRef}
              style={styles.input}
              value={text}
              onChangeText={handleTextChange}
              selection={inputSelection}
              onSelectionChange={event => setInputSelection(event.nativeEvent.selection)}
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              multiline
              placeholder="1+51+81="
              placeholderTextColor="#777"
            />
            <View style={styles.previewBox}>
              <Text style={styles.previewLabel}>Output</Text>
              <Text style={styles.previewText}>{preview || 'Fix the expression to preview a result'}</Text>
            </View>
            <View style={styles.toggleRow}>
              <Pressable
                onPress={() => handleOutputModeChange('full')}
                style={[styles.toggleBtn, outputMode === 'full' && styles.toggleBtnActive]}>
                <Text style={[styles.toggleText, outputMode === 'full' && styles.toggleTextActive]}>Full</Text>
              </Pressable>
              <Pressable
                onPress={() => handleOutputModeChange('result')}
                style={[styles.toggleBtn, outputMode === 'result' && styles.toggleBtnActive]}>
                <Text style={[styles.toggleText, outputMode === 'result' && styles.toggleTextActive]}>Result</Text>
              </Pressable>
            </View>
            <Pressable onPress={handleOpenCalculator} style={styles.openCalcBtn}>
              <Text style={styles.openCalcText}>Open Calculator</Text>
            </Pressable>
            <View style={styles.buttonRow}>
              <Pressable onPress={close} style={[styles.actionBtn, styles.secondaryBtn]}>
                <Text style={styles.secondaryText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={handleInsert}
                disabled={inserting || !preview}
                style={[styles.actionBtn, styles.primaryBtn, (inserting || !preview) && styles.disabledBtn]}>
                <Text style={styles.primaryText}>{inserting ? 'Inserting...' : 'Insert'}</Text>
              </Pressable>
            </View>
          </View>
        )}
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  overlay: {flex: 1, backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center'},
  panel: {width: 420, backgroundColor: '#FFFFFF', borderRadius: 10, borderWidth: 1.5, borderColor: '#000000'},
  title: {fontSize: 18, fontWeight: 'bold', paddingHorizontal: 16, paddingVertical: 10, textAlign: 'center'},
  divider: {height: 1, backgroundColor: '#000000'},
  statusText: {fontSize: 16, padding: 18, textAlign: 'center', color: '#111111'},
  body: {padding: 16},
  errorText: {fontSize: 14, marginBottom: 10, textAlign: 'center', color: '#111111'},
  label: {fontSize: 12, fontWeight: 'bold', color: '#333333', marginBottom: 6},
  input: {minHeight: 74, borderWidth: 1, borderColor: '#777777', borderRadius: 6, padding: 10, fontSize: 20, color: '#000000', textAlignVertical: 'top'},
  previewBox: {marginTop: 12, padding: 10, borderRadius: 6, backgroundColor: '#F2F2F2', borderWidth: 1, borderColor: '#DDDDDD'},
  previewLabel: {fontSize: 11, fontWeight: 'bold', color: '#555555', marginBottom: 4},
  previewText: {fontSize: 17, fontWeight: '600', color: '#000000'},
  toggleRow: {flexDirection: 'row', marginTop: 12},
  toggleBtn: {flex: 1, padding: 8, borderWidth: 1, borderColor: '#000000', alignItems: 'center'},
  toggleBtnActive: {backgroundColor: '#000000'},
  toggleText: {fontSize: 13, fontWeight: 'bold', color: '#000000'},
  toggleTextActive: {color: '#FFFFFF'},
  openCalcBtn: {marginTop: 10, padding: 10, borderRadius: 6, borderWidth: 1.5, borderColor: '#000000', alignItems: 'center', backgroundColor: '#FFFFFF'},
  openCalcText: {fontSize: 15, fontWeight: 'bold', color: '#000000'},
  buttonRow: {flexDirection: 'row', marginTop: 14},
  actionBtn: {flex: 1, padding: 11, borderRadius: 6, alignItems: 'center', borderWidth: 1.5},
  secondaryBtn: {backgroundColor: '#FFFFFF', borderColor: '#000000', marginRight: 8},
  primaryBtn: {backgroundColor: '#000000', borderColor: '#000000', marginLeft: 8},
  disabledBtn: {backgroundColor: '#999999', borderColor: '#999999'},
  secondaryText: {fontSize: 15, fontWeight: 'bold', color: '#000000'},
  primaryText: {fontSize: 15, fontWeight: 'bold', color: '#FFFFFF'},
});
