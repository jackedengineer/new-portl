import assert from 'node:assert/strict';
import {
  constants,
  createHash,
  generateKeyPairSync,
  privateEncrypt,
  sign,
} from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { installedPackages } from './installed.mts';

type Ast = { type: string; value?: string; nodes?: Ast[]; parent?: Ast };
type Options = Record<string, unknown>;
interface Braces {
  (input: string | string[], options?: Options): string[];
  parse(input: string, options?: Options): Ast;
  compile(input: string | Ast, options?: Options): string;
  expand(input: string | Ast, options?: Options): string[];
  stringify(input: string | Ast, options?: Options): string;
}
interface Forge {
  pki: {
    publicKeyFromPem(pem: string): {
      verify(digest: string, signature: string, scheme?: unknown): boolean;
    };
  };
  md: { sha256: { create(): unknown } };
  mgf: { mgf1: { create(md: unknown): unknown } };
  pss: {
    create(options: { md: unknown; mgf: unknown; saltLength: number }): unknown;
  };
}

// Test-only keys; malformed DigestInfo is signed without bypassing padding checks.
const keys = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicExponent: 3,
});
const publicPem = keys.publicKey
  .export({ type: 'spki', format: 'pem' })
  .toString();
const message = Buffer.from('Portl dependency security regression');
const digest = createHash('sha256').update(message).digest();
const oid = Buffer.from('608648016503040201', 'hex');
const der = (tag: number, value: Buffer) => {
  const length =
    value.length < 128
      ? Buffer.from([value.length])
      : Buffer.from([0x81, value.length]);
  return Buffer.concat([Buffer.from([tag]), length, value]);
};
const sequence = (...values: Buffer[]) => der(0x30, Buffer.concat(values));
function signature(
  algorithm: Buffer,
  extraOuter?: Buffer,
  messageDigest = digest,
) {
  const info = sequence(
    algorithm,
    der(0x04, messageDigest),
    ...(extraOuter ? [extraOuter] : []),
  );
  return rawSignature(info);
}
function rawSignature(info: Buffer) {
  const encoded = Buffer.concat([
    Buffer.from([0, 1]),
    Buffer.alloc(256 - info.length - 3, 0xff),
    Buffer.from([0]),
    info,
  ]);
  return privateEncrypt(
    { key: keys.privateKey, padding: constants.RSA_NO_PADDING },
    encoded,
  ).toString('binary');
}
const tooDeep = (open: string, close: string) =>
  open.repeat(4900) + 'a' + close.repeat(4900);
function astAtDepth(depth: number): Ast {
  let node: Ast = { type: 'text', value: 'a' };
  for (let i = 0; i < depth; i++) {
    const parent: Ast = { type: 'root', nodes: [node] };
    node.parent = parent;
    node = parent;
  }
  return node;
}

for (const pkg of installedPackages()) {
  const require = createRequire(`${pkg.path}/package.json`);
  const label = `${pkg.name}@${pkg.version}`;
  if (pkg.name === 'node-forge') {
    const entries: [string, Forge][] = [['lib', require(pkg.path) as Forge]];
    for (const file of ['forge.min.js', 'forge.all.min.js']) {
      const window: { forge?: Forge } = {};
      // forge.all also registers legacy Flash/jQuery helpers, outside RSA scope.
      const events = {
        mousemove() {
          return this;
        },
        keypress() {
          return this;
        },
      };
      const jQuery = Object.assign(() => events, { fn: {} });
      runInNewContext(
        readFileSync(`${pkg.path}/dist/${file}`, 'utf8'),
        { window, jQuery, setTimeout, clearTimeout },
        { timeout: 5000 },
      );
      assert(window.forge);
      entries.push([file, window.forge]);
    }
    for (const [entry, forge] of entries) {
      const label = `${pkg.name}@${pkg.version}/${entry}`;
      const publicKey = forge.pki.publicKeyFromPem(publicPem);
      const malformed = {
        'extra element after NULL': sequence(
          der(0x06, oid),
          der(0x05, Buffer.alloc(0)),
          der(0x04, Buffer.from('garbage')),
        ),
        'extra element without NULL': sequence(
          der(0x06, oid),
          der(0x04, Buffer.from('garbage')),
        ),
        'duplicate NULL': sequence(
          der(0x06, oid),
          der(0x05, Buffer.alloc(0)),
          der(0x05, Buffer.alloc(0)),
        ),
        'nonempty NULL': sequence(
          der(0x06, oid),
          der(0x05, Buffer.from('garbage')),
        ),
        'noncanonical OID padding': sequence(
          der(
            0x06,
            Buffer.concat([
              oid.subarray(0, 1),
              Buffer.alloc(40, 0x80),
              oid.subarray(1),
            ]),
          ),
        ),
        'unterminated OID': sequence(
          der(0x06, Buffer.concat([oid, Buffer.from([0x81])])),
        ),
      };
      for (const [name, algorithm] of Object.entries(malformed)) {
        test(`${label} rejects ${name}`, () => {
          assert.throws(
            () =>
              publicKey.verify(digest.toString('binary'), signature(algorithm)),
            /DigestInfo|DigestAlgorithm/,
          );
        });
      }
      test(`${label} rejects extra outer DigestInfo elements`, () => {
        assert.throws(
          () =>
            publicKey.verify(
              digest.toString('binary'),
              signature(sequence(der(0x06, oid)), der(0x05, Buffer.alloc(0))),
            ),
          /DigestInfo/,
        );
      });
      for (const withNull of [false, true]) {
        test(`${label} accepts SHA256 with optional NULL=${withNull}`, () => {
          const algorithm = sequence(
            der(0x06, oid),
            ...(withNull ? [der(0x05, Buffer.alloc(0))] : []),
          );
          assert.equal(
            publicKey.verify(digest.toString('binary'), signature(algorithm)),
            true,
          );
        });
      }
      test(`${label} accepts standard Node signatures and rejects a different digest`, () => {
        const valid = sign('sha256', message, keys.privateKey).toString(
          'binary',
        );
        assert.equal(
          publicKey.verify(
            digest.toString('binary'),
            valid,
            'rsassa-pkcs1-v1_5',
          ),
          true,
        );
        assert.equal(
          publicKey.verify(
            createHash('sha256').update('different').digest('binary'),
            valid,
          ),
          false,
        );
      });
      test(`${label} preserves PSS verification`, () => {
        const valid = sign('sha256', message, {
          key: keys.privateKey,
          padding: constants.RSA_PKCS1_PSS_PADDING,
          saltLength: 32,
        });
        const scheme = forge.pss.create({
          md: forge.md.sha256.create(),
          mgf: forge.mgf.mgf1.create(forge.md.sha256.create()),
          saltLength: 32,
        });
        assert.equal(
          publicKey.verify(
            digest.toString('binary'),
            valid.toString('binary'),
            scheme,
          ),
          true,
        );
      });
      test(`${label} preserves NONE verification and mandatory MD5 parameters`, () => {
        assert.equal(
          publicKey.verify(
            digest.toString('binary'),
            rawSignature(digest),
            'NONE',
          ),
          true,
        );
        const md5 = createHash('md5').update(message).digest();
        const md5Oid = der(0x06, Buffer.from('2a864886f70d0205', 'hex'));
        assert.equal(
          publicKey.verify(
            md5.toString('binary'),
            signature(
              sequence(md5Oid, der(0x05, Buffer.alloc(0))),
              undefined,
              md5,
            ),
          ),
          true,
        );
        assert.throws(
          () =>
            publicKey.verify(
              md5.toString('binary'),
              signature(sequence(md5Oid), undefined, md5),
            ),
          /Missing algorithm identifier NULL/,
        );
      });
    }
  } else {
    const braces = require(pkg.path) as Braces;
    const nestingError = {
      name: 'RangeError',
      message: 'Nesting depth exceeds maximum of 100',
    };
    for (const method of ['parse', 'compile', 'expand', 'stringify'] as const) {
      for (const [name, input] of Object.entries({
        braces: tooDeep('{', '}'),
        parentheses: tooDeep('(', ')'),
        mixed: '{'.repeat(50) + tooDeep('(', ')') + '}'.repeat(50),
        unbalanced: '{'.repeat(4900),
      })) {
        test(`${label}.${method} bounds ${name} nesting`, () => {
          assert.throws(() => braces[method](input), nestingError);
        });
      }
    }
    for (const method of ['compile', 'expand', 'stringify'] as const) {
      test(`${label}.${method} bounds prebuilt ASTs and direct imports`, () => {
        assert.throws(() => braces[method](astAtDepth(15000)), nestingError);
        const direct = require(`${pkg.path}/lib/${method}.js`) as (
          ast: Ast,
        ) => unknown;
        assert.throws(() => direct(astAtDepth(15000)), nestingError);
      });
      test(`${label}.${method} rejects cyclic ASTs`, () => {
        const ast: Ast = { type: 'root', nodes: [] };
        ast.nodes!.push(ast);
        assert.throws(() => braces[method](ast), nestingError);
      });
    }
    test(`${label} preserves ordinary glob, range, escaping and quote behavior`, () => {
      assert.deepEqual(braces('src/{app,components}/**/*.{ts,tsx}'), [
        'src/(app|components)/**/*.(ts|tsx)',
      ]);
      assert.deepEqual(braces.expand('tower-{1..3}/{a,b}'), [
        'tower-1/a',
        'tower-1/b',
        'tower-2/a',
        'tower-2/b',
        'tower-3/a',
        'tower-3/b',
      ]);
      assert.equal(braces.compile('a/\\{literal\\}'), 'a/{literal}');
      assert.equal(
        braces.stringify('"' + '{'.repeat(101) + '"'),
        '{'.repeat(101),
      );
      assert.equal(
        braces.stringify('('.repeat(99) + 'a' + ')'.repeat(99)),
        '('.repeat(99) + 'a' + ')'.repeat(99),
      );
    });
    test(`${label} enforces the AST depth boundary without counting flat siblings`, () => {
      assert.equal(braces.compile(astAtDepth(100)), 'a');
      assert.throws(() => braces.compile(astAtDepth(101)), nestingError);
      assert.equal(
        braces.compile({
          type: 'root',
          nodes: Array.from({ length: 1000 }, () => ({
            type: 'text',
            value: 'a',
          })),
        }),
        'a'.repeat(1000),
      );
    });
    test(`${label} checks shared subtrees at every depth and cannot disable the cap`, () => {
      const shared = astAtDepth(60);
      const deep = astAtDepth(60);
      let end = deep;
      while (end.nodes) end = end.nodes[0]!;
      end.nodes = [shared];
      const ast: Ast = { type: 'root', nodes: [deep, shared] };
      for (const method of ['compile', 'expand', 'stringify'] as const) {
        assert.throws(
          () =>
            braces[method](ast, {
              rangeLimit: false,
              maxLength: Infinity,
              maxDepth: Infinity,
            }),
          nestingError,
        );
      }
    });
  }
}
