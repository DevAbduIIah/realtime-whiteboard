export function throttle<T extends (...args: Parameters<T>) => void>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let lastCall = 0;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let trailingArgs: Parameters<T> | null = null;

  return (...args: Parameters<T>) => {
    const now = Date.now();

    if (now - lastCall >= delay) {
      lastCall = now;
      trailingArgs = null;
      fn(...args);
      return;
    }

    trailingArgs = args;

    if (!timeoutId) {
      timeoutId = setTimeout(() => {
        lastCall = Date.now();
        timeoutId = null;
        if (trailingArgs) {
          fn(...(trailingArgs as Parameters<T>));
          trailingArgs = null;
        }
      }, delay - (now - lastCall));
    }
  };
}
