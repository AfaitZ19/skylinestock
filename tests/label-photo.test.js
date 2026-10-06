const test = require('node:test');
const assert = require('node:assert');
const { pickLabelScan } = require('../label-photo.js');
const { gs1Decode } = require('../gs1.js');

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

test('two-line GS1-128: the GTIN-less companion symbol is merged in', () => {
  const [t] = pickLabelScan(r('(01)04719893347999(11)260520', '(17)310520(10)0126050125', '1094051'));
  const g = gs1Decode(t);
  assert.deepStrictEqual([g.gtin, g.mfgDate, g.expiry, g.lot], ['4719893347999', '2026-05-20', '2031-05-20', '0126050125']);
});

test('companion values never override the GTIN symbol', () => {
  const [t] = pickLabelScan(r('(01)04719893347999(10)0126050125', '(10)9999999999'));
  assert.strictEqual(gs1Decode(t).lot, '0126050125');
});

test('companion is not merged when the label has several products', () => {
  const t = ['(01)04719893347081(10)0124010178', '(01)04713025000400(10)0124010179'];
  assert.deepStrictEqual(pickLabelScan(r(...t, '(17)310520')), t);
});

test('no GTIN anywhere → distinct raw texts', () => {
  assert.deepStrictEqual(pickLabelScan(r('1094051', '1094051', 'ABC')), ['1094051', 'ABC']);
});

test('nothing found → empty', () => {
  assert.deepStrictEqual(pickLabelScan([]), []);
});
