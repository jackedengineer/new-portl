/** Only useful work extends the idle window; ordinary empty polls do not. */
export function idleWorker(
  afterMs: number,
  close: () => Promise<void>,
  onError: (error: unknown) => void,
) {
  let lastActivity = Date.now(),
    active = 0,
    closing = false;
  function touch() {
    if (closing) return false;
    lastActivity = Date.now();
    return true;
  }
  const timer = setInterval(() => {
    if (closing || active || Date.now() - lastActivity < afterMs) return;
    closing = true;
    clearInterval(timer);
    void close().catch(onError);
  }, 1000);
  timer.unref();
  return {
    touch,
    async run<T>(work: () => Promise<T>) {
      active++;
      touch();
      try {
        return await work();
      } finally {
        active--;
        touch();
      }
    },
    stop: () => {
      closing = true;
      clearInterval(timer);
    },
  };
}
