/** Geometry is separate from pointer/focus ownership and content rendering. */
export interface Rect { left: number; right: number; top: number; bottom: number }
export interface Point { x: number; y: number }
export const EDGE = 8;
export const SEPARATION = 10;

export function horizontalPosition(column: number, viewportWidth: number): { left: number; width: number } {
  const left = Math.max(EDGE, Math.min(column + 16, viewportWidth - 200 - EDGE));
  return { left, width: Math.max(0, Math.min(360, viewportWidth - left - EDGE)) };
}

export function verticalPosition(anchor: Rect, height: number, viewportHeight: number): {
  top: number; maxHeight: number; side: 'above' | 'below' | 'overlay';
} {
  const below = Math.max(0, viewportHeight - anchor.bottom - SEPARATION - EDGE);
  const above = Math.max(0, anchor.top - SEPARATION - EDGE);
  if (Math.max(below, above) < 120 && height > Math.max(below, above)) {
    return { top: EDGE, maxHeight: Math.max(0, viewportHeight - EDGE * 2), side: 'overlay' };
  }
  const side = height <= below || (height > above && below >= above) ? 'below' : 'above';
  const maxHeight = side === 'below' ? below : above;
  const top = side === 'below' ? anchor.bottom + SEPARATION : anchor.top - SEPARATION - Math.min(height, maxHeight);
  return { top: Math.max(EDGE, top), maxHeight, side };
}

export function inside(point: Point, rect: Rect): boolean {
  return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
}

/** A narrow transition corridor, not an overlay that intercepts other rows. */
export function inBridge(point: Point, anchor: Rect, popup: Rect): boolean {
  const top = popup.top >= anchor.bottom ? anchor.bottom : popup.bottom;
  const bottom = popup.top >= anchor.bottom ? popup.top : anchor.top;
  return bottom >= top && inside(point, {
    left: Math.min(anchor.left, popup.left), right: Math.max(anchor.right, popup.right), top, bottom,
  });
}
