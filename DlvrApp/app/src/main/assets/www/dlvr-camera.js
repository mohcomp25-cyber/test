const WORKER_URL='https://dry-glade-3ab4.e-8mohm.workers.dev/';
const ADMIN_PIN='1234';
const BRANCHES={'3847':'تست','5921':'النسيم','7364':'الحمدانية','1589':'الاجاويد','4203':'الصفا','8716':'السامر','2945':'الزهرة','6138':'ابحر','9472':'فرع 9472','3061':'فرع 3061','7854':'فرع 7854','1427':'فرع 1427','5693':'فرع 5693','8310':'فرع 8310','2786':'فرع 2786','4519':'فرع 4519','9063':'فرع 9063','6742':'فرع 6742','1358':'فرع 1358','8927':'فرع 8927','3614':'فرع 3614','7081':'فرع 7081','5439':'فرع 5439','2197':'فرع 2197','9845':'فرع 9845','4672':'فرع 4672','1036':'فرع 1036','8253':'فرع 8253','6480':'فرع 6480','3729':'فرع 3729','7195':'فرع 7195','5068':'فرع 5068','2841':'فرع 2841','9317':'فرع 9317','4953':'فرع 4953','1624':'فرع 1624','8490':'فرع 8490','6207':'فرع 6207','3578':'فرع 3578','7843':'فرع 7843','2465':'فرع 2465','5130':'فرع 5130','9786':'فرع 9786','1902':'فرع 1902','6354':'فرع 6354','4817':'فرع 4817','8629':'فرع 8629','3041':'فرع 3041','7568':'فرع 7568','2394':'فرع 2394'};

let stream=null,busy=false,tapN=0,tapTimer=null,audioCtx=null;

// ══ AUTO SCAN ════════════════════════════════════════
let autoMode=false,autoRAF=null,prevFrame=null;
let stableCount=0,changeDetected=false,lastAutoTime=0;
let processedOrders=new Set();
const CHANGE_THRESH=18;
const STABLE_NEED=3;
const SCAN_MS=500;
const COOLDOWN=6000;
let cooldownUntil=0;

const KEY_URL='dlvr_v2_url',KEY_BRANCH='dlvr_v2_branch',KEY_COUNT='dlvr_v2_count',KEY_BRANCH_NAME='dlvr_v2_branch_name',KEY_AUTO='dlvr_v2_auto',KEY_CAM='dlvr_v2_cam';
let sheetUrl=localStorage.getItem(KEY_URL)||'';
let selectedCamId=localStorage.getItem(KEY_CAM)||'';
let branchNameLabel=localStorage.getItem(KEY_BRANCH_NAME)||'';
let branchName=localStorage.getItem(KEY_BRANCH)||'';
let count=parseInt(localStorage.getItem(KEY_COUNT)||'0');

// ══ كلمات كاميرات الجوال المدمجة (للاستبعاد) ══════
const BUILTIN_KEYWORDS=[
  'front','back','rear','facing','selfie','environment','user',
  'wide','ultra','tele','macro','depth','ir ',
  'camera2 0','camera2 1','camera2 2','camera2 3','camera2 4',
  'camera 0','camera 1',
  // عربي
  'امامي','خلفي'
];

// ══ كلمات كاميرا USB (للتفضيل) ═════════════════════
const USB_KEYWORDS=[
  'usb','uvc','external','webcam','web cam','capture','hdmi',
  'cam link','elgato','logitech','razer','a4tech','microsoft lifecam',
  'hd pro','c920','c922','c270','brio','streamcam',
  'generic','video','hd camera','pc camera'
];

function isBuiltinCamera(label){
  const l=label.toLowerCase();
  return BUILTIN_KEYWORDS.some(k=>l.includes(k));
}

function isLikelyUSB(label){
  const l=label.toLowerCase();
  return USB_KEYWORDS.some(k=>l.includes(k));
}

// INIT
document.getElementById('cnt').textContent=count;
if(sheetUrl)setConn(true);
updateBranchBar();
if(sheetUrl)document.getElementById('urlIn').value=sheetUrl;
if(branchName)document.getElementById('branchIn').value=branchName;
if(localStorage.getItem(KEY_AUTO)==='true'){autoMode=true;updateModeUI();}

// ══ CAMERA ═══════════════════════════════════════════
async function startCam(deviceId){
  const camId = deviceId || selectedCamId;

  // لو فيه stream قديم أوقفه
  if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}

  // لو فيه كاميرا محددة من المستخدم، استخدمها مباشرة
  if(camId){
    try{
      stream=await navigator.mediaDevices.getUserMedia({video:{deviceId:{exact:camId},width:{ideal:1920},height:{ideal:1080}},audio:false});
    }catch{
      selectedCamId='';localStorage.removeItem(KEY_CAM);
    }
  }

  // لو ما اشتغلت — نعرف الكاميرا الافتراضية ونستبعدها
  if(!stream){
    try{
      // الخطوة 1: افتح الكاميرا الافتراضية عشان ناخذ الإذن ونعرف مين هي
      const tempStream=await navigator.mediaDevices.getUserMedia({video:true,audio:false});
      const defaultTrack=tempStream.getVideoTracks()[0];
      const defaultDeviceId=(defaultTrack.getSettings&&defaultTrack.getSettings().deviceId)||'';
      const defaultLabel=defaultTrack.label||'';
      const defaultGroupId='';
      tempStream.getTracks().forEach(t=>t.stop());

      console.log('[DLVR] الكاميرا الافتراضية (الجوال): "'+defaultLabel+'" id='+defaultDeviceId.slice(0,12));

      // الخطوة 2: جيب كل الكاميرات
      const devices=await navigator.mediaDevices.enumerateDevices();
      const cams=devices.filter(d=>d.kind==='videoinput');

      console.log('[DLVR] عدد الكاميرات: '+cams.length);
      cams.forEach((c,i)=>console.log(`  [${i}] "${c.label}" id=${c.deviceId.slice(0,12)} group=${c.groupId.slice(0,8)}`));

      // الخطوة 3: رتّب الكاميرات — غير الافتراضية أول
      // نستبعد الكاميرا الافتراضية (كاميرا الجوال) ونجرب الباقي
      const nonDefault=cams.filter(c=>c.deviceId!==defaultDeviceId);
      const defaultCam=cams.find(c=>c.deviceId===defaultDeviceId);

      // أولوية 1: كاميرات غير الافتراضية (غالباً USB)
      if(nonDefault.length>0){
        // رتّب: USB keywords أول، ثم غير المدمجة، ثم الباقي
        nonDefault.sort((a,b)=>{
          const aUSB=isLikelyUSB(a.label)?0:1;
          const bUSB=isLikelyUSB(b.label)?0:1;
          if(aUSB!==bUSB)return aUSB-bUSB;
          const aBuiltin=isBuiltinCamera(a.label)?1:0;
          const bBuiltin=isBuiltinCamera(b.label)?1:0;
          return aBuiltin-bBuiltin;
        });

        for(const cam of nonDefault){
          try{
            stream=await navigator.mediaDevices.getUserMedia({video:{deviceId:{exact:cam.deviceId},width:{ideal:1920},height:{ideal:1080}},audio:false});
            selectedCamId=cam.deviceId;
            localStorage.setItem(KEY_CAM,selectedCamId);
            toast(cam.label||'كاميرا خارجية','ok');
            console.log('[DLVR] تم اختيار (غير الافتراضية): "'+cam.label+'"');
            break;
          }catch{continue;}
        }
      }

      // أولوية 2: لو كل الكاميرات غير الافتراضية فشلت، استخدم الافتراضية
      if(!stream&&defaultCam){
        try{
          stream=await navigator.mediaDevices.getUserMedia({video:{deviceId:{exact:defaultCam.deviceId},width:{ideal:1920},height:{ideal:1080}},audio:false});
          console.log('[DLVR] رجعنا للافتراضية: "'+defaultCam.label+'"');
        }catch{stream=null;}
      }
    }catch(e){console.error('[DLVR] خطأ بالبحث عن كاميرات:',e);}
  }

  // fallback أخير
  if(!stream){
    try{stream=await navigator.mediaDevices.getUserMedia({video:true,audio:false});}
    catch{toast('تعذّر الوصول للكاميرا','bad');return;}
  }

  const v=document.getElementById('vid');v.srcObject=stream;v.style.display='block';
  document.getElementById('noCam').style.display='none';
  document.getElementById('shutter').disabled=false;
  document.getElementById('camZone').classList.add('scanning');
  if(autoMode)startAutoScan();
  loadCameras();
}

// ══ مراقبة توصيل/فصل كاميرا ════════════════════════
let knownCamIds=new Set();
// احفظ الكاميرات الحالية عند التشغيل
navigator.mediaDevices.enumerateDevices().then(devs=>{
  devs.filter(d=>d.kind==='videoinput').forEach(d=>knownCamIds.add(d.deviceId));
}).catch(()=>{});

navigator.mediaDevices.addEventListener('devicechange',async()=>{
  await loadCameras();
  const devices=await navigator.mediaDevices.enumerateDevices();
  const cams=devices.filter(d=>d.kind==='videoinput');

  // شوف لو فيه كاميرا جديدة ما كانت موجودة قبل
  const newCam=cams.find(c=>!knownCamIds.has(c.deviceId));

  // حدّث القائمة
  knownCamIds.clear();
  cams.forEach(c=>knownCamIds.add(c.deviceId));

  if(newCam){
    // كاميرا جديدة انوصلت — غالباً USB، بدّل لها مباشرة
    toast('كاميرا جديدة! جاري التبديل...','info');
    console.log('[DLVR] كاميرا جديدة: "'+newCam.label+'" id='+newCam.deviceId.slice(0,12));
    setTimeout(()=>startCam(newCam.deviceId),1000);
  }
});

// ══ CAMERA LIST ══════════════════════════════════════
async function loadCameras(){
  try{
    const devices=await navigator.mediaDevices.enumerateDevices();
    const cams=devices.filter(d=>d.kind==='videoinput');
    const sel=document.getElementById('camSelect');
    if(!sel)return;
    sel.innerHTML='';
    if(cams.length===0){sel.innerHTML='<option value="">لا توجد كاميرات</option>';return;}
    // اعرف الكاميرا النشطة حالياً
    let activeDeviceId='';
    if(stream){
      const t=stream.getVideoTracks()[0];
      if(t&&t.getSettings)activeDeviceId=t.getSettings().deviceId||'';
    }

    cams.forEach((cam,i)=>{
      const opt=document.createElement('option');
      opt.value=cam.deviceId;
      const label=cam.label||('كاميرا '+(i+1));
      let tag='';
      if(isLikelyUSB(label))tag=' [USB]';
      else if(isBuiltinCamera(label))tag=' [مدمجة]';
      if(cam.deviceId===activeDeviceId)tag+=' ✓';
      opt.textContent=label+tag;
      if(cam.deviceId===selectedCamId)opt.selected=true;
      sel.appendChild(opt);
    });
    // لو ما فيه كاميرا محفوظة، حدد الحالية
    if(!selectedCamId&&stream){
      const activeTrack=stream.getVideoTracks()[0];
      if(activeTrack){
        const activeCam=cams.find(c=>c.label===activeTrack.label);
        if(activeCam)sel.value=activeCam.deviceId;
      }
    }
    sel.onchange=()=>{
      selectedCamId=sel.value;
      localStorage.setItem(KEY_CAM,selectedCamId);
      startCam(selectedCamId);
      toast('تم تغيير الكاميرا','ok');
    };
  }catch(e){console.error('Camera list error:',e);}
}

// MODE
function toggleMode(){
  autoMode=!autoMode;localStorage.setItem(KEY_AUTO,autoMode);updateModeUI();
  if(autoMode&&stream)startAutoScan();else stopAutoScan();
}
function updateModeUI(){
  const btn=document.getElementById('modeBtn'),r=document.getElementById('shutterRing');
  if(btn){
    if(autoMode){btn.textContent='✓ تلقائي';btn.style.background='var(--org)';btn.style.color='#000';btn.style.borderColor='var(--org)';}
    else{btn.textContent='يدوي';btn.style.background='var(--dark)';btn.style.color='var(--muted)';btn.style.borderColor='var(--border)';}
  }
  if(r){if(autoMode)r.classList.add('hidden');else r.classList.remove('hidden');}
}

// AUTO SCAN
function startAutoScan(){
  if(!stream)return;
  document.getElementById('autoStatus').classList.add('on');
  document.getElementById('boxLabel').textContent='مسح تلقائي — ضع الفاتورة';
  prevFrame=null;stableCount=0;changeDetected=false;
  autoLoop();toast('المسح التلقائي شغّال','info');
}
function stopAutoScan(){
  if(autoRAF){cancelAnimationFrame(autoRAF);autoRAF=null;}
  document.getElementById('autoStatus').classList.remove('on');
  document.getElementById('boxLabel').textContent='ضع الطلب داخل الإطار';
  prevFrame=null;
}
function autoLoop(){
  if(!autoMode||!stream)return;
  autoRAF=requestAnimationFrame(()=>{
    const now=Date.now();
    if(now-lastAutoTime>=SCAN_MS&&!busy&&now>=cooldownUntil){lastAutoTime=now;detectMotion();}
    autoLoop();
  });
}

// MOTION DETECTION
function detectMotion(){
  const vid=document.getElementById('vid');
  if(!vid.videoWidth)return;
  const cvS=document.getElementById('cvSmall'),w=80,h=60;
  cvS.width=w;cvS.height=h;
  const ctx=cvS.getContext('2d',{willReadFrequently:true});
  ctx.drawImage(vid,0,0,w,h);
  const px=ctx.getImageData(0,0,w,h).data;
  const gray=new Uint8Array(w*h);
  for(let i=0;i<gray.length;i++){const j=i*4;gray[i]=(px[j]*.299+px[j+1]*.587+px[j+2]*.114)|0;}

  const sb=document.getElementById('scanBox'),lb=document.getElementById('boxLabel');

  if(!prevFrame){prevFrame=gray;return;}

  let diff=0;
  for(let i=0;i<gray.length;i++)if(Math.abs(gray[i]-prevFrame[i])>30)diff++;
  const pct=(diff/gray.length)*100;
  prevFrame=gray;

  if(pct>=CHANGE_THRESH){
    changeDetected=true;stableCount=0;
    sb.classList.add('detected');
    lb.textContent='حركة...';lb.style.color='var(--warn)';
  }else if(changeDetected&&pct<5){
    stableCount++;
    lb.textContent='تثبيت '+stableCount+'/'+STABLE_NEED;
    if(stableCount>=STABLE_NEED){
      changeDetected=false;stableCount=0;
      sb.classList.remove('detected');
      lb.textContent='مسح تلقائي — ضع الفاتورة';lb.style.color='';
      captureAuto();
    }
  }else if(!changeDetected){
    sb.classList.remove('detected');
    lb.textContent='مسح تلقائي — ضع الفاتورة';lb.style.color='';
  }
}

// AUTO CAPTURE
async function captureAuto(){
  if(busy)return;
  if(!branchName||!BRANCHES[branchName]){toast('أدخل رقم المنشأة','bad');return;}
  busy=true;
  flash();beep();

  const vid=document.getElementById('vid'),cv=document.getElementById('cv');
  const maxW=900,ratio=Math.min(maxW/(vid.videoWidth||1280),1);
  cv.width=Math.round((vid.videoWidth||1280)*ratio);cv.height=Math.round((vid.videoHeight||720)*ratio);
  cv.getContext('2d').drawImage(vid,0,0,cv.width,cv.height);
  const b64=cv.toDataURL('image/jpeg',0.8).split(',')[1];
  const b64Up=cv.toDataURL('image/jpeg',0.85).split(',')[1];

  document.getElementById('analyzing').classList.add('on');
  document.getElementById('anSub').textContent='تحليل بالذكاء الاصطناعي...';

  try{
    const r=await analyze(b64);
    if(!r||r.readable==='no'){busy=false;document.getElementById('analyzing').classList.remove('on');return;}
    const key=(r.orderNumber||'').trim();
    if(key&&processedOrders.has(key)){busy=false;document.getElementById('analyzing').classList.remove('on');return;}

    r.branchCode=branchName;r.branchLabel=branchNameLabel||BRANCHES[branchName]||branchName;
    let saved=false;
    if(sheetUrl)saved=await saveSheet(r,b64Up);
    showResult(r,saved);

    if(key)processedOrders.add(key);
    if(processedOrders.size>100){const a=[...processedOrders];processedOrders.clear();a.slice(-50).forEach(x=>processedOrders.add(x));}
    count++;localStorage.setItem(KEY_COUNT,count);document.getElementById('cnt').textContent=count;
    document.getElementById('scanBox').classList.add('captured');
    setTimeout(()=>document.getElementById('scanBox').classList.remove('captured'),800);
    cooldownUntil=Date.now()+COOLDOWN;showCooldown(COOLDOWN);
  }catch(e){console.error(e);}
  finally{document.getElementById('analyzing').classList.remove('on');document.getElementById('anSub').textContent='تحليل البيانات';busy=false;}
}

function flash(){const f=document.getElementById('flash');f.classList.add('go');setTimeout(()=>f.classList.remove('go'),100);}

function showCooldown(ms){
  const f=document.getElementById('cooldownFill');
  f.style.transition='none';f.style.width='100%';
  requestAnimationFrame(()=>requestAnimationFrame(()=>{f.style.transition=`width ${ms}ms linear`;f.style.width='0%';}));
}

// MANUAL CAPTURE
async function capture(){
  if(!stream||busy)return;
  if(!branchName||!BRANCHES[branchName]){toast('أدخل رقم المنشأة أولاً','bad');setTimeout(()=>openAdmin(),800);return;}
  busy=true;flash();beep();
  const vid=document.getElementById('vid'),cv=document.getElementById('cv');
  const maxW=900,ratio=Math.min(maxW/(vid.videoWidth||1280),1);
  cv.width=Math.round((vid.videoWidth||1280)*ratio);cv.height=Math.round((vid.videoHeight||720)*ratio);
  cv.getContext('2d').drawImage(vid,0,0,cv.width,cv.height);
  const b64=cv.toDataURL('image/jpeg',0.8).split(',')[1];
  const b64Up=cv.toDataURL('image/jpeg',0.85).split(',')[1];
  document.getElementById('analyzing').classList.add('on');document.getElementById('shutter').disabled=true;
  try{
    const r=await analyze(b64);r.branchCode=branchName;r.branchLabel=branchNameLabel||BRANCHES[branchName]||branchName;
    let saved=false;if(sheetUrl&&r.readable!=='no')saved=await saveSheet(r,b64Up);
    showResult(r,saved);count++;localStorage.setItem(KEY_COUNT,count);document.getElementById('cnt').textContent=count;
    document.getElementById('scanBox').classList.add('captured');setTimeout(()=>document.getElementById('scanBox').classList.remove('captured'),800);
  }catch(e){toast(e.message,'bad');}
  finally{document.getElementById('analyzing').classList.remove('on');document.getElementById('shutter').disabled=false;busy=false;}
}

// AI
async function analyze(b64){
  const res=await fetch(WORKER_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:'claude-haiku-4-5-20251001',max_tokens:400,messages:[{role:'user',content:[{type:'image',source:{type:'base64',media_type:'image/jpeg',data:b64}},{type:'text',text:`أنت نظام توثيق طلبات مطاعم. حلّل صورة طلب التيك أواي وأعطني JSON فقط بدون أي نص إضافي:
{"orderNumber":"...","platform":"...","readable":"...","confidence":"..."}

قواعد تحديد رقم الطلب:
- HungerStation فقط: يوجد رقمان في الفاتورة:
  1) رقم قصير من 4 أرقام بعد علامة # (مثل #5350) ← تجاهل هذا تماماً
  2) رقم طويل من 7-10 أرقام (مثل 588185171) ← هذا هو رقم الطلب الصحيح المطلوب
  دائماً خذ الرقم الطويل فقط وتجاهل الرقم القصير بعد #
- بقية المنصات (Keeta, Jahez, Ninja, ToYou, Marsool): خذ رقم الطلب المعتاد
- أزل أي علامة # أو رموز من الرقم

مهم جداً — الدقة أهم من السرعة:
- إذا أي رقم (digit) في رقم الطلب غير واضح أو مشوّش أو ممكن يكون رقم ثاني (مثلاً 0 أو 8 أو 6 أو 9)، اجعل readable = "no"
- لا تخمّن أبداً — الرقم الغلط أسوأ بكثير من إعادة التصوير
- أرقام HungerStation دائماً 9 أرقام بالضبط. إذا طلع أقل أو أكثر فالقراءة غالباً خاطئة واجعل readable = "no"

confidence: high إذا كل الأرقام واضحة 100%، low إذا فيه أي شك
platform: HungerStation أو Keeta أو Jahez أو Ninja أو ToYou أو Marsool أو غير واضح
readable: yes فقط إذا كل رقم واضح تماماً بدون أي شك، no إذا فيه أي شك أو الصورة غير مقروءة أو لا تحتوي على فاتورة
لا تكتب أي شيء خارج JSON.`}]}]})});
  const data=await res.json();
  if(data.error)throw new Error(data.error.message||JSON.stringify(data.error));
  if(!data.content||!data.content[0])throw new Error('رد غير متوقع');
  const m=data.content[0].text.trim().match(/\{[\s\S]*\}/);
  if(!m)throw new Error('لم يتمكن AI من قراءة الطلب');
  const result = JSON.parse(m[0]);

  if(result.readable === 'yes' && result.platform === 'HungerStation'){
    const digits = (result.orderNumber || '').replace(/\D/g, '');
    if(digits.length !== 9){
      result.readable = 'no';
    }
  }
  if(result.confidence === 'low'){
    result.readable = 'no';
  }

  return result;
}

// SHEET
async function saveSheet(r,b64Up){
  try{await fetch(sheetUrl,{method:'POST',mode:'no-cors',headers:{'Content-Type':'application/json'},body:JSON.stringify({branchCode:r.branchCode||'',branchLabel:r.branchLabel||'',branchName:r.branchLabel||'',orderNumber:(r.orderNumber||'').replace(/^#+/,'').trim()||'',platform:r.platform||'',imageBase64:b64Up||''})});return true;}catch{return false;}
}

// BRAND TAP
function onBrandTap(){
  tapN++;for(let i=0;i<5;i++)document.getElementById('t'+i).classList.toggle('on',i<tapN);
  clearTimeout(tapTimer);tapTimer=setTimeout(()=>{tapN=0;for(let i=0;i<5;i++)document.getElementById('t'+i).classList.remove('on');},2500);
  if(tapN>=5){tapN=0;clearTimeout(tapTimer);for(let i=0;i<5;i++)document.getElementById('t'+i).classList.remove('on');openAdmin();}
}

// ADMIN
function openAdmin(){document.getElementById('pinIn').value='';document.getElementById('pinErr').style.display='none';document.getElementById('pinWrap').style.display='block';document.getElementById('settingsDiv').style.display='none';document.getElementById('adminOverlay').classList.add('on');setTimeout(()=>document.getElementById('pinIn').focus(),350);}
function closeAdmin(){document.getElementById('adminOverlay').classList.remove('on');}
function checkPin(){const v=document.getElementById('pinIn').value;if(v.length<4)return;if(v===ADMIN_PIN){document.getElementById('pinWrap').style.display='none';document.getElementById('settingsDiv').style.display='block';document.getElementById('urlIn').value=sheetUrl;document.getElementById('branchIn').value=branchName;document.getElementById('branchNameIn').value=branchNameLabel;}else{document.getElementById('pinErr').style.display='block';document.getElementById('pinIn').value='';setTimeout(()=>document.getElementById('pinErr').style.display='none',2000);}}
function saveSettings(){
  const url=document.getElementById('urlIn').value.trim(),branch=document.getElementById('branchIn').value.trim();
  if(!branch){toast('أدخل رقم المنشأة','bad');return;}
  if(!BRANCHES[branch]){toast('رقم المنشأة غير صحيح','bad');document.getElementById('branchIn').style.borderColor='var(--red)';setTimeout(()=>document.getElementById('branchIn').style.borderColor='',2000);return;}
  if(url&&!url.startsWith('https://script.google.com')){toast('رابط الشيت غير صحيح','bad');return;}
  if(url){sheetUrl=url;localStorage.setItem(KEY_URL,sheetUrl);setConn(true);}
  branchName=branch;localStorage.setItem(KEY_BRANCH,branchName);
  const n=document.getElementById('branchNameIn').value.trim();if(n){branchNameLabel=n;localStorage.setItem(KEY_BRANCH_NAME,branchNameLabel);}
  updateBranchBar();closeAdmin();toast('تم الحفظ بنجاح','ok');
}
function setConn(ok){document.getElementById('conn').className='conn'+(ok?' ok':'');document.getElementById('connTxt').textContent=ok?'متصل':'غير متصل';}
function updateBranchBar(){const el=document.getElementById('branchInfo');if(branchName&&BRANCHES[branchName]){const d=branchNameLabel||BRANCHES[branchName]||branchName;el.innerHTML=d+' · <span>'+branchName+'</span>';el.style.color='';}else{el.innerHTML='يجب تحديد رمز المنشأة';el.style.color='var(--warn)';}}

// RESULT
function showResult(r,saved){
  if(!r||r.readable==='no'){showRetake();return;}
  const badge=document.getElementById('rBadge'),rRows=document.getElementById('rRows'),sentRow=document.getElementById('sentRow'),overlay=document.getElementById('resultOverlay');
  if(!badge||!rRows||!overlay)return;
  badge.textContent=saved?'✓ تم الإرسال':(sheetUrl?'فشل الحفظ':'غير مرتبط');badge.className='r-badge '+(saved?'ok':'err');
  const rows=[{k:'رقم الطلب',v:r.orderNumber||'—',c:'big'},{k:'المنصة',v:r.platform||'—',c:''}];
  if(r.branchCode){const b=BRANCHES[r.branchCode]||r.branchCode;rows.splice(1,0,{k:'الفرع',v:b+' · '+r.branchCode,c:''});}
  rRows.innerHTML=rows.map(x=>`<div class="r-row"><span class="r-key">${x.k}</span><span class="r-val ${x.c}">${x.v}</span></div>`).join('');
  if(sentRow)sentRow.style.display=saved?'flex':'none';
  overlay.classList.add('on');setTimeout(()=>closeResult(),3000);
  if(!saved)toast('تم التحليل','info');
}
function showRetake(){const el=document.getElementById('retakeOverlay');el.classList.add('on');setTimeout(()=>el.classList.remove('on'),3000);}
function showSuccess(){const el=document.getElementById('successOverlay');el.classList.add('on');setTimeout(()=>el.classList.remove('on'),3000);}
function closeResult(){document.getElementById('resultOverlay').classList.remove('on');}

function beep(){try{if(!audioCtx)audioCtx=new(window.AudioContext||window.webkitAudioContext)();const o=audioCtx.createOscillator(),g=audioCtx.createGain();o.connect(g);g.connect(audioCtx.destination);o.type='sine';o.frequency.setValueAtTime(900,audioCtx.currentTime);o.frequency.exponentialRampToValueAtTime(1300,audioCtx.currentTime+0.1);g.gain.setValueAtTime(0.35,audioCtx.currentTime);g.gain.exponentialRampToValueAtTime(0.001,audioCtx.currentTime+0.18);o.start();o.stop(audioCtx.currentTime+0.18);}catch{}}
function toast(msg,type='ok'){const el=document.getElementById('toast');el.textContent=msg;el.className=`toast ${type} show`;setTimeout(()=>el.classList.remove('show'),2800);}

document.addEventListener('touchstart',()=>{if(!audioCtx)audioCtx=new(window.AudioContext||window.webkitAudioContext)();if(audioCtx.state==='suspended')audioCtx.resume();},{once:true});
document.addEventListener('keydown',e=>{if(e.code==='Space'&&!document.getElementById('shutter').disabled){e.preventDefault();capture();}});
if('serviceWorker' in navigator){window.addEventListener('load',()=>{navigator.serviceWorker.register('sw.js').catch(()=>{});});}
