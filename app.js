// SkylineApi (spec §4.3, §8). Production by default; ?api=dev or ?api=local for testing
const API_ENVS = {
  local: 'https://localhost:5001/api',
  dev: 'https://api-dev.skylinemedical.co.th/api',
  prod: 'https://api.skylinemedical.co.th/api'
};
const API_ENV = API_ENVS[new URLSearchParams(location.search).get('api')] ? new URLSearchParams(location.search).get('api') : 'prod';
const API_BASE = API_ENVS[API_ENV];
let API_URL = API_BASE;
const OCR_URL = localStorage.getItem('skl_api') || ''; // label OCR stays in Apps Script (D5)
['skl_token', 'skl_user', 'skl_staff', 'skl_role'].forEach(k => localStorage.removeItem(k)); // old Apps Script session
let AUTH_TOKEN = localStorage.getItem('skl2_token') || '';
let REFRESH_TOKEN = localStorage.getItem('skl2_refresh') || '';
let CUR_USER = localStorage.getItem('skl2_user') || '', CUR_ROLE = localStorage.getItem('skl2_role') || 'stock', CUR_STAFF = localStorage.getItem('skl2_name') || '';
let MODE = 'in', LAST = null, scanner = null, scanOn = false, sflt = 'all';
let CACHE = { device:[], mask:[], accessory:[], history:[], products:[], monthlyOut:null, salesAlerts:[] };
let PRODUCT_LOOKUP = { byGtin:new Map(), byRef:new Map(), byCode:new Map() };
let ACTIVE_STOCK_CACHE = null;
let IS_PROCESSING = false;
let PENDING_SCAN = null;
let LAST_SCAN_TEXT = '';
let LAST_SCAN_TIME = 0;
const DUP_MS = 8000;
let HIST_OFFSET = 0;
const HIST_PAGE = 50;
let SELECTED_OUT_MONTH = currentMonthValue();
localStorage.removeItem('skl_last_out_recipient');
localStorage.removeItem('skl_last_out_purpose');
localStorage.removeItem('skl_last_out_purpose_other');
let SELECTED_NAME_PRODUCT_CODE = '';

let HID_ENABLED = false;
let hidBufferTimer = null;
let HID_BUFFER = '';
let HID_AUTO_RESUME = false;
let HID_LAST_TEXT = '';
let HID_LAST_TIME = 0;
const AUTO_SAVE_ON_SCAN_IN = true;
const AUTO_STOCK_OUT_ON_SCAN_OUT = false;
const DEFAULT_HOSPITAL_CHOICES = [
  'สถาบันการแพทย์จักรีนฤบดินทร์',
  'โรงพยาบาลบ้านแพ้ว (องค์การมหาชน)',
  'โรงพยาบาลศิริราช',
  'โรงพยาบาลศิริราชปิยมหาราชการุณย์',
  'โรงพยาบาลศิริราช Chest',
  'โรงพยาบาลธรรมศาสตร์',
  'โรงพยาบาลภูมิพล',
  'สถาบันโรคทรวงอก',
  'โรงพยาบาลรามาธิบดี',
  'โรงพยาบาลตากสิน',
  'สถาบันประสาทวิทยา',
  'โรงพยาบาลพระมงกุฎเกล้า',
  'โรงพยาบาลตำรวจ',
  'โรงพยาบาลวิชัยยุทธ',
  'โรงพยาบาลจุฬาลงกรณ์',
  'โรงพยาบาลบํารุงราษฎร์',
  'โรงพยาบาลเมดพาร์ค',
  'โรงพยาบาลมหาวิทยาลัยบูรพา',
  'โรงพยาบาลนวเวช',
  'โรงพยาบาลวชิระ',
  'โรงพยาบาลพระราม9',
  'โรงพยาบาลราชวิถี'
];
let _bgSyncTimer  = null;
let _lastSyncTime = 0;

window.onload = () => {
  const envHint = document.getElementById('apiEnvHint');
  if (envHint && API_ENV !== 'prod') envHint.textContent = 'API: ' + API_ENV + ' (' + API_BASE + ')';
  updateModeUI();
  setupHidScanner();
  setupManualScanner();
  resumeStoredSession();
};

async function resumeStoredSession() {
  if (!AUTH_TOKEN || !CUR_USER) return;
  applyRoleUi();
  showApp();
  setPill('busy');
  try {
    await loadMe();
    saveSession();
    await loadAll();
    _lastSyncTime = Date.now();
    enableHIDMode(true);
  } catch (e) {
    if (!handleAuthExpired(e)) {
      signOut();
      showSetupErr('เชื่อมต่อ API เดิมไม่สำเร็จ: ' + apiFriendlyError(e.message || e));
    }
  }
}

function getHidInput() {
  return document.getElementById('hidInput');
}

function focusHidInput() {
  if (!HID_ENABLED) return;
  const el = getHidInput();
  if (!el) return;
  try {
    el.focus();
    if (el.select) el.select();
  } catch (e) {}
}

function clearHidInput() {
  const el = getHidInput();
  if (el) el.value = '';
}

function focusScanInput(delay = 80) {
  setTimeout(() => {
    if (HID_ENABLED) {
      focusHidInput();
      return;
    }
    const el = document.getElementById('mc');
    if (!el) return;
    try {
      el.focus();
      el.select();
    } catch (e) {}
  }, delay);
}

function enableHIDMode(auto = false) {
  HID_ENABLED = true;
  const hidBtn = document.getElementById('hidToggleBtn');
  const manualBtn = document.getElementById('manualToggleBtn');
  if (hidBtn) {
    hidBtn.classList.add('on');
    hidBtn.textContent = 'เครื่องสแกนเปิด';
    hidBtn.title = 'เครื่องสแกนเปิดอยู่';
  }
  if (manualBtn) manualBtn.classList.remove('on');
  clearHidInput();
  focusScanInput(80);
  if (!auto) toast('เปิดเครื่องสแกนแล้ว', 'ok');
}

function disableHIDMode(updateButtons = true) {
  HID_ENABLED = false;
  HID_BUFFER = '';
  clearTimeout(hidBufferTimer);
  clearHidInput();
  if (updateButtons) {
    const hidBtn = document.getElementById('hidToggleBtn');
    const manualBtn = document.getElementById('manualToggleBtn');
    if (hidBtn) {
      hidBtn.classList.remove('on');
      hidBtn.textContent = 'ใช้เครื่องสแกน';
      hidBtn.title = 'คลิกเพื่อเปิดเครื่องสแกน';
    }
    if (manualBtn) manualBtn.classList.add('on');
  }
}

function tryAutoResumeHID() {
  const ae = document.activeElement;
  const tag = (ae?.tagName || '').toLowerCase();
  const isTypingField = ae && ae.id !== 'hidInput' && (tag === 'input' || tag === 'textarea');
  if (isTypingField) return;
  HID_AUTO_RESUME = false;
  enableHIDMode(true);
}

function toggleHIDMode() {
  if (HID_ENABLED) {
    HID_AUTO_RESUME = false;
    disableHIDMode(true);
    toast('ปิดเครื่องสแกนแล้ว', 'ok');
  } else {
    HID_AUTO_RESUME = false;
    enableHIDMode(true);
  }
}

function focusManualInput() {
  HID_AUTO_RESUME = false;
  disableHIDMode(true);
}

const THAI_KEDMANEE_TO_EN = {
  'ๅ':'1','/':'2','-':'3','ภ':'4','ถ':'5','ุ':'6','ึ':'7','ค':'8','ต':'9','จ':'0','ข':'-','ช':'=',
  'ๆ':'q','ไ':'w','ำ':'e','พ':'r','ะ':'t','ั':'y','ี':'u','ร':'i','น':'o','ย':'p','บ':'[','ล':']','ฃ':'\\',
  'ฟ':'a','ห':'s','ก':'d','ด':'f','เ':'g','้':'h','่':'j','า':'k','ส':'l','ว':';','ง':'\'',
  'ผ':'z','ป':'x','แ':'c','อ':'v','ิ':'b','ื':'n','ท':'m','ม':',','ใ':'.','ฝ':'/',
  '+':'!','๑':'@','๒':'#','๓':'$','๔':'%','ู':'^','฿':'&','๕':'*','๖':'(','๗':')','๘':'_','๙':'+',
  '๐':'Q','"':'W','ฎ':'E','ฑ':'R','ธ':'T','ํ':'Y','๊':'U','ณ':'I','ฯ':'O','ญ':'P','ฐ':'{',',':'}','ฅ':'|',
  'ฤ':'A','ฆ':'S','ฏ':'D','โ':'F','ฌ':'G','็':'H','๋':'J','ษ':'K','ศ':'L','ซ':':','.':'"',
  '(':'Z',')':'X','ฉ':'C','ฮ':'V','ฺ':'B','์':'N','?':'M','ฒ':'<','ฬ':'>','ฦ':'?'
};

function normalizeScannerLayout(text) {
  const s = String(text || '');
  if (!/[ก-๙]/.test(s)) return s;
  return s.replace(/[^\x1D]/g, ch => THAI_KEDMANEE_TO_EN[ch] || ch);
}


function processScannerText(text) {
  
  let code = normalizeScannerLayout(text).replace(/^[\s]+|[\s]+$/g, '');
  if (!code) return;

  

  const parsed = parseCode(code);
  if (!parsed || parsed.pending) return;

  
  
  const scannedItem = LAST;
  if (!scannedItem) return;

  if (MODE === 'in' && AUTO_SAVE_ON_SCAN_IN) {
    if (!scannedItem.p || !scannedItem.p.type) {
      toast('ยังระบุสินค้าไม่ได้ — เลือกประเภทหรือตรวจข้อมูลก่อนรับเข้า', 'warn');
      focusScanInput(120);
      return;
    }
    const type = scannedItem.p.type || document.getElementById('iType')?.value || '';
    const tracking = requiredTrackingValue(type);
    if (['device','mask','accessory'].includes(type) && !tracking.value) {
      toast(type === 'device' ? 'กรอกเลขเครื่อง (SN) ก่อนรับเข้า' : 'กรอกเลขล็อต (LOT) ก่อนรับเข้า', 'warn');
      const snLot = document.getElementById('snLotI');
      if (snLot) setTimeout(() => snLot.focus(), 80);
      return;
    }
    
    setTimeout(() => {
      if (LAST === scannedItem && !IS_PROCESSING) doAct('in');
    }, 120);
    return;
  }

}

function flushHidBuffer() {
  const el = getHidInput();
  submitHidCode(HID_BUFFER + (el ? el.value : ''));
  focusHidInput();
}

function submitHidCode(raw) {
  clearTimeout(hidBufferTimer);
  const code = String(raw || '').replace(/[\n\t]/g, '').trim();
  HID_BUFFER = '';
  clearHidInput();
  if (!code || code.replace(/\x1D/g,'').length < 4) return false;

  const key = code.replace(/\s/g, '').toUpperCase();
  const now = Date.now();
  if (key === HID_LAST_TEXT && (now - HID_LAST_TIME) < 250) {
    focusHidInput();
    return false;
  }
  HID_LAST_TEXT = key;
  HID_LAST_TIME = now;
  processScannerText(code);
  focusHidInput();
  return true;
}

function setupHidScanner() {
  const el = getHidInput();
  if (!el) return;

  el.addEventListener('keydown', (e) => {
    if (!HID_ENABLED) return;

    if (e.key === 'Enter' || e.key === '\n' || e.keyCode === 10 || e.key === 'Tab') {
      e.preventDefault();
      flushHidBuffer();
      return;
    }

    
    
    if (e.key === 'GS' || (e.ctrlKey && e.key === ']')) {
      e.preventDefault();
      HID_BUFFER += el.value + '\x1D';
      clearHidInput();
      return;
    }

  });

  el.addEventListener('input', () => {
    if (!HID_ENABLED) return;

    clearTimeout(hidBufferTimer);

    if (el.value.includes('\n') || el.value.includes('\t')) {
      submitHidCode(HID_BUFFER + el.value);
      return;
    }

    hidBufferTimer = setTimeout(() => {
      submitHidCode(HID_BUFFER + el.value);
    }, 800);
  });

  document.addEventListener('click', () => {
    if (HID_ENABLED) setTimeout(focusHidInput, 50);
  });

  document.addEventListener('focusin', (e) => {
    const t = e.target;
    if (!HID_ENABLED || !t || t.id === 'hidInput') return;
    if (t.id === 'mc') return;
    const tag = (t.tagName || '').toLowerCase();
    const isTypingField = tag === 'input' || tag === 'textarea';
    if (!isTypingField) return;
    HID_AUTO_RESUME = true;
    disableHIDMode(false);
    toast('พักเครื่องสแกนชั่วคราว เพื่อให้กรอกข้อมูลได้', 'warn');
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && HID_ENABLED) {
      setTimeout(focusHidInput, 150);
    }
  });
}

function setupManualScanner() {
  const el = document.getElementById('mc');
  if (!el) return;

  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== '\n' && e.keyCode !== 10 && e.key !== 'Tab') return;
    e.preventDefault();
    procM();
  });
}

async function doSetup() {
  const email = document.getElementById('setupUser').value.trim();
  const pass = document.getElementById('setupPass').value;
  const errEl = document.getElementById('setupErr');

  if (!email) { showSetupErr('กรุณากรอกอีเมล'); return; }
  if (!pass) { showSetupErr('กรุณากรอกรหัสผ่าน'); return; }

  setSetupLoading(true, 'กำลังเข้าสู่ระบบ...');
  try {
    errEl.style.display = 'none';

    // api/authorize/login is not wrapped in ApiResponse: object on success, ProblemDetails 400 on failure (§4.3)
    const r = await fetchWithTimeout(API_BASE + '/authorize/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: pass, rememberMe: !!document.getElementById('setupRemember')?.checked }),
      credentials: 'omit'
    });
    const login = await r.json().catch(() => null);
    if (!r.ok || !login || !login.token) {
      showSetupErr(problemMessage(login) || 'อีเมลหรือรหัสผ่านไม่ถูกต้อง');
      return;
    }

    AUTH_TOKEN = login.token;
    REFRESH_TOKEN = login.refreshToken || '';
    CUR_USER = email;
    CUR_STAFF = login.user?.fullName || email;
    setSetupLoading(true, 'กำลังตรวจสิทธิ์...');
    setPill('busy');
    await loadMe();
    saveSession();
    showApp();

    toast('เข้าสู่ระบบสำเร็จ', 'ok');
    setPill('ok');
    setSetupLoading(true, 'กำลังโหลดข้อมูล...');
    await loadAll();
    _lastSyncTime = Date.now();
    enableHIDMode(false);
  } catch(e) {
    showSetupErr('เชื่อมต่อ API ไม่สำเร็จ: ' + apiFriendlyError(e.message));
    setPill('err');
  } finally {
    setSetupLoading(false);
  }
}

function setSetupLoading(isLoading, msg = '') {
  const btn = document.getElementById('setupBtn');
  const st = document.getElementById('setupStatus');
  if (btn) {
    btn.disabled = !!isLoading;
    btn.textContent = isLoading ? 'กำลังโหลด...' : 'เชื่อมต่อระบบ';
  }
  if (st) {
    st.textContent = msg;
    st.classList.toggle('on', !!isLoading && !!msg);
  }
}

function signOut() {
  CUR_USER = '';
  AUTH_TOKEN = '';
  REFRESH_TOKEN = '';
  CUR_ROLE = 'stock';
  CUR_STAFF = '';
  STOCK_ME = null;
  LOOKUPS = null;
  LAST = null;
  PENDING_SCAN = null;
  HID_AUTO_RESUME = false;
  ['skl2_user', 'skl2_token', 'skl2_refresh', 'skl2_name', 'skl2_role'].forEach(k => localStorage.removeItem(k));
  document.body.classList.remove('admin', 'sales-scope');
  clearTimeout(_bgSyncTimer);
  _bgSyncTimer = null;
  stopScannerOnly();
  document.getElementById('scApp').classList.remove('on');
  document.getElementById('scSetup').classList.add('on');
  document.getElementById('setupPass').value = '';
  resetScan();
}

function showSetupErr(msg) {
  const errEl = document.getElementById('setupErr');
  errEl.textContent = msg;
  errEl.style.display = 'block';
}

function isAuthErrorMessage(msg) {
  return /Unauthorized|missing staff name|เซสชัน/i.test(String(msg || ''));
}

function handleAuthExpired(e) {
  const msg = e && e.message ? e.message : String(e || '');
  if (!isAuthErrorMessage(msg)) return false;
  signOut();
  showSetupErr('เซสชันหมดอายุหรือข้อมูลผู้ใช้ไม่ครบ กรุณาเข้าสู่ระบบใหม่');
  setPill('err');
  return true;
}

function apiFriendlyError(msg) {
  msg = String(msg || '');
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) {
    return 'เชื่อมต่อ ' + API_BASE + ' ไม่ได้ (ตรวจว่า API เปิดอยู่ และเปิดหน้านี้ผ่าน http://localhost ไม่ใช่ file://)';
  }
  return msg;
}

function apiHttpErrorMessage(status) {
  if (status === 404) return 'HTTP 404 - ไม่พบ API endpoint';
  if (status === 401 || status === 403) return 'HTTP ' + status + ' - ไม่มีสิทธิ์ใช้งานส่วนนี้';
  return 'HTTP ' + status;
}

/* ===================== SkylineApi adapter (spec §8, option A) =====================
   The UI still speaks the old Apps Script protocol: apiFetch/apiPost({ action, ... }) → { ok, ... } with
   sheet-shaped rows ('Product Name', 'Serial Number (SN)', _sheetRow ...). legacyCall() sends each action to
   the SkylineApi REST endpoint and maps the DTOs back, so the render code stays as it was. */

let STOCK_ME = null;   // E20
let LOOKUPS = null;    // E16
let _refreshing = null;

function saveSession() {
  localStorage.setItem('skl2_token', AUTH_TOKEN);
  localStorage.setItem('skl2_refresh', REFRESH_TOKEN);
  localStorage.setItem('skl2_user', CUR_USER);
  localStorage.setItem('skl2_name', CUR_STAFF);
  localStorage.setItem('skl2_role', CUR_ROLE);
}

function showApp() {
  document.getElementById('scSetup').classList.remove('on');
  document.getElementById('scApp').classList.add('on');
  document.getElementById('usrBadge').textContent = CUR_STAFF + (CUR_ROLE === 'admin' ? ' (admin)' : CUR_ROLE === 'sales' ? ' (เซลล์)' : '');
}

function applyRoleUi() {
  document.body.classList.toggle('admin', CUR_ROLE === 'admin');
  document.body.classList.toggle('sales-scope', CUR_ROLE === 'sales');
  const rn = document.getElementById('roleNote');
  if (rn) rn.textContent = CUR_ROLE === 'admin' ? 'Admin - ใช้งานเครื่องมือผู้ดูแลได้'
    : CUR_ROLE === 'sales' ? 'เซลล์ - ดูสต็อกและกรอกข้อมูลขายของตัวเอง'
    : 'Stock - รับเข้า จ่ายออก และนับสต็อกได้';
  if (CUR_ROLE === 'sales' && document.getElementById('t-scan')?.classList.contains('on')) goTab('stock');
}

// E20: which menus this user gets (user.roleName from login is only the first role)
async function loadMe() {
  const res = await rest('GET', '/stock/me');
  if (!res.success) throw new Error(res.message || 'ตรวจสิทธิ์ไม่สำเร็จ');
  STOCK_ME = res.data;
  CUR_STAFF = STOCK_ME.fullName || CUR_STAFF;
  CUR_ROLE = STOCK_ME.canAdmin ? 'admin' : STOCK_ME.canOperate ? 'stock' : 'sales';
  applyRoleUi();
  showApp();
}

function problemMessage(data) {
  if (!data) return '';
  if (data.errors && !Array.isArray(data.errors)) return Object.values(data.errors).flat().join(', '); // ValidationProblemDetails
  if (Array.isArray(data.errors) && data.errors.length && !data.message) return data.errors.join(', ');
  return data.detail || data.message || data.title || '';
}

async function refreshAccessToken() {
  if (!REFRESH_TOKEN) return false;
  if (!_refreshing) {
    _refreshing = (async () => {
      try {
        const r = await fetchWithTimeout(API_BASE + '/authorize/refresh-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: REFRESH_TOKEN }),
          credentials: 'omit'
        });
        const d = r.ok ? await r.json() : null;
        if (!d || !d.token) return false;
        AUTH_TOKEN = d.token;
        REFRESH_TOKEN = d.refreshToken || REFRESH_TOKEN;
        saveSession();
        return true;
      } catch { return false; }
      finally { setTimeout(() => { _refreshing = null; }, 0); }
    })();
  }
  return _refreshing;
}

// One REST call: Bearer token, one refresh on 401, ApiResponse / ProblemDetails both returned as { success, statusCode, message, data }
async function rest(method, path, body, opts = {}) {
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  const send = () => fetchWithTimeout(API_BASE + path, {
    method,
    headers: {
      ...(body !== undefined && !isForm ? { 'Content-Type': 'application/json' } : {}),
      ...(AUTH_TOKEN ? { Authorization: 'Bearer ' + AUTH_TOKEN } : {})
    },
    body: body === undefined ? undefined : (isForm ? body : JSON.stringify(body)),
    credentials: 'omit'
  }, opts.timeoutMs || 45000);

  let r = await send();
  if (r.status === 401 && await refreshAccessToken()) r = await send();
  if (r.status === 401) {
    handleAuthExpired(new Error('Unauthorized'));
    throw new Error('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
  }
  if (opts.raw) {
    if (!r.ok) throw new Error(apiHttpErrorMessage(r.status));
    return r;
  }
  const txt = await r.text();
  let data = null;
  try { data = txt ? JSON.parse(txt) : null; } catch { throw new Error('API ตอบกลับไม่ใช่ JSON (HTTP ' + r.status + ')'); }
  if (data && typeof data.success === 'boolean' && 'statusCode' in data) return data; // ApiResponse<T>
  if (r.ok) return { success: true, statusCode: r.status, data };
  return { success: false, statusCode: r.status, message: problemMessage(data) || apiHttpErrorMessage(r.status), data };
}

function fail(res) {
  return { ok: false, error: res.message || (res.errors || []).join(', ') || 'API error', statusCode: res.statusCode };
}

// Old call sites build a URL and pass it to apiFetch; now the "URL" is just the action object
function buildApiUrl(base, params = {}) { return { ...params }; }
async function apiFetch(params) { return legacyCall(params); }
async function apiPost(body) { return legacyCall(body); }

const pad2 = n => String(n).padStart(2, '0');
const TYPE_LABEL = { device: 'Device', mask: 'Mask', accessory: 'Accessory' };
const ACTION_LABEL = { IN: 'Stock In', OUT: 'Stock Out', STOCKTAKE: 'Stocktake' };
const PURPOSE_CODE = { 'ขาย': 'SALE', 'ของแถม': 'GIFT', 'เดโม': 'DEMO', 'อื่นๆ': 'OTHER' };

// API dates are Bangkok wall-clock strings ("2026-08-20T10:15:00", "2026-08-20"); never convert time zones
function isoParts(v) {
  const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
  return m ? { y: m[1], mo: m[2], d: m[3], h: m[4], mi: m[5] } : null;
}
function fmtDmy(v) { const p = isoParts(v); return p ? `${p.d}/${p.mo}/${p.y}` : ''; }
function fmtHm(v) { const p = isoParts(v); return p && p.h ? `${p.h}:${p.mi}` : ''; }
function fmtIsoDate(v) { const p = isoParts(v); return p ? `${p.y}-${p.mo}-${p.d}` : ''; }

// UI dates → DateOnly: yyyy-MM-dd, GS1 yyyy-MM (day 00 = end of month), dd/MM/yyyy (Buddhist year allowed)
function toIsoDate(v) {
  const s = String(v || '').trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return s;
  m = s.match(/^(\d{4})-(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${pad2(new Date(Number(m[1]), Number(m[2]), 0).getDate())}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    let y = Number(m[3]);
    if (y > 2400) y -= 543;
    return `${y}-${pad2(m[2])}-${pad2(m[1])}`;
  }
  return null;
}

function toMoney(v) {
  const s = String(v ?? '').replace(/[,฿\s]/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Stock/history rows need a numeric _sheetRow (the UI compares Number(_sheetRow)); map each API id to a stable number
const ROW_NO = new Map();
const ROW_REF = new Map();
let ROW_SEQ = 0;
function rowNo(kind, id, ref) {
  const key = kind + ':' + id;
  let n = ROW_NO.get(key);
  if (!n) { n = ++ROW_SEQ; ROW_NO.set(key, n); }
  ROW_REF.set(n, { ...(ROW_REF.get(n) || {}), kind, id, ...ref });
  return n;
}
function rowRef(n) { return ROW_REF.get(Number(n)) || null; }

function adaptProducts(list) {
  const out = [];
  (list || []).forEach(p => {
    const base = {
      id: p.id, gtin: '', sn_exact: '', sn_pfx: '', lot_pfx: '',
      name: p.stockDisplayName || p.productName, product_name: p.productName,
      stock_name: p.stockDisplayName || '', po_name: p.poPrintName || '', aliases: p.searchAliases || '',
      brand: p.brand, type: p.stockType, model: p.model || '', size: p.size || '', ref: p.ref || '',
      product_code: p.productCode, category: p.categoryName || '', has_barcode: (p.barcodes || []).length > 0,
      photoUrl: p.photoUrl || '', is_sizeless: !!p.isSizeless
    };
    const values = type => (p.barcodes || []).filter(b => b.matchType === type).map(b => b.value);
    const gtin = values('GTIN'), snExact = values('SN_EXACT'), snPrefix = values('SN_PREFIX'), lotPattern = values('LOT_PATTERN');
    // ProductDB had one row per barcode; keep that shape so the client-side lookup (§5.2) works unchanged
    const rows = Math.max(1, gtin.length, snExact.length, snPrefix.length, lotPattern.length);
    for (let i = 0; i < rows; i++) {
      out.push({ ...base, gtin: gtin[i] || '', sn_exact: snExact[i] || '', sn_pfx: snPrefix[i] || '', lot_pfx: lotPattern[i] || '' });
    }
  });
  return out;
}

function stockRowRef(it) {
  return { rowVersion: it.rowVersion, productId: it.stockProductId, type: it.stockType };
}

function adaptItem(it) {
  const common = {
    _sheetRow: rowNo(it.kind, it.id, stockRowRef(it)), _type: it.stockType, _id: it.id, _productId: it.stockProductId,
    'Date In': fmtDmy(it.receivedAt), 'Time': fmtHm(it.receivedAt), 'Product Name': it.productName, 'Status': 'Active',
    'Brand': it.brand, 'GTIN / Barcode': it.gtin || '', 'Mfg Date': fmtIsoDate(it.mfgDate), 'Expiry': fmtIsoDate(it.expiryDate), 'Note': ''
  };
  if (it.stockType === 'device') {
    return { ...common, 'Model': it.model || '', 'Serial Number (SN)': it.serialNumber || '', 'LOT Number': it.lotNumber || '',
      'Location / Hospital': it.location || '', 'Date Out': '', 'Recorded By': '' };
  }
  if (it.stockType === 'mask') {
    return { ...common, 'Model': it.model || '', 'Size': it.size || '', 'REF': it.ref || '', 'LOT Number': it.lotNumber || '', 'Qty': it.qty };
  }
  return { ...common, 'LOT Number': it.lotNumber || '', 'Qty': it.qty, 'Location': it.location || '' };
}

function serialLotText(sn, lot) {
  return sn ? 'SN: ' + sn : (lot ? 'LOT: ' + lot : '');
}

function adaptTx(t) {
  return {
    _sheetRow: rowNo('tx', t.id, {}), _txId: t.id, _canEdit: t.canEditSalesDetail,
    'Date': fmtDmy(t.occurredAt), 'Time': fmtHm(t.occurredAt), 'Type': TYPE_LABEL[t.stockType] || t.stockType,
    'Product Name': t.productName, 'Brand': t.brand, 'Serial / LOT': serialLotText(t.serialNumber, t.lotNumber),
    'Action': ACTION_LABEL[t.txType] || t.txType, 'Location / Recipient': t.recipientName || '',
    'Recorded By': t.operatorName || '', 'Operator': t.operatorName || '', 'Purpose': t.purposeLabel || '',
    'Qty': t.qty, 'Before Qty': t.beforeQty ?? '', 'After Qty': t.afterQty ?? '', 'Note': t.note || '',
    'Reference': t.ref || '', 'Model': t.model || '', 'Size': t.size || '',
    'Buyer Name': t.buyerName || '', 'Hospital': t.hospital || '', 'PO No': t.poNo || '',
    'Sale Date': fmtIsoDate(t.saleDate), 'Sale Price': t.salePrice ?? '', 'Wholesale Price': t.wholesalePrice ?? ''
  };
}

function adaptSalesAlert(a) {
  return {
    historyRow: rowNo('tx', a.transactionId, {}), kind: a.kind, message: a.message, ageDays: a.ageDays,
    date: fmtDmy(a.occurredAt), productName: a.productName, brand: a.brand, model: a.model || '', size: a.size || '',
    serialLot: serialLotText(a.serialNumber, a.lotNumber), recipient: a.recipientName || '',
    buyerName: a.buyerName || '', hospital: a.hospital || '', poNo: a.poNo || '',
    saleDate: fmtIsoDate(a.saleDate), salePrice: a.salePrice ?? '', wholesalePrice: a.wholesalePrice ?? ''
  };
}

const textKey = v => String(v || '').trim().replace(/\s+/g, ' ').toUpperCase();

// E16: recipient list replaces the hard-coded datalist; recipientUserId is sent when the typed name is a known user
async function ensureLookups() {
  if (LOOKUPS) return LOOKUPS;
  const res = await rest('GET', '/stock/lookups');
  if (!res.success) return null;
  LOOKUPS = res.data;
  const list = document.getElementById('recipientChoices');
  if (list) list.innerHTML = (LOOKUPS.recipients || []).map(r => `<option value="${escapeHtml(r.display)}"></option>`).join('');
  return LOOKUPS;
}

function recipientUserIdFor(name) {
  const key = textKey(name);
  const hit = (LOOKUPS?.recipients || []).find(r => textKey(r.display) === key);
  return hit ? hit.value : null;
}

// The server never guesses a product (§5.2): only a catalog row the user picked, or one unique name match
function resolveProductId(b) {
  const rows = (CACHE.products || []).filter(p => p.id);
  const code = textKey(b.productCode);
  if (code) {
    const byCode = [...new Set(rows.filter(p => textKey(p.product_code) === code).map(p => p.id))];
    if (byCode.length === 1) return byCode[0];
  }
  const fits = (want, have) => !textKey(want) || textKey(want) === textKey(have);
  const ids = [...new Set(rows.filter(p =>
    (!b.type || p.type === b.type) &&
    (textKey(b.name) === textKey(p.name) || textKey(b.name) === textKey(p.product_name)) &&
    fits(b.brand, p.brand) && fits(b.model, p.model) && fits(b.size, p.size)
  ).map(p => p.id))];
  return ids.length === 1 ? ids[0] : '';
}

// Keep rowVersion current after a write, so a second stock-out on the same lot does not get 409
async function refreshRowVersions(productId) {
  if (!productId) return;
  try {
    const res = await rest('GET', '/stock/items?productId=' + encodeURIComponent(productId));
    if (res.success) res.data.forEach(it => rowNo(it.kind, it.id, stockRowRef(it)));
  } catch { /* the next loadAll refreshes them anyway */ }
}

// Stock-out without a row id (cache patched before the background sync): find the exact row on the server
async function findStockRowForOut(b) {
  const key = b.type === 'device' ? b.sn : b.lot;
  if (!key) return null;
  const res = await rest('GET', `/stock/items?stockType=${encodeURIComponent(b.type || '')}&search=${encodeURIComponent(key)}`);
  if (!res.success) return null;
  const hits = res.data.filter(it => b.type === 'device'
    ? textKey(it.serialNumber) === textKey(b.sn)
    : _gs1NormLot(it.lotNumber || '') === _gs1NormLot(b.lot || '') && (!b.name || textKey(it.productName) === textKey(b.name)));
  if (hits.length !== 1) return null;
  rowNo(hits[0].kind, hits[0].id, stockRowRef(hits[0]));
  return rowRef(ROW_NO.get(hits[0].kind + ':' + hits[0].id));
}

function dataUrlToBlob(dataUrl) {
  const [head, b64] = String(dataUrl).split(',');
  const mime = (head.match(/data:([^;]+)/) || [])[1] || 'image/jpeg';
  const bin = atob(b64 || '');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

async function legacyCall(params) {
  const p = params || {};
  switch (p.action) {
    case 'ping':
      return { ok: true };

    case 'products': { // E1
      const res = await rest('GET', '/stock/products');
      return res.success ? { ok: true, products: adaptProducts(res.data) } : fail(res);
    }

    case 'stock': { // E7
      const res = await rest('GET', '/stock/items');
      if (!res.success) return fail(res);
      await ensureLookups();
      // number rows oldest first so the UI's "lowest _sheetRow first" FIFO ordering still holds
      [...res.data]
        .sort((a, b) => String(a.receivedAt).localeCompare(String(b.receivedAt)) || String(a.id).localeCompare(String(b.id)))
        .forEach(it => rowNo(it.kind, it.id, stockRowRef(it)));
      const rows = res.data.map(adaptItem);
      return {
        ok: true,
        device: rows.filter(r => r._type === 'device'),
        mask: rows.filter(r => r._type === 'mask'),
        accessory: rows.filter(r => r._type === 'accessory')
      };
    }

    case 'history': { // E11 (search/filter stays client-side like before)
      const n = Number(p.n || HIST_PAGE);
      const offset = Number(p.offset || 0);
      const pageSize = Math.min(200, n);
      const rows = [];
      let page = Math.floor(offset / pageSize) + 1;
      while (rows.length < n) {
        const res = await rest('GET', `/stock/transactions?pageNumber=${page}&pageSize=${pageSize}`);
        if (!res.success) return fail(res);
        const items = res.data.items || [];
        rows.push(...items.map(adaptTx));
        if (items.length < pageSize || page >= (res.data.pagination?.totalPages || page)) break;
        page++;
      }
      return { ok: true, history: rows.slice(0, n) };
    }

    case 'monthly_out_summary': { // E13
      const res = await rest('GET', `/stock/reports/monthly-out?year=${encodeURIComponent(p.year)}&month=${encodeURIComponent(p.month)}`);
      if (!res.success) return fail(res);
      const d = res.data;
      return {
        ok: true, year: d.year, month: d.month, totalQty: d.totalQty, byPurpose: d.byPurpose,
        rows: (d.rows || []).map(r => ({
          type: TYPE_LABEL[r.stockType] || r.stockType, productName: r.productName, brand: r.brand,
          reference: r.ref || '', model: r.model || '', size: r.size || '', qty: r.qty, prevAvg: r.prevAvg,
          sameMonthLastYearQty: r.sameMonthLastYearQty, forecastQty: r.forecastQty,
          currentQty: r.currentQty, suggestedReorderQty: r.suggestedReorderQty
        }))
      };
    }

    case 'sales_detail_alerts': { // E14
      const res = await rest('GET', '/stock/alerts/sales-detail');
      return res.success ? { ok: true, alerts: (res.data || []).map(adaptSalesAlert) } : fail(res);
    }

    case 'in': { // E8
      const productId = resolveProductId(p);
      if (!productId) return { ok: false, error: 'ไม่พบสินค้านี้ในแคตตาล็อก SkylinePlus หรือพบหลายตัว — เลือกสินค้าให้ตรง หรือเพิ่มสินค้าก่อน' };
      const lm = p.learnMapping;
      const res = await rest('POST', '/stock/in', {
        stockProductId: productId,
        serialNumber: p.type === 'device' ? (p.sn || null) : null,
        lotNumber: p.lot || null,
        gtin: p.gtin || null,
        mfgDate: toIsoDate(p.mfgDate),
        expiryDate: toIsoDate(p.expiry),
        qty: Number(p.qty || 1),
        location: p.location || null,
        note: p.note || null,
        learnMapping: lm && (lm.gtin || lm.sn || lm.lot) ? { gtin: lm.gtin || null, sn: lm.sn || null, lot: lm.lot || null } : null
      });
      if (res.statusCode === 409 && res.data?.duplicate) return { ok: false, error: 'DUPLICATE', duplicate: res.data.duplicate };
      if (!res.success) return fail(res);
      await refreshRowVersions(productId);
      return { ok: true, merged: res.data.merged, newQty: res.data.afterQty };
    }

    case 'out':
    case 'out_by_id': { // E9: always by row id + rowVersion (R-OUT-1)
      const ref = (p.sheetRow ? rowRef(p.sheetRow) : null) || await findStockRowForOut(p);
      if (!ref || (ref.kind !== 'device' && ref.kind !== 'lot')) return { ok: false, error: 'Item not found' };
      const purpose = PURPOSE_CODE[p.purpose] || (String(p.purpose || '').startsWith('อื่นๆ') ? 'OTHER' : null);
      const recipientName = String(p.recipient || p.location || '').trim();
      const res = await rest('POST', '/stock/out', {
        stockDeviceId: ref.kind === 'device' ? ref.id : null,
        stockLotId: ref.kind === 'lot' ? ref.id : null,
        rowVersion: ref.rowVersion,
        qty: Number(p.qty || 1),
        purpose,
        purposeOther: purpose === 'OTHER' ? (p.purposeOther || null) : null,
        recipientUserId: recipientUserIdFor(recipientName),
        recipientName,
        note: p.note || null,
        buyerName: p.buyerName || null,
        hospital: p.hospital || null,
        poNo: p.poNo || null,
        saleDate: toIsoDate(p.saleDate),
        salePrice: toMoney(p.salePrice),
        wholesalePrice: toMoney(p.wholesalePrice),
        model: p.model || null,
        size: p.size || null
      });
      if (!res.success) return fail(res);
      await refreshRowVersions(ref.productId);
      return { ok: true, row: p.sheetRow };
    }

    case 'batch_stocktake': { // E10
      const items = [];
      for (const it of p.items || []) {
        if (it.type === 'device') continue; // devices are not counted (E10)
        const ref = it.sheetRow ? rowRef(it.sheetRow) : null;
        if (ref && ref.kind === 'lot') { items.push({ stockLotId: ref.id, countedQty: Number(it.qty) }); continue; }
        const productId = resolveProductId({ productCode: it.productCode, type: it.type, name: it.name, brand: it.brand, model: it.model, size: it.size });
        if (!productId || !it.lot) return { ok: false, error: 'ระบุสินค้าหรือ LOT ไม่ได้: ' + (it.name || it.productCode || '-') };
        items.push({ stockProductId: productId, lotNumber: it.lot, countedQty: Number(it.qty) });
      }
      if (!items.length) return { ok: false, error: 'ไม่มีรายการที่นับได้ (เครื่อง device ไม่ต้องนับ)' };
      const res = await rest('POST', '/stock/stocktake', { items });
      return res.success ? { ok: true, updated: res.data.updated } : fail(res);
    }

    case 'update_sales_details': { // E12
      const ref = rowRef(p.historyRow);
      if (!ref || ref.kind !== 'tx') return { ok: false, error: 'ไม่พบรายการ กรุณาซิงก์ข้อมูลใหม่' };
      const res = await rest('PUT', `/stock/transactions/${encodeURIComponent(ref.id)}/sales-detail`, {
        buyerName: p.buyerName || null, hospital: p.hospital || null, poNo: p.poNo || null,
        saleDate: toIsoDate(p.saleDate), salePrice: toMoney(p.salePrice), wholesalePrice: toMoney(p.wholesalePrice),
        model: p.model || null, size: p.size || null
      });
      return res.success ? { ok: true } : fail(res);
    }

    case 'update_product_names': { // E3
      const product = (CACHE.products || []).find(x => x.product_code === p.productCode && x.id);
      if (!product) return { ok: false, error: 'ไม่พบสินค้า' };
      const res = await rest('PUT', `/stock/products/${encodeURIComponent(product.id)}/names`, {
        stockDisplayName: p.stockName || null, poPrintName: p.poName || null, searchAliases: p.aliases || null
      });
      return res.success ? { ok: true } : fail(res);
    }

    case 'upload_product_photo':
      // E4 needs the product id, so keep the picture until add_product has saved the product
      return { ok: true, url: p.image };

    case 'add_product': { // E2, then E4 for a picture picked before saving
      const res = await rest('POST', '/stock/products', {
        productName: p.productName, stockType: p.type, brand: p.brand, model: p.model || null, size: p.size || null,
        ref: p.ref || null, categoryName: p.category || null, searchAliases: p.aliases || null, gtin: p.gtin || null
      });
      if (!res.success) return fail(res);
      if (String(p.photoUrl || '').startsWith('data:')) {
        const form = new FormData();
        const blob = dataUrlToBlob(p.photoUrl);
        form.append('file', blob, 'product.' + (blob.type.split('/')[1] || 'jpg'));
        const up = await rest('POST', `/stock/products/${encodeURIComponent(res.data.id)}/photo`, form);
        if (!up.success) toast('บันทึกสินค้าแล้ว แต่อัปโหลดรูปไม่สำเร็จ: ' + (up.message || ''), 'warn');
      }
      return { ok: true, product: res.data };
    }

    case 'ocr_label': { // still Apps Script (D5)
      if (!OCR_URL) return { ok: false, error: 'ยังไม่มี Apps Script URL สำหรับอ่านป้าย' };
      const r = await fetchWithTimeout(OCR_URL, {
        method: 'POST',
        body: JSON.stringify({ action: 'ocr_label', image: p.image, filename: p.filename }),
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        redirect: 'follow',
        credentials: 'omit'
      });
      if (!r.ok) throw new Error(apiHttpErrorMessage(r.status));
      return r.json();
    }

    default:
      return { ok: false, error: 'action ไม่รองรับ: ' + p.action };
  }
}

function openAddProductModal() {
  if (!STOCK_ME?.canOperate) { toast('บัญชีนี้ไม่มีสิทธิ์เพิ่มสินค้า', 'warn'); return; }
  const modal = document.getElementById('addProductModal');
  modal.classList.add('on');
  populateAddProductCategories();
  setTimeout(() => document.getElementById('newGtin')?.focus(), 80);
}

function closeAddProductModal() {
  document.getElementById('addProductModal')?.classList.remove('on');
}

function populateAddProductCategories() {
  const sel = document.getElementById('newCategory');
  if (!sel) return;
  const current = sel.value;
  const cats = [...new Set((CACHE.products || []).map(p => p.category).filter(Boolean))].sort();
  sel.innerHTML = '<option value="">เลือกหมวดหมู่</option>' + cats.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  if (current && cats.includes(current)) sel.value = current;
}

function pickLabelPhoto() {
  document.getElementById('labelPhotoInput').click();
}

function pickProductPhoto() {
  document.getElementById('productPhotoInput').click();
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('อ่านไฟล์ไม่สำเร็จ'));
    reader.readAsDataURL(file);
  });
}

async function handleLabelPhoto(file) {
  if (!file) return;
  try {
    toast('กำลังอ่านป้ายสินค้า...', 'ok');
    const image = await fileToDataUrl(file);
    const res = await apiPost({ action:'ocr_label', image, filename:file.name || 'label.jpg' });
    if (!res.ok) throw new Error(res.error || 'OCR error');
    const parsed = parseOcrProductText(res.text || '');
    applyOcrToForm(parsed);
    toast('อ่านป้ายแล้ว กรุณาตรวจข้อมูลอีกครั้ง', 'ok');
  } catch(e) {
    toast('OCR ล้มเหลว: ' + e.message + ' — พิมพ์เองได้เลย', 'err');
  } finally {
    const input = document.getElementById('labelPhotoInput');
    if (input) input.value = '';
  }
}

async function handleProductPhoto(file) {
  if (!file) return;
  try {
    toast('กำลังอัปโหลดรูปสินค้า...', 'ok');
    const image = await fileToDataUrl(file);
    const res = await apiPost({ action:'upload_product_photo', image, filename:file.name || 'product.jpg' });
    if (!res.ok) throw new Error(res.error || 'Upload error');
    document.getElementById('newPhotoUrl').value = res.url || '';
    const thumb = document.getElementById('productPhotoThumb');
    thumb.src = res.url || image;
    document.getElementById('productPhotoPreview').classList.add('on');
    document.getElementById('productPhotoStatus').textContent = 'อัปโหลดรูปสินค้าแล้ว';
    toast('อัปโหลดรูปสินค้าแล้ว', 'ok');
  } catch(e) {
    toast('อัปโหลดรูปไม่สำเร็จ: ' + e.message, 'err');
  } finally {
    const input = document.getElementById('productPhotoInput');
    if (input) input.value = '';
  }
}

function parseOcrProductText(text) {
  const raw = String(text || '');
  const lines = raw.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  const ref = (raw.match(/\bREF\s*[:#-]?\s*([A-Z0-9._/-]+)/i) || [])[1] || '';
  let gtin = ((raw.match(/\(01\)\s*(\d{13,14})/) || [])[1] || '');
  if (!gtin) gtin = (raw.match(/\b(\d{13,14})\b/) || [])[1] || '';
  const productName = (lines.find(line =>
    !/^\d+$/.test(line) &&
    !/\b(REF|LOT|GTIN|EXP|MFG|SN|UDI|\(01\))\b/i.test(line) &&
    !/^\d{8,14}$/.test(line)
  ) || '').trim();
  return { gtin, ref, productName };
}

function applyOcrToForm(data) {
  if (data.gtin && !document.getElementById('newGtin').value.trim()) document.getElementById('newGtin').value = data.gtin;
  if (data.ref && !document.getElementById('newRef').value.trim()) document.getElementById('newRef').value = data.ref;
  if (data.productName && !document.getElementById('newProductName').value.trim()) document.getElementById('newProductName').value = data.productName;
}

async function saveNewProduct() {
  const productName = document.getElementById('newProductName').value.trim();
  if (!productName) { toast('กรุณากรอกชื่อสินค้า', 'warn'); document.getElementById('newProductName').focus(); return; }
  const gtin = normalizeNewGtinField();
  const payload = {
    action:'add_product',
    gtin,
    productName,
    brand: document.getElementById('newBrand').value,
    type: document.getElementById('newType').value,
    model: document.getElementById('newModel').value.trim(),
    size: document.getElementById('newSize').value.trim(),
    ref: document.getElementById('newRef').value.trim(),
    category: document.getElementById('newCategory').value,
    aliases: document.getElementById('newAliases').value.trim(),
    hasBarcode: !!gtin,
    photoUrl: document.getElementById('newPhotoUrl').value.trim()
  };
  try {
    const res = await apiPost(payload);
    if (!res.ok) throw new Error(res.error || 'API error');
    toast('บันทึกสินค้าใหม่แล้ว', 'ok');
    clearAddProductForm();
    closeAddProductModal();
    await refreshProductsOnly();
  } catch(e) {
    toast('บันทึกไม่สำเร็จ: ' + e.message, 'err');
  }
}

function normalizeNewGtinField() {
  const el = document.getElementById('newGtin');
  if (!el) return '';
  const normalized = normalizeNewGtinInput(el.value);
  if (normalized && el.value.trim() !== normalized) el.value = normalized;
  return normalized || el.value.trim();
}

function normalizeNewGtinInput(raw) {
  const decoded = gs1Decode(raw);
  if (decoded.gtin && /^\d{8,14}$/.test(decoded.gtin)) return decoded.gtin;
  const plain = String(raw || '').replace(/\D/g, '');
  if (/^\d{8,14}$/.test(plain)) return plain;
  return '';
}

function clearAddProductForm() {
  ['newGtin','newProductName','newModel','newSize','newRef','newAliases','newPhotoUrl'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('newBrand').value = 'APEX';
  document.getElementById('newType').value = 'device';
  document.getElementById('newCategory').value = '';
  document.getElementById('productPhotoPreview').classList.remove('on');
  document.getElementById('productPhotoThumb').removeAttribute('src');
}

async function refreshProductsOnly() {
  const prods = await apiFetch(buildApiUrl(API_URL, { action:'products' }));
  if (prods && prods.ok && prods.products) {
    CACHE.products = prods.products;
    rebuildProductLookupIndex();
    populateProductFilters();
    populateAddProductCategories();
    renderManualProducts();
    renderStocktake();
    renderProductNameManager();
  }
}

async function fetchWithTimeout(url, opts = {}, timeoutMs = 45000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } catch (e) {
    if (e && e.name === 'AbortError') throw new Error('API timeout — เซิร์ฟเวอร์ตอบช้าเกินไป');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function loadAll() {
  setPill('busy');
  HIST_OFFSET = 0;
  syncOutMonthInput();
  const outMonth = selectedOutMonthParts();
  try {
    const [stock, hist, prods] = await Promise.all([
      apiFetch(buildApiUrl(API_URL, { action:'stock' })),
      apiFetch(buildApiUrl(API_URL, { action:'history', n:HIST_PAGE, offset:0 })),
      apiFetch(buildApiUrl(API_URL, { action:'products' })),
    ]);
    const [monthlyOut, salesAlerts] = await Promise.all([
      apiFetch(buildApiUrl(API_URL, { action:'monthly_out_summary', year:outMonth.year, month:outMonth.month })).catch(e => ({ ok:false, error:e.message })),
      apiFetch(buildApiUrl(API_URL, { action:'sales_detail_alerts' })).catch(e => ({ ok:false, error:e.message })),
    ]);

    if (!stock.ok) throw new Error(stock.error);

    CACHE.device    = stock.device || [];
    CACHE.mask      = stock.mask || [];
    CACHE.accessory = stock.accessory || [];
    CACHE.history   = (hist && hist.history) ? hist.history : [];
    CACHE.monthlyOut = monthlyOut && monthlyOut.ok ? monthlyOut : monthlyOutSummaryFromHistory(CACHE.history);
    CACHE.salesAlerts = salesAlerts && salesAlerts.ok ? (salesAlerts.alerts || []) : [];
    if (prods && prods.ok && prods.products) CACHE.products = prods.products;
    invalidateActiveStockCache();
    rebuildProductLookupIndex();
    populateProductFilters();
    renderManualProducts();
    renderStocktake();
    renderProductNameManager();

    renderStock();
    renderHist(false);
    updateStats();

    setPill('ok');
    document.getElementById('connTxt').innerHTML =
      `เชื่อมต่อสำเร็จ<br>Device ${CACHE.device.length} | Mask ${sumQty(CACHE.mask, 'Qty')} | Accessory ${sumQty(CACHE.accessory, 'Qty')}<br>อัปเดตล่าสุด: ${new Date().toLocaleTimeString('th-TH')}`;
  } catch(e) {
    setPill('err');
    document.getElementById('connTxt').textContent = 'Error: ' + e.message;
    toast('โหลดข้อมูลไม่สำเร็จ: ' + e.message, 'err');
  }
}

function sumQty(arr, key) {
  return (arr || []).reduce((sum, x) => sum + Number(x[key] || 0), 0);
}




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
  return lot.replace(/^\d{10,}/, '').replace(/C\.\d+(?:\.\d+)+/g,'').trim();
}

function _gs1Fmt6(s) {
  if (!s || !/^\d{6}$/.test(s)) return s || '';
  const day = s.slice(4,6);
  if (day === '00') return '20' + s.slice(0,2) + '-' + s.slice(2,4);  
  return '20' + s.slice(0,2) + '-' + s.slice(2,4) + '-' + day;
}


function normalizeLot(lot) { return _gs1NormLot(lot); }


function parseCode(raw) {
  if (!raw) return null;
  raw = normalizeScannerLayout(raw);

  
  const key = String(raw).replace(/[^\x1D\x20-\x7E]/g,'').replace(/\s/g,'').toUpperCase();
  if (!key) return null;

  const now = Date.now();
  if (IS_PROCESSING) return null;
  if (key === LAST_SCAN_TEXT && (now - LAST_SCAN_TIME) < DUP_MS) {
    const secLeft = Math.ceil((DUP_MS - (now - LAST_SCAN_TIME)) / 1000);
    toast(`สแกนซ้ำเร็วเกินไป รอ ${secLeft} วินาที`, 'warn');
    return null;
  }


  const g = gs1Decode(raw);

  const d = {
    raw:     key,
    gtin:    g.gtin,
    sn:      g.sn,
    lot:     g.lot,
    mfgDate: g.mfgDate,
    expiry:  g.expiry,
    ref:     g.ref,
  };

  
  
  if (!d.gtin && !d.sn && !d.lot) {
    const plain = key.replace(/\x1D/g,'');
    if (plain.startsWith('BY-') || /^[A-Z]{2}-/.test(plain)) {
      d.lot = _gs1NormLot(plain);
    } else if (/^\d{12,14}$/.test(plain)) {
      
      d.gtin = plain.replace(/^0+/,'');
    } else {
      d.sn = plain;
    }
  }

  // Stock-out must resolve against real stock rows first. ProductDB is only
  // a product catalog and is not enough to decide which stock row to consume.
  const stockHit = MODE === 'out' ? findStockItemForScan(d) : null;
  if (stockHit && stockHit.ambiguous) {
    PENDING_SCAN = { raw: key, gtin: d.gtin || '', sn: d.sn || '', lot: d.lot || '', reason: 'ambiguous_stock', allowAllStock: true };
    LAST = null;
    LAST_SCAN_TEXT = key;
    LAST_SCAN_TIME = now;
    stopScannerOnly();
    document.getElementById('rkv').innerHTML = '';
    document.getElementById('rbox').classList.remove('on');
    document.getElementById('sf').style.display = 'none';
    showManualProductPanel(true);
    return { pending: true };
  }
  if (stockHit) {
    d.stockItem = stockHit;
    d.p = productFromStockItem(stockHit);
    d.sn = stockHit['Serial Number (SN)'] || d.sn || '';
    d.lot = stockHit['LOT Number'] || d.lot || '';
    d.gtin = stockHit['GTIN / Barcode'] || d.gtin || '';
  } else {

    d.p = lookup(d);
  }

  if (MODE === 'out' && !stockHit) {
    PENDING_SCAN = {
      raw: key,
      gtin: d.gtin || '',
      sn: d.sn || '',
      lot: d.lot || '',
      reason: 'stock_not_found',
      allowAllStock: false
    };
    LAST = null;
    LAST_SCAN_TEXT = key;
    LAST_SCAN_TIME = now;
    stopScannerOnly();
    document.getElementById('rkv').innerHTML = '';
    document.getElementById('rbox').classList.remove('on');
    document.getElementById('sf').style.display = 'none';
    showManualProductPanel(true);
    toast('ไม่พบ SN/LOT นี้ในสต็อก จ่ายออกอัตโนมัติไม่ได้', 'warn');
    return { pending: true };
  }

  if (!d.p && (d.gtin || d.sn || d.lot)) {
    PENDING_SCAN = {
      raw: key,
      gtin: d.gtin || '',
      sn: d.sn || '',
      lot: d.lot || '',
      reason: 'unknown_product',
      allowAllStock: false
    };
    LAST = null;
    LAST_SCAN_TEXT = key;
    LAST_SCAN_TIME = now;
    stopScannerOnly();
    document.getElementById('rkv').innerHTML = '';
    document.getElementById('rbox').classList.remove('on');
    document.getElementById('sf').style.display = 'none';
    showManualProductPanel(true);
    return { pending: true };
  }

  PENDING_SCAN = null;
  LAST           = d;
  LAST_SCAN_TEXT = key;
  LAST_SCAN_TIME = now;

  const autoInCanContinue = MODE === 'in' && AUTO_SAVE_ON_SCAN_IN && scanOn && d.p && d.p.type &&
    !((d.p.type === 'device' && !d.sn) || ((d.p.type === 'mask' || d.p.type === 'accessory') && !d.lot));
  if (!autoInCanContinue) stopScannerOnly();
  showResult(d);
  if (MODE === 'out') {
    prepareOutFormAfterScan(d);
    maybeAutoStockOutAfterScan(d);
  } else toast('สแกนสำเร็จ', 'ok');
  return d;
}

function activeStockItems() {
  if (ACTIVE_STOCK_CACHE) return ACTIVE_STOCK_CACHE;
  ACTIVE_STOCK_CACHE = [
    ...CACHE.device.map(x => ({...x, _type:'device'})),
    ...CACHE.mask.map(x => ({...x, _type:'mask'})),
    ...CACHE.accessory.map(x => ({...x, _type:'accessory'}))
  ].filter(x => {
    const status = String(x['Status'] || 'Active').trim().toLowerCase();
    if (status !== 'active') return false;
    if (x._type !== 'device' && Number(x['Qty'] || 0) <= 0) return false;
    return true;
  });
  return ACTIVE_STOCK_CACHE;
}

function invalidateActiveStockCache() {
  ACTIVE_STOCK_CACHE = null;
}

function productFromStockItem(x) {
  return {
    name: x['Product Name'] || '',
    brand: x['Brand'] || '',
    type: x._type || '',
    model: x['Model'] || '',
    size: x['Size'] || '',
    ref: x['REF'] || '',
    product_code: x['Serial Number (SN)'] || x['LOT Number'] || String(x._sheetRow || '')
  };
}

function findStockItemForScan(d) {
  const sn = normalizeSerialForMatch(d.sn || (!d.gtin && !d.lot ? d.raw : ''));
  const lot = _gs1NormLot(d.lot || '');
  const gtin = normalizeGtinForMatch(d.gtin || '');
  const rows = activeStockItems();
  const hint = lookup(d) || {};

  const matches = rows.filter(x => {
    if (x._type === 'device') {
      const rowSn = normalizeSerialForMatch(x['Serial Number (SN)'] || '');
      const rowLot = _gs1NormLot(x['LOT Number'] || '');
      const rowGtin = normalizeGtinForMatch(x['GTIN / Barcode'] || '');
      // A scanned SN identifies one unit; another unit of the same model must not match on GTIN/LOT (spec §8 bug 2)
      if (sn) return !!rowSn && rowSn === sn;
      if (hint.type === 'device' && lot && rowLot && rowLot === lot) return true;
      if (hint.type === 'device' && gtin && rowGtin && rowGtin === gtin) return true;
      return false;
    }
    return stockRowMatchesScan(x, { lot, gtin });
  });

  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    const resolved = resolveAmbiguousStockMatch(matches, d);
    if (resolved) return resolved;
    toast('พบหลายล็อต/หลายแถวในสต็อก กรุณาเลือกจากรายการสต็อก', 'warn');
    showManualProductPanel(true);
    return { ambiguous: true };
  }
  return null;
}

function normalizeGtinForMatch(v) {
  return String(v || '').replace(/\s/g, '').replace(/^0+/, '').toUpperCase();
}

function stockRowMatchesScan(row, scan) {
  const scanLot = _gs1NormLot(scan?.lot || '');
  const scanGtin = normalizeGtinForMatch(scan?.gtin || '');
  const rowLot = _gs1NormLot(row['LOT Number'] || '');
  const rowGtin = normalizeGtinForMatch(row['GTIN / Barcode'] || '');
  let checked = 0;

  if (scanLot) {
    if (!rowLot || rowLot !== scanLot) return false;
    checked++;
  }
  if (scanGtin) {
    if (!rowGtin || rowGtin !== scanGtin) return false;
    checked++;
  }

  return checked > 0;
}

function resolveAmbiguousStockMatch(matches, d) {
  const hint = lookup(d) || {};
  let narrowed = matches;

  if (hint.type) narrowed = narrowed.filter(x => x._type === hint.type);
  if (hint.model) narrowed = narrowed.filter(x => sameText(x['Model'], hint.model));
  if (hint.size) narrowed = narrowed.filter(x => sameText(x['Size'], hint.size));
  if (hint.ref) narrowed = narrowed.filter(x => sameText(x['REF'], hint.ref));
  if (hint.name) narrowed = narrowed.filter(x => sameText(x['Product Name'], hint.name));

  if (narrowed.length === 1) return narrowed[0];
  const sn = normalizeSerialForMatch(d.sn || (!d.gtin && !d.lot ? d.raw : ''));
  if (sn) {
    const bySn = narrowed.filter(x => normalizeSerialForMatch(x['Serial Number (SN)'] || '') === sn);
    if (bySn.length === 1) return bySn[0];
  }
  if (narrowed.length > 1 && allSameMaskIdentity(narrowed)) return pickFefoRow(narrowed);
  return null;
}

function normalizeSerialForMatch(v) {
  return String(v || '')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/^(SN|S\/N|SERIAL|SERIALNO|SERIALNUMBER)[:\-\s]*/i, '')
    .replace(/\s/g, '')
    .toUpperCase();
}

function sameText(a, b) {
  return String(a || '').trim().toUpperCase() === String(b || '').trim().toUpperCase();
}

function allSameMaskIdentity(rows) {
  if (!rows.length || rows.some(x => x._type !== 'mask')) return false;
  const first = rows[0];
  return rows.every(x =>
    sameText(x['Product Name'], first['Product Name']) &&
    sameText(x['Brand'], first['Brand']) &&
    sameText(x['Model'], first['Model']) &&
    sameText(x['Size'], first['Size']) &&
    sameText(x['REF'], first['REF']) &&
    _gs1NormLot(x['LOT Number'] || '') === _gs1NormLot(first['LOT Number'] || '')
  );
}

function pickFefoRow(rows) {
  return [...rows].sort((a, b) => {
    const ea = _expDaysOf(a);
    const eb = _expDaysOf(b);
    if (ea !== null && eb !== null && ea !== eb) return ea - eb;
    if (ea !== null) return -1;
    if (eb !== null) return 1;
    return Number(a._sheetRow || 0) - Number(b._sheetRow || 0);
  })[0];
}

function lookup(d) {
  const gtinRaw = String(d.gtin||'').replace(/[^\x20-\x7E]/g,'').replace(/\s/g,'').toUpperCase().replace(/^0+/,'');
  const lot = _gs1NormLot(d.lot);
  const sn  = String(d.sn||'').replace(/[^\x20-\x7E]/g,'').replace(/\s/g,'').toUpperCase();
  const scanText = [d.raw, d.lot, d.ref].join(' ');

  const inferred = inferFromLot(lot || scanText);
  const gtinHit = lookupProductByGtin(gtinRaw, inferred);
  if (gtinHit) return _mergeLotDetails(gtinHit, lot || d.raw || '', { preferProductIdentity:true });

  const indexed = lookupProductFromIndex({ gtin:gtinRaw, lot, sn, ref:d.ref, raw:d.raw });
  if (indexed) return _mergeLotDetails(indexed, lot || d.raw || '');

  const refHit = lookupProductByEmbeddedRef(scanText, inferred);
  if (refHit) return _mergeLotDetails(refHit, lot || scanText);

  const db = CACHE.products || [];
  const wildcardLotHits = [];
  const gtinRows = [];

  for (const p of db) {
    const pGtin = String(p.gtin || '').replace(/^0+/, '');
    if (pGtin && gtinRaw === pGtin) {
      gtinRows.push(p);
      continue;
    }
    if (p.sn_exact && sn === p.sn_exact) return _mergeLotDetails(p, lot);
    if (p.sn_pfx && sn.startsWith(p.sn_pfx)) return _mergeLotDetails(p, lot);
    if (p.lot_pfx && _matchProductPattern(lot, p.lot_pfx)) {
      if (String(p.lot_pfx).includes('*')) {
        wildcardLotHits.push(p);
      } else {
        return _mergeLotDetails(p, lot);
      }
    }
  }

  if (gtinRows.length === 1) return _mergeLotDetails(gtinRows[0], lot, { preferProductIdentity:true });
  if (gtinRows.length > 1) {
    const hinted = lookupUniqueProductRows(gtinRows, inferred);
    if (hinted) return _mergeLotDetails(hinted, lot, { preferProductIdentity:true });
  }

  const wildcardLotHit = pickWildcardLotHit(wildcardLotHits, inferred);
  if (wildcardLotHit) return _mergeLotDetails(wildcardLotHit, lot);


  if (gtinRaw) {
    const apexMatch = _apexGtinLookup(gtinRaw);
    if (apexMatch) return apexMatch;
  }

  return inferred;
}

function rebuildProductLookupIndex() {
  PRODUCT_LOOKUP = { byGtin:new Map(), byRef:new Map(), byCode:new Map() };
  (CACHE.products || []).forEach(p => {
    const gtin = normalizeGtinForMatch(p.gtin || '');
    if (gtin) addLookupBucket(PRODUCT_LOOKUP.byGtin, gtin, p);
    const ref = normalizeRefToken(p.ref || p.reference || '');
    if (ref) addLookupBucket(PRODUCT_LOOKUP.byRef, ref, p);
    const code = normalizeSkuToken(p.product_code || p.productCode || '');
    if (code && code !== '-') addLookupBucket(PRODUCT_LOOKUP.byCode, code, p);
  });
}

function lookupProductByGtin(gtin, hint = null) {
  gtin = normalizeGtinForMatch(gtin || '');
  return gtin ? lookupUniqueBucket(PRODUCT_LOOKUP.byGtin, gtin, hint) : null;
}

function addLookupBucket(map, key, product) {
  if (!key) return;
  const cur = map.get(key);
  if (!cur) map.set(key, [product]);
  else cur.push(product);
}

function lookupProductFromIndex(d) {
  const scan = [d.raw, d.lot, d.ref].join(' ');
  const refHit = lookupProductByEmbeddedRef(scan);
  if (refHit) return refHit;

  const sku = normalizeSkuToken(scan);
  if (sku) {
    const codeHit = lookupUniqueBucket(PRODUCT_LOOKUP.byCode, sku);
    if (codeHit) return codeHit;
  }
  return null;
}

function lookupProductByEmbeddedRef(text, hint = null) {
  const refs = extractRefTokens(text);
  for (const ref of refs) {
    const hit = lookupUniqueBucket(PRODUCT_LOOKUP.byRef, ref, hint);
    if (hit) return hit;
  }
  return null;
}

function lookupUniqueBucket(map, key, hint = null) {
  const rows = map.get(key) || [];
  return lookupUniqueProductRows(rows, hint);
}

function lookupUniqueProductRows(rows, hint = null) {
  if (!rows.length) return null;
  if (rows.length === 1) return rows[0];
  if (hint?.model) {
    const byModel = rows.filter(p => sameText(p.model, hint.model));
    if (byModel.length === 1) return byModel[0];
    if (hint.size) {
      const bySize = byModel.filter(p => sameText(p.size, hint.size));
      if (bySize.length === 1) return bySize[0];
    }
  }
  if (hint?.size) {
    const bySize = rows.filter(p => sameText(p.size, hint.size));
    if (bySize.length === 1) return bySize[0];
  }
  if (hint?.ref) {
    const byRef = rows.filter(p => sameText(p.ref, hint.ref));
    if (byRef.length === 1) return byRef[0];
  }
  return null;
}

function pickWildcardLotHit(rows, hint = null) {
  const hinted = lookupUniqueProductRows(rows || [], hint);
  if (hinted) return hinted;
  return (rows || []).slice().sort((a, b) => wildcardPatternSpecificity(b.lot_pfx) - wildcardPatternSpecificity(a.lot_pfx))[0] || null;
}

function wildcardPatternSpecificity(pattern) {
  return normalizeSkuToken(pattern).length;
}

function normalizeSkuToken(v) {
  return String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function normalizeRefToken(v) {
  return String(v || '').toUpperCase().replace(/^REF/i, '').replace(/[^A-Z0-9]/g, '');
}

function extractRefTokens(text) {
  const raw = String(text || '').toUpperCase();
  const out = [];
  raw.replace(/\bREF\s*[:#-]?\s*([A-Z0-9._/-]{3,})/g, (_, ref) => {
    const v = normalizeRefToken(ref);
    if (v) out.push(v);
    return _;
  });
  raw.replace(/\b(PT?\d{4,6}|\d{5})\b/g, (_, ref) => {
    const v = normalizeRefToken(ref);
    if (v) out.push(v);
    return _;
  });
  return [...new Set(out)];
}

function clearScanDedup() {
  LAST_SCAN_TEXT = '';
  LAST_SCAN_TIME = 0;
}

function _matchProductPattern(value, pattern) {
  const v = String(value || '').trim().toUpperCase();
  const p = String(pattern || '').trim().toUpperCase();
  if (!v || !p) return false;

  // Backward compatible: existing ProductDB values still mean "starts with".
  if (!p.includes('*')) return v.startsWith(p);

  // New shortcut for recurring products: use patterns like *NM5A*, *R30F107*, BY-C*HP.
  const re = new RegExp('^' + p.split('*').map(_escapeRegExp).join('.*') + '$');
  return re.test(v);
}

function _escapeRegExp(s) {
  return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function _mergeProduct(base, override) {
  const merged = { ...(base || {}) };
  Object.keys(override || {}).forEach(k => {
    const v = override[k];
    if (v !== undefined && v !== null && v !== '') merged[k] = v;
  });
  return merged;
}

function _mergeLotDetails(product, lot, opts = {}) {
  const inferred = inferFromLot(lot);
  const merged = _mergeProduct(inferred, product);
  if (opts.preferProductIdentity) {
    return {
      ...merged,
      size: merged.size || inferred?.size || '',
      ref:  merged.ref  || inferred?.ref  || '',
    };
  }
  return {
    ...merged,
    // Some products share GTIN across sizes; LOT suffix is more specific when present.
    size: inferred?.size || merged.size || '',
    ref:  inferred?.ref  || merged.ref  || '',
  };
}

function learnMappingIntoCache(payload) {
  const m = payload?.learnMapping;
  const p = LAST?.p;
  if (!m || !p || !p.product_code || !(m.gtin || m.lot || m.sn)) return;

  const learned = {
    ...p,
    gtin: String(m.gtin || '').replace(/^0+/, ''),
    sn_exact: String(m.sn || '').replace(/\s/g, '').toUpperCase(),
    sn_pfx: '',
    lot_pfx: _gs1NormLot(m.lot || ''),
    has_barcode: true
  };

  const key = [learned.gtin, learned.sn_exact, learned.sn_pfx, learned.lot_pfx].join('|').toUpperCase();
  const exists = (CACHE.products || []).some(x => {
    const xKey = [
      String(x.gtin || '').replace(/^0+/, ''),
      String(x.sn_exact || '').toUpperCase(),
      String(x.sn_pfx || '').toUpperCase(),
      String(x.lot_pfx || '').toUpperCase()
    ].join('|').toUpperCase();
    return xKey === key;
  });
  if (!exists) {
    CACHE.products = (CACHE.products || []).concat([learned]);
    rebuildProductLookupIndex();
    populateProductFilters();
  }
}


const _APEX_GTIN_PRODUCTS = {
  // XT / iX series
  '007': { name:'APEX XT Auto',                type:'device',     model:'XT Auto',            brand:'APEX Medical' },
  '022': { name:'APEX iX Auto Humidifier',     type:'device',     model:'iX Auto Humidifier', brand:'APEX Medical' },
  '040': { name:'APEX iX Auto',                type:'device',     model:'iX Auto',            brand:'APEX Medical' },
  // Domus 1 G2 series (SS ??Airway Clearance)
  '100': { name:'APEX Domus 1 G2 Pump',        type:'device',     model:'Domus 1 G2 Pump',    brand:'APEX Medical' },
  '101': { name:'APEX Domus 1 G2 Mattress',    type:'accessory',  model:'Domus 1 G2 Mattress',brand:'APEX Medical' },
  
};

function _apexGtinLookup(gtinRaw) {
  
  const g = gtinRaw.replace(/^1(?=4713025)/, '');  // normalize 14-digit ??13-digit
  if (!g.startsWith('4713025') || g.length !== 13) return null;
  const code = g.slice(7, 10);  
  return _APEX_GTIN_PRODUCTS[code] || { name:'APEX Device ('+code+')', type:'device', model:'', brand:'APEX Medical' };
}



const _LOT_RULES = [
  { test: l => l.includes('NM6A'), type:'mask',      model:'EaseFit NM6A', name:'Beyond EaseFit NM6A', brand:'Hunan Beyond' },
  { test: l => l.includes('NM6'),  type:'mask',      model:'EaseFit NM6',  name:'Beyond EaseFit NM6',  brand:'Hunan Beyond' },
  { test: l => l.includes('NM5A'), type:'mask',      model:'EaseFit NM5A', name:'Beyond EaseFit NM5A', brand:'Hunan Beyond' },
  { test: l => l.includes('NM5'),  type:'mask',      model:'EaseFit NM5',  name:'Beyond EaseFit NM5',  brand:'Hunan Beyond' },
  { test: l => l.includes('PMI'),  type:'mask',      model:'EaseFit PMI',  name:'Beyond EaseFit PMI',  brand:'Hunan Beyond' },
  
  { test: l => /HP\d*$/.test(l) || l.includes('HP1'), type:'accessory', model:'HP1', name:'Breathing Tube HP1', brand:'Hunan Beyond' },
  { test: l => l.includes('R30F107') || l.includes('R30F'), type:'device', model:'R-30F', name:'Beyond R-30F BPAP',   brand:'Hunan Beyond' },
  { test: l => l.includes('R25V'),  type:'device',    model:'R-25V',        name:'Beyond R-25V BPAP',   brand:'Hunan Beyond' },
  { test: l => l.includes('R20A'),  type:'device',    model:'R-20A',        name:'Beyond R-20A CPAP',   brand:'Hunan Beyond' },
  { test: l => l.includes('R20'),   type:'device',    model:'R-20i',        name:'Beyond R-20i CPAP',   brand:'Hunan Beyond' },
  { test: l => l.includes('SPO2'),  type:'accessory', model:'SpO2 Kit',     name:'Beyond SpO2 Kits',    brand:'Hunan Beyond' },
  // APEX LOT format: FFYYMMNNNN ??2 letters (factory) + YY + MM (01-12) + 4-digit seq
  { test: l => /^[A-Z]{2}\d{2}(0[1-9]|1[0-2])\d{4}$/.test(l), type:'device', model:'', name:'APEX Device', brand:'APEX Medical' },
];

const _SIZE_RULES = [
  { test: l => l.includes('NM5AL') || l.includes('NM6AL') || l.includes('NM6L') || l.includes('NM5L') || (/L$/.test(l) && !l.endsWith('LOT')), size:'L' },
  { test: l => l.includes('NM5AM') || l.includes('NM6AM') || l.includes('NM6M') || l.includes('NM5M') || /M$/.test(l), size:'M' },
  { test: l => l.includes('NM5AS') || l.includes('NM6AS') || l.includes('NM6S') || l.includes('NM5S') || /S$/.test(l), size:'S' },
];

const _REF_RULES = [
  { model:'EaseFit NM5A', size:'L', ref:'78072'   },
  { model:'EaseFit NM5A', size:'M', ref:'PT78044' },
  { model:'EaseFit NM6A', size:'M', ref:'78091'   },
  { model:'EaseFit NM6',  size:'L', ref:'78084'   },
  { model:'EaseFit NM6',  size:'M', ref:'78085'   },
  { model:'EaseFit NM6',  size:'S', ref:'78086'   },
  { model:'EaseFit NM5',  size:'M', ref:'78066'   },
  { model:'EaseFit NM5',  size:'L', ref:'78066'   },
  { model:'EaseFit NM5',  size:'S', ref:'78066'   },
];

function inferFromLot(lot) {
  if (!lot) return null;
  lot = normalizeSkuToken(lot);

  const matched = _LOT_RULES.find(r => r.test(lot));
  const refRuleFromText = extractRefTokens(lot).map(ref => {
    const matches = _REF_RULES.filter(r => normalizeRefToken(r.ref) === ref);
    return matches.length === 1 ? matches[0] : null;
  }).find(Boolean);
  if (!matched && !refRuleFromText) return null;

  const model = matched?.model || refRuleFromText?.model || '';
  const type = matched?.type || (model ? 'mask' : '');
  const name = matched?.name || (model ? 'Beyond ' + model : '');
  const brand = matched?.brand || (model ? 'Hunan Beyond' : '');
  const sizeRule = _SIZE_RULES.find(r => r.test(lot));
  const size = sizeRule ? sizeRule.size : (refRuleFromText?.size || '');
  const refRule = _REF_RULES.find(r => r.model === model && r.size === size);
  const ref = refRule ? refRule.ref : (refRuleFromText?.ref || '');

  return { name, brand, type, model, size, ref };
}


function productLabel(p) {
  return [p.product_code || '-', p.name || '-', p.brand || ''].join(' | ');
}

function stockDisplayName(p) {
  return p?.stock_name || p?.name || p?.product_name || '';
}

function poPrintName(p) {
  return p?.po_name || p?.product_name || p?.name || '';
}

function productSearchText(p) {
  return [
    p?.name, p?.product_name, p?.stock_name, p?.po_name, p?.aliases,
    p?.brand, p?.product_code, p?.category, p?.model, p?.ref
  ].join(' ').toLowerCase();
}

function productPhotoUrl(p) {
  return p?.photoUrl || p?.photo_url || p?.['Photo URL'] || '';
}

function productVariantLabel(p) {
  return [
    p?.model ? 'รุ่น ' + p.model : '',
    p?.size ? 'ไซส์ ' + p.size : '',
    p?.ref ? 'REF ' + p.ref : ''
  ].filter(Boolean).join(' · ');
}

function stockBatchLabel(p) {
  if (!p?.stockItem) return p?.category || '-';
  return [
    p.fifoFirst ? 'FIFO' : '',
    p.type !== 'device' ? 'คงเหลือ ' + (p.qty || 0) : '',
    p.size ? 'ไซส์ ' + p.size : '',
    p.lot ? 'LOT ' + p.lot : p.sn ? 'SN ' + p.sn : 'ในสต็อก'
  ].filter(Boolean).join(' · ');
}

function parseStockDate(v) {
  if (v instanceof Date && !isNaN(v.getTime())) return v;
  const s = String(v || '').trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    let y = Number(m[3]);
    if (y > 2400) y -= 543;
    return new Date(y, Number(m[2]) - 1, Number(m[1]));
  }
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function sameMaskStockIdentity(a, b) {
  return sameText(a?.['Product Name'], b?.['Product Name']) &&
    sameText(a?.['Brand'], b?.['Brand']) &&
    sameText(a?.['Model'], b?.['Model']) &&
    sameText(a?.['Size'], b?.['Size']) &&
    sameText(a?.['REF'], b?.['REF']);
}

function isFifoMaskStockRow(row) {
  if (!row || row._type !== 'mask') return false;
  const rows = (CACHE.mask || []).filter(x => {
    const status = String(x['Status'] || 'Active').trim().toLowerCase();
    return status === 'active' && Number(x['Qty'] || 0) > 0 && sameMaskStockIdentity(x, row);
  });
  if (!rows.length) return false;
  const first = rows.slice().sort((a, b) => {
    const da = parseStockDate(a['Date In']);
    const db = parseStockDate(b['Date In']);
    if (da && db && da.getTime() !== db.getTime()) return da - db;
    if (da) return -1;
    if (db) return 1;
    return Number(a._sheetRow || 0) - Number(b._sheetRow || 0);
  })[0];
  return Number(first?._sheetRow || 0) === Number(row._sheetRow || 0);
}

function photoUrlForStockItem(it) {
  const gtin = normalizeGtinForMatch(it?.['GTIN / Barcode'] || '');
  const name = String(it?.['Product Name'] || '').trim().toLowerCase();
  const brand = String(it?.['Brand'] || '').trim().toLowerCase();
  const hit = (CACHE.products || []).find(p => {
    const pPhoto = productPhotoUrl(p);
    if (!pPhoto) return false;
    const pGtin = normalizeGtinForMatch(p.gtin || '');
    if (gtin && pGtin && gtin === pGtin) return true;
    return name && String(p.name || p.product_name || '').trim().toLowerCase() === name &&
      (!brand || String(p.brand || '').trim().toLowerCase() === brand);
  });
  return productPhotoUrl(hit);
}

function populateProductFilters() {
  const cats = [...new Set((CACHE.products || []).map(p => p.category).filter(Boolean))].sort();
  const brands = [...new Set((CACHE.products || []).map(p => p.brand).filter(Boolean))].sort();
  [['manualCategory', cats, 'ทุกหมวดหมู่'], ['takeCategory', cats, 'ทุกหมวดสินค้าใช้แล้วหมด'], ['manualBrand', brands, 'ทุกแบรนด์'], ['takeBrand', brands, 'ทุกแบรนด์']].forEach(([id, values, first]) => {
    const el = document.getElementById(id);
    if (!el) return;
    const cur = el.value;
    el.innerHTML = `<option value="">${escapeHtml(first)}</option>` + values.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
    if (values.includes(cur)) el.value = cur;
  });
  renderInlineMaskModelOptions();
}

function maskProductsFromDB() {
  return (CACHE.products || []).filter(p => String(p.type || '').toLowerCase() === 'mask');
}

function maskModelChoicesFromDB() {
  return [...new Set(maskProductsFromDB().map(p => String(p.model || '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
}

function maskSizeChoicesFromDB(model = '') {
  const wanted = String(model || '').trim().toLowerCase();
  return [...new Set(maskProductsFromDB()
    .filter(p => !wanted || String(p.model || '').trim().toLowerCase() === wanted)
    .map(p => String(p.size || '').trim())
    .filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
}

function optionHtml(value, selected, emptyLabel) {
  const label = value || emptyLabel;
  return `<option value="${escapeHtml(value)}"${String(selected || '') === String(value) ? ' selected' : ''}>${escapeHtml(label)}</option>`;
}

function renderInlineMaskModelOptions(selected = '') {
  const el = document.getElementById('maskModelI');
  if (!el) return;
  const current = selected || el.value || '';
  const models = maskModelChoicesFromDB();
  el.innerHTML = optionHtml('', current, models.length ? 'เลือกรุ่นหน้ากากจาก ProductDB' : 'ยังไม่มีรุ่นหน้ากากใน ProductDB')
    + models.map(v => optionHtml(v, current, '')).join('');
  if (current && models.includes(current)) el.value = current;
  renderInlineMaskSizeOptions();
}

function renderInlineMaskSizeOptions(selected = '') {
  const el = document.getElementById('maskSizeI');
  if (!el) return;
  const model = document.getElementById('maskModelI')?.value || '';
  const current = selected || el.value || '';
  const sizes = maskSizeChoicesFromDB(model);
  el.innerHTML = optionHtml('', current, sizes.length ? 'เลือกไซส์หน้ากากจาก ProductDB' : 'ยังไม่มีไซส์ของรุ่นนี้ใน ProductDB')
    + sizes.map(v => optionHtml(v, current, '')).join('');
  if (current && sizes.includes(current)) el.value = current;
}

function completeProductFromScan(scan) {
  if (!scan) return null;
  const inferred = lookup({
    raw: scan.raw || scan.learnRaw || '',
    gtin: scan.gtin || scan.learnGtin || '',
    sn: scan.sn || scan.learnSn || '',
    lot: scan.lot || scan.learnLot || '',
    ref: scan.p?.ref || ''
  }) || inferFromLot([scan.raw, scan.lot, scan.learnRaw, scan.learnLot, scan.p?.ref].join(' '));
  if (!inferred) return scan.p || null;
  return _mergeProduct(inferred, scan.p || {});
}

function stockInIdentityError(type, p) {
  if (type === 'device' && !String(p.model || '').trim()) {
    return 'ยังระบุรุ่นเครื่องไม่ได้ — ตรวจ mapping ก่อนรับเข้า';
  }
  if (type === 'mask' && !isSizelessMaskProduct(p) && (!String(p.model || '').trim() || !String(p.size || '').trim())) {
    return 'ยังระบุรุ่น/ไซส์หน้ากากไม่ได้ — ตรวจ mapping ก่อนรับเข้า';
  }
  return '';
}

function isSizelessMaskProduct(p) {
  const text = normalizeSkuToken([p?.name, p?.model, p?.ref, p?.productCode].join(' '));
  return text.includes('EASEFITPMI') || text.includes('PILLOW');
}

function showManualProductPanel(focusSearch = false) {
  const manualProductPanel = document.getElementById('manualProductPanel');
  if (manualProductPanel) manualProductPanel.style.display = 'block';
  renderManualScanNotice();
  renderManualProducts();
  if (focusSearch) {
    const manualSearch = document.getElementById('manualSearch');
    if (manualSearch) manualSearch.focus();
  }
}

function hideManualProductPanel() {
  const manualProductPanel = document.getElementById('manualProductPanel');
  if (manualProductPanel) manualProductPanel.style.display = 'none';
  const notice = document.getElementById('manualScanNotice');
  if (notice) {
    notice.style.display = 'none';
    notice.className = 'manual-alert';
    notice.innerHTML = '';
  }
}

function pendingScanSummary() {
  if (!PENDING_SCAN) return '';
  return [
    PENDING_SCAN.sn ? 'SN ' + PENDING_SCAN.sn : '',
    PENDING_SCAN.lot ? 'LOT ' + PENDING_SCAN.lot : '',
    PENDING_SCAN.gtin ? 'GTIN ' + PENDING_SCAN.gtin : '',
    !PENDING_SCAN.sn && !PENDING_SCAN.lot && !PENDING_SCAN.gtin ? PENDING_SCAN.raw : ''
  ].filter(Boolean).join(' · ');
}

function renderManualScanNotice() {
  const notice = document.getElementById('manualScanNotice');
  if (!notice) return;
  if (!PENDING_SCAN) {
    notice.style.display = 'none';
    notice.className = 'manual-alert';
    notice.innerHTML = '';
    return;
  }

  const scan = escapeHtml(pendingScanSummary() || 'ไม่พบข้อมูลจากบาร์โค้ด');
  notice.style.display = 'block';
  notice.className = 'manual-alert';

  if (MODE === 'out') {
    notice.classList.add('err');
    if (PENDING_SCAN.reason === 'ambiguous_stock') {
      notice.innerHTML = `พบหลายแถวในสต็อกสำหรับ ${scan}<br>กรุณาเลือกแถวที่ต้องการจ่ายออกจากรายการด้านล่าง`;
      return;
    }
    const btn = PENDING_SCAN.allowAllStock
      ? ''
      : '<br><button type="button" onclick="allowPendingStockSearch()">ค้นหาทั้งสต็อกเอง</button>';
    notice.innerHTML = `ไม่พบ SN/LOT นี้ในสต็อก: ${scan}<br>ระบบยังไม่จ่ายออกให้ เพื่อกันจ่ายผิดรายการ${btn}`;
    return;
  }

  notice.innerHTML = `ไม่รู้จักบาร์โค้ดนี้: ${scan}<br>เลือกสินค้าด้านล่างเพื่อผูกบาร์โค้ด/SN/LOT ครั้งแรก แล้วระบบจะจำไว้รอบถัดไป`;
}

function allowPendingStockSearch() {
  if (!PENDING_SCAN || MODE !== 'out') return;
  PENDING_SCAN.allowAllStock = true;
  renderManualScanNotice();
  renderManualProducts();
  const manualSearch = document.getElementById('manualSearch');
  if (manualSearch) manualSearch.focus();
}

function pendingScanMatchesStockRow(x) {
  if (!PENDING_SCAN || MODE !== 'out') return true;
  if (PENDING_SCAN.allowAllStock) return true;
  const pendingLot = _gs1NormLot(PENDING_SCAN.lot || '');
  const pendingGtin = normalizeGtinForMatch(PENDING_SCAN.gtin || '');
  const pendingSn = String(PENDING_SCAN.sn || '').trim().toUpperCase();
  if (!pendingLot && !pendingGtin && !pendingSn) return true;

  const rowSn = String(x['Serial Number (SN)'] || '').trim().toUpperCase();
  if (pendingSn && rowSn) return rowSn === pendingSn;
  return stockRowMatchesScan(x, { lot: pendingLot, gtin: pendingGtin });
}

function filteredProducts(prefix) {
  const cat = document.getElementById(prefix + 'Category')?.value || '';
  const brand = document.getElementById(prefix + 'Brand')?.value || '';
  const q = (document.getElementById(prefix + 'Search')?.value || '').toLowerCase().trim();

  if (prefix === 'manual' && MODE === 'out') {
    return [
      ...CACHE.device.map(x => ({...x, _type:'device'})),
      ...CACHE.mask.map(x => ({...x, _type:'mask'})),
      ...CACHE.accessory.map(x => ({...x, _type:'accessory'}))
    ].filter(x => {
      const status = String(x['Status'] || 'Active').trim().toLowerCase();
      if (status !== 'active') return false;
      if (x._type !== 'device' && Number(x['Qty'] || 0) <= 0) return false;
      if (!pendingScanMatchesStockRow(x)) return false;
      if (cat && ['device','mask','accessory'].includes(cat) && x._type !== cat) return false;
      if (brand && (x['Brand'] || '') !== brand) return false;
      const hay = [
        x['Product Name'], x['Brand'], x['Model'], x['Size'], x['REF'],
        x['Serial Number (SN)'], x['LOT Number'], x['GTIN / Barcode']
      ].join(' ').toLowerCase();
      return !q || hay.includes(q);
    }).map(x => ({
      name: x['Product Name'] || '',
      brand: x['Brand'] || '',
      type: x._type,
      model: x['Model'] || '',
      size: x['Size'] || '',
      ref: x['REF'] || '',
      product_code: x['Serial Number (SN)'] || x['LOT Number'] || String(x._sheetRow || ''),
      category: 'ในสต็อก',
      sn: x['Serial Number (SN)'] || '',
      lot: x['LOT Number'] || '',
      gtin: x['GTIN / Barcode'] || '',
      qty: x['Qty'] || '',
      fifoFirst: x._type === 'mask' && isFifoMaskStockRow(x),
      stockItem: x
    }));
  }

  if (prefix === 'take') {
    return [
      ...CACHE.mask.map(x => ({...x, _type:'mask'})),
      ...CACHE.accessory.map(x => ({...x, _type:'accessory'}))
    ].filter(x => {
      const status = String(x['Status'] || 'Active').trim().toLowerCase();
      if (status !== 'active') return false;
      if (cat && ['mask','accessory'].includes(cat) && x._type !== cat) return false;
      if (brand && (x['Brand'] || '') !== brand) return false;
      const hay = [
        x['Product Name'], x['Brand'], x['Model'], x['Size'], x['REF'],
        x['LOT Number'], x['GTIN / Barcode'], x['Location']
      ].join(' ').toLowerCase();
      return !q || hay.includes(q);
    }).map(x => ({
      name: x['Product Name'] || '',
      brand: x['Brand'] || '',
      type: x._type,
      model: x['Model'] || '',
      size: x['Size'] || '',
      ref: x['REF'] || '',
      product_code: `${x._type.toUpperCase()}-${x._sheetRow || ''}`,
      category: 'ในสต็อก',
      sn: '',
      lot: x['LOT Number'] || '',
      gtin: x['GTIN / Barcode'] || '',
      qty: x['Qty'] || '',
      fifoFirst: x._type === 'mask' && isFifoMaskStockRow(x),
      stockItem: x
    }));
  }

  return (CACHE.products || []).filter(p => {
    if (prefix === 'manual' && !p.product_code) return false;
    if (cat && p.category !== cat) return false;
    if (brand && p.brand !== brand) return false;
    const hay = productSearchText(p);
    return !q || hay.includes(q);
  });
}

function renderManualProducts() {
  const el = document.getElementById('manualProductList');
  if (!el) return;
  const rows = filteredProducts('manual').slice(0, 80);
  el.innerHTML = rows.length ? rows.map((p, i) => `
    <div class="manual-row selectable" onclick="selectManualProduct(${i})">
      <div class="manual-row-main">
        ${productPhotoUrl(p) ? `<img class="prod-thumb" src="${escapeHtml(productPhotoUrl(p))}" alt="">` : ''}
        <div><b>${escapeHtml(stockDisplayName(p))}</b><br><span>${escapeHtml(p.product_code || '-')} · ${escapeHtml(p.brand || '-')} · ${escapeHtml(p.stockItem ? stockBatchLabel(p) : (productVariantLabel(p) || p.category || '-'))}</span></div>
      </div>
      <button type="button" class="manual-select-btn" onclick="event.stopPropagation();selectManualProduct(${i})">เลือก</button>
    </div>`).join('') : '<div class="empty">ไม่พบสินค้า</div>';
  if (!rows.length && MODE === 'out' && PENDING_SCAN && !PENDING_SCAN.allowAllStock) {
    el.innerHTML = `<div class="empty">ไม่พบ SN/LOT นี้ในสต็อก<br><button type="button" class="manual-select-btn" style="margin-top:8px" onclick="allowPendingStockSearch()">ค้นหาทั้งสต็อกเอง</button></div>`;
  }
  window.__manualRows = rows;
}

function selectManualProduct(i) {
  const p = (window.__manualRows || [])[i];
  if (!p) return;
  const pending = PENDING_SCAN;
  LAST = {
    raw: p.product_code || p.name,
    p,
    manual: true,
    stockItem: p.stockItem || null,
    sn: p.sn || '',
    lot: p.lot || '',
    gtin: p.gtin || ''
  };
  if (pending && (pending.gtin || pending.lot || pending.sn)) {
    LAST.learnGtin = pending.gtin || '';
    LAST.learnLot = pending.lot || '';
    LAST.learnSn = pending.sn || '';
    LAST.learnRaw = pending.raw || '';
    PENDING_SCAN = null;
  }
  showResult(LAST);
  const qty = document.getElementById('qtyI');
  if (qty) qty.value = '1';
  const snLot = document.getElementById('snLotI');
  if (snLot && snLot.offsetParent !== null) snLot.focus();
  else if (qty) qty.focus();
  updateActionButtons();
  if (MODE === 'out') prepareOutFormAfterScan(LAST);
}

function prepareOutFormAfterScan(item = LAST) {
  if (MODE !== 'out' || !item) return;
  const qty = document.getElementById('qtyI');
  if (qty && transactionNeedsQty('out', item.stockItem?._type || item.p?.type || '')) qty.value = qty.value || '1';
  updateActionButtons();

  const loc = document.getElementById('locI');
  const purpose = document.getElementById('purposeI');
  const purposeOther = document.getElementById('purposeOtherI');
  const outBtn = document.getElementById('bOut');
  setTimeout(() => {
    if (loc && !loc.value.trim()) loc.focus();
    else if (purpose && !purpose.value) purpose.focus();
    else if (purpose?.value === 'อื่นๆ' && purposeOther && !purposeOther.value.trim()) purposeOther.focus();
    else if (outBtn && !outBtn.disabled) outBtn.focus();
  }, 80);
  toast(outBtn && !outBtn.disabled ? 'เจอสินค้าแล้ว — ตรวจสอบแล้วกดจ่ายออก' : 'เจอสินค้าแล้ว — เติมข้อมูลจ่ายออกให้ครบ', outBtn && !outBtn.disabled ? 'ok' : 'warn');
}

function maybeAutoStockOutAfterScan(item = LAST) {
  if (!AUTO_STOCK_OUT_ON_SCAN_OUT || MODE !== 'out' || !item?.stockItem) return;
  setTimeout(() => {
    if (IS_PROCESSING || LAST !== item || MODE !== 'out') return;
    updateActionButtons();
    const outBtn = document.getElementById('bOut');
    if (!outBtn || outBtn.disabled) return;
    toast('เจอแถวสต็อกแล้ว — จ่ายออกอัตโนมัติ', 'ok');
    doAct('out');
  }, 160);
}

function requiredTrackingValue(type) {
  const v = document.getElementById('snLotI')?.value.trim() || '';
  if (type === 'device') return { key:'sn', value:v };
  if (type === 'mask' || type === 'accessory') return { key:'lot', value:v };
  return { key:'', value:'' };
}

function getSalesDetailInputs() {
  return {
    buyerName: document.getElementById('buyerNameI')?.value.trim() || '',
    hospital: document.getElementById('hospitalI')?.value.trim() || '',
    poNo: document.getElementById('poNoI')?.value.trim() || '',
    saleDate: document.getElementById('saleDateI')?.value || '',
    salePrice: document.getElementById('salePriceI')?.value.trim() || '',
    wholesalePrice: document.getElementById('wholesalePriceI')?.value.trim() || '',
    model: document.getElementById('maskModelI')?.value || '',
    size: document.getElementById('maskSizeI')?.value || ''
  };
}

function syncSnLotInput() {
  if (!LAST) return;
  const type = document.getElementById('iType')?.value || LAST.p?.type || '';
  const cur = requiredTrackingValue(type);
  if (cur.key === 'sn') LAST.sn = cur.value;
  if (cur.key === 'lot') LAST.lot = cur.value;
  updateActionButtons();
}

function transactionNeedsQty(action, type) {
  return type === 'mask' || type === 'accessory';
}

function transactionNeedsTracking(action, type) {
  if (action === 'out' && LAST?.stockItem) return false;
  if (action === 'out' && LAST?.manual && (type === 'mask' || type === 'accessory')) return false;
  return type === 'device' || type === 'mask' || type === 'accessory';
}

function updateSnLotField(force = false) {
  const row = document.getElementById('snLotRow');
  const label = document.getElementById('snLotLabel');
  const input = document.getElementById('snLotI');
  const hint = document.getElementById('snLotHint');
  if (!row || !label || !input || !hint) return;

  const type = document.getElementById('iType')?.value || LAST?.p?.type || '';
  const isDevice = type === 'device';
  const isLotItem = type === 'mask' || type === 'accessory';
  row.style.display = LAST && (isDevice || isLotItem) ? 'block' : 'none';
  if (!LAST || (!isDevice && !isLotItem)) {
    input.value = '';
    return;
  }

  if (isDevice) {
    label.textContent = 'เลขเครื่อง (SN)';
    input.placeholder = 'ดูที่สติกเกอร์ด้านหลังเครื่อง';
    hint.textContent = 'ดูที่สติกเกอร์ด้านหลังเครื่อง';
    if (force || input.dataset.trackType !== type) input.value = LAST.sn || '';
  } else {
    label.textContent = 'เลขล็อต (LOT)';
    input.placeholder = 'ดูที่ฉลากบนกล่อง/ถุง';
    hint.textContent = 'ดูที่ฉลากบนกล่อง/ถุง';
    if (force || input.dataset.trackType !== type) input.value = LAST.lot || '';
  }
  input.dataset.trackType = type;
  syncSnLotInput();
}

function updateActionButtons() {
  const bIn = document.getElementById('bIn');
  const bOut = document.getElementById('bOut');
  if (!bIn || !bOut) return;
  if (!LAST) {
    bIn.disabled = true;
    bOut.disabled = true;
    bOut.title = 'กรุณาสแกนหรือเลือกสินค้าก่อน';
    return;
  }
  const isOut = MODE === 'out';
  const type = document.getElementById('iType')?.value || LAST?.p?.type || '';
  const qtyVal = parseInt(document.getElementById('qtyI')?.value || '', 10);
  const needsQty = LAST && transactionNeedsQty(MODE, type);
  const purpose = document.getElementById('purposeI')?.value || '';
  const purposeOther = document.getElementById('purposeOtherI')?.value.trim() || '';
  const recipient = document.getElementById('locI')?.value.trim() || '';
  const purposeOtherEl = document.getElementById('purposeOtherI');
  if (purposeOtherEl) purposeOtherEl.style.display = purpose === 'อื่นๆ' ? 'block' : 'none';
  const missingTracking = LAST && transactionNeedsTracking(MODE, type) && !requiredTrackingValue(type).value;
  const invalidQty = needsQty && (!qtyVal || qtyVal <= 0);
  const invalidOut = isOut && (!recipient || !purpose || (purpose === 'อื่นๆ' && !purposeOther));
  bIn.disabled = !!(invalidQty || missingTracking);
  bOut.disabled = !!(invalidQty || missingTracking || invalidOut);
  bOut.title = invalidQty ? 'กรุณากรอกจำนวนให้ถูกต้อง'
    : missingTracking ? 'กรุณากรอก SN/LOT'
    : invalidOut ? 'กรุณาระบุผู้รับและวัตถุประสงค์'
    : '';
}

document.addEventListener('input', e => {
  if (['qtyI','locI','purposeI','purposeOtherI','snLotI'].includes(e.target.id)) updateActionButtons();
});

document.addEventListener('change', e => {
  if (['qtyI','locI','purposeI','purposeOtherI','snLotI','iType'].includes(e.target.id)) updateActionButtons();
});

function currentStockQtyForProduct(p) {
  if (p?.stockItem) return Number(p.stockItem['Qty'] || 0);
  const arr = p.type === 'mask' ? CACHE.mask : CACHE.accessory;
  const names = [p.name, p.product_name, p.stock_name].filter(Boolean).map(x => String(x).trim());
  const hit = (arr || []).find(x => names.includes(String(x['Product Name'] || '').trim()) && (x['Brand'] || '') === (p.brand || '') && (p.type !== 'mask' || (x['Size'] || '') === (p.size || '')) && (x['Status'] || 'Active') === 'Active');
  return hit ? Number(hit['Qty'] || 0) : 0;
}

function renderStocktake() {
  const el = document.getElementById('stocktakeList');
  if (!el) return;
  const rows = filteredProducts('take').slice(0, 120);
  el.innerHTML = rows.map(p => `
    <div class="manual-row">
      <div><b>${escapeHtml(stockDisplayName(p))}</b><br><span>${escapeHtml(p.product_code || '-')} · ${escapeHtml(p.brand || '-')} · ${escapeHtml(stockBatchLabel(p))} · คงเหลือเดิม ${currentStockQtyForProduct(p)}</span></div>
      <input class="takeQty"
        data-code="${escapeHtml(p.product_code || '')}"
        data-type="${escapeHtml(p.type || '')}"
        data-row="${escapeHtml(p.stockItem?._sheetRow || '')}"
        data-name="${escapeHtml(p.name || '')}"
        data-brand="${escapeHtml(p.brand || '')}"
        data-model="${escapeHtml(p.model || '')}"
        data-size="${escapeHtml(p.size || '')}"
        data-ref="${escapeHtml(p.ref || '')}"
        data-lot="${escapeHtml(p.lot || '')}"
        data-gtin="${escapeHtml(p.gtin || '')}"
        type="number" min="0" placeholder="จำนวน" oninput="validateStocktakeSubmit()">
    </div>`).join('') || '<div class="empty">ไม่พบสินค้า</div>';
  validateStocktakeSubmit();
}

function validateStocktakeSubmit() {
  const hasAny = [...document.querySelectorAll('.takeQty')].some(x => x.value !== '' && Number(x.value) >= 0);
  const btn = document.getElementById('stocktakeSubmit');
  if (btn) btn.disabled = !hasAny;
}

async function submitStocktake() {
  const items = [...document.querySelectorAll('.takeQty')]
    .filter(x => x.value !== '' && (x.dataset.row || x.dataset.code))
    .map(x => ({
      sheetRow: Number(x.dataset.row || 0) || '',
      type: x.dataset.type || '',
      productCode: x.dataset.code || '',
      name: x.dataset.name || '',
      brand: x.dataset.brand || '',
      model: x.dataset.model || '',
      size: x.dataset.size || '',
      ref: x.dataset.ref || '',
      lot: x.dataset.lot || '',
      gtin: x.dataset.gtin || '',
      qty: Number(x.value)
    }));
  if (!items.length) return;
  setPill('busy');
  try {
    const res = await apiPost({ action:'batch_stocktake', items, user:CUR_USER, staffName:CUR_STAFF });
    if (!res.ok) throw new Error(res.error || 'API error');
    toast('บันทึกการนับสต็อก ' + (res.updated || items.length) + ' รายการแล้ว', 'ok');
    await loadAll();
    setPill('ok');
  } catch(e) {
    setPill('err');
    toast('บันทึกการนับสต็อกล้มเหลว: ' + e.message, 'err');
  }
}


async function startScan() {
  if (scanOn || IS_PROCESSING) return;
  scanner = new Html5Qrcode('reader');

  try {
    await scanner.start(
      { facingMode:'environment' },
      { fps:10, qrbox:{width:260,height:110}, aspectRatio:1.6 },
      txt => processScannerText(txt),
      () => {}
    );
    scanOn = true;
  } catch(e) {
    document.getElementById('reader').innerHTML =
      '<p style="text-align:center;padding:18px;color:#aaa;font-size:12px">เปิดกล้องไม่สำเร็จ<br>กรุณาอนุญาตกล้องหรือกรอกเอง</p>';
  }
}

function stopScannerOnly() {
  if (scanner) {
    try { scanner.stop(); } catch(e) {}
    try { scanner.clear(); } catch(e) {}
  }
  scanner = null;
  scanOn = false;
}

function setMode(m) {
  MODE = m;
  if (LAST) resetScan({ clearLocation:false, keepScanner:true });
  renderManualProducts();
  updateModeUI();
}

function updateModeUI() {
  const isIn = MODE === 'in';
  document.getElementById('mIn').classList.toggle('on', isIn);
  document.getElementById('mOut').classList.toggle('on', !isIn);
  document.getElementById('bIn').style.display  = isIn ? 'block' : 'none';
  document.getElementById('bOut').style.display = isIn ? 'none' : 'block';
  document.getElementById('bOut').disabled = false;
  document.getElementById('locLabel').textContent = isIn ? 'คนรับเข้า/ผู้บันทึก' : 'เซลล์หรือผู้รับสินค้า';
  document.getElementById('locI').placeholder = isIn ? 'เช่น ฝ้าย, แอดมิน, ทีมสต็อก' : 'เลือกหรือพิมพ์ชื่อเซลล์/ผู้รับสินค้า';
  document.getElementById('locI').setAttribute('list', isIn ? '' : 'recipientChoices');
  document.getElementById('scanHint').innerHTML = isIn
    ? '<span class="dot"></span>รับเข้า: สแกนแล้วบันทึกอัตโนมัติ'
    : '<span class="dot"></span>สแกนจ่ายออก แล้วตรวจสอบก่อนกดจ่ายออก';

  
  const curType = document.getElementById('iType')?.value || '';
  updateSnLotField();
  const showQty = LAST && transactionNeedsQty(MODE, curType);
  document.getElementById('qtyRow').style.display = showQty ? 'block' : 'none';
  const outFields = document.getElementById('outRequiredFields');
  if (outFields) outFields.style.display = isIn ? 'none' : 'block';
  const salesFields = document.getElementById('salesDetailFields');
  if (salesFields) salesFields.style.display = isIn ? 'none' : 'block';
  updateActionButtons();
}

function onTypeChange() {
  updateModeUI();
}

function procM() {
  const c = document.getElementById('mc').value.trim();
  if (c) {
    processScannerText(c);
    document.getElementById('mc').value = '';
  }
}

function showResult(d) {
  hideManualProductPanel();

  const rows = [];

  if (d.p) {
    rows.push(['สินค้า', d.p.name]);
    rows.push(['Brand', d.p.brand]);
    rows.push(['ประเภท', d.p.type]);
    rows.push(['Model', d.p.model || '-']);
    if (d.p.size) rows.push(['Size', d.p.size]);
    if (d.p.ref) rows.push(['REF', d.p.ref]);
  }

  if (d.sn) rows.push(['เลขเครื่อง (SN)', d.sn]);
  if (d.lot) rows.push(['เลขล็อต (LOT)', d.lot]);
  if (d.gtin) rows.push(['บาร์โค้ด', d.gtin]);
  if (d.mfgDate) rows.push(['Mfg Date', d.mfgDate]);
  if (d.expiry) rows.push(['Expiry', d.expiry]);

  if (!rows.length) rows.push(['ข้อมูล', d.raw]);

  const photo = productPhotoUrl(d.p);
  document.getElementById('rkv').innerHTML =
    (photo ? `<dt>รูป</dt><dd class="scan-photo"><img src="${escapeHtml(photo)}" alt=""></dd>` : '') +
    rows.map(([k,v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join('');

  if (d.p && d.p.type) {
    document.getElementById('iType').value = d.p.type;
  }

  document.getElementById('rbox').classList.add('on');
  document.getElementById('sf').style.display = 'block';
  updateSnLotField(true);
  updateModeUI();
}

function resetScan(opts = {}) {
  const shouldResumeHid = HID_AUTO_RESUME;
  HID_AUTO_RESUME = false;
  LAST = null;
  PENDING_SCAN = null;
  clearScanDedup();
  HID_BUFFER = '';
  clearTimeout(hidBufferTimer);
  clearHidInput();
  document.getElementById('rkv').innerHTML = '';
  document.getElementById('rbox').classList.remove('on');
  document.getElementById('sf').style.display = 'none';
  hideManualProductPanel();
  document.getElementById('mc').value = '';
  document.getElementById('qtyI').value = '1';
  const snLot = document.getElementById('snLotI');
  if (snLot) {
    snLot.value = '';
    snLot.dataset.trackType = '';
  }
  const snLotRow = document.getElementById('snLotRow');
  if (snLotRow) snLotRow.style.display = 'none';
  document.getElementById('noteI').value = '';
  const p = document.getElementById('purposeI'); if (p) p.value = '';
  const po = document.getElementById('purposeOtherI'); if (po) { po.value = ''; po.style.display = 'none'; }
  ['buyerNameI','hospitalI','poNoI','saleDateI','salePriceI','wholesalePriceI','maskModelI','maskSizeI'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  if (opts.clearLocation) document.getElementById('locI').value = '';
  if (!opts.keepScanner) {
    stopScannerOnly();
    document.getElementById('reader').innerHTML = '';
  }
  if (shouldResumeHid) {
    enableHIDMode(true);
  } else if (HID_ENABLED) {
    focusScanInput(100);
  } else {
    focusScanInput(100);
  }
}


function _patchCache(action, b) {
  const type = b.type;
  const qty  = Number(b.qty || 1);

  if (action === 'in') {
    if (type === 'device') {
      CACHE.device.push({
        'Product Name':        b.name     || '',
        'Brand':               b.brand    || '',
        'Model':               b.model    || '',
        'Serial Number (SN)':  b.sn       || '',
        'LOT Number':          b.lot      || '',
        'GTIN / Barcode':      b.gtin     || '',
        'Location / Hospital': b.location || '',
        'Status': 'Active',
        'Note':   b.note || '',
        _type: 'device'
      });
    } else {
      const arr = type === 'mask' ? CACHE.mask : CACHE.accessory;
      const hit = arr.find(x =>
        _gs1NormLot(x['LOT Number'] || '') === _gs1NormLot(b.lot || '') &&
        (x['Product Name'] || '') === (b.name || '') &&
        (type !== 'mask' || (x['Size'] || '') === (b.size || ''))
      );
      if (hit) {
        hit['Qty'] = (Number(hit['Qty']) || 0) + qty;
      } else {
        arr.push({
          'Product Name':   b.name     || '',
          'Brand':          b.brand    || '',
          'Model':          b.model    || '',
          'Size':           b.size     || '',
          'REF':            b.ref      || '',
          'LOT Number':     b.lot      || '',
          'GTIN / Barcode': b.gtin     || '',
          'Mfg Date':       b.mfgDate  || '',
          'Expiry':         b.expiry   || '',
          'Location':       b.location || '',
          'Qty':    qty,
          'Status': 'Active',
          _type: type
        });
      }
    }
  }

  if (action === 'out') {
    if (type === 'device') {
      const idx = CACHE.device.findIndex(x =>
        (b.sheetRow && Number(x._sheetRow) === Number(b.sheetRow)) ||
        (b.sn && (x['Serial Number (SN)'] || '').toUpperCase() === b.sn.toUpperCase()) ||
        (b.lot && _gs1NormLot(x['LOT Number'] || '') === _gs1NormLot(b.lot))
      );
      if (idx !== -1) CACHE.device.splice(idx, 1);
    } else {
      const arr = type === 'mask' ? CACHE.mask : CACHE.accessory;
      const hit = arr.find(x =>
        (b.sheetRow && Number(x._sheetRow) === Number(b.sheetRow)) ||
        (_gs1NormLot(x['LOT Number'] || '') === _gs1NormLot(b.lot || '') &&
          (x['Product Name'] || '') === (b.name || '') &&
          (type !== 'mask' || (x['Size'] || '') === (b.size || '')))
      );
      if (hit) {
        hit['Qty'] = Math.max(0, (Number(hit['Qty']) || 0) - qty);
        if (hit['Qty'] === 0) arr.splice(arr.indexOf(hit), 1);
      }
    }
  }

  invalidateActiveStockCache();
  
  const now = new Date();
  CACHE.history.unshift({
    'Date':                now.toLocaleDateString('th-TH'),
    'Time':                now.toLocaleTimeString('th-TH', {hour:'2-digit', minute:'2-digit'}),
    'Type':                type,
    'Product Name':        b.name     || '',
    'Brand':               b.brand    || '',
    'Serial / LOT':        b.sn ? 'SN: '+b.sn : (b.lot ? 'LOT: '+b.lot : ''),
    'Action':              action === 'in' ? 'Stock In' : 'Stock Out',
    'Purpose':             b.purpose || '',
    'Location / Recipient':b.location || '',
    'Recorded By':         b.user     || CUR_USER || '',
    'Qty':                 qty,
    'Model':               b.model || '',
    'Size':                b.size || '',
    'Reference':           b.ref || '',
    'Buyer Name':          b.buyerName || '',
    'Hospital':            b.hospital || '',
    'PO No':               b.poNo || '',
    'Sale Date':           b.saleDate || '',
    'Sale Price':          b.salePrice || '',
    'Wholesale Price':     b.wholesalePrice || '',
    'Note':                b.note     || '',
  });
  if (CACHE.history.length > 200) CACHE.history.length = 200;
  _patchMonthlyOutSummary(action, b);
}

function _scheduleBgSync() {
  clearTimeout(_bgSyncTimer);
  _bgSyncTimer = setTimeout(async () => {
    try {
      await loadAll(); _lastSyncTime = Date.now();
    } catch(e) {
      setTimeout(async () => {
        try { await loadAll(); _lastSyncTime = Date.now(); } catch(e2) {}
      }, 5_000);
    }
  }, 8_000);  
}

async function doAct(action) {
  if (!LAST) {
    toast(action === 'out' ? 'กรุณาสแกนหรือเลือกสินค้าในสต็อกก่อนจ่ายออก' : 'กรุณาสแกนหรือเลือกสินค้าก่อนรับเข้า', 'warn');
    focusScanInput(80);
    return;
  }
  if (IS_PROCESSING) return;
  IS_PROCESSING = true;

  const stockItem = action === 'out' ? LAST.stockItem : null;
  const type = stockItem?._type || document.getElementById('iType').value;
  const loc  = document.getElementById('locI').value.trim();
  const note = document.getElementById('noteI').value.trim();
  const qtyInput = parseInt(document.getElementById('qtyI').value || '', 10);
  const qty  = transactionNeedsQty(action, type)
    ? Math.min(9999, Math.max(1, isNaN(qtyInput) ? 0 : qtyInput))
    : 1;
  const purpose = document.getElementById('purposeI')?.value || '';
  const purposeOther = document.getElementById('purposeOtherI')?.value.trim() || '';
  const { model: salesModelInput, size: salesSizeInput, ...salesDetails } = getSalesDetailInputs();
  const tracking = requiredTrackingValue(type);
  const sn = stockItem ? (stockItem['Serial Number (SN)'] || LAST.sn || '') : (tracking.key === 'sn' ? tracking.value : (LAST.sn || ''));
  const lot = stockItem ? (stockItem['LOT Number'] || LAST.lot || '') : (tracking.key === 'lot' ? tracking.value : (LAST.lot || ''));
  if (action === 'in' && !stockItem) {
    const completed = completeProductFromScan(LAST);
    if (completed) LAST.p = completed;
  }

  let name = stockItem ? (stockItem['Product Name'] || '') : (LAST.p?.name || sn || LAST.raw);
  let brand = stockItem ? (stockItem['Brand'] || '') : (LAST.p?.brand || '');
  let model = stockItem ? (stockItem['Model'] || '') : (LAST.p?.model || '');
  let size = stockItem ? (stockItem['Size'] || '') : (LAST.p?.size || '');
  let ref = stockItem ? (stockItem['REF'] || '') : (LAST.p?.ref || '');
  const payloadModel = action === 'out' && salesModelInput ? salesModelInput : model;
  const payloadSize = action === 'out' && salesSizeInput ? salesSizeInput : size;
  const gtin = stockItem ? (stockItem['GTIN / Barcode'] || '') : LAST.gtin;
  const maxStockQty = stockItem && type !== 'device' ? Number(stockItem['Qty'] || 0) : 1;

  if (type === 'device' && !sn && !(action === 'out' && stockItem)) {
    toast('กรุณากรอกเลขเครื่อง (SN) ก่อนบันทึก', 'warn');
    IS_PROCESSING = false;
    updateActionButtons();
    return;
  }
  if ((type === 'mask' || type === 'accessory') && !lot && !(action === 'out' && stockItem)) {
    toast('กรุณากรอกเลขล็อต (LOT) ก่อนบันทึก', 'warn');
    IS_PROCESSING = false;
    updateActionButtons();
    return;
  }
  if (transactionNeedsQty(action, type) && (!qty || qty <= 0)) {
    toast('กรุณากรอกจำนวนให้ถูกต้อง', 'warn');
    IS_PROCESSING = false;
    return;
  }
  const identityError = action === 'in' ? stockInIdentityError(type, { name, model, size, ref }) : '';
  if (identityError) {
    toast(identityError, 'warn');
    IS_PROCESSING = false;
    updateActionButtons();
    focusScanInput(120);
    return;
  }
  if (action === 'out' && stockItem && type !== 'device' && qty > maxStockQty) {
    toast('จำนวนจ่ายออกมากกว่าคงเหลือ (' + maxStockQty + ' ชิ้น)', 'warn');
    IS_PROCESSING = false;
    updateActionButtons();
    return;
  }
  if (action === 'out' && (!loc || !purpose || (purpose === 'อื่นๆ' && !purposeOther))) {
    toast('กรุณาระบุวัตถุประสงค์และผู้เบิกให้ครบ', 'warn');
    IS_PROCESSING = false;
    return;
  }

  document.getElementById('bIn').disabled = true;
  document.getElementById('bOut').disabled = true;
  setPill('busy');

  try {
    const submitAction = stockItem?._sheetRow ? 'out_by_id' : action;
    const payload = {
      action: submitAction,
      type,
      ...(submitAction === 'out_by_id' ? { sheetRow: stockItem._sheetRow } : {}),
      name,
      brand,
      model: payloadModel,
      size: payloadSize,
      ref,
      sn,
      lot,
      gtin,
      mfgDate: LAST.mfgDate,
      expiry: LAST.expiry,
      location: loc,
      recipient: loc,
      purpose,
      purposeOther,
      note,
      qty,
      ...salesDetails,
      productCode: LAST.p?.product_code || '',
      user: CUR_USER,
      staffName: CUR_STAFF
    };
    if (LAST.learnGtin || LAST.learnLot || LAST.learnSn) {
      payload.learnMapping = {
        gtin: LAST.learnGtin || '',
        lot: LAST.learnLot || '',
        sn: LAST.learnSn || '',
        raw: LAST.learnRaw || '',
        product_code: LAST.p?.product_code || ''
      };
    }

    const res = await apiPost(payload);
    if (!res.ok) {
      if (res.error === 'DUPLICATE') {
        const d = res.duplicate || {};
        const detail = d.row ? ` (Active row ${d.row})` : '';
        toast('สินค้านี้ยังมีในสต็อก' + detail, 'warn');
        setPill('ok');
        focusScanInput(120);
        return;
      }
      if (res.error === 'Item not found') {
        toast('ไม่พบในสต็อก — ลองเลือกประเภทให้ถูกต้อง หรือตรวจสอบเลขเครื่อง/เลขล็อต', 'err');
        setPill('err');
        focusScanInput(120);
        return;
      }
      throw new Error(res.error || 'API error');
    }
    
    _patchCache(action, payload);  
    learnMappingIntoCache(payload);
    renderStock();
    renderHist(false);
    updateStats();
    setPill('ok');
    resetScan({
      clearLocation: action === 'in',
      keepScanner: action === 'in' && scanOn
    });

    if (action === 'out') {
      document.getElementById('locI').value = '';
      const purposeEl = document.getElementById('purposeI');
      const purposeOtherEl = document.getElementById('purposeOtherI');
      if (purposeEl) purposeEl.value = '';
      if (purposeOtherEl) {
        purposeOtherEl.value = '';
        purposeOtherEl.style.display = 'none';
      }
      ['buyerNameI','hospitalI','poNoI','saleDateI','salePriceI','wholesalePriceI','maskModelI','maskSizeI'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
      updateActionButtons();
      focusScanInput(80);
      toast('จ่ายออกสำเร็จ', 'ok');
    } else if (res.merged) {
      toast('รับเข้าแล้ว — รวมกับล็อตเดิม (คงเหลือ ' + res.newQty + ' ชิ้น)', 'ok');
    } else {
      toast('รับเข้าสำเร็จ', 'ok');
    }

    _scheduleBgSync();  
  } catch(e) {
    setPill('err');
    toast(e.message, 'err');
  } finally {
    document.getElementById('bIn').disabled = false;
    document.getElementById('bOut').disabled = false;
    updateActionButtons();
    IS_PROCESSING = false;
    focusScanInput(120);
  }
}

let _qoItem = null;

function quickOut(item) {
  _qoItem = item;
  document.getElementById('modalItemName').textContent =
    (item['Product Name'] || '-') + (item['Brand'] ? ' · ' + item['Brand'] : '');
  document.getElementById('modalWho').value = '';
  document.getElementById('modalPurpose').value = '';
  document.getElementById('modalPurposeOther').value = '';
  document.getElementById('modalPurposeOther').style.display = 'none';
  
  const isAgg = item._type === 'mask' || item._type === 'accessory';
  const qtyEl = document.getElementById('modalQty');
  qtyEl.style.display = isAgg ? 'block' : 'none';
  qtyEl.value = '1';
  const maxQty = isAgg ? Number(item['Qty'] || 1) : 1;
  qtyEl.max = maxQty;
  document.getElementById('quickOutModal').classList.add('on');
  setTimeout(() => document.getElementById('modalWho').focus(), 80);
}

function closeModal() {
  document.getElementById('quickOutModal').classList.remove('on');
  _qoItem = null;
}

async function confirmQuickOut() {
  if (IS_PROCESSING) return;
  const who = document.getElementById('modalWho').value.trim();
  const purpose = document.getElementById('modalPurpose').value;
  const purposeOther = document.getElementById('modalPurposeOther').value.trim();
  if (!who) { document.getElementById('modalWho').focus(); return; }
  if (!purpose || (purpose === 'อื่นๆ' && !purposeOther)) { document.getElementById('modalPurpose').focus(); return; }

  const item = _qoItem;
  closeModal();
  if (!item) return;

  const useById = !!item._sheetRow;

  const isAgg = item._type === 'mask' || item._type === 'accessory';
  const _parsedQty = parseInt(document.getElementById('modalQty').value || '1', 10);
  const outQty = isAgg
    ? Math.min(Number(item['Qty'] || 1), Math.max(1, isNaN(_parsedQty) ? 1 : _parsedQty))
    : 1;

  const payload = {
    action: useById ? 'out_by_id' : 'out',
    type: item._type,
    ...(useById ? { sheetRow: item._sheetRow } : {}),
    name: item['Product Name'] || '',
    brand: item['Brand'] || '',
    model: item['Model'] || '',
    size: item['Size'] || '',
    ref: item['REF'] || '',
    sn: item['Serial Number (SN)'] || '',
    lot: item['LOT Number'] || '',
    gtin: item['GTIN / Barcode'] || '',
    location: who,
    recipient: who,
    purpose,
    purposeOther,
    note: 'quick out from stock card',
    qty: outQty,
    buyerName: '',
    hospital: '',
    poNo: '',
    saleDate: '',
    salePrice: '',
    wholesalePrice: '',
    user: CUR_USER,
    staffName: CUR_STAFF
  };

  IS_PROCESSING = true;
  setPill('busy');
  try {
    const res = await apiPost(payload);
    if (!res.ok) throw new Error(res.error || 'API error');
    toast('จ่ายออกให้ ' + who + ' สำเร็จ', 'ok');
    _patchCache('out', payload);  
    renderStock();
    renderHist(false);
    updateStats();
    setPill('ok');
    _scheduleBgSync();
  } catch(e) {
    setPill('err');
    toast(e.message, 'err');
  } finally {
    IS_PROCESSING = false;
    updateActionButtons();
    focusScanInput(120);
  }
}


document.addEventListener('click', e => {
  const modal = document.getElementById('quickOutModal');
  if (e.target === modal) closeModal();
});

function updateStats() {
  document.getElementById('sDv').textContent = CACHE.device.length || 0;
  document.getElementById('sMk').textContent = sumQty(CACHE.mask, 'Qty') || 0;
  document.getElementById('sAc').textContent = sumQty(CACHE.accessory, 'Qty') || 0;
  renderStockBreakdown();
}

function renderStockBreakdown() {
  const el = document.getElementById('stockBreakdown');
  if (!el) return;

  const deviceRows = _groupRows(CACHE.device, it => [
    it['Model'] || '-',
    it['Product Name'] || '-',
    it['Brand'] || ''
  ], () => 1).map(x => ({
    main: x.key[0],
    sub: [x.key[1], x.key[2]].filter(Boolean).join(' · '),
    qty: x.qty
  }));

  const maskRows = _groupRows(CACHE.mask, it => [
    it['Model'] || '-',
    it['Size'] || '-',
    it['REF'] || '',
    it['Product Name'] || '-',
    it['Brand'] || ''
  ], it => Number(it['Qty'] || 0)).map(x => ({
    main: `${x.key[0]} / ${x.key[1]}`,
    sub: [x.key[3], x.key[4], x.key[2] ? 'REF '+x.key[2] : ''].filter(Boolean).join(' · '),
    qty: x.qty
  }));

  const accessoryRows = _groupRows(CACHE.accessory, it => [
    it['Product Name'] || '-',
    it['Brand'] || ''
  ], it => Number(it['Qty'] || 0)).map(x => ({
    main: x.key[0],
    sub: x.key[1],
    qty: x.qty
  }));

  el.innerHTML = [
    _breakdownCard('device', 'Device by Model', deviceRows),
    _breakdownCard('mask', 'Mask by Model / Size', maskRows),
    _breakdownCard('accessory', 'Accessory by Product', accessoryRows),
  ].join('');
}

function _groupRows(rows, keyFn, qtyFn) {
  const map = new Map();
  (rows || []).forEach(it => {
    const key = keyFn(it);
    const id = key.join('|').toUpperCase();
    const cur = map.get(id) || { key, qty:0 };
    cur.qty += qtyFn(it);
    map.set(id, cur);
  });
  return Array.from(map.values()).sort((a,b) =>
    String(a.key[0]).localeCompare(String(b.key[0])) ||
    String(a.key[1] || '').localeCompare(String(b.key[1] || ''))
  );
}

function _breakdownCard(type, title, rows) {
  const body = (rows || []).length
    ? rows.map(r => `
      <div class="bdash-row">
        <div>
          <div class="bdash-main">${escapeHtml(r.main)}</div>
          <div class="bdash-sub">${escapeHtml(r.sub || '')}</div>
        </div>
        <div class="bdash-qty">${escapeHtml(String(r.qty || 0))}</div>
      </div>
    `).join('')
    : `<div class="bdash-row"><div class="bdash-sub">No stock</div><div class="bdash-qty">0</div></div>`;
  return `<div class="bdash-card"><div class="bdash-h ${type}">${escapeHtml(title)}</div>${body}</div>`;
}

function flt(type, el) {
  sflt = type;
  document.querySelectorAll('.chip').forEach(x => x.classList.remove('on'));
  if (el) el.classList.add('on');
  renderStock();
}

const WARN_DAYS = 90;
const LOW_QTY   = 3;

function _expDaysOf(it) {
  const expRaw = it['Expiry'] || it['Expiry Date'] || '';
  if (!expRaw) return null;
  const today = new Date(); today.setHours(0,0,0,0);
  const parts = String(expRaw).split('/');
  let expDate = parts.length === 3 ? new Date(+parts[2], +parts[1]-1, +parts[0]) : new Date(expRaw);
  if (isNaN(expDate)) return null;
  return Math.ceil((expDate - today) / 86400000);
}

function renderAttention(items) {
  const box = document.getElementById('attnBox');
  if (!box) return;

  const flagged = items.map((it) => {
    const expDays = _expDaysOf(it);
    const qty = Number(it['Qty'] || 0);
    const low = it._type !== 'device' && qty <= LOW_QTY;
    const exp = expDays !== null && expDays <= WARN_DAYS;
    return { it, qty, expDays, low, exp };
  }).filter(x => x.low || x.exp);
  const salesAlerts = (CACHE.salesAlerts || []).map(a => ({ sales:a }));

  if (!flagged.length && !salesAlerts.length) {
    box.style.display = 'none';
    box.innerHTML = '';
    return;
  }

  flagged.sort((a, b) => {
    const pa = a.expDays !== null ? a.expDays : Infinity;
    const pb = b.expDays !== null ? b.expDays : Infinity;
    return pa - pb;
  });

  const combined = [...salesAlerts, ...flagged].slice(0, 8);
  const total = salesAlerts.length + flagged.length;
  const more = total - combined.length;

  box.innerHTML = `
    <div class="attn-hd">ต้องตรวจสอบ (${total} รายการ)</div>
    ${combined.map(x => {
      if (x.sales) {
        const a = x.sales;
        return `
          <div class="attn-row" data-hrow="${escapeHtml(String(a.historyRow || ''))}">
            <div>
              <div class="attn-main">${escapeHtml(a.productName || '-')}</div>
              <div class="attn-sub">${escapeHtml(a.message || '')}<br>${escapeHtml(a.recipient || '-')} · ${escapeHtml(a.serialLot || '-')}</div>
            </div>
            <span class="attn-tag exp">${escapeHtml(String(a.ageDays || 0))} วัน</span>
          </div>
        `;
      }
      const name = x.it['Product Name'] || '-';
      const sub = x.it._type === 'device'
        ? ('SN ' + (x.it['Serial Number (SN)'] || '-'))
        : ('LOT ' + (x.it['LOT Number'] || '-'));
      let tag = '';
      if (x.expDays !== null && x.expDays <= WARN_DAYS) {
        tag = x.expDays <= 0
          ? `<span class="attn-tag exp">หมดอายุแล้ว</span>`
          : `<span class="attn-tag exp">${x.expDays} วัน</span>`;
      } else if (x.low) {
        tag = `<span class="attn-tag low">สต็อกต่ำ (${x.qty})</span>`;
      }
      return `
        <div class="attn-row" data-q="${escapeHtml(name)}">
          <div>
            <div class="attn-main">${escapeHtml(name)}</div>
            <div class="attn-sub">${escapeHtml(sub)}</div>
          </div>
          ${tag}
        </div>
      `;
    }).join('')}
    ${more > 0 ? `<div class="attn-more">…และอีก ${more} รายการ</div>` : ''}
  `;
  box.style.display = 'block';

  box.querySelectorAll('.attn-row').forEach(row => {
    row.onclick = () => {
      const hrow = row.getAttribute('data-hrow');
      if (hrow) {
        goTab('sales');
        setTimeout(() => {
          const target = document.querySelector(`[data-history-row="${CSS.escape(hrow)}"]`);
          if (target) target.scrollIntoView({behavior:'smooth', block:'center'});
        }, 80);
        return;
      }
      const q = row.getAttribute('data-q') || '';
      const input = document.getElementById('stockSearch');
      if (input) { input.value = q; }
      renderStock();
      box.scrollIntoView({behavior:'smooth', block:'start'});
    };
  });
}

function renderStock() {
  const list = document.getElementById('stList');
  const q = (document.getElementById('stockSearch')?.value || '').toLowerCase().trim();

  const allItems = [
    ...CACHE.device.map(x => ({...x, _type:'device'})).sort((a,b) => {
      const sa = a['Status'] === 'Active' ? 0 : 1;
      const sb = b['Status'] === 'Active' ? 0 : 1;
      if (sa !== sb) return sa - sb;
      return (a['Serial Number (SN)'] || '').localeCompare(b['Serial Number (SN)'] || '');
    }),
    ...CACHE.mask.map(x => ({...x, _type:'mask'})),
    ...CACHE.accessory.map(x => ({...x, _type:'accessory'}))
  ];

  renderAttention(allItems);

  const items = allItems.filter(x => {
    if (sflt !== 'all' && x._type !== sflt) return false;
    if (!q) return true;
    const hay = [
      x['Product Name'], x['Brand'], x['Model'],
      x['Serial Number (SN)'], x['LOT Number'], x['GTIN / Barcode'],
      x['Location'], x['Location / Hospital']
    ].join(' ').toLowerCase();
    return hay.includes(q);
  });

  if (!items.length) {
    list.innerHTML = `<div class="empty"><div>ไม่พบข้อมูลในสต็อก</div></div>`;
    return;
  }

  list.innerHTML = items.map((it, idx) => {
    const badgeCls = it._type === 'device' ? 'bd2' : it._type === 'mask' ? 'bm' : 'ba';
    const qty   = Number(it['Qty'] || 0);
    const loc   = it['Location'] || it['Location / Hospital'] || '-';
    const expRaw = it['Expiry'] || it['Expiry Date'] || '';
    const expDays = _expDaysOf(it);

    const sub = [it['Brand'], it['Model'], it['Size']].filter(Boolean).join(' · ') || '-';
    const idLine = it._type === 'device'
      ? ('SN ' + (it['Serial Number (SN)'] || '-'))
      : ('LOT ' + (it['LOT Number'] || '-'));
    const photo = photoUrlForStockItem(it);

    let expBadge = '';
    if (expDays !== null && expDays <= WARN_DAYS) {
      expBadge = expDays <= 0
        ? `<span class="badge-exp">หมดอายุแล้ว</span>`
        : `<span class="badge-exp">${expDays} วัน</span>`;
    }

    const lowBadge = (it._type !== 'device' && qty <= LOW_QTY)
      ? `<span class="badge-low">สต็อกต่ำ</span>` : '';

    return `
      <div class="ic ${it._type}">
        <div class="ic-top">
          ${photo ? `<img class="prod-thumb" src="${escapeHtml(photo)}" alt="">` : ''}
          <div class="ic-nm">${escapeHtml(it['Product Name'] || '-')}</div>
          <div class="bg ${badgeCls}">${escapeHtml(it._type)}</div>
        </div>
        <div class="ic-sub">${escapeHtml(sub)}</div>
        <div class="ic-id">${escapeHtml(idLine)}</div>
        <div class="ic-ft">
          <div class="ic-meta">
            <span>${escapeHtml(loc)}</span>
            ${expRaw ? `<span>หมดอายุ ${escapeHtml(String(expRaw))}</span>` : ''}
            ${expBadge}${lowBadge}
          </div>
          <div class="ic-right">
            ${it._type !== 'device' ? `<div class="ic-qty">${escapeHtml(String(qty))}</div>` : ''}
            <button class="btn-co" data-idx="${idx}">จ่ายออก</button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  const buttons = list.querySelectorAll('.btn-co');
  buttons.forEach((btn, i) => {
    btn.onclick = function() { quickOut(items[i]); };
  });
}

function renderPurposeSummary(items) {
  const el = document.getElementById('purposeSummary');
  if (!el) return;
  const now = new Date();
  const month = now.toLocaleDateString('th-TH', { year:'numeric', month:'long' });
  const sums = {'ขาย':0,'ของแถม':0,'เดโม':0,'อื่นๆ':0};
  (items || CACHE.history || []).forEach(it => {
    if (String(it['Action'] || '') !== 'Stock Out') return;
    if (!isHistoryInCurrentMonth(it, now)) return;
    const rawPurpose = historyPurpose(it);
    const p = rawPurpose.startsWith('อื่นๆ') ? 'อื่นๆ' : (rawPurpose || 'อื่นๆ');
    sums[p] = (sums[p] || 0) + historyQty(it);
  });
  el.innerHTML = `<div class="asum-hd"><span class="atag">อัตโนมัติ</span><h3>สรุปจ่ายออกตามวัตถุประสงค์ (${escapeHtml(month)})</h3></div>` + Object.entries(sums).map(([k,v]) => `<div class="bdash-row"><div>${escapeHtml(k)}</div><div class="bdash-qty">${v}</div></div>`).join('');
}

function renderMonthlyOutSummary() {
  const el = document.getElementById('monthlyOutSummary');
  if (!el) return;
  const data = CACHE.monthlyOut || monthlyOutSummaryFromHistory(CACHE.history || []);
  const now = new Date();
  const year = data.year || now.getFullYear();
  const monthNum = data.month || (now.getMonth() + 1);
  const month = new Date(year, monthNum - 1, 1).toLocaleDateString('th-TH', { year:'numeric', month:'long' });
  const rows = (data.rows || []).slice(0, 20);

  if (!rows.length) {
    el.innerHTML = `<div class="scrd"><h3>สรุปจ่ายออกรายสินค้า (${escapeHtml(month)})</h3><div class="empty"><div>ยังไม่มีรายการจ่ายออกในเดือนนี้</div></div></div>`;
    return;
  }

  const totalQty = Number(data.totalQty || rows.reduce((n, r) => n + Number(r.qty || 0), 0));

  const totalCardHtml = `<div class="scrd">
    <h3>สรุปจ่ายออกรายสินค้า (${escapeHtml(month)})</h3>
    <div class="bdash-row"><div>รวมจ่ายออกเดือนที่เลือก</div><div class="bdash-qty">${escapeHtml(String(totalQty))}</div></div>
  </div>`;

  const chartsInner = renderMaskSalesCharts(data);
  const chartsCardHtml = chartsInner ? `<div class="scrd"><h3>กราฟภาพรวมหน้ากาก</h3>${chartsInner}</div>` : '';

  const rowsHtml = rows.map(r => {
      const currentQty = currentQtyForMonthlyRow(r);
      const forecastQty = Number(r.forecastQty || r.qty || 0);
      const suggested = Math.max(0, forecastQty - currentQty);
      const typeLower = String(r.type || '').toLowerCase();
      const badgeCls = typeLower.includes('device') ? 'bd2' : typeLower.includes('mask') ? 'bm' : 'ba';
      const typeLabel = typeLower.includes('device') ? 'Device' : typeLower.includes('mask') ? 'Mask' : typeLower.includes('accessory') ? 'Accessory' : (r.type || '-');
      const sub = [
        r.brand || '',
        r.model ? 'รุ่น ' + r.model : '',
        r.size ? 'ไซส์ ' + r.size : ''
      ].filter(Boolean).join(' · ');
      const stats = [
        sub || '',
        'คงเหลือ ' + currentQty,
        'จ่ายออกเดือนที่เลือก ' + Number(r.qty || 0),
        'เฉลี่ย 3 เดือนก่อน ' + Number(r.prevAvg || 0),
        'เดือนเดียวกันปีก่อน ' + Number(r.sameMonthLastYearQty || 0),
        'Forecast ' + forecastQty
      ].filter(Boolean).join(' · ');
      return `<div class="prow">
        <div class="prow-top">
          <div class="prow-nm">${escapeHtml(r.productName || '-')}</div>
          <span class="bg ${badgeCls}">${escapeHtml(typeLabel)}</span>
        </div>
        <div class="rord ${suggested ? '' : 'ok'}">
          <span class="k">${suggested ? 'แนะนำสั่งเพิ่ม' : 'สต็อกเพียงพอ'}</span>
          <span class="v">${suggested ? escapeHtml(String(suggested)) + ' ชิ้น' : 'คงเหลือ ' + escapeHtml(String(currentQty))}</span>
        </div>
        <div class="hm">${escapeHtml(stats)}</div>
      </div>`;
    }).join('');

  const rowsCardHtml = `<div class="scrd"><h3>รายละเอียดสินค้า (${rows.length} รายการ)</h3>${rowsHtml}</div>`;

  el.innerHTML = totalCardHtml + chartsCardHtml + rowsCardHtml;
}

function renderMaskSalesCharts(data) {
  const maskRows = (data.rows || [])
    .filter(r => isMaskSummaryRow(r))
    .map(r => ({
      ...r,
      modelKey: maskModelLabel(r),
      sizeKey: maskSizeLabel(r),
      qty: Number(r.qty || 0),
      forecastQty: Number(r.forecastQty || r.qty || 0)
    }))
    .filter(r => r.qty || r.forecastQty);
  if (!maskRows.length) return '';

  const byModel = sumRows(maskRows, r => r.modelKey, r => r.qty);
  const modelBars = Object.entries(byModel)
    .map(([label, qty]) => ({label, qty}))
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 10);

  const byModelSize = {};
  maskRows.forEach(r => {
    if (!byModelSize[r.modelKey]) byModelSize[r.modelKey] = {};
    byModelSize[r.modelKey][r.sizeKey] = (byModelSize[r.modelKey][r.sizeKey] || 0) + r.qty;
  });
  const sizeGroups = Object.entries(byModelSize)
    .map(([model, sizes]) => ({
      model,
      total: Object.values(sizes).reduce((n, v) => n + Number(v || 0), 0),
      bars: Object.entries(sizes)
        .map(([label, qty]) => ({label, qty}))
        .sort((a, b) => b.qty - a.qty)
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 4);

  return `<div class="chart-grid">
    <div class="chart-card">
      <div class="chart-title">กราฟเทียบจำนวนจ่ายออกตามรุ่นหน้ากาก</div>
      ${barChartHtml(modelBars, {fillClass:'mask'})}
      <div class="chart-sub">ใช้ยอดจ่ายออกของเดือนที่เลือก เพื่อดูว่ารุ่นไหนขาย/เบิกมากที่สุด</div>
    </div>
    ${sizeGroups.map(g => `<div class="chart-card">
      <div class="chart-title">แยกไซส์: ${escapeHtml(g.model)}</div>
      ${barChartHtml(g.bars, {fillClass:'mask'})}
    </div>`).join('')}
  </div>`;
}

function barChartHtml(items, opts = {}) {
  if (!items.length) return '<div class="hm">ยังไม่มีข้อมูลสำหรับกราฟ</div>';
  const max = Math.max(...items.map(x => Number(x.qty || 0)), 1);
  const fillClass = opts.fillClass ? ' ' + opts.fillClass : '';
  return `<div class="chart-bars">${items.map(x => {
    const qty = Number(x.qty || 0);
    const width = Math.max(3, Math.round((qty / max) * 100));
    return `<div class="chart-row">
      <div class="chart-label" title="${escapeHtml(x.label)}">${escapeHtml(x.label)}</div>
      <div class="chart-track"><div class="chart-fill${fillClass}" style="width:${width}%"></div></div>
      <div class="chart-value">${escapeHtml(String(qty))}</div>
    </div>`;
  }).join('')}</div>`;
}

function isMaskSummaryRow(r) {
  const type = String(r.type || '').toLowerCase();
  return type.includes('mask') || !!r.size;
}

function maskModelLabel(r) {
  return String(r.model || r.productName || 'ไม่ระบุรุ่น').trim() || 'ไม่ระบุรุ่น';
}

function maskSizeLabel(r) {
  return String(r.size || 'ไม่ระบุไซส์').trim() || 'ไม่ระบุไซส์';
}

function sumRows(rows, keyFn, valueFn) {
  return rows.reduce((acc, row) => {
    const key = keyFn(row);
    acc[key] = (acc[key] || 0) + Number(valueFn(row) || 0);
    return acc;
  }, {});
}

function currentMonthValue() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function syncOutMonthInput() {
  const el = document.getElementById('outMonthI');
  if (el && !el.value) el.value = SELECTED_OUT_MONTH;
}

function selectedOutMonthParts() {
  const el = document.getElementById('outMonthI');
  const value = (el && el.value) || SELECTED_OUT_MONTH || currentMonthValue();
  SELECTED_OUT_MONTH = value;
  const m = value.match(/^(\d{4})-(\d{2})$/);
  if (!m) {
    const now = new Date();
    return {year: now.getFullYear(), month: now.getMonth() + 1};
  }
  return {year: Number(m[1]), month: Number(m[2])};
}

async function loadMonthlyOutSummaryForSelected() {
  const outMonth = selectedOutMonthParts();
  const el = document.getElementById('monthlyOutSummary');
  if (el) el.innerHTML = '<h3>สรุปจ่ายออกรายสินค้า</h3><div class="hm">กำลังวิเคราะห์...</div>';
  try {
    const res = await apiFetch(buildApiUrl(API_URL, { action:'monthly_out_summary', year:outMonth.year, month:outMonth.month }));
    if (!res.ok) throw new Error(res.error || 'API error');
    CACHE.monthlyOut = res;
    renderMonthlyOutSummary();
  } catch(e) {
    CACHE.monthlyOut = monthlyOutSummaryFromHistory(CACHE.history);
    renderMonthlyOutSummary();
    if (el) el.insertAdjacentHTML('beforeend', `<div class="hm" style="margin-top:8px">${escapeHtml('โหลดรายงานจาก API ไม่สำเร็จ: ' + e.message)}<br>แสดงข้อมูลสำรองจากประวัติที่โหลดไว้แทน</div>`);
    toast('โหลดรายงาน forecast ไม่สำเร็จ: ' + e.message, 'err');
  }
}

function monthlyOutSummaryFromHistory(items) {
  const now = new Date();
  const map = new Map();
  (items || []).forEach(it => {
    if (String(it['Action'] || '') !== 'Stock Out') return;
    if (!isHistoryInCurrentMonth(it, now)) return;
    const inferred = inferHistoryModelSize(it);
    const row = {
      type: it['Type'] || '',
      productName: it['Product Name'] || '-',
      brand: it['Brand'] || '',
      reference: it['Reference'] || '',
      model: it['Model'] || inferred.model || '',
      size: it['Size'] || inferred.size || '',
    };
    const key = monthlySummaryKey(row);
    const cur = map.get(key) || {...row, qty:0};
    cur.qty += historyQty(it);
    map.set(key, cur);
  });
  const rows = Array.from(map.values()).sort((a,b) => Number(b.qty || 0) - Number(a.qty || 0));
  rows.forEach(r => {
    r.prevAvg = 0;
    r.sameMonthLastYearQty = 0;
    r.forecastQty = Number(r.qty || 0);
  });
  return {year: now.getFullYear(), month: now.getMonth() + 1, totalQty: rows.reduce((n,r) => n + Number(r.qty || 0), 0), rows};
}

function currentQtyForMonthlyRow(row) {
  const type = String(row.type || '').toLowerCase();
  const name = String(row.productName || '').trim().toLowerCase();
    const brand = String(row.brand || '').trim().toLowerCase();
  const model = String(row.model || '').trim().toLowerCase();
  const size = String(row.size || '').trim().toLowerCase();
  const match = it =>
    String(it['Product Name'] || '').trim().toLowerCase() === name &&
    (!brand || String(it['Brand'] || '').trim().toLowerCase() === brand) &&
    (!type.includes('mask') || !model || String(it['Model'] || '').trim().toLowerCase() === model) &&
    (!type.includes('mask') || !size || String(it['Size'] || '').trim().toLowerCase() === size);

  if (type.includes('device')) return (CACHE.device || []).filter(match).length;
  if (type.includes('mask')) return (CACHE.mask || []).filter(match).reduce((n, it) => n + Number(it['Qty'] || 0), 0);
  if (type.includes('accessory')) return (CACHE.accessory || []).filter(match).reduce((n, it) => n + Number(it['Qty'] || 0), 0);
  return [...(CACHE.device || []), ...(CACHE.mask || []), ...(CACHE.accessory || [])]
    .filter(match)
    .reduce((n, it) => n + (it._type === 'device' ? 1 : Number(it['Qty'] || 0)), 0);
}

function _patchMonthlyOutSummary(action, b) {
  if (action !== 'out') return;
  const now = new Date();
  if (CACHE.monthlyOut && (CACHE.monthlyOut.year !== now.getFullYear() || CACHE.monthlyOut.month !== now.getMonth() + 1)) return;
  if (!CACHE.monthlyOut) {
    CACHE.monthlyOut = {ok:true, year:now.getFullYear(), month:now.getMonth() + 1, totalQty:0, rows:[]};
  }
  const type = b.type === 'device' ? 'Device' : b.type === 'mask' ? 'Mask' : b.type === 'accessory' ? 'Accessory' : b.type;
  const row = {
    type,
    productName: b.name || '-',
    brand: b.brand || '',
    reference: b.ref || '',
    model: b.model || '',
    size: b.size || '',
    qty: Number(b.qty || 1),
    prevAvg: 0,
    sameMonthLastYearQty: 0,
    forecastQty: Number(b.qty || 1)
  };
  const key = monthlySummaryKey(row);
  const hit = CACHE.monthlyOut.rows.find(r => monthlySummaryKey(r) === key);
  if (hit) {
    hit.qty = Number(hit.qty || 0) + row.qty;
    hit.forecastQty = Math.ceil(Math.max(Number(hit.qty || 0), Number(hit.prevAvg || 0), Number(hit.sameMonthLastYearQty || 0)));
  }
  else CACHE.monthlyOut.rows.push(row);
  CACHE.monthlyOut.totalQty = Number(CACHE.monthlyOut.totalQty || 0) + row.qty;
  CACHE.monthlyOut.rows.sort((a,b) => Number(b.qty || 0) - Number(a.qty || 0));
}

function monthlySummaryKey(row) {
  const type = String(row.type || '').toLowerCase();
  return [
    row.type || '',
    row.productName || '',
    row.brand || '',
    type.includes('mask') ? (row.model || '') : '',
    type.includes('mask') ? (row.size || '') : ''
  ].join('|').toUpperCase();
}

function isHistoryInCurrentMonth(it, now = new Date()) {
  const raw = String(it?.['Date'] || '').trim();
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) {
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return false;
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return false;
  const month = Number(m[2]) - 1;
  let year = Number(m[3]);
  if (year > 2400) year -= 543;
  return month === now.getMonth() && year === now.getFullYear();
}

function historyPurpose(it) {
  return String(it['Purpose'] || it['purpose'] || it['วัตถุประสงค์'] || it['วัตถุประสงค์การเบิก'] || '').trim();
}

function historyRecipient(it) {
  return it['Location / Recipient'] || it['Recipient'] || it['Location'] || it['Location / Hospital'] || '';
}

function salesChoiceKey(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '');
}

function updateHospitalChoicesForSales(salesName = '') {
  const list = document.getElementById('hospitalChoices');
  if (!list) return;
  const salesKey = salesChoiceKey(salesName);
  const all = [...DEFAULT_HOSPITAL_CHOICES];
  const matched = [];
  (CACHE.history || []).forEach(it => {
    const hospital = String(it['Hospital'] || '').trim();
    if (!hospital || hospital === '-') return;
    all.push(hospital);
    const ownerKey = salesChoiceKey(historyRecipient(it));
    if (salesKey && ownerKey && (ownerKey.includes(salesKey) || salesKey.includes(ownerKey))) {
      matched.push(hospital);
    }
  });
  const values = [...new Set((matched.length ? matched : all).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'th'))
    .slice(0, 80);
  list.innerHTML = values.map(v => `<option value="${escapeHtml(v)}"></option>`).join('');
}

function historyRecordedBy(it) {
  return it['Recorded By'] || it['Record by'] || it['Record By'] || it['record by'] || it['User'] || '';
}

function historyQty(it) {
  const q = Number(it?.['Qty']);
  if (Number.isFinite(q) && q > 0) return q;
  return String(it?.['Action'] || '') === 'Stock Out' ? 1 : 0;
}

function historySearchText(it) {
  return [
    it['Product Name'],
    it['Brand'],
    it['Type'],
    it['Serial / LOT'],
    it['Serial Number (SN)'],
    it['SN'],
    it['LOT Number'],
    it['LOT'],
    it['Model'],
    it['Size'],
    it['Reference'],
    historyRecipient(it),
    historyRecordedBy(it),
    it['Operator'],
    it['Buyer Name'],
    it['Hospital'],
    it['PO No'],
    it['Purpose'],
    it['Note'],
    it['Date'],
    it['Time']
  ].filter(v => v !== null && v !== undefined).join(' ').toLowerCase();
}

function filteredHistoryItems(items) {
  const q = (document.getElementById('histSearch')?.value || '').trim().toLowerCase();
  if (!q) return items || [];
  const terms = q.split(/\s+/).filter(Boolean);
  return (items || []).filter(it => {
    const hay = historySearchText(it);
    return terms.every(term => hay.includes(term));
  });
}

function inferHistoryModelSize(it) {
  const current = {
    model: String(it['Model'] || '').trim(),
    size: String(it['Size'] || '').trim()
  };
  const type = String(it['Type'] || '').toLowerCase();
  if (type && !type.includes('mask')) return current;
  if (current.model && current.size) return current;

  const serialLot = String(it['Serial / LOT'] || it['LOT Number'] || it['LOT'] || '').trim().toUpperCase();
  const lotHit = inferFromLot(serialLot);
  const productName = String(it['Product Name'] || '').trim().toLowerCase();
  const brand = String(it['Brand'] || '').trim().toLowerCase();
  const productHit = (CACHE.products || []).find(p => {
    const names = [p.name, p.product_name, p.stock_name, p.po_name].filter(Boolean).map(x => String(x).trim().toLowerCase());
    const sameName = names.includes(productName);
    const sameBrand = !brand || String(p.brand || '').trim().toLowerCase() === brand;
    const sameLotModel = lotHit && lotHit.model && String(p.model || '').trim().toLowerCase() === String(lotHit.model).trim().toLowerCase();
    return sameBrand && (sameName || sameLotModel);
  });

  return {
    model: current.model || lotHit?.model || productHit?.model || '',
    size: current.size || lotHit?.size || productHit?.size || ''
  };
}

function salesDetailForm(it) {
  if (String(it['Action'] || '') !== 'Stock Out' || !it._sheetRow) return '';
  const row = String(it._sheetRow);
  const inferred = inferHistoryModelSize(it);
  return `
    <div class="mform" data-history-row="${escapeHtml(row)}" data-sales-owner="${escapeHtml(historyRecipient(it))}" style="margin-top:8px">
      <input type="text" class="finp" data-sales-field="buyerName" value="${escapeHtml(it['Buyer Name'] || '')}" placeholder="ชื่อผู้ซื้อ">
      <input type="text" class="finp" data-sales-field="hospital" list="hospitalChoices" value="${escapeHtml(it['Hospital'] || '')}" placeholder="เลือกโรงพยาบาลจากเซลล์" onfocus="updateHospitalChoicesForSales(this.closest('.mform')?.dataset.salesOwner || '')">
      <input type="text" class="finp" data-sales-field="poNo" value="${escapeHtml(it['PO No'] || '')}" placeholder="เลข PO">
      <input type="date" class="finp" data-sales-field="saleDate" value="${escapeHtml(formatDateInputValue(it['Sale Date'] || ''))}">
      <input type="number" class="finp" data-sales-field="salePrice" value="${escapeHtml(it['Sale Price'] || '')}" placeholder="ราคาขาย" min="0" step="0.01">
      <input type="number" class="finp" data-sales-field="wholesalePrice" value="${escapeHtml(it['Wholesale Price'] || '')}" placeholder="ราคาส่ง" min="0" step="0.01">
      ${maskModelSelectHtml(inferred.model, 'data-sales-field="model" onchange="updateHistoryMaskSizeChoices(this)"')}
      ${maskSizeSelectHtml(inferred.size, 'data-sales-field="size"', inferred.model)}
      <button onclick="saveSalesDetails(${escapeHtml(row)})">บันทึกข้อมูลขาย</button>
    </div>
  `;
}

function maskModelSelectHtml(value = '', attrs = '') {
  const opts = ['', ...maskModelChoicesFromDB()];
  return `<select class="fsel" ${attrs}>${opts.map(v => {
    const label = v || (opts.length > 1 ? 'เลือกรุ่นหน้ากากจาก ProductDB' : 'ยังไม่มีรุ่นหน้ากากใน ProductDB');
    return `<option value="${escapeHtml(v)}"${String(value) === v ? ' selected' : ''}>${escapeHtml(label)}</option>`;
  }).join('')}</select>`;
}

function maskSizeSelectHtml(value = '', attrs = '', model = '') {
  const opts = ['', ...maskSizeChoicesFromDB(model)];
  return `<select class="fsel" ${attrs}>${opts.map(v => {
    const label = v || (opts.length > 1 ? 'เลือกไซส์หน้ากากจาก ProductDB' : 'ยังไม่มีไซส์ใน ProductDB');
    return `<option value="${escapeHtml(v)}"${String(value) === v ? ' selected' : ''}>${escapeHtml(label)}</option>`;
  }).join('')}</select>`;
}

function updateHistoryMaskSizeChoices(modelEl) {
  const form = modelEl?.closest('.mform');
  if (!form) return;
  const sizeEl = form.querySelector('[data-sales-field="size"]');
  if (!sizeEl) return;
  const current = sizeEl.value || '';
  const sizes = maskSizeChoicesFromDB(modelEl.value || '');
  sizeEl.innerHTML = optionHtml('', current, sizes.length ? 'เลือกไซส์หน้ากากจาก ProductDB' : 'ยังไม่มีไซส์ของรุ่นนี้ใน ProductDB')
    + sizes.map(v => optionHtml(v, current, '')).join('');
  if (current && sizes.includes(current)) sizeEl.value = current;
}

function formatDateInputValue(v) {
  const raw = String(v || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return '';
  let y = Number(m[3]);
  if (y > 2400) y -= 543;
  return `${y}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
}

async function saveSalesDetails(historyRow) {
  const form = document.querySelector(`[data-history-row="${CSS.escape(String(historyRow))}"]`);
  if (!form) return;
  const payload = { action:'update_sales_details', historyRow };
  form.querySelectorAll('[data-sales-field]').forEach(el => {
    payload[el.getAttribute('data-sales-field')] = el.value.trim();
  });
  try {
    const res = await apiPost(payload);
    if (!res.ok) throw new Error(res.error || 'API error');
    const item = CACHE.history.find(h => Number(h._sheetRow) === Number(historyRow));
    if (item) {
      item['Buyer Name'] = payload.buyerName || '';
      item['Hospital'] = payload.hospital || '';
      item['PO No'] = payload.poNo || '';
      item['Sale Date'] = payload.saleDate || '';
      item['Sale Price'] = payload.salePrice || '';
      item['Wholesale Price'] = payload.wholesalePrice || '';
      item['Model'] = payload.model || '';
      item['Size'] = payload.size || '';
    }
    const alerts = await apiFetch(buildApiUrl(API_URL, { action:'sales_detail_alerts' }));
    CACHE.salesAlerts = alerts && alerts.ok ? (alerts.alerts || []) : CACHE.salesAlerts;
    renderHist(false);
    renderStock();
    toast('บันทึกข้อมูลขายแล้ว', 'ok');
  } catch(e) {
    toast('บันทึกข้อมูลขายไม่สำเร็จ: ' + e.message, 'err');
  }
}

function renderHist(append, items) {
  const list = document.getElementById('hiList');
  items = items || CACHE.history || [];
  if (!append) {
    renderPurposeSummary(items);
    renderMonthlyOutSummary();
  }
  const q = (document.getElementById('histSearch')?.value || '').trim();
  if (q) append = false;
  const sourceItems = items;
  items = filteredHistoryItems(items);

  if (!items.length && !append) {
    const msg = q
      ? `ไม่พบรายการที่ตรงกับ "${escapeHtml(q)}"`
      : 'ยังไม่มีประวัติรายการ';
    const hint = q
      ? 'ลองค้นด้วยชื่อเซลล์/ผู้รับ, SN เครื่อง, LOT, ชื่อสินค้า, รุ่น หรือไซส์'
      : '';
    list.innerHTML = `<div class="empty"><div>${msg}</div>${hint ? `<div class="hm">${hint}</div>` : ''}</div>`;
    document.getElementById('hiMore').style.display = 'none';
    return;
  }

  const html = items.map(it => {
    const action = String(it['Action'] || '');
    const isIn = action === 'Stock In';
    const purpose = historyPurpose(it);
    const qty = historyQty(it);
    return `
      <div class="hi" data-history-row="${escapeHtml(String(it._sheetRow || ''))}">
        <div class="hd ${isIn ? 'in' : 'out'}">${isIn ? '↓' : '↑'}</div>
        <div class="hi-body">
          <div class="hi-top">
            <div class="hn">${escapeHtml(it['Product Name'] || '-')}</div>
            ${qty ? `<div class="hi-qty ${isIn ? 'in' : 'out'}">${isIn ? '+' : '-'}${escapeHtml(String(qty))}</div>` : ''}
          </div>
          <div class="hm">${escapeHtml(it['Action'] || '-')} · ${escapeHtml(historyRecipient(it) || '-')} · ${escapeHtml(historyRecordedBy(it) || '-')}</div>
          ${!isIn ? `<div class="hm">วัตถุประสงค์: ${escapeHtml(purpose || '-')}</div>` : ''}
          ${!isIn ? `<div class="hm">ผู้ซื้อ: ${escapeHtml(it['Buyer Name'] || '-')} · โรงพยาบาล: ${escapeHtml(it['Hospital'] || '-')} · PO: ${escapeHtml(it['PO No'] || '-')}</div>` : ''}
          ${!isIn ? `<div class="hm">ราคาขาย: ${escapeHtml(it['Sale Price'] || '-')} · ราคาส่ง: ${escapeHtml(it['Wholesale Price'] || '-')}</div>` : ''}
          ${it['Serial / LOT'] ? `<div class="hm">${escapeHtml(it['Serial / LOT'])}</div>` : ''}
          ${salesDetailForm(it)}
        </div>
        <div class="ht">${escapeHtml(it['Date'] || '-')}<br>${escapeHtml(it['Time'] || '-')}</div>
      </div>
    `;
  }).join('');

  if (append) {
    list.insertAdjacentHTML('beforeend', html);
  } else {
    list.innerHTML = html;
  }

  
  document.getElementById('hiMore').style.display =
    (!q && sourceItems.length >= HIST_PAGE) ? 'block' : 'none';
}

async function loadMoreHist() {
  HIST_OFFSET += HIST_PAGE;
  try {
    const res = await apiFetch(buildApiUrl(API_URL, { action:'history', n:HIST_PAGE, offset:HIST_OFFSET }));
    if (!res.ok) throw new Error(res.error);
    const more = res.history || [];
    const seen = new Set(CACHE.history.map(h =>
      [h['Date'], h['Time'], h['Product Name'], h['Action']].join('|')
    ));
    const fresh = more.filter(h => {
      const key = [h['Date'], h['Time'], h['Product Name'], h['Action']].join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    
    CACHE.history = CACHE.history.concat(fresh);
    renderHist(true, fresh);

    if (more.length < HIST_PAGE) document.getElementById('hiMore').style.display = 'none';
  } catch(e) {
    toast('โหลดประวัติเพิ่มเติมไม่สำเร็จ: ' + e.message, 'err');
    HIST_OFFSET -= HIST_PAGE;
  }
}

function productNameRows() {
  const q = (document.getElementById('nameSearch')?.value || '').toLowerCase().trim();
  return (CACHE.products || [])
    .filter(p => p.product_code)
    .filter(p => !q || productSearchText(p).includes(q))
    .slice(0, 80);
}

function renderProductNameManager() {
  const list = document.getElementById('nameProductList');
  if (!list) return;
  const rows = productNameRows();
  list.innerHTML = rows.length ? rows.map(p => {
    const code = escapeHtml(p.product_code || '');
    const active = p.product_code === SELECTED_NAME_PRODUCT_CODE ? ' on' : '';
    const po = poPrintName(p);
    return `
      <div class="name-row${active}" onclick="selectProductName('${code}')">
        <b>${escapeHtml(stockDisplayName(p) || '-')}</b>
        <span>${code} · ${escapeHtml(p.brand || '-')} · ${escapeHtml(productVariantLabel(p) || p.category || '-')} · PO: ${escapeHtml(po || '-')}</span>
      </div>
    `;
  }).join('') : '<div class="empty">ไม่พบสินค้า</div>';
}

function selectProductName(code) {
  const p = (CACHE.products || []).find(x => String(x.product_code || '') === String(code || ''));
  if (!p) return;
  SELECTED_NAME_PRODUCT_CODE = p.product_code || '';
  document.getElementById('nameEditForm').style.display = 'block';
  document.getElementById('nameProductCode').value = p.product_code || '';
  document.getElementById('stockNameI').value = p.stock_name || p.name || '';
  document.getElementById('poNameI').value = p.po_name || p.product_name || p.name || '';
  document.getElementById('aliasNameI').value = p.aliases || '';
  renderProductNameManager();
}

async function saveProductNames() {
  if (!SELECTED_NAME_PRODUCT_CODE) {
    toast('กรุณาเลือกสินค้าก่อน', 'warn');
    return;
  }
  const stockName = document.getElementById('stockNameI')?.value.trim() || '';
  const poName = document.getElementById('poNameI')?.value.trim() || '';
  const aliases = document.getElementById('aliasNameI')?.value.trim() || '';
  if (!stockName && !poName && !aliases) {
    toast('กรุณากรอกอย่างน้อย 1 ช่อง', 'warn');
    return;
  }

  setPill('busy');
  try {
    const res = await apiPost({
      action: 'update_product_names',
      productCode: SELECTED_NAME_PRODUCT_CODE,
      stockName,
      poName,
      aliases,
      user: CUR_USER,
      staffName: CUR_STAFF
    });
    if (!res.ok) throw new Error(res.error || 'API error');

    const p = (CACHE.products || []).find(x => String(x.product_code || '') === SELECTED_NAME_PRODUCT_CODE);
    if (p) {
      p.stock_name = stockName;
      p.po_name = poName;
      p.aliases = aliases;
      p.name = stockName || p.product_name || p.name;
    }
    renderProductNameManager();
    renderManualProducts();
    renderStocktake();
    setPill('ok');
    toast('บันทึกชื่อสินค้าแล้ว', 'ok');
    await loadAll();
  } catch(e) {
    setPill('err');
    toast('บันทึกชื่อสินค้าไม่สำเร็จ: ' + e.message, 'err');
  }
}

function goTab(tab) {
  ['scan','stock','analysis','sales','take','cfg'].forEach(k => {
    document.getElementById('t-' + k).classList.toggle('on', k === tab);
    document.getElementById('v-' + k).style.display = (k === tab ? (k === 'cfg' ? 'grid' : 'block') : 'none');
  });
  
  if ((tab === 'stock' || tab === 'analysis' || tab === 'sales') && Date.now() - _lastSyncTime > 60_000) {
    loadAll().then(() => { _lastSyncTime = Date.now(); }).catch(() => {});
  }
  if (tab === 'cfg') renderProductNameManager();
}

function setPill(mode) {
  const el = document.getElementById('pill');
  el.className = 'pill ' + mode;
  el.textContent = mode === 'ok' ? 'Connected' : mode === 'busy' ? 'Working' : mode === 'err' ? 'Error' : 'Sheet';
}

function toast(msg, type='ok') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast on ' + type;
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => { el.className = 'toast'; }, 2200);
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#039;');
}

async function exportCSV() {
  if (!API_URL) { toast('ยังไม่ได้ตั้งค่า API URL', 'warn'); return; }
  toast('กำลัง export ประวัติ...', 'ok');
  try {

    const res = await apiFetch(buildApiUrl(API_URL, { action:'history', n:9999, offset:0 }));
    if (!res.ok) throw new Error(res.error);
    const items = res.history || [];
    if (!items.length) { toast('ไม่มีประวัติให้ export', 'warn'); return; }

    const headers = Object.keys(items[0]);
    const csv = [
      headers.join(','),
      ...items.map(row => headers.map(h => `"${String(row[h] || '').replace(/"/g, '""')}"`).join(','))
    ].join('\n');


    const blob = new Blob(['\uFEFF' + csv], {type:'text/csv;charset=utf-8;'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const dateStr = new Date().toLocaleDateString('th-TH').replace(/\//g, '-');
    a.download = `skyline-history-${dateStr}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast(`Export ${items.length} รายการสำเร็จ`, 'ok');
  } catch(e) {
    toast('Export ไม่สำเร็จ: ' + e.message, 'err');
  }
}

// E17: the server builds the .xlsx (Products, Devices, Lots, Transactions)
async function exportAllExcel() {
  toast('กำลังสร้างไฟล์ Excel...', 'ok');
  try {
    const r = await rest('GET', '/stock/export', undefined, { raw: true, timeoutMs: 120000 });
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const dateStr = new Date().toLocaleDateString('th-TH').replace(/\//g, '-');
    a.download = `skyline-stock-${dateStr}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast('ดาวน์โหลด Excel สำเร็จ', 'ok');
  } catch(e) {
    toast('Export Excel ไม่สำเร็จ: ' + e.message, 'err');
  }
}
