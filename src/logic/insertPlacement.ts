export type InsertAnchorRect = {left: number; top: number; right: number; bottom: number};
export type InsertPlacementMode = 'default' | 'right-of-anchor';

type PlacementInput = {
  anchorRect?: InsertAnchorRect;
  placementMode?: InsertPlacementMode;
  pageWidth: number;
  pageHeight: number;
  boxWidth: number;
  boxHeight: number;
  defaultLeft: number;
  defaultTop: number;
  pageEdgeMargin: number;
  anchorGap: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function calculateInsertRect({
  anchorRect,
  placementMode = 'default',
  pageWidth,
  pageHeight,
  boxWidth,
  boxHeight,
  defaultLeft,
  defaultTop,
  pageEdgeMargin,
  anchorGap,
}: PlacementInput): InsertAnchorRect {
  const maxLeft = Math.max(pageEdgeMargin, pageWidth - pageEdgeMargin - boxWidth);
  const maxTop = Math.max(pageEdgeMargin, pageHeight - pageEdgeMargin - boxHeight);

  if (anchorRect && placementMode === 'right-of-anchor') {
    const preferredLeft = anchorRect.right + anchorGap;
    const anchorHeight = Math.max(0, anchorRect.bottom - anchorRect.top);
    const preferredTop = anchorRect.top + Math.round(anchorHeight / 3);
    return {
      left: clamp(preferredLeft, pageEdgeMargin, maxLeft),
      top: clamp(preferredTop, pageEdgeMargin, maxTop),
      right: clamp(preferredLeft, pageEdgeMargin, maxLeft) + boxWidth,
      bottom: clamp(preferredTop, pageEdgeMargin, maxTop) + boxHeight,
    };
  }

  if (anchorRect) {
    const preferredTop = anchorRect.bottom + anchorGap;
    return {
      left: clamp(anchorRect.left, pageEdgeMargin, maxLeft),
      top: clamp(preferredTop, pageEdgeMargin, maxTop),
      right: clamp(anchorRect.left, pageEdgeMargin, maxLeft) + boxWidth,
      bottom: clamp(preferredTop, pageEdgeMargin, maxTop) + boxHeight,
    };
  }

  return {
    left: clamp(defaultLeft, pageEdgeMargin, maxLeft),
    top: clamp(defaultTop, pageEdgeMargin, maxTop),
    right: clamp(defaultLeft, pageEdgeMargin, maxLeft) + boxWidth,
    bottom: clamp(defaultTop, pageEdgeMargin, maxTop) + boxHeight,
  };
}
