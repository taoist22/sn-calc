import {calculateInsertRect} from './insertPlacement';

describe('insert placement', () => {
  const base = {
    pageWidth: 1404,
    pageHeight: 1872,
    boxWidth: 240,
    boxHeight: 50,
    defaultLeft: 180,
    defaultTop: 1500,
    pageEdgeMargin: 40,
    anchorGap: 20,
  };

  test('places result output to the right of the lasso anchor', () => {
    expect(
      calculateInsertRect({
        ...base,
        anchorRect: {left: 200, top: 300, right: 320, bottom: 360},
        placementMode: 'right-of-anchor',
      }),
    ).toEqual({left: 340, top: 320, right: 580, bottom: 370});
  });

  test('keeps default anchored output below the lasso anchor', () => {
    expect(
      calculateInsertRect({
        ...base,
        anchorRect: {left: 200, top: 300, right: 320, bottom: 360},
      }),
    ).toEqual({left: 200, top: 380, right: 440, bottom: 430});
  });

  test('clamps right-of-anchor placement to page bounds', () => {
    expect(
      calculateInsertRect({
        ...base,
        anchorRect: {left: 1200, top: 1840, right: 1380, bottom: 1870},
        placementMode: 'right-of-anchor',
      }),
    ).toEqual({left: 1124, top: 1782, right: 1364, bottom: 1832});
  });
});
