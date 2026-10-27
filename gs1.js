// GS1 element-string parsing shared by the scanner flows; loaded before app.js

const _GS1F = {
  '00':18,'01':14,'02':14,
  '11':6,'12':6,'13':6,'15':6,'16':6,'17':6,'18':6,'19':6,
  '20':2
};

const _GS1V = new Set(['10','21','22','30','37',
  '240','241','250','251','400','401','410','411','412','413','414','415','416',
  '420','421','422','7001','8002','8003','8004','8005','8006','8007','8008',
  '8010','8011','8012','8013','8020',
  
  
  '91','92','93','94','95','96','97','98','99']);


function gs1Decode(raw) {
  if (!raw) return _emptyGS1();

  
  let s = String(raw)
    .replace(/[^\x1D\x20-\x7E]/g, '')  
    .replace(/\s/g, '')
    .toUpperCase();

  // Plain retail barcodes (EAN/UPC/GTIN) are just digits. Do not let the
  // positional GS1 parser reinterpret their leading digits as AI codes.
  if (/^\d{8}$|^\d{12,14}$/.test(s)) {
    return {
      gtin: s.replace(/^0+/, ''),
      sn: '',
      lot: '',
      mfgDate: '',
      expiry: '',
      ref: ''
    };
  }

  const fields = {};

  if (/\(\d{2,4}\)/.test(s)) {

    const re = /\((\d{2,4})\)([^(\x1D]*)/g;
    let m;
    while ((m = re.exec(s)) !== null) {
      fields[m[1]] = m[2].replace(/\x1D/g, '').trim();
    }
  } else if (s.includes('\x1D') || _gs1StartsWithAi(s)) {
    // Positional parsing only for real GS1 element strings: a plain SN such as CAED3C02683
    // would otherwise be read as GTIN 683 (spec §8 frontend bug 1)
    _gs1Scan(s, fields);
  }

  return {
    gtin:    String(fields['01'] || fields['02'] || '').replace(/^0+/, ''),
    sn:      fields['21'] || fields['91'] || fields['92'] || '',
    lot:     _gs1NormLot(fields['10'] || ''),
    mfgDate: _gs1Fmt6(fields['11'] || ''),
    expiry:  _gs1Fmt6(fields['17'] || ''),
    ref:     fields['240'] || fields['241'] || '',
  };
}

function _gs1StartsWithAi(s) {
  return [4, 3, 2].some(n => {
    const c = s.substr(0, n);
    return _GS1F[c] !== undefined || _GS1V.has(c);
  });
}

function _emptyGS1() {
  return { gtin:'', sn:'', lot:'', mfgDate:'', expiry:'', ref:'' };
}


function _gs1Scan(s, out) {
  const GS = '\x1D';
  let i = 0;
  while (i < s.length) {
    if (s.charCodeAt(i) === 29) { i++; continue; }   

    
    let ai = null, fl = null;
    for (const n of [4, 3, 2]) {
      const c = s.substr(i, n);
      if (_GS1F[c] !== undefined) { ai = c; fl = _GS1F[c]; break; }
      if (_GS1V.has(c))           { ai = c; fl = -1;       break; }
    }
    if (!ai) { i++; continue; }
    i += ai.length;

    if (fl > 0) {

      out[ai] = s.substr(i, fl);
      i += fl;
    } else {

      const gsPos = s.indexOf(GS, i);
      if (gsPos !== -1) {
        
        out[ai] = s.substr(i, gsPos - i);
        i = gsPos;   
      } else {
        
        const end = _gs1VarEnd(s, i);
        out[ai] = s.substr(i, end - i);
        i = end;
      }
    }
  }
}


function _gs1VarEnd(s, from) {
  const MIN_VAL = 2;
  const NEXT = [
    
    
    
    { ai:'10', ok: a => /^[A-Z][A-Z0-9\-]/.test(a) },
    { ai:'11', ok: a => /^\d{6}/.test(a) },
    { ai:'17', ok: a => /^\d{6}/.test(a) },
    { ai:'21', ok: a => /^[A-Z][A-Z0-9\-]/.test(a) },
    
    
    { ai:'91', ok: a => /^[A-Z]/.test(a) },
    { ai:'92', ok: a => /^[A-Z]/.test(a) },
  ];
  for (let j = from + MIN_VAL; j < s.length - 1; j++) {
    for (const { ai, ok } of NEXT) {
      if (s.substr(j, ai.length) !== ai) continue;
      if (ok(s.substr(j + ai.length))) return j;
    }
  }
  return s.length;
}


function _gs1NormLot(lot) {
  if (!lot) return '';
  lot = String(lot).toUpperCase().replace(/\s/g,'');
  const idx = lot.indexOf('BY-');
  if (idx !== -1) {
    
    
    return lot.substring(idx).replace(/\dC(?:\.\d+){4,}.*$/, '').trim();
  }
  // Strip a long digit prefix only when a real LOT follows it; all-digit LOTs (Wellell/Apex/Philips) are the LOT
  return lot.replace(/^\d{10,}(?=[A-Z])/, '').replace(/C\.\d+(?:\.\d+)+/g,'').trim();
}

function _gs1Fmt6(s) {
  if (!s || !/^\d{6}$/.test(s)) return s || '';
  const day = s.slice(4,6);
  if (day === '00') return '20' + s.slice(0,2) + '-' + s.slice(2,4);  
  return '20' + s.slice(0,2) + '-' + s.slice(2,4) + '-' + day;
}


function normalizeLot(lot) { return _gs1NormLot(lot); }

// Same result as C# DateOnly.AddMonths (clamps to month end); previews the expiry the API stores on stock-in
function expiryFromShelfLife(mfgDate, months) {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(String(mfgDate || ''));
  const n = Number(months);
  if (!m || !Number.isInteger(n) || n <= 0) return '';
  const lastDay = (y, mo) => new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const y = +m[1], mo = +m[2];
  const d = m[3] ? +m[3] : lastDay(y, mo); // 'YYYY-MM' is sent as the month end (toIsoDate)
  const total = y * 12 + (mo - 1) + n;
  const ty = Math.floor(total / 12), tm = total % 12 + 1;
  return `${ty}-${String(tm).padStart(2, '0')}-${String(Math.min(d, lastDay(ty, tm))).padStart(2, '0')}`;
}

// GS1 mod-10 check digit. gs1Decode strips leading zeros, so pad back to GTIN-14 (zeros do not change the sum).
function isValidGtin(gtin) {
  const s = String(gtin || '');
  if (!/^\d{1,14}$/.test(s)) return false;
  const d = s.padStart(14, '0');
  let sum = 0;
  for (let i = 0; i < 13; i++) sum += Number(d[i]) * (i % 2 === 0 ? 3 : 1);
  return (10 - (sum % 10)) % 10 === Number(d[13]);
}

// GTIN-14 indicator digits 1-8 mark a carton of the same item (16958949938506 = carton of bag 6958949938509),
// so match on the item reference alone, without the indicator and check digit
function gtinItemKey(gtin) {
  const s = String(gtin || '').replace(/\s/g, '').toUpperCase();
  if (!/^\d{8,14}$/.test(s)) return s.replace(/^0+/, '');
  return s.padStart(14, '0').slice(1, 13);
}

// A date gs1Decode produced ('YYYY-MM-DD', or 'YYYY-MM' for day 00) that exists on the calendar
function isValidGs1Date(date) {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(String(date || ''));
  if (!m) return false;
  const y = +m[1], mo = +m[2], d = m[3] ? +m[3] : 1;
  return mo >= 1 && mo <= 12 && d >= 1 && d <= new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

if (typeof module !== 'undefined') module.exports = { gs1Decode, _gs1NormLot, normalizeLot, expiryFromShelfLife, isValidGtin, isValidGs1Date, gtinItemKey };
