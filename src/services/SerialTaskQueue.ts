export class SerialTaskQueue {
  private readonly queue: (() => Promise<void>)[] = [];
  private running = false;

  public constructor(private readonly onIdle?: (queue: SerialTaskQueue) => void) {}

  public add<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push(async () => {
        try {
          const res = await task();
          resolve(res);
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      });
      void this.runNext();
    });
  }

  private async runNext(): Promise<void> {
    if (this.running || this.queue.length === 0) {
      return;
    }
    this.running = true;
    const task = this.queue.shift()!;
    try {
      await task();
    } catch {
      // Errors are handled inside the task wrapper
    } finally {
      this.running = false;
      if (this.queue.length > 0) {
        void this.runNext();
      } else {
        this.onIdle?.(this);
      }
    }
  }
}
