(function(){
const SFX=['HA!','GO!','OK!','YAY!','WOW!','NICE!','DONE!','YES!'];
const GUIDES={
  in:{name:'รับสินค้าเข้าคลัง',steps:[
    {sel:'#t-scan',   sfx:'GO!',  title:'แท็บ "ทำรายการ"',       body:'คลิกแท็บนี้ก่อนเลยนะ! ทุก transaction เริ่มที่นี่จ้า 👆'},
    {sel:'#mIn',      sfx:'YES!', title:'กดปุ่ม "รับเข้า" 💚',   body:'เลือกโหมด รับเข้า (สีเขียว) ปุ่มจะเปลี่ยนสีให้รู้ว่าเลือกอยู่นะ'},
    {sel:'#hidToggleBtn', sfx:'HID!', title:'มีเครื่องสแกน? กดตรงนี้! 🔫', body:'กดปุ่มนี้เพื่อเปิด HID Mode — เสียบเครื่องสแกนแล้วยิงได้เลย ไม่ต้องกดอะไรเพิ่ม (ต้องตั้ง suffix = Enter ในเครื่องสแกนด้วยนะ)'},
    {sel:'.scan-btn', sfx:'SCAN!',title:'สแกน QR / Barcode 📷',  body:'กด "ใช้กล้อง" แล้วชี้ไปที่บาร์โค้ดบนกล่อง — ระบบดึงข้อมูลให้เองเลย ไม่ต้องพิมพ์!'},
    {sel:'#mf',       sfx:'OK!',  title:'หรือกรอกเองก็ได้!',     body:'ถ้าสแกนไม่ได้ พิมพ์รหัสสินค้าตรงนี้ แล้วกด "ตรวจสอบ" ได้เลย'},
    {sel:null,        sfx:'WOW!', title:'ระบบดึงข้อมูลให้ ✨',   body:'ชื่อสินค้า, ประเภท และจำนวนคงเหลือจะโผล่ขึ้นมาเอง — ตรวจดูให้ถูกต้องด้วยนะ'},
    {sel:null,        sfx:'NICE!',title:'กรอกรายละเอียด 📝',     body:'ใส่ SN / LOT (ถ้ามี), จำนวนที่รับ และชื่อคนรับผิดชอบ — กรอกให้ครบนะจ๊ะ'},
    {sel:'#bIn',      sfx:'DONE!',title:'กด "รับเข้า" เพื่อบันทึก!',body:'กดปุ่มสีเขียวนี้เพื่อยืนยัน — สต็อกเพิ่มขึ้นและบันทึกใน Sheet ทันที ✅ เยี่ยมมาก!'},
  ]},
  out:{name:'เบิก / จ่ายสินค้า',steps:[
    {sel:'#t-scan',   sfx:'GO!',  title:'แท็บ "ทำรายการ"',       body:'เริ่มต้นที่แท็บนี้ก่อนเลยนะ! 👆'},
    {sel:'#mOut',     sfx:'YES!', title:'กดปุ่ม "จ่ายออก" ❤️',  body:'เลือกโหมด จ่ายออก (สีแดง) เพื่อบันทึกการเบิกหรือจ่ายสินค้าออกนะจ้า'},
    {sel:'#hidToggleBtn', sfx:'HID!', title:'มีเครื่องสแกน? กดตรงนี้! 🔫', body:'กดปุ่มนี้เพื่อเปิด HID Mode — เสียบเครื่องสแกนแล้วยิงได้เลย ไม่ต้องกดอะไรเพิ่ม (ต้องตั้ง suffix = Enter ในเครื่องสแกนด้วยนะ)'},
    {sel:'.scan-btn', sfx:'SCAN!',title:'สแกนสินค้า 📷',         body:'กด "ใช้กล้อง" แล้วสแกนบาร์โค้ดสินค้าที่ต้องการเบิก — ง่ายมาก!'},
    {sel:'#mf',       sfx:'OK!',  title:'หรือกรอกเองก็ได้!',     body:'พิมพ์รหัสสินค้าในช่องนี้ แล้วกด "ตรวจสอบ" ได้เลยจ้า'},
    {sel:null,        sfx:'WOW!', title:'ตรวจสอบข้อมูล ✨',      body:'ระบบแสดงชื่อสินค้าและสต็อกคงเหลือ — ตรวจให้แน่ใจก่อนจ่ายออกนะ'},
    {sel:null,        sfx:'NICE!',title:'ระบุผู้รับและจำนวน 📝', body:'กรอกชื่อผู้รับและจำนวนที่จ่ายออก — อย่าลืมตรวจสอบให้ถูกต้องด้วยนะ'},
    {sel:'#bOut',     sfx:'DONE!',title:'กด "จ่ายออก" เพื่อบันทึก!',body:'กดปุ่มสีแดงนี้เพื่อยืนยัน — สต็อกลดลงและบันทึกใน Sheet ทันที ✅ เก่งมาก!'},
  ]},
  take:{name:'นับสต็อก',steps:[
    {sel:'#t-take',          sfx:'GO!',  title:'แท็บ "นับสต็อก"',           body:'คลิกแท็บนี้เพื่อเข้าสู่หน้านับสต็อก — ใช้ตรวจสอบของจริงกับในระบบนะจ๊ะ'},
    {sel:'#takeCategory',    sfx:'PICK!',title:'กรองหมวดหมู่ / แบรนด์ 🗂',  body:'เลือกหมวดสินค้าหรือแบรนด์เพื่อกรองรายการ — ช่วยให้นับทีละกลุ่มง่ายขึ้นมาก!'},
    {sel:'#takeSearch',      sfx:'FIND!',title:'ค้นหาสินค้า 🔍',            body:'พิมพ์ชื่อหรือรหัสสินค้าเพื่อกรองรายการได้เลย'},
    {sel:'#stocktakeList',   sfx:'COUNT!',title:'กรอกจำนวนที่นับได้ 🔢',   body:'กรอกจำนวนที่นับได้จริงในช่องแต่ละรายการ — ระบบจะเปรียบเทียบกับที่มีในระบบให้เอง'},
    {sel:'#stocktakeSubmit', sfx:'DONE!',title:'กด "บันทึกการนับสต็อก" ✅', body:'กดปุ่มนี้เมื่อนับครบทุกรายการ — ระบบอัปเดตจำนวนคงเหลือใน Google Sheets ทันที!'},
  ]},
  sales:{name:'ข้อมูลขาย',steps:[
    {sel:'#t-sales',   sfx:'GO!',  title:'แท็บ "ข้อมูลขาย"',        body:'คลิกแท็บนี้เพื่อดูและแก้ไขข้อมูลการขายย้อนหลังทั้งหมด'},
    {sel:'#histSearch',sfx:'FIND!',title:'ค้นหารายการ 🔍',           body:'พิมพ์ชื่อเซลล์, ผู้รับ, SN, LOT, ชื่อสินค้า, โรงพยาบาล หรือ PO — ค้นได้กว้างมากเลย!'},
    {sel:'#hiList',    sfx:'TAP!', title:'กดรายการเพื่อแก้ไข 📋',    body:'กดที่รายการไหนก็ได้เพื่อกรอกหรือแก้ไขข้อมูลขาย เช่น ราคาขาย, ผู้ซื้อ, เลข PO'},
    {sel:null,         sfx:'SAVE!',title:'บันทึกข้อมูลขาย 💾',       body:'กรอกข้อมูลให้ครบ (ราคาขาย, ราคาส่ง, ผู้ซื้อ, โรงพยาบาล, PO) แล้วกด "บันทึกข้อมูลขาย" ✅'},
  ]},
  anal:{name:'วิเคราะห์',steps:[
    {sel:'#t-analysis',         sfx:'GO!',   title:'แท็บ "วิเคราะห์"',               body:'คลิกแท็บนี้เพื่อดูสรุปและวิเคราะห์ข้อมูลการจ่ายออก'},
    {sel:'#purposeSummary',     sfx:'STATS!',title:'สรุปจ่ายออกตามวัตถุประสงค์ 📊', body:'ตรงนี้แสดงภาพรวมว่าจ่ายออกไปเพื่ออะไรบ้าง เช่น ขาย, ทดลอง, คืน'},
    {sel:'#outMonthI',          sfx:'PICK!', title:'เลือกเดือนที่ต้องการ 📅',       body:'เลือกเดือนที่ต้องการวิเคราะห์ แล้วกด "วิเคราะห์เดือนที่เลือก" เพื่อดูข้อมูล'},
    {sel:'#monthlyOutSummary',  sfx:'WOW!',  title:'ดูสรุปรายเดือน 📈',            body:'ระบบแสดงสรุปการจ่ายออกแยกตามสินค้า — ใช้วางแผนสั่งของได้เลย ✅'},
  ]},
  cfg:{name:'ตั้งค่า',steps:[
    {sel:'#t-cfg',         sfx:'GO!',  title:'แท็บ "ตั้งค่า"',               body:'คลิกแท็บนี้เพื่อตั้งค่าระบบ ดูสถานะเชื่อมต่อ และจัดการชื่อสินค้า'},
    {sel:'#connTxt',       sfx:'WIFI!',title:'สถานะ Google Sheets 🔌',       body:'ตรงนี้แสดงว่าเชื่อมต่อกับ Google Sheets อยู่ไหม — กด "ซิงก์ข้อมูล" เพื่อโหลดข้อมูลใหม่'},
    {sel:'#nameSearch',    sfx:'EDIT!',title:'จัดการชื่อสินค้า ✏️',         body:'ค้นหาสินค้าและแก้ไขชื่อที่ใช้แสดง, ชื่อตามเอกสาร PO หรือคำค้นหาเพิ่มเติมได้ที่นี่'},
    {sel:null,             sfx:'TIP!', title:'เครื่องมือ Admin 🔧',          body:'Admin สามารถ export ประวัติ CSV, ดูข้อมูลขั้นสูง และจัดการระบบได้จากส่วนนี้'},
  ]},
  add:{name:'เพิ่มสินค้าใหม่',steps:[
    {sel:'.fab-add',         sfx:'NEW!', title:'กดปุ่ม "เพิ่มสินค้า" ➕',    body:'ปุ่มสีน้ำเงินมุมล่างขวา กดได้เลย! (เห็นเฉพาะตอนอยู่หน้าสต็อกนะ)'},
    {sel:null,               sfx:'PIN!', title:'กรอก PIN ปลดล็อก 🔒',       body:'ฟีเจอร์นี้สงวนไว้สำหรับ Admin เท่านั้น — กรอก PIN ที่ได้รับจาก Admin ก่อนนะจ๊ะ'},
    {sel:null,               sfx:'FILL!',title:'กรอกข้อมูลสินค้า 📝',       body:'ใส่ชื่อสินค้า*, GTIN (บาร์โค้ด), REF, Model, Size และหมวดหมู่ — ช่องที่มี * จำเป็นต้องกรอก'},
    {sel:null,               sfx:'TIP!', title:'สแกน barcode ได้เลย! 📷',   body:'ช่อง GTIN — กดสแกนหรือเสียบเครื่องสแกนแล้วยิงบาร์โค้ดสินค้าได้เลย ระบบจะดึงข้อมูลให้อัตโนมัติ'},
    {sel:null,               sfx:'DONE!',title:'กด "บันทึก" เพื่อเพิ่ม ✅', body:'กดบันทึกเพื่อเพิ่มสินค้าเข้าระบบ — หลังจากนั้นสินค้าจะพร้อมให้รับเข้า/จ่ายออกได้ทันที!'},
  ]},
  stock:{name:'เช็คสต็อกสินค้า',steps:[
    {sel:'#t-stock',        sfx:'GO!',  title:'แท็บ "สต็อก"',       body:'คลิกที่นี่เพื่อดูรายการสินค้าทั้งหมดในคลัง ง่ายมากเลย! 👆'},
    {sel:'#stockBreakdown', sfx:'WOW!', title:'ภาพรวมสต็อก 📊',    body:'ตรงนี้แสดงจำนวนรวมแยกตามหมวด: Device, Mask และ Accessory — ดูได้ในแวบเดียว!'},
    {sel:'#stockSearch',    sfx:'FIND!',title:'ค้นหาสินค้า 🔍',     body:'พิมพ์ชื่อ, Brand, SN หรือ LOT — กรองทันทีโดยไม่ต้องกด Enter เลย เร็วมาก!'},
    {sel:'#stList',         sfx:'YES!', title:'รายการสินค้า 📦',    body:'🟡 สีเหลือง = ใกล้หมด  🔴 สีแดง = หมดแล้ว  ✅ สีปกติ = โอเคนะ เช็คเสร็จแล้ว!'},
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
