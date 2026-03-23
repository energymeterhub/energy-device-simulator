import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeValue, encodeValue } from '../src/core/register-codec.ts';

test('encode and decode float32 with CDAB order', () => {
  const registers = encodeValue({
    type: 'float32',
    value: 230.5,
    order: 'CDAB'
  });

  assert.equal(registers.length, 2);
  const decoded = decodeValue('float32', registers, 'CDAB');
  assert.ok(Math.abs(decoded - 230.5) < 0.0001);
});

test('encode and decode signed 32-bit values', () => {
  const registers = encodeValue({
    type: 'int32',
    value: -123456
  });

  assert.deepEqual(registers, [65534, 7616]);
  assert.equal(decodeValue('int32', registers), -123456);
});

test('reject unsupported byte order', () => {
  assert.throws(
    () =>
      encodeValue({
        type: 'float32',
        value: 10,
        order: 'AAAA'
      }),
    /Unsupported byte order/
  );
});
