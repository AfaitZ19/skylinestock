// Barcode reading for the camera and photo scans (zxing-wasm): decode every barcode in a frame or photo,
// then feed the chosen GS1 string to processScannerText
const _gs1Lib = typeof gs1Decode === 'function' ? { gs1Decode, isValidGtin, isValidGs1Date } : require('./gs1.js');
const _labelGs1 = _gs1Lib.gs1Decode;

// A GTIN failing its check digit or a date that does not exist is a misread (blur, damage), not a real label
function _isPlausibleRead(g) {
  return (!g.gtin || _gs1Lib.isValidGtin(g.gtin)) && [g.mfgDate, g.expiry].every(d => !d || _gs1Lib.isValidGs1Date(d));
}
// Every symbology zxing reads except DXFilmEdge (film strips; it produced false reads on labels)
const LABEL_FORMATS = ['Aztec', 'Codabar', 'Code39', 'Code93', 'Code128', 'DataBar', 'DataBarExpanded', 'DataBarLimited',
  'DataMatrix', 'EAN-8', 'EAN-13', 'ITF', 'MaxiCode', 'PDF417', 'QRCode', 'MicroQRCode', 'rMQRCode', 'UPC-A', 'UPC-E'];
const LABEL_READ_OPTS = { tryHarder: true, maxNumberOfSymbols: 8, textMode: 'HRI', formats: LABEL_FORMATS };

const _labelDataKeys = ['sn', 'lot', 'mfgDate', 'expiry'];

// One raw text per distinct GTIN (the one carrying most fields wins); without any GTIN, the distinct texts
function pickLabelScan(results) {
  const texts = [...new Set((results || []).map(x => String(x.text || '').trim()).filter(Boolean))]
    .filter(t => _isPlausibleRead(_labelGs1(t)));
  const byGtin = new Map();
  for (const text of texts) {
    const g = _labelGs1(text);
    if (!g.gtin) continue;
    const score = _labelDataKeys.filter(k => g[k]).length;
    const cur = byGtin.get(g.gtin);
    if (!cur || score > cur.score) byGtin.set(g.gtin, { text, score });
  }
  if (!byGtin.size) return texts;
  const picked = [...byGtin.values()].map(x => x.text);
  // Two-line GS1-128 labels put (01) in one symbol and (17)/(10)/(21) in another; with one product, join them.
  // Companions go first so the GTIN symbol's own values win on a repeated AI.
  if (picked.length === 1 && picked[0].startsWith('(')) {
    const companions = texts.filter(t => {
      if (!t.startsWith('(')) return false;
      const g = _labelGs1(t);
      return !g.gtin && _labelDataKeys.some(k => g[k]);
    });
    return [companions.join('') + picked[0]];
  }
  return picked;
}

// One canvas for every read. iOS Safari caps total canvas memory (~384 MB) and frees dropped canvases late;
// a new canvas per camera frame or photo soon exhausts it, and from then on every canvas reads back blank.
const _labelCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
const LABEL_MAX_SIDE = 4096, LABEL_MAX_AREA = 16000000; // iOS refuses canvases above ~16.7 megapixels

function _fitScale(width, height, want) {
  return Math.min(want, LABEL_MAX_SIDE / Math.max(width, height), Math.sqrt(LABEL_MAX_AREA / (width * height)));
}

// crop {x, y, w, h} (source pixels) reads only that part of the source, scaled to width x height
function _readCanvas(source, width, height, crop) {
  const canvas = _labelCanvas;
  canvas.width = Math.round(width);
  canvas.height = Math.round(height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  if (crop) ctx.drawImage(source, crop.x, crop.y, crop.w, crop.h, 0, 0, canvas.width, canvas.height);
  else ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

// Beep + vibrate + green flash when a code is taken. iOS only plays sound after a tap, so the camera and photo
// buttons call unlockScanSound() first; iPhone has no web vibration.
let _scanAudio = null;
function unlockScanSound() {
  try {
    _scanAudio = _scanAudio || new (window.AudioContext || window.webkitAudioContext)();
    if (_scanAudio.state === 'suspended') void _scanAudio.resume();
  } catch (e) {
    _scanAudio = null; // no sound on this browser; vibration and the flash still work
  }
}

function scanFeedback(el) {
  try {
    if (_scanAudio) {
      const osc = _scanAudio.createOscillator(), gain = _scanAudio.createGain();
      osc.frequency.value = 1400;
      gain.gain.value = 0.12;
      osc.connect(gain);
      gain.connect(_scanAudio.destination);
      osc.start();
      osc.stop(_scanAudio.currentTime + 0.09);
    }
  } catch (e) {
    // sound is a nicety; never block a scan on it
  }
  if (navigator.vibrate) navigator.vibrate(60);
  if (el) {
    el.classList.remove('scan-ok');
    void el.offsetWidth; // restart the flash animation
    el.classList.add('scan-ok');
    setTimeout(() => el.classList.remove('scan-ok'), 450);
  }
}

function _releaseCanvas() {
  _labelCanvas.width = _labelCanvas.height = 1;
}

async function _readValid(input) {
  return (await ZXingWASM.readBarcodes(input, LABEL_READ_OPTS)).filter(r => r.isValid);
}

// The browser decodes the file (JPEG, PNG, WebP, AVIF, GIF, and HEIC on Safari), so any photo the phone or
// gallery gives works. Compressed photos (~1100px, e.g. forwarded from LINE) need 2x for thin 1D bars.
async function decodeLabelPhoto(file) {
  let bmp;
  try {
    bmp = await createImageBitmap(file);
  } catch (e) {
    return _readValid(file); // a format the browser cannot draw: let zxing's own decoder try
  }
  try {
    const first = _fitScale(bmp.width, bmp.height, 1);
    const found = await _readValid(_readCanvas(bmp, bmp.width * first, bmp.height * first));
    const second = _fitScale(bmp.width, bmp.height, 2);
    if (found.length || second <= first) return found;
    return _readValid(_readCanvas(bmp, bmp.width * second, bmp.height * second));
  } finally {
    bmp.close();
    _releaseCanvas();
  }
}

// Decides when the live camera hands a reading to the app. The same code must show in two frames within confirmMs
// (one blurred frame can misread), and is not handed over again within repeatMs. A code without a GTIN (a REF or
// other side barcode) only goes through after guideMs with nothing better in view; meanwhile `guide` asks the
// caller to show "aim at the UDI barcode".
function createReadGate({ repeatMs, confirmMs = 1500, guideMs = 2500 }) {
  let pendingKey = '', pendingAt = 0, firedKey = '', firedAt = -Infinity, guideSince = null;
  return {
    offer(texts, now) {
      if (!texts.length) return { fire: false, guide: false };
      const key = texts.join('|');
      const hasGtin = !!_labelGs1(texts[0]).gtin;
      if (hasGtin) guideSince = null;
      else if (guideSince === null) guideSince = now;
      const confirmed = key === pendingKey && now - pendingAt <= confirmMs;
      pendingKey = key;
      pendingAt = now;
      const fire = confirmed && (key !== firedKey || now - firedAt > repeatMs) && (hasGtin || now - guideSince >= guideMs);
      if (fire) {
        firedKey = key;
        firedAt = now;
        guideSince = null;
      }
      return { fire, guide: !hasGtin && !fire };
    }
  };
}

// Live camera: same engine as the photo scan, run on video frames (html5-qrcode could not read these labels).
// onTexts gets pickLabelScan's result once createReadGate lets it through.
async function startLiveBarcodeScan(container, onTexts, repeatMs) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false
  });
  const video = document.createElement('video');
  video.className = 'live-video';
  video.muted = true;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.srcObject = stream;

  // Drawn in video pixels over the picture: the aiming frame is the zoomed centre, the outline the code just read
  const svgNs = 'http://www.w3.org/2000/svg';
  const overlay = document.createElementNS(svgNs, 'svg');
  overlay.setAttribute('class', 'scan-overlay');
  overlay.setAttribute('preserveAspectRatio', 'none');
  const aim = document.createElementNS(svgNs, 'rect');
  aim.setAttribute('class', 'scan-aim');
  const outline = document.createElementNS(svgNs, 'polygon');
  outline.setAttribute('class', 'scan-hit');
  overlay.append(aim, outline);
  const hint = document.createElement('div');
  hint.className = 'scan-live-hint';
  hint.textContent = 'เจอบาร์โค้ดอื่น — เล็งไปที่บาร์โค้ด UDI ที่มีเลข (01)';
  hint.hidden = true;
  container.innerHTML = '';
  container.append(video, overlay, hint);

  let stopped = false, outlineTimer = null;
  const stop = () => {
    stopped = true;
    clearTimeout(outlineTimer);
    stream.getTracks().forEach(t => t.stop());
    container.innerHTML = '';
    _releaseCanvas();
  };
  try {
    await video.play();
  } catch (e) {
    stop();
    throw e;
  }

  const showOutline = (result, crop, scale) => {
    const p = result && result.position;
    if (!p) return;
    const pts = [p.topLeft, p.topRight, p.bottomRight, p.bottomLeft]
      .map(c => `${crop.x + c.x / scale},${crop.y + c.y / scale}`).join(' ');
    outline.setAttribute('points', pts);
    outline.classList.add('on');
    clearTimeout(outlineTimer);
    outlineTimer = setTimeout(() => outline.classList.remove('on'), 400);
  };

  const gate = createReadGate({ repeatMs });
  let frame = 0;
  const tick = async () => {
    if (stopped) return;
    const vw = video.videoWidth, vh = video.videoHeight;
    if (vw) {
      overlay.setAttribute('viewBox', `0 0 ${vw} ${vh}`);
      const centre = { x: vw / 4, y: vh / 4, w: vw / 2, h: vh / 2 };
      aim.setAttribute('x', centre.x);
      aim.setAttribute('y', centre.y);
      aim.setAttribute('width', centre.w);
      aim.setAttribute('height', centre.h);
      // Every other frame reads the centre half enlarged 2x, so small codes work from a normal distance
      const zoom = frame++ % 2 === 1;
      const crop = zoom ? centre : { x: 0, y: 0, w: vw, h: vh };
      const scale = _fitScale(crop.w, crop.h, zoom ? 2 : 1);
      try {
        const found = await _readValid(_readCanvas(video, crop.w * scale, crop.h * scale, crop));
        if (stopped) return;
        const texts = pickLabelScan(found);
        const { fire, guide } = gate.offer(texts, Date.now());
        hint.hidden = !guide;
        if (texts.length) showOutline(found.find(r => texts[0].includes(r.text)) || found[0], crop, scale);
        if (fire) {
          scanFeedback(container);
          onTexts(texts);
        }
      } catch (e) {
        // a frame that fails to decode is just skipped
      }
    }
    if (!stopped) setTimeout(tick, 80);
  };
  void tick();
  return { stop };
}

// Camera/photo reads: SCAN_FROM_IMAGE lets an unknown-barcode notice suggest aiming at the UDI barcode
function _processImageScan(text) {
  SCAN_FROM_IMAGE = true;
  try {
    processScannerText(text);
  } finally {
    SCAN_FROM_IMAGE = false;
  }
}

// One barcode goes straight to processScannerText; several products on one label show a picker
function handleScannedTexts(texts) {
  const box = document.getElementById('labelPhotoChoices');
  box.innerHTML = '';
  if (texts.length === 1) {
    _processImageScan(texts[0]);
    return;
  }
  stopScannerOnly();
  box.innerHTML = '<div class="photo-pick-hd">ฉลากนี้มีหลายสินค้า เลือกรายการที่ต้องการ</div>' + texts.map((t, i) => {
    const g = _labelGs1(t);
    const p = g.gtin ? lookupProductByGtin(g.gtin) : null;
    const label = [(p && p.name) || g.gtin || t, g.sn && 'SN ' + g.sn, g.lot && 'LOT ' + g.lot].filter(Boolean).join(' · ');
    return `<button class="scan-btn alt photo-pick" data-i="${i}">${escapeHtml(label)}</button>`;
  }).join('');
  box.querySelectorAll('.photo-pick').forEach(b => {
    b.onclick = () => { box.innerHTML = ''; _processImageScan(texts[Number(b.dataset.i)]); };
  });
}

function openLabelPhoto() {
  unlockScanSound();
  stopScannerOnly();
  const input = document.getElementById('labelPhotoI');
  input.value = '';
  input.click();
}

async function onLabelPhoto(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  document.getElementById('labelPhotoChoices').innerHTML = '';
  try {
    if (typeof ZXingWASM === 'undefined') {
      toast('โหลดตัวอ่านบาร์โค้ดไม่สำเร็จ — ตรวจอินเทอร์เน็ตแล้วลองใหม่', 'err');
      return;
    }
    toast('กำลังอ่านบาร์โค้ด...', 'ok');
    const texts = pickLabelScan(await decodeLabelPhoto(file));
    if (!texts.length) {
      toast('ไม่พบบาร์โค้ดในรูป — ถ่ายใหม่ให้ใกล้และชัดขึ้น', 'warn');
      return;
    }
    scanFeedback(null);
    handleScannedTexts(texts);
  } catch (e) {
    toast('อ่านรูปไม่สำเร็จ: ' + e.message, 'err');
  }
}

if (typeof module !== 'undefined') module.exports = { pickLabelScan, createReadGate };
