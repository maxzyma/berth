/** Offer the optional layout once when the extension first activates. */
export function createLayoutIntroduction(host: {
  eligible(): boolean;
  seen(): boolean;
  remember(): PromiseLike<void>;
  show(): PromiseLike<string | undefined>;
  create(): PromiseLike<unknown>;
}): () => Promise<void> {
  let offered = false;
  return async () => {
    if (offered || !host.eligible() || host.seen()) return;
    offered = true;
    const choice = await host.show();
    if (choice !== 'Use Berth Layout' && choice !== 'Keep Current Layout') return;
    if (choice === 'Use Berth Layout') {
      await host.create();
      return;
    }
    try {
      await host.remember();
    } catch (error) {
      offered = false;
      throw error;
    }
  };
}
