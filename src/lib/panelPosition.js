// Pure geometry for positioning the Chanakya assistant panel relative to its
// floating button. Kept free of the DOM/React so it can be unit-tested.
//
// The panel is anchored by the edge NEAREST the button (bottom/right when the
// button sits at the bottom-right) so it grows *away* from the button and hugs
// it regardless of content height. Anchoring by top-left instead would push a
// short panel far from the button and leave a visible gap.

export const PANEL_MAX_WIDTH = 384;
export const BUTTON_SIZE = 56; // BW/BH
export const GAP = 12;
const EDGE = 8; // minimum distance kept from any viewport edge

/**
 * @param {{right:number, bottom:number}} btnPos  button offset from the viewport's right/bottom edges
 * @param {number} viewportWidth
 * @param {number} viewportHeight
 * @returns {object} an inline-style object (position:fixed) with exactly one of
 *          top/bottom and one of left/right set.
 */
export function computePanelStyle(btnPos, viewportWidth, viewportHeight) {
  const PW = Math.min(PANEL_MAX_WIDTH, viewportWidth - 32);
  const PH = Math.min(viewportHeight * 0.5, 520);
  const BS = BUTTON_SIZE;

  const btnL = viewportWidth - btnPos.right - BS;
  const btnT = viewportHeight - btnPos.bottom - BS;

  // Prefer opening upward when there is room above the button, else downward.
  const openUp = btnT >= PH + GAP || btnT >= viewportHeight - btnT - BS;
  // Open toward the left when the button sits close to the right edge.
  const openLeft = viewportWidth - btnL < PW + GAP;

  const style = {
    position: "fixed",
    width: PW,
    maxHeight: PH,
    zIndex: 50,
    display: "flex",
    flexDirection: "column",
  };

  // Vertical: anchor the edge next to the button so the panel hugs it.
  if (openUp) {
    style.bottom = Math.max(EDGE, btnPos.bottom + BS + GAP);
  } else {
    style.top = Math.max(EDGE, Math.min(viewportHeight - PH - EDGE, btnT + BS + GAP));
  }

  // Horizontal: align the panel's near edge with the button's.
  if (openLeft) {
    style.right = Math.max(EDGE, Math.min(viewportWidth - PW - EDGE, btnPos.right));
  } else {
    style.left = Math.max(EDGE, Math.min(viewportWidth - PW - EDGE, btnL));
  }

  return style;
}
