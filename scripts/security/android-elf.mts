import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const pageSize = 16384n;
const pageStart = (address: bigint) => (address / pageSize) * pageSize;
const pageEnd = (address: bigint) => pageStart(address + pageSize - 1n);
const overlaps = (a: bigint, b: bigint, c: bigint, d: bigint) =>
  a < b && c < d && a < d && c < b;

/** Static ELF layout check only; it cannot detect runtime PAGE_SIZE assumptions. */
export function inspectAndroidElf(bytes: Buffer) {
  assert.ok(bytes.length >= 64, 'Truncated ELF header');
  assert.equal(bytes.subarray(0, 4).toString('hex'), '7f454c46', 'Invalid ELF');
  assert.equal(bytes[4], 2, 'Expected ELF64');
  assert.equal(bytes[5], 1, 'Expected little-endian ELF');
  assert.ok(
    [62, 183].includes(bytes.readUInt16LE(18)),
    'Expected x86_64 or arm64',
  );
  const offset = bytes.readBigUInt64LE(32);
  const entrySize = bytes.readUInt16LE(54);
  const count = bytes.readUInt16LE(56);
  assert.ok(count > 0 && entrySize === 56, 'Invalid program header table');
  assert.ok(
    offset >= 64n && offset + BigInt(count * entrySize) <= BigInt(bytes.length),
    'Truncated program header table',
  );
  const segments = Array.from({ length: count }, (_, index) => {
    const position = Number(offset) + index * entrySize;
    return {
      type: bytes.readUInt32LE(position),
      flags: bytes.readUInt32LE(position + 4),
      offset: bytes.readBigUInt64LE(position + 8),
      address: bytes.readBigUInt64LE(position + 16),
      fileSize: bytes.readBigUInt64LE(position + 32),
      memorySize: bytes.readBigUInt64LE(position + 40),
      alignment: bytes.readBigUInt64LE(position + 48),
    };
  });
  const loads = segments.filter(({ type }) => type === 1);
  const relros = segments.filter(({ type }) => type === 0x6474e552);
  assert.ok(loads.length, 'No LOAD segments');
  for (const load of loads) {
    assert.ok(
      load.alignment >= pageSize &&
        (load.alignment & (load.alignment - 1n)) === 0n,
      'LOAD alignment must be a power of two >= 16 KB',
    );
    assert.equal(
      load.address % pageSize,
      load.offset % pageSize,
      'LOAD address/file offset are not congruent',
    );
    assert.ok(
      load.fileSize <= load.memorySize &&
        load.offset + load.fileSize <= BigInt(bytes.length),
      'Invalid LOAD size',
    );
  }
  // Bionic rounds both ends of RELRO to whole pages. A non-aligned end alone
  // is not proof of a collision: lld can leave an unused gap before writable
  // data. Check the actual ranges, including zero-filled writable data.
  // https://android.googlesource.com/platform/bionic/+/731631f300090436d7f5df80d50b6275c8c60a93/linker/linker_phdr.cpp
  for (const relro of relros) {
    const start = relro.address;
    const end = start + relro.memorySize;
    for (const load of loads.filter(({ flags }) => (flags & 2) !== 0)) {
      const loadEnd = load.address + load.memorySize;
      const beforeEnd = loadEnd < start ? loadEnd : start;
      const afterStart = load.address > end ? load.address : end;
      assert.ok(
        !overlaps(load.address, beforeEnd, pageStart(start), pageEnd(end)) &&
          !overlaps(afterStart, loadEnd, pageStart(start), pageEnd(end)),
        'RELRO page rounding overlaps writable LOAD data',
      );
    }
  }
  return {
    loadSegments: loads.length,
    relroSegments: relros.length,
    relroEndsAligned: relros.every(
      (segment) => (segment.address + segment.memorySize) % pageSize === 0n,
    ),
    writableRelroOverlap: false,
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const bundle = process.argv[2];
  assert.ok(
    bundle,
    'Usage: node scripts/security/android-elf.mts path/to/app.aab',
  );
  const archive = resolve(bundle);
  const entries = execFileSync('unzip', ['-Z1', archive], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter((name) => /^base\/lib\/(arm64-v8a|x86_64)\/[^/]+\.so$/.test(name));
  assert.ok(
    entries.some((name) => name.includes('/arm64-v8a/')),
    'No arm64 libraries found',
  );
  const results = entries.map((library) => {
    try {
      return {
        library,
        ...inspectAndroidElf(
          execFileSync('unzip', ['-p', archive, library], {
            maxBuffer: 128 * 1024 * 1024,
          }),
        ),
      };
    } catch (error) {
      throw new Error(`Native layout check failed: ${library}`, {
        cause: error,
      });
    }
  });
  console.log(
    JSON.stringify(
      { staticLayout: 'PASS', runtimeTested: false, libraries: results },
      null,
      2,
    ),
  );
}
