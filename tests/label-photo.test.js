const test = require('node:test');
const assert = require('node:assert');
const { pickLabelScan, createReadGate } = require('../label-photo.js');
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

test('a read with a wrong GTIN check digit is dropped, the good read wins', () => {
  assert.deepStrictEqual(pickLabelScan(r('(01)04719893347998(10)0126050125', '(01)04719893347999(10)0126050125')),
    ['(01)04719893347999(10)0126050125']);
});

test('a read with an impossible date is dropped', () => {
  assert.deepStrictEqual(pickLabelScan(r('(01)04719893347999(11)261320(10)0126050125')), []);
});

const UDI = ['(01)04719893347999(11)260520(10)0126050125'];
const REF = ['1094051'];

test('read gate: a code is accepted only when a second frame agrees', () => {
  const gate = createReadGate({ repeatMs: 8000 });
  assert.strictEqual(gate.offer(UDI, 0).fire, false);
  assert.strictEqual(gate.offer(UDI, 300).fire, true);
});

test('read gate: frames without a code do not cancel a pending code (zoom frames alternate)', () => {
  const gate = createReadGate({ repeatMs: 8000 });
  gate.offer(UDI, 0);
  gate.offer([], 150);
  assert.strictEqual(gate.offer(UDI, 300).fire, true);
});

test('read gate: a second sighting too late starts over', () => {
  const gate = createReadGate({ repeatMs: 8000 });
  gate.offer(UDI, 0);
  assert.strictEqual(gate.offer(UDI, 2000).fire, false);
  assert.strictEqual(gate.offer(UDI, 2200).fire, true);
});

test('read gate: the same code is not offered again within repeatMs', () => {
  const gate = createReadGate({ repeatMs: 8000 });
  gate.offer(UDI, 0); gate.offer(UDI, 100);
  assert.strictEqual(gate.offer(UDI, 500).fire, false);
  assert.strictEqual(gate.offer(UDI, 600).fire, false);
  gate.offer(UDI, 9000);
  assert.strictEqual(gate.offer(UDI, 9100).fire, true);
});

test('read gate: a barcode without GTIN asks to aim at the UDI first, then is accepted if nothing better shows', () => {
  const gate = createReadGate({ repeatMs: 8000 });
  assert.deepStrictEqual(gate.offer(REF, 0), { fire: false, guide: true });
  assert.deepStrictEqual(gate.offer(REF, 1000), { fire: false, guide: true });
  assert.deepStrictEqual(gate.offer(REF, 2000), { fire: false, guide: true });
  assert.deepStrictEqual(gate.offer(REF, 2600), { fire: true, guide: false });
});

test('read gate: the UDI barcode wins as soon as it shows up after a REF', () => {
  const gate = createReadGate({ repeatMs: 8000 });
  gate.offer(REF, 0); gate.offer(REF, 500);
  gate.offer(UDI, 700);
  assert.deepStrictEqual(gate.offer(UDI, 900), { fire: true, guide: false });
});
