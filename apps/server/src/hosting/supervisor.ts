type Kind = 'api' | 'worker';
type Child = {
  on(event: 'message', listener: (message: unknown) => void): unknown;
  on(
    event: 'exit',
    listener: (code: number | null, signal: string | null) => void,
  ): unknown;
  on(event: 'error', listener: () => void): unknown;
  send(message: { type: 'wake' }): boolean;
  kill(signal: NodeJS.Signals): boolean;
};
type WorkerState = {
  child: Child;
  parking: boolean;
  parked: boolean;
  restart: boolean;
  drain?: ReturnType<typeof setTimeout>;
};
const common = ['NODE_ENV', 'HOST', 'PORT', 'LOG_LEVEL', 'TZ'];
const keys = {
  api: [
    'DATABASE_URL',
    'BETTER_AUTH_SECRET',
    'BETTER_AUTH_URL',
    'TRUSTED_ORIGINS',
    'RESEND_API_KEY',
    'EMAIL_FROM',
  ],
  worker: [
    'WORKER_DATABASE_URL',
    'BETTER_AUTH_SECRET',
    'ERASURE_LEDGER_DATABASE_URL',
    'EXPO_ACCESS_TOKEN',
  ],
};
/** Separate SQL roles and allowlisted environments; children share one OS instance. */
export function childEnvironment(kind: Kind, source: NodeJS.ProcessEnv) {
  const selected = Object.fromEntries(
    [...common, ...keys[kind]]
      .filter((key) => source[key] !== undefined)
      .map((key) => [key, source[key]]),
  );
  return {
    ...selected,
    ...(kind === 'api'
      ? { PORTL_MANAGED_WORKER: '1' }
      : { PORTL_WORKER_IDLE_MS: '90000' }),
  };
}
export function supervise(
  spawn: (kind: Kind) => Child,
  onExit: (code: number) => void,
) {
  let stopping = false,
    api: Child | undefined,
    worker: WorkerState | undefined;
  const live = new Set<Child>(),
    startup = new Map<Child, ReturnType<typeof setTimeout>>();
  let force: ReturnType<typeof setTimeout> | undefined;
  function stop(code = 0) {
    if (stopping) return;
    stopping = true;
    clearInterval(fallback);
    for (const timer of startup.values()) clearTimeout(timer);
    if (worker?.drain) clearTimeout(worker.drain);
    onExit(code);
    for (const child of live) child.kill('SIGTERM');
    if (live.size)
      force = setTimeout(() => {
        for (const child of live) child.kill('SIGKILL');
        onExit(1);
      }, 30000);
  }
  function register(kind: Kind) {
    const child = spawn(kind);
    live.add(child);
    startup.set(
      child,
      setTimeout(() => stop(1), 60000),
    );
    child.on('error', () => stop(1));
    child.on('exit', (code, signal) => {
      live.delete(child);
      clearTimeout(startup.get(child));
      startup.delete(child);
      if (!live.size && force) clearTimeout(force);
      if (stopping) return;
      if (
        kind === 'worker' &&
        worker?.child === child &&
        worker.parked &&
        code === 0 &&
        !signal
      ) {
        const again = worker.restart;
        if (worker.drain) clearTimeout(worker.drain);
        worker = undefined;
        if (again) wake();
      } else stop(1);
    });
    return child;
  }
  function startApi() {
    if (api || stopping) return;
    api = register('api');
    api.on('message', (message) => {
      if (
        typeof message !== 'object' ||
        message === null ||
        !('type' in message)
      )
        return;
      if (message.type === 'ready') clearTimeout(startup.get(api!));
      if (message.type === 'work') wake();
    });
  }
  function wake() {
    if (stopping) return;
    if (worker) {
      if (worker.parking) worker.restart = true;
      else {
        try {
          worker.child.send({ type: 'wake' });
        } catch {
          worker.restart = true;
        }
      }
      return;
    }
    const child = register('worker');
    const current: WorkerState = {
      child,
      parking: false,
      parked: false,
      restart: false,
    };
    worker = current;
    child.on('message', (message) => {
      if (
        typeof message !== 'object' ||
        message === null ||
        !('type' in message) ||
        stopping
      )
        return;
      if (message.type === 'ready') {
        clearTimeout(startup.get(child));
        startApi();
      }
      if (message.type === 'parking') {
        current.parking = true;
        current.drain = setTimeout(() => stop(1), 180000);
      }
      if (message.type === 'parked') current.parked = true;
      if (message.type === 'wake-required') current.restart = true;
    });
  }
  const fallback = setInterval(wake, 30 * 60000);
  fallback.unref();
  wake();
  return { wake, stop };
}
