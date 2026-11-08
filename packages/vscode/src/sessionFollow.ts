/** Explorer reveal must return focus only to the terminal that requested it. */
export function createSessionFollower<T>(host: {
  current(): T | undefined;
  collapse(): PromiseLike<unknown>;
  reveal(target: string): PromiseLike<unknown>;
  focus(terminal: T): void;
}) {
  let revision = 0;
  return {
    cancel() { revision++; },
    async follow(target: string): Promise<void> {
      const requested = ++revision;
      const terminal = host.current();
      const current = () => requested === revision && terminal !== undefined && host.current() === terminal;
      await host.collapse();
      if (!current()) return;
      await host.reveal(target);
      if (current()) host.focus(terminal!);
    },
  };
}
