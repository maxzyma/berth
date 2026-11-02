import type { FromView } from '../src/view/protocol.js';

/** Host clipboard acknowledgements; a denied or missing host response is not success. */
export class ClipboardBridge {
  private sequence = 0;
  private readonly pending = new Map<number, (success: boolean) => void>();

  constructor(private readonly post: (message: FromView) => void) {}

  write(value: string): Promise<void> {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.complete(id, false), 5000);
      this.pending.set(id, (success) => {
        clearTimeout(timer);
        if (success) resolve();
        else reject(new Error('Clipboard write failed'));
      });
      this.post({ type: 'copy', id, value });
    });
  }

  complete(id: number, success: boolean): void {
    const finish = this.pending.get(id);
    this.pending.delete(id);
    finish?.(success);
  }
}
