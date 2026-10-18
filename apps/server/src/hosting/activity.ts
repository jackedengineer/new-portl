/** A post-commit hint only. PostgreSQL remains the durable source of work. */
export function signalWorker() {
  if (process.env.PORTL_MANAGED_WORKER !== '1' || !process.connected) return;
  try {
    process.send?.({ type: 'work' }, () => {});
  } catch {
    /* The supervisor's periodic drain recovers lost wake hints. */
  }
}
