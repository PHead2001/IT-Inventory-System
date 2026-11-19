import assert from 'node:assert/strict';
import test from 'node:test';
import {
  legacyReceiveVersion,
  remainingReadinessMs,
} from '../helpers/overview-integration-contract';

test('receive versions become exact JSON numbers only within positive int32 bounds', () => {
  for (const [decimal, numeric] of [
    ['1', 1],
    ['2', 2],
    ['2147483647', 2147483647],
  ] as const) {
    assert.equal(legacyReceiveVersion(decimal), numeric);
    assert.equal(
      JSON.stringify({ expected_version: legacyReceiveVersion(decimal) }),
      JSON.stringify({ expected_version: numeric }),
    );
  }
});

test('receive conversion rejects noncanonical, unsafe, nonpositive and nonstring versions', () => {
  for (const value of [
    '0',
    '-1',
    '+1',
    '01',
    '1.0',
    '1e0',
    ' 1',
    '1 ',
    '',
    '2147483648',
    '9007199254740993',
    '9999999999999999999999999999999999999999',
    1,
    2147483647,
    null,
    undefined,
    NaN,
    Infinity,
  ])
    assert.throws(() => legacyReceiveVersion(value));
});

test('each readiness request receives only the remaining integer deadline', () => {
  assert.equal(remainingReadinessMs(2500, 500), 2000);
  assert.equal(remainingReadinessMs(2500, 1000), 1500);
  assert.equal(remainingReadinessMs(2500, 2498.25), 1);
  assert.ok(remainingReadinessMs(2500, 2498.25) <= 2500 - 2498.25);
});

test('readiness exhaustion, invalid clocks and accidental extended windows fail closed', () => {
  for (const [deadline, now] of [
    [2500, 2499.5],
    [2500, 2500],
    [2500, 2501],
    [2500, 499],
    [Infinity, 0],
    [2500, NaN],
    [NaN, 0],
  ])
    assert.throws(() => remainingReadinessMs(deadline!, now!));
});
