import { afterEach, expect, it, vi } from 'vitest';
const { query, end, erase, disconnect } = vi.hoisted(() => ({
  query: vi.fn(),
  end: vi.fn(),
  erase: vi.fn(),
  disconnect: vi.fn(),
}));
vi.mock('pg', () => ({
  default: {
    Pool: class {
      query = query;
      end = end;
    },
  },
}));
vi.mock('../src/database/client.js', () => ({
  createDatabase: () => ({ $disconnect: disconnect }),
}));
vi.mock('../src/account/restore.js', () => ({ restoreAccountErasures: erase }));
vi.mock('../src/account/ledger.js', () => ({ readLedger: () => [] }));
const originalArgv = process.argv;
afterEach(() => {
  process.argv = originalArgv;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
async function run(source: string, external = true) {
  vi.resetModules();
  vi.clearAllMocks();
  process.argv = ['node', 'account-restore', '--offline-restore', source];
  vi.stubEnv('DIRECT_DATABASE_URL', 'postgresql://business.test/db');
  vi.stubEnv(
    'ERASURE_LEDGER_OWNER_URL',
    external ? 'postgresql://ledger.test/db' : '',
  );
  vi.spyOn(console, 'log').mockImplementation(() => {});
  erase.mockResolvedValue(0);
  end.mockResolvedValue(undefined);
  disconnect.mockResolvedValue(undefined);
  return import('./account-restore.js');
}
it.each(['database', '/private/ledger'])(
  'blocks %s before business erasures when reconciliation is pending',
  async (source) => {
    query.mockResolvedValue({ rows: [{ blocked: true }] });
    await expect(run(source)).rejects.toThrow('reconciliation');
    expect(erase).not.toHaveBeenCalled();
    expect(end).toHaveBeenCalledOnce();
  },
);
it.each(['database', '/private/ledger'])(
  'blocks %s when the ledger gate is missing or unavailable',
  async (source) => {
    query.mockResolvedValue({ rows: [] });
    await expect(run(source)).rejects.toThrow('reconciliation');
    expect(erase).not.toHaveBeenCalled();
    query.mockRejectedValue(new Error('unavailable'));
    await expect(run(source)).rejects.toThrow('unavailable');
    expect(erase).not.toHaveBeenCalled();
  },
);
it.each(['database', '/private/ledger'])(
  'allows %s only after the owner clears reconciliation',
  async (source) => {
    query.mockResolvedValue({ rows: [{ blocked: false }] });
    await run(source);
    expect(erase).toHaveBeenCalledOnce();
  },
);
it('preserves standalone legacy file restoration without an independent-project configuration', async () => {
  await run('/private/ledger', false);
  expect(query).not.toHaveBeenCalled();
  expect(erase).toHaveBeenCalledOnce();
});
