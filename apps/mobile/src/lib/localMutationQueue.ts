/** Serialize complete mutations, not just their database writes. */
export function createLocalMutationQueue() {
  let running = false;
  const pending: Array<() => void> = [];
  const advance = () => {
    const next = pending.shift();
    if (next) next();
    else running = false;
  };

  return function enqueue<T>(mutation: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const start = () => {
        running = true;
        try {
          // Run the first mutation eagerly so its existing optimistic state
          // remains observable. Queued mutations must not read state yet.
          mutation().then(
            (value) => {
              resolve(value);
              advance();
            },
            (error: unknown) => {
              reject(error);
              advance();
            },
          );
        } catch (error) {
          reject(error);
          advance();
        }
      };
      if (running) pending.push(start);
      else start();
    });
  };
}
