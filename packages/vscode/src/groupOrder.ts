/** Folder group order the user saved per workspace (spec §6). Pure, so it is unit-testable. */

/**
 * Groups in the saved order follow it; any other group keeps its default
 * position after the group that precedes it by default (spec §6).
 */
export function applyGroupOrder<T extends { cwd: string }>(defaults: readonly T[], saved: readonly string[]): T[] {
  const byCwd = new Map(defaults.map((group) => [group.cwd, group]));
  return mergeOrder([...byCwd.keys()], saved).map((cwd) => byCwd.get(cwd)!);
}

/** The saved order after moving `cwd` before or after `target` in the shown order. */
export function moveGroup(shown: readonly string[], saved: readonly string[], cwd: string, target: string, after: boolean): string[] {
  if (cwd === target || !shown.includes(cwd) || !shown.includes(target)) return [...saved];
  const rest = shown.filter((path) => path !== cwd);
  const at = rest.indexOf(target) + (after ? 1 : 0);
  return remember([...rest.slice(0, at), cwd, ...rest.slice(at)], saved);
}

/** The saved order after moving `cwd` one place up or down in the shown order. */
export function shiftGroup(shown: readonly string[], saved: readonly string[], cwd: string, delta: -1 | 1): string[] {
  const index = shown.indexOf(cwd);
  const target = shown[index + delta];
  return index < 0 || target === undefined ? [...saved] : moveGroup(shown, saved, cwd, target, delta > 0);
}

/** `items` in their default order, with every item also in `order` placed as it is there. */
function mergeOrder(items: readonly string[], order: readonly string[]): string[] {
  const present = new Set(items);
  const placed = [...new Set(order.filter((item) => present.has(item)))];
  const isPlaced = new Set(placed);
  // Unplaced items follow the placed item that precedes them by default.
  const runs = new Map<string | undefined, string[]>();
  let anchor: string | undefined;
  for (const item of items) {
    if (isPlaced.has(item)) anchor = item;
    else if (runs.has(anchor)) runs.get(anchor)!.push(item);
    else runs.set(anchor, [item]);
  }
  return [...(runs.get(undefined) ?? []), ...placed.flatMap((item) => [item, ...(runs.get(item) ?? [])])];
}

/** A new shown order, keeping saved groups that are absent where they were. */
function remember(shown: readonly string[], saved: readonly string[]): string[] {
  return mergeOrder([...new Set([...saved, ...shown])], shown);
}
