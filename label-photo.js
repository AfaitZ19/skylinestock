// Photo scan: decode every barcode in one label photo, then feed the chosen GS1 string to processScannerText
const _labelGs1 = typeof gs1Decode === 'function' ? gs1Decode : require('./gs1.js').gs1Decode;
const LABEL_FORMATS = ['DataMatrix', 'Code128', 'EAN-13', 'UPC-A', 'QRCode'];

// One raw text per distinct GTIN (the one carrying most fields wins); without any GTIN, the distinct texts
function pickLabelScan(results) {
  const texts = [...new Set((results || []).map(x => String(x.text || '').trim()).filter(Boolean))];
  const byGtin = new Map();
  for (const text of texts) {
    const g = _labelGs1(text);
    if (!g.gtin) continue;
    const score = ['sn', 'lot', 'mfgDate', 'expiry'].filter(k => g[k]).length;
    const cur = byGtin.get(g.gtin);
    if (!cur || score > cur.score) byGtin.set(g.gtin, { text, score });
  }
  return byGtin.size ? [...byGtin.values()].map(x => x.text) : texts;
}

async function decodeLabelPhoto(file) {
  const opts = { tryHarder: true, maxNumberOfSymbols: 8, textMode: 'HRI', formats: LABEL_FORMATS };
  const found = await ZXingWASM.readBarcodes(file, opts);
  if (found.length) return found;
  // Compressed photos (~1100px, e.g. forwarded from LINE) need 2x for thin 1D bars; camera photos rarely get here
  const bmp = await createImageBitmap(file);
  const scale = Math.min(2, 3000 / Math.max(bmp.width, bmp.height));
  if (scale <= 1) return found;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return ZXingWASM.readBarcodes(ctx.getImageData(0, 0, canvas.width, canvas.height), opts);
}

function openLabelPhoto() {
  stopScannerOnly();
  const input = document.getElementById('labelPhotoI');
  input.value = '';
  input.click();
}

async function onLabelPhoto(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  const box = document.getElementById('labelPhotoChoices');
  box.innerHTML = '';
  try {
    const texts = pickLabelScan(await decodeLabelPhoto(file));
    if (!texts.length) {
      toast('ไม่พบบาร์โค้ดในรูป — ถ่ายใหม่ให้ใกล้และชัดขึ้น', 'warn');
      return;
    }
    if (texts.length === 1) {
      processScannerText(texts[0]);
      return;
    }
    box.innerHTML = '<div class="photo-pick-hd">ฉลากนี้มีหลายสินค้า เลือกรายการที่ต้องการ</div>' + texts.map((t, i) => {
      const g = _labelGs1(t);
      const p = g.gtin ? lookupProductByGtin(g.gtin) : null;
      const label = [(p && p.name) || g.gtin || t, g.sn && 'SN ' + g.sn, g.lot && 'LOT ' + g.lot].filter(Boolean).join(' · ');
      return `<button class="scan-btn alt photo-pick" data-i="${i}">${escapeHtml(label)}</button>`;
    }).join('');
    box.querySelectorAll('.photo-pick').forEach(b => {
      b.onclick = () => { box.innerHTML = ''; processScannerText(texts[Number(b.dataset.i)]); };
    });
  } catch (e) {
    toast('อ่านรูปไม่สำเร็จ: ' + e.message, 'err');
  }
}

if (typeof module !== 'undefined') module.exports = { pickLabelScan };
