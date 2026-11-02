/** One window's layout commands finish in order; rejection does not poison the queue. */
export function createLayoutQueue(): (operation: () => Promise<void>) => Promise<void> {
  let pending = Promise.resolve();
  return (operation) => {
    const result = pending.then(operation);
    pending = result.catch(() => {});
    return result;
  };
}
