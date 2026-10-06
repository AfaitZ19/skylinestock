(function(){
const SFX=['HA!','GO!','OK!','YAY!','WOW!','NICE!','DONE!','YES!'];
const GUIDES={
  in:{name:'รับสินค้าเข้าคลัง',steps:[
    {sel:'#t-scan',   sfx:'GO!',  title:'แท็บ "ทำรายการ"',       body:'คลิกแท็บนี้ก่อนเลยนะ! ทุกรายการรับเข้า/จ่ายออกเริ่มที่นี่จ้า 👆'},
    {sel:'#mIn',      sfx:'YES!', title:'กดปุ่ม "รับเข้า" 💚',   body:'เลือกโหมด รับเข้า (สีเขียว) ปุ่มจะเปลี่ยนสีให้รู้ว่าเลือกอยู่นะ'},
    {sel:'#hidToggleBtn', sfx:'HID!', title:'มีเครื่องสแกน USB? เลือก "เครื่องสแกน" 🔫', body:'เสียบเครื่องสแกนแล้วยิงบาร์โค้ดได้เลย ไม่ต้องกดอะไรเพิ่ม (ตั้ง suffix = Enter ในเครื่องสแกนด้วยนะ) — เครื่องจำวิธีที่เลือกไว้ใช้ครั้งหน้า'},
    {sel:'#camWayBtn', sfx:'SCAN!',title:'สแกนด้วยกล้อง 📷',     body:'กด "กล้อง" แล้วเล็งบาร์โค้ด UDI (ที่มีเลข (01)) ให้อยู่ในกรอบเส้นประ — ได้ยินเสียงบี๊บ + ขึ้นกรอบเขียว = อ่านได้แล้ว! บาร์โค้ดเล็กไม่ต้องจ่อใกล้มาก'},
    {sel:'#photoWayBtn', sfx:'SNAP!',title:'หรือถ่ายรูปฉลาก 🖼',  body:'กด "ถ่ายรูป" แล้วถ่ายใหม่หรือเลือกรูปจากแกลเลอรี — ระบบอ่านทุกบาร์โค้ดในรูปให้ ถ้าฉลากมีหลายสินค้าจะให้เลือกรายการ'},
    {sel:'#manualToggleBtn', sfx:'OK!',  title:'หรือพิมพ์เองก็ได้!',     body:'ถ้าสแกนไม่ได้ กด "พิมพ์เอง" แล้วพิมพ์ Barcode / SN / LOT จากนั้นกด "ตรวจสอบ" ได้เลย'},
    {sel:null,        sfx:'WOW!', title:'ตรวจข้อมูลก่อนบันทึก ✨', body:'ระบบแสดงชื่อสินค้า, SN/LOT, วันผลิต และวันหมดอายุ (ถ้าฉลากไม่มี ระบบคำนวณจากอายุสินค้า) — ยังไม่บันทึกนะ จนกว่าจะกดรับเข้า ถ้าระบบไม่รู้จักบาร์โค้ด ให้เลือกสินค้าจากรายการด้านล่าง'},
    {sel:null,        sfx:'NICE!',title:'จำนวนและคนรับเข้า 📝',  body:'หน้ากาก/อุปกรณ์เสริม ใส่จำนวนที่รับได้เลย (รับทั้งกล่องในครั้งเดียว) — ช่อง "คนรับเข้า/ผู้บันทึก" ใส่ชื่อคุณให้แล้ว แก้ได้ถ้าคนอื่นเป็นคนรับ'},
    {sel:'#bIn',      sfx:'DONE!',title:'กด "รับเข้า" เพื่อบันทึก!',body:'กดปุ่มสีเขียวเพื่อยืนยัน — สต็อกเพิ่มขึ้นทันที ✅ ถ้าใช้กล้อง กล้องจะเปิดต่อให้สแกนชิ้นถัดไปเลย!'},
  ]},
  out:{name:'เบิก / จ่ายสินค้า',steps:[
    {sel:'#t-scan',   sfx:'GO!',  title:'แท็บ "ทำรายการ"',       body:'เริ่มต้นที่แท็บนี้ก่อนเลยนะ! 👆'},
    {sel:'#mOut',     sfx:'YES!', title:'กดปุ่ม "จ่ายออก" ❤️',  body:'เลือกโหมด จ่ายออก (สีแดง) เพื่อบันทึกการเบิกหรือจ่ายสินค้าออกนะจ้า'},
    {sel:'#camWayBtn', sfx:'SCAN!',title:'สแกนชิ้นที่จะจ่าย 📷',   body:'ใช้ "กล้อง", "ถ่ายรูป", "เครื่องสแกน" หรือ "พิมพ์เอง" ก็ได้ — ระบบหาแถวในสต็อกที่ SN/LOT ตรงกันให้เอง'},
    {sel:null,        sfx:'WOW!', title:'ตรวจสอบข้อมูล ✨',      body:'ระบบแสดงสินค้าและแถวสต็อกที่จะจ่าย — ถ้าไม่พบ SN/LOT นี้ในสต็อก ระบบจะไม่จ่ายให้ เพื่อกันจ่ายผิดรายการ ให้เลือกจากรายการด้านล่างแทน'},
    {sel:null,        sfx:'NICE!',title:'ผู้รับ วัตถุประสงค์ จำนวน 📝', body:'เลือกเซลล์หรือผู้รับสินค้า, วัตถุประสงค์ (ขาย / ของแถม / เดโม / อื่นๆ) และจำนวนสำหรับหน้ากาก/อุปกรณ์เสริม — เครื่องที่ให้ยืมเดโมจะขึ้นสถานะ Demo'},
    {sel:'#bOut',     sfx:'DONE!',title:'กด "จ่ายออก" เพื่อบันทึก!',body:'กดปุ่มสีแดงเพื่อยืนยัน — สต็อกลดลงทันที ✅ ข้อมูลขาย (ราคา, โรงพยาบาล, PO) เติมทีหลังได้ที่แท็บ "ข้อมูลขาย"'},
  ]},
  take:{name:'นับสต็อก',steps:[
    {sel:'#t-take',          sfx:'GO!',  title:'แท็บ "นับสต็อก"',           body:'คลิกแท็บนี้เพื่อเข้าสู่หน้านับสต็อก — ใช้ตรวจสอบของจริงกับในระบบนะจ๊ะ (หน้ากากและอุปกรณ์เสริมที่นับเป็น LOT)'},
    {sel:'#takeCategory',    sfx:'PICK!',title:'กรองหมวดหมู่ / แบรนด์ 🗂',  body:'เลือกหมวดสินค้าหรือแบรนด์เพื่อกรองรายการ — ช่วยให้นับทีละกลุ่มง่ายขึ้นมาก!'},
    {sel:'#takeSearch',      sfx:'FIND!',title:'ค้นหาสินค้า 🔍',            body:'พิมพ์ชื่อ, รหัสสินค้า หรือ LOT เพื่อกรองรายการได้เลย'},
    {sel:'#stocktakeList',   sfx:'COUNT!',title:'กรอกจำนวนที่นับได้ 🔢',   body:'กรอกจำนวนที่นับได้จริงในช่องแต่ละรายการ — ระบบจะเปรียบเทียบกับที่มีในระบบให้เอง'},
    {sel:'#stocktakeSubmit', sfx:'DONE!',title:'กด "บันทึกการนับสต็อก" ✅', body:'กดเมื่อนับครบ — ระบบตั้งยอดคงเหลือตามที่นับได้ทันที ถ้ามีรายการไหนผิด จะไม่บันทึกทั้งชุด แก้แล้วกดใหม่ได้เลย'},
  ]},
  sales:{name:'ข้อมูลขาย',steps:[
    {sel:'#t-sales',   sfx:'GO!',  title:'แท็บ "ข้อมูลขาย"',        body:'คลิกแท็บนี้เพื่อดูและแก้ไขข้อมูลการขายย้อนหลังทั้งหมด'},
    {sel:'#histSearch',sfx:'FIND!',title:'ค้นหารายการ 🔍',           body:'พิมพ์ชื่อเซลล์, ผู้รับ, SN, LOT, ชื่อสินค้า, โรงพยาบาล หรือ PO — ค้นได้กว้างมากเลย!'},
    {sel:'#hiList',    sfx:'TAP!', title:'กดรายการเพื่อแก้ไข 📋',    body:'กดที่รายการไหนก็ได้เพื่อกรอกหรือแก้ไขข้อมูลขาย เช่น ราคาขาย, ผู้ซื้อ, เลข PO'},
    {sel:null,         sfx:'SAVE!',title:'บันทึกข้อมูลขาย 💾',       body:'กรอกข้อมูลให้ครบ (ราคาขาย, ราคาส่ง, ผู้ซื้อ, โรงพยาบาล, PO) แล้วกด "บันทึกข้อมูลขาย" ✅'},
  ]},
  anal:{name:'วิเคราะห์',steps:[
    {sel:'#t-analysis',         sfx:'GO!',   title:'แท็บ "วิเคราะห์"',               body:'คลิกแท็บนี้เพื่อดูสรุปและวิเคราะห์ข้อมูลการจ่ายออก'},
    {sel:'#purposeSummary',     sfx:'STATS!',title:'สรุปจ่ายออกตามวัตถุประสงค์ 📊', body:'ตรงนี้แสดงภาพรวมว่าจ่ายออกไปเพื่ออะไรบ้าง เช่น ขาย, ของแถม, เดโม'},
    {sel:'#outMonthI',          sfx:'PICK!', title:'เลือกเดือนที่ต้องการ 📅',       body:'เลือกเดือนที่ต้องการวิเคราะห์ แล้วกด "วิเคราะห์เดือนที่เลือก" เพื่อดูข้อมูล'},
    {sel:'#monthlyOutSummary',  sfx:'WOW!',  title:'ดูสรุปรายเดือน 📈',            body:'ระบบแสดงสรุปการจ่ายออกแยกตามสินค้า — ใช้วางแผนสั่งของได้เลย ✅'},
  ]},
  cfg:{name:'ตั้งค่า',steps:[
    {sel:'#t-cfg',         sfx:'GO!',  title:'ปุ่ม "ตั้งค่า" ⚙️',             body:'กดรูปเฟืองมุมขวาบน เพื่อดูสถานะการเชื่อมต่อและจัดการชื่อสินค้า'},
    {sel:'#connTxt',       sfx:'WIFI!',title:'สถานะการเชื่อมต่อ 🔌',       body:'ตรงนี้บอกว่าเชื่อมต่อระบบ SkylinePlus อยู่ไหม พร้อมยอด Device / Mask / Accessory — กด "ซิงก์ข้อมูล" เพื่อโหลดข้อมูลล่าสุด'},
    {sel:'#nameSearch',    sfx:'EDIT!',title:'จัดการชื่อสินค้า ✏️',         body:'ค้นหาสินค้าแล้วแก้ชื่อที่ใช้แสดง, ชื่อตามเอกสาร PO หรือคำค้นหาเพิ่มเติม — Admin ตั้ง "อายุสินค้า (เดือน)" ได้ด้วย ใช้คำนวณวันหมดอายุเมื่อฉลากมีแค่วันผลิต'},
    {sel:null,             sfx:'TIP!', title:'เครื่องมือ Admin 🔧',          body:'Admin ดาวน์โหลดประวัติเป็น CSV หรือข้อมูลทั้งหมดเป็น Excel ได้จากหน้านี้'},
  ]},
  add:{name:'เพิ่มสินค้าใหม่',steps:[
    {sel:'.fab-add',         sfx:'NEW!', title:'กดปุ่ม "เพิ่มสินค้า" ➕',    body:'ปุ่มกลมสีน้ำเงินมุมล่างขวา กดได้เลย! (ใช้ได้กับบัญชีที่มีสิทธิ์ทำรายการสต็อก)'},
    {sel:null,               sfx:'TIP!', title:'ทางลัดจากการสแกน 📷',       body:'สแกนแล้วเจอ "ไม่รู้จักบาร์โค้ดนี้" ให้กด "เพิ่มสินค้าใหม่ด้วย GTIN นี้" — ฟอร์มจะเปิดพร้อมใส่ GTIN ให้เลย'},
    {sel:null,               sfx:'FILL!',title:'กรอกข้อมูลสินค้า 📝',       body:'ใส่ชื่อสินค้า*, GTIN (บาร์โค้ด), REF, Model, Size และหมวดหมู่ — ช่องที่มี * จำเป็นต้องกรอก'},
    {sel:null,               sfx:'DONE!',title:'กด "บันทึก" เพื่อเพิ่ม ✅', body:'กดบันทึกเพื่อเพิ่มสินค้าเข้าระบบ — หลังจากนั้นสแกนรับเข้า/จ่ายออกได้ทันที!'},
  ]},
  stock:{name:'เช็คสต็อกสินค้า',steps:[
    {sel:'#t-stock',        sfx:'GO!',  title:'แท็บ "สต็อก"',       body:'คลิกที่นี่เพื่อดูรายการสินค้าทั้งหมดในคลัง ง่ายมากเลย! 👆'},
    {sel:'#v-stock .sg',    sfx:'WOW!', title:'ภาพรวมสต็อก 📊',    body:'ตรงนี้แสดงจำนวนรวมแยกตามหมวด: Device, Mask และ Accessory — ดูได้ในแวบเดียว!'},
    {sel:'#stockSearch',    sfx:'FIND!',title:'ค้นหาสินค้า 🔍',     body:'พิมพ์ชื่อ, Brand, SN หรือ LOT — กรองทันทีโดยไม่ต้องกด Enter เลย เร็วมาก!'},
    {sel:'#stList',         sfx:'YES!', title:'รายการสินค้า 📦',    body:'🟡 สีเหลือง = ใกล้หมด  🔴 สีแดง = หมดแล้ว  ✅ สีปกติ = โอเคนะ'},
    {sel:'#st-sum',         sfx:'SUM!', title:'สรุปตามรุ่น 📈',     body:'กดแท็บนี้เพื่อดูยอดรวมแยกตามรุ่นสินค้า'},
    {sel:'#st-attn',        sfx:'LOOK!',title:'ต้องตรวจสอบ ⚠️',    body:'รวมรายการที่ใกล้หมด ใกล้หมดอายุ หรือข้อมูลขายที่ยังกรอกไม่ครบ ตัวเลขสีแดงคือจำนวนที่ต้องดู — กดรายการเพื่อไปดูในสต็อกได้เลย'},
  ]},
};

let gType=null,gIdx=0;
const overlay=document.getElementById('guideOverlay');
const hole=document.getElementById('guideHole');
const ring=document.getElementById('guideRing');
const panel=document.getElementById('mangaPanel');

window.toggleGuideMenu=function(){
  document.getElementById('guideMenu').classList.toggle('on');
};
window.startGuide=function(type){
  document.getElementById('guideMenu').classList.remove('on');
  gType=type;gIdx=0;
  overlay.classList.add('on');
  renderStep();
};
window.guideNav=function(dir){
  const steps=GUIDES[gType].steps;
  gIdx=Math.max(0,Math.min(steps.length-1,gIdx+dir));
  renderStep();
};
window.closeGuide=function(){
  overlay.classList.remove('on');
  ring.style.display='none';
  hole.setAttribute('width',0);hole.setAttribute('height',0);
  gType=null;
};

function renderStep(){
  const steps=GUIDES[gType].steps;
  const s=steps[gIdx];
  const total=steps.length;
  const isLast=gIdx===total-1;

  document.getElementById('gtStep').textContent='STEP '+(gIdx+1)+' / '+total;
  document.getElementById('gtTitle').textContent=s.title;
  document.getElementById('gtBody').textContent=s.body;
  document.getElementById('gtSfx').textContent=s.sfx||'';

  // Dots
  const dotsEl=document.getElementById('gtDots');
  dotsEl.innerHTML='';
  for(let i=0;i<total;i++){
    const d=document.createElement('div');
    d.className='manga-dot'+(i===gIdx?' on':'');
    dotsEl.appendChild(d);
  }

  const prevBtn=document.getElementById('gtPrev');
  const nextBtn=document.getElementById('gtNext');
  prevBtn.style.visibility=gIdx===0?'hidden':'visible';
  nextBtn.textContent=isLast?'✓ เสร็จสิ้น!!':'ถัดไป ›';
  nextBtn.className='manga-next'+(isLast?' finish':'');
  nextBtn.onclick=isLast?closeGuide:()=>guideNav(1);

  // Spotlight
  const target=s.sel?document.querySelector(s.sel):null;
  if(target&&isElVisible(target)){
    const r=target.getBoundingClientRect();
    const pad=10;
    hole.setAttribute('x',r.left-pad);
    hole.setAttribute('y',r.top-pad);
    hole.setAttribute('width',r.width+pad*2);
    hole.setAttribute('height',r.height+pad*2);
    // Animated ring
    ring.style.display='block';
    ring.style.left=(r.left-pad)+'px';
    ring.style.top=(r.top-pad)+'px';
    ring.style.width=(r.width+pad*2)+'px';
    ring.style.height=(r.height+pad*2)+'px';
    positionPanel(r);
  } else {
    hole.setAttribute('width',0);hole.setAttribute('height',0);
    ring.style.display='none';
    centerPanel();
  }
}

function isElVisible(el){
  const r=el.getBoundingClientRect();
  return r.width>0&&r.height>0&&r.top<window.innerHeight&&r.bottom>0;
}
function positionPanel(r){
  const PW=Math.min(300,window.innerWidth*0.92);
  const PH=200;
  const vw=window.innerWidth,vh=window.innerHeight,pad=12;
  let top=r.bottom+pad;
  if(top+PH>vh-pad) top=r.top-PH-pad;
  if(top<pad) top=pad;
  let left=r.left+r.width/2-PW/2;
  left=Math.max(pad,Math.min(vw-PW-pad,left));
  panel.style.top=top+'px';
  panel.style.left=left+'px';
  panel.style.transform='';
  panel.style.width=PW+'px';
}
function centerPanel(){
  panel.style.top='50%';
  panel.style.left='50%';
  panel.style.transform='translate(-50%,-50%)';
  panel.style.width=Math.min(300,window.innerWidth*0.92)+'px';
}

// Close menu on outside click
document.addEventListener('click',function(e){
  const menu=document.getElementById('guideMenu');
  const btn=document.getElementById('guideBtn');
  if(menu.classList.contains('on')&&!menu.contains(e.target)&&e.target!==btn)
    menu.classList.remove('on');
},true);

// Close overlay on backdrop click
overlay.addEventListener('click',function(e){
  if(e.target===overlay||e.target.tagName==='svg'||e.target.tagName==='rect')
    closeGuide();
});
})();
