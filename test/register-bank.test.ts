import assert from 'node:assert/strict';
import test from 'node:test';
import { RegisterBank } from '../src/core/register-bank.ts';

test('register bank loads typed entries and reads ranges', () => {
  const bank = new RegisterBank({
    input: {
      0: {
        type: 'float32',
        value: 230.1,
        order: 'CDAB'
      }
    },
    holding: {
      100: {
        type: 'uint16',
        value: 90,
        writable: true
      }
    }
  });

  assert.equal(bank.getEntryValue('input', 0).toFixed(1), '230.1');
  assert.deepEqual(bank.readRange('holding', 100, 1), [90]);
});

test('register bank writes only writable holding registers', () => {
  const bank = new RegisterBank({
    holding: {
      10: {
        type: 'uint16',
        value: 1,
        writable: true
      },
      11: {
        type: 'uint16',
        value: 2,
        writable: false
      }
    }
  });

  bank.writeRange(10, [55]);
  assert.equal(bank.getEntryValue('holding', 10), 55);

  assert.throws(() => bank.writeRange(11, [99]), /read-only/);
});

test('register bank supports forced raw writes for input registers', () => {
  const bank = new RegisterBank({
    input: {
      20: {
        type: 'uint16',
        value: 5
      }
    }
  });

  bank.setRawRegisters('input', 20, [42], { force: true });
  assert.equal(bank.getEntryValue('input', 20), 42);
});
