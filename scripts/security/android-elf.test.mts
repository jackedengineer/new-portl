import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inspectAndroidElf } from './android-elf.mts';

type Segment = {
  type: number;
  address: number;
  size: number;
  flags?: number;
  alignment?: number;
  offset?: number;
};
function elf(segments: Segment[]) {
  const bytes = Buffer.alloc(4096);
  bytes.write('7f454c46020101', 0, 'hex');
  bytes.writeUInt16LE(183, 18);
  bytes.writeBigUInt64LE(64n, 32);
  bytes.writeUInt16LE(56, 54);
  bytes.writeUInt16LE(segments.length, 56);
  segments.forEach((segment, index) => {
    const position = 64 + index * 56;
    bytes.writeUInt32LE(segment.type, position);
    bytes.writeUInt32LE(segment.flags ?? 6, position + 4);
    bytes.writeBigUInt64LE(
      BigInt(segment.offset ?? segment.address % 16384),
      position + 8,
    );
    bytes.writeBigUInt64LE(BigInt(segment.address), position + 16);
    bytes.writeBigUInt64LE(BigInt(segment.size), position + 40);
    bytes.writeBigUInt64LE(BigInt(segment.alignment ?? 16384), position + 48);
  });
  return bytes;
}
const load = { type: 1, address: 0x4000, size: 0x1000 };
const relro = { type: 0x6474e552, address: 0x4000, size: 0x1000 };

test('accepts a non-aligned RELRO end when padding separates writable data', () => {
  const result = inspectAndroidElf(
    elf([load, relro, { type: 1, address: 0x8000, size: 0x1000 }]),
  );
  assert.equal(result.relroEndsAligned, false);
  assert.equal(result.writableRelroOverlap, false);
});
test('rejects the RELRO collision even when every LOAD is 16 KB aligned', () => {
  assert.throws(
    () => inspectAndroidElf(elf([{ ...load, size: 0x2000 }, relro])),
    /overlaps writable/,
  );
});
test('rejects rounding down over writable data before RELRO', () => {
  assert.throws(
    () =>
      inspectAndroidElf(
        elf([load, { ...relro, address: 0x4800, size: 0x800 }]),
      ),
    /overlaps writable/,
  );
});
test('accepts an exactly aligned RELRO boundary with adjacent writable data', () => {
  assert.equal(
    inspectAndroidElf(
      elf([
        { ...load, size: 0x4000 },
        { ...relro, size: 0x4000 },
        { type: 1, address: 0x8000, size: 0x1000 },
      ]),
    ).relroEndsAligned,
    true,
  );
});
test('accepts a library without RELRO', () => {
  assert.equal(inspectAndroidElf(elf([load])).relroSegments, 0);
});
test('rejects a 4 KB LOAD', () => {
  assert.throws(
    () => inspectAndroidElf(elf([{ ...load, alignment: 4096 }])),
    /LOAD alignment/,
  );
});
test('rejects a non-power-of-two LOAD alignment', () => {
  assert.throws(
    () => inspectAndroidElf(elf([{ ...load, alignment: 24576 }])),
    /LOAD alignment/,
  );
});
test('rejects incongruent LOAD file and virtual offsets', () => {
  assert.throws(
    () => inspectAndroidElf(elf([{ ...load, offset: 128 }])),
    /not congruent/,
  );
});
test('rejects truncated, wrong-class and missing program headers', () => {
  assert.throws(() => inspectAndroidElf(Buffer.alloc(10)), /Truncated/);
  const bytes = elf([load]);
  bytes[4] = 1;
  assert.throws(() => inspectAndroidElf(bytes), /ELF64/);
  assert.throws(() => inspectAndroidElf(elf([])), /program header/);
});
