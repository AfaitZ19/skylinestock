const test = require('node:test');
const assert = require('node:assert');
const { pickLabelScan } = require('../label-photo.js');

const r = (...texts) => texts.map(text => ({ text }));

test('single DataMatrix (#1) → that text', () => {
  const t = '(01)06958949905648(11)231206(10)BY-C2312PMI009';
  assert.deepStrictEqual(pickLabelScan(r(t)), [t]);
});

test('Philips (#3): REF and LOT Code128 ignored, DataMatrix chosen', () => {
  assert.deepStrictEqual(pickLabelScan(r('1094051', '0303238576', '(01)00606959006829(10)0303238576')),
    ['(01)00606959006829(10)0303238576']);
});

test('same GTIN twice: the string with more fields wins', () => {
  assert.deepStrictEqual(pickLabelScan(r('606959006829', '(01)00606959006829(10)0303238576')),
    ['(01)00606959006829(10)0303238576']);
});

test('iX Auto box (#6): one choice per product', () => {
  const t = ['(01)04719893347081(10)0124010178(21)00004', '(01)04713025000400(10)0124010179(21)00004', '(01)04713025000226(10)0124010180(21)00004'];
  assert.deepStrictEqual(pickLabelScan(r(...t)), t);
});

test('no GTIN anywhere → distinct raw texts', () => {
  assert.deepStrictEqual(pickLabelScan(r('1094051', '1094051', 'ABC')), ['1094051', 'ABC']);
});

test('nothing found → empty', () => {
  assert.deepStrictEqual(pickLabelScan([]), []);
});
