// The box a new text starts in when the text tool is clicked (not dragged): wide enough to type in, and limited by
// the page, so the text wraps onto the next line instead of running off to the right. Left-aligned text runs from
// the click to the page's right edge, right-aligned text from the left edge to the click, centred text is centred
// on the click; never narrower than a few words. Dragging with the text tool still sets the width by hand.
// (The same rule as textWrap.js in Quarc Reader and Quarc Notes.)

const MARGIN = 16; // kept free inside the page's edges (page px)
const MIN_EM = 8; // narrowest box, in font sizes

/** `x` is where the click is on the page (page px), `pageW` the page's width. Returns the box's left edge and width. */
export function newTextBox(x: number, align: 'left' | 'center' | 'right', pageW: number, fontSize: number): { x: number; boxW: number } {
  const min = MIN_EM * fontSize;
  if (align === 'center') {
    const half = Math.max(Math.min(x, pageW - x) - MARGIN, min / 2);
    return { x: Math.round(x - half), boxW: Math.round(2 * half) };
  }
  if (align === 'right') {
    const w = Math.max(x - MARGIN, min);
    return { x: Math.round(x - w), boxW: Math.round(w) };
  }
  return { x: Math.round(x), boxW: Math.round(Math.max(pageW - x - MARGIN, min)) };
}
