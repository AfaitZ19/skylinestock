const test = require('node:test');
const assert = require('node:assert');
const { gs1Decode, _gs1NormLot, expiryFromShelfLife } = require('../gs1.js');

const pick = (g, ...keys) => Object.fromEntries(keys.map(k => [k, g[k]]));

test('Wellell Wizard 310 (#15): 10-digit LOT is kept', () => {
  assert.deepStrictEqual(pick(gs1Decode('(01)04719893347999(11)260520(10)0126050125'), 'gtin', 'lot', 'mfgDate'),
    { gtin: '4719893347999', lot: '0126050125', mfgDate: '2026-05-20' });
});

test('Philips Wisp DataMatrix (#3): GTIN with leading zeros, 10-digit LOT', () => {
  assert.deepStrictEqual(pick(gs1Decode('(01)00606959006829(10)0303238576'), 'gtin', 'lot'),
    { gtin: '606959006829', lot: '0303238576' });
});

test('iX Auto (#6): LOT and SN both parsed', () => {
  assert.deepStrictEqual(pick(gs1Decode('(01)04719893347081(10)0124010178(21)00004'), 'gtin', 'lot', 'sn'),
    { gtin: '4719893347081', lot: '0124010178', sn: '00004' });
});

test('BYOND ResFree DataMatrix (#10): BY- LOT, SN, mfg date', () => {
  assert.deepStrictEqual(
    pick(gs1Decode('(01)16958949927319(11)260320(21)CEEC3C00423(10)BY-C2603R20i109(91)C.03.05.01.03.000002'), 'gtin', 'sn', 'lot', 'mfgDate'),
    { gtin: '16958949927319', sn: 'CEEC3C00423', lot: 'BY-C2603R20I109', mfgDate: '2026-03-20' });
});

test('GS1-128 without parentheses (#28) parses positionally', () => {
  assert.deepStrictEqual(pick(gs1Decode('01047168725068731125080810250808'), 'gtin', 'mfgDate', 'lot'),
    { gtin: '4716872506873', mfgDate: '2025-08-08', lot: '250808' });
});

test('plain EAN-13 is a GTIN only', () => {
  assert.deepStrictEqual(pick(gs1Decode('6958949978085'), 'gtin', 'lot'), { gtin: '6958949978085', lot: '' });
});

test('LOT normalizer: junk digit prefix before letters is still stripped (API parity)', () => {
  assert.strictEqual(_gs1NormLot('1234567890XT24A10088'), 'XT24A10088');
  assert.strictEqual(_gs1NormLot('10BY-NM6M260715'), 'BY-NM6M260715');
  assert.strictEqual(_gs1NormLot('0126050125'), '0126050125');
  assert.strictEqual(_gs1NormLot('123456789012'), '123456789012');
});

test('expiryFromShelfLife matches DateOnly.AddMonths', () => {
  assert.strictEqual(expiryFromShelfLife('2026-05-20', 60), '2031-05-20');
  assert.strictEqual(expiryFromShelfLife('2024-02-29', 12), '2025-02-28');
  assert.strictEqual(expiryFromShelfLife('2026-01', 24), '2028-01-31');
  assert.strictEqual(expiryFromShelfLife('', 60), '');
  assert.strictEqual(expiryFromShelfLife('2026-05-20', null), '');
});
