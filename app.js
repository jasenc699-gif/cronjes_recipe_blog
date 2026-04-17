const SK='cronjes_blog_v1',KK='cronjes_apikey',WK='cronjes_welcomed',CK='cronjes_customcats';
const SKB='cronjes_blog_v1_bak'; // backup key — written on every save so a killed mid-write never loses data
const CATS=['Breakfast','Lunch','Dinner','Dessert','Snacks','Soups','Salads','Baking','Drinks','Other'];
const CE={Breakfast:'🍳',Lunch:'🥙',Dinner:'🍽️',Dessert:'🍰',Snacks:'🧀',Soups:'🍲',Salads:'🥗',Baking:'🥐',Drinks:'🥤',Other:'🍴'};
const CC={Breakfast:'#FFF0D0',Lunch:'#E2F2E0',Dinner:'#D5E8F5',Dessert:'#FFD6E8',Snacks:'#FFFAC0',Soups:'#FFE4C8',Salads:'#DCF2CC',Baking:'#F5E8D0',Drinks:'#CCE8F8',Other:'#E8E4DC'};
const CUSTOMCC='#E0EEF0';
const FE=['🍝','🥗','🍜','🥘','🍲','🍛','🥩','🍕','🥞','🧆','🍗','🥕','🥧','🍱','🫔','🫕'];

// ── Haptic feedback ───────────────────────────────────────────────────────
// Patterns: 'tap' light tap, 'select' multi-select entry, 'toggle' checkbox tick,
// 'save' success, 'delete' destructive, 'fav' favourite toggle, 'error' warning.
const VIBE={tap:30,toggle:18,select:[40,30,40],save:[30,50,80],delete:[50,40,70],fav:[25,40,50],error:[60,40,60]};
function vibe(type='tap'){try{if(navigator.vibrate)navigator.vibrate(VIBE[type]??30);}catch(e){}}

// Safe storage — falls back to in-memory if localStorage is blocked (sandboxed iframes etc.)
const _mem={};
const store={
  get(k){try{return localStorage.getItem(k);}catch(e){return _mem[k]??null;}},
  set(k,v){try{localStorage.setItem(k,v);}catch(e){_mem[k]=v;}},
  remove(k){try{localStorage.removeItem(k);}catch(e){delete _mem[k];}}
};
function getCustomCats(){try{const v=store.get(CK);return v?JSON.parse(v):[];}catch(e){return[];}}
function saveCustomCats(arr){store.set(CK,JSON.stringify(arr));}
function allCats(){return[...CATS,...getCustomCats().filter(c=>!CATS.includes(c))];}
function catEmoji(c){return CE[c]||'🍴';}
function catColor(c){return CC[c]||CUSTOMCC;}
let recs=[],tab='c',catF='All',rid=null,mode='p',fb64=null,dtxt=null,pendingRec=null,editMode=false,editPendingImg=undefined,_editPendingImgData=null;
let _openCat=null;
let _prevTab='c',_prevCat=null;
let multiSelectMode=false,selectedIds=new Set();
let multiImgs=[];    // [{fb64, name}] — multiple screenshots queued for batch extraction
let batchResults=[]; // [{rec, imgData, status}] — extracted recipes awaiting individual save

// ── IndexedDB Image Store ─────────────────────────────────────────────────
// Stores base64 image data separately from localStorage to avoid quota issues.
// Recipes use imageData='__idb__' to signal their image lives here.
const ImgStore=(function(){
  let _db=null;
  function _open(){
    if(_db)return Promise.resolve(_db);
    return new Promise((res,rej)=>{
      try{
        const req=indexedDB.open('cronjes_imgs',1);
        req.onupgradeneeded=e=>e.target.result.createObjectStore('imgs');
        req.onsuccess=e=>{_db=e.target.result;res(_db);};
        req.onerror=()=>rej(req.error);
      }catch(e){rej(e);}
    });
  }
  async function get(id){
    try{const db=await _open();return await new Promise((res)=>{const t=db.transaction('imgs','readonly');const r=t.objectStore('imgs').get(id);r.onsuccess=()=>res(r.result||null);r.onerror=()=>res(null);});}catch(e){return null;}
  }
  async function set(id,data){
    try{const db=await _open();return await new Promise((res)=>{const t=db.transaction('imgs','readwrite');t.objectStore('imgs').put(data,id);t.oncomplete=()=>res(true);t.onerror=()=>res(false);});}catch(e){return false;}
  }
  async function del(id){
    try{const db=await _open();return await new Promise((res)=>{const t=db.transaction('imgs','readwrite');t.objectStore('imgs').delete(id);t.oncomplete=()=>res(true);t.onerror=()=>res(false);});}catch(e){return false;}
  }
  return{get,set,del};
})();

function load(){
  // Try main key first; fall back to backup if missing or corrupt.
  // This guards against iOS killing the app mid-write and leaving partial JSON.
  const tryParse=k=>{try{const v=store.get(k);return v?JSON.parse(v):null;}catch(e){return null;}};
  const main=tryParse(SK);
  if(Array.isArray(main)&&main.length>0){
    recs=main;
  } else {
    const bak=tryParse(SKB);
    if(Array.isArray(bak)&&bak.length>0){
      recs=bak;
      save(); // re-write main key from backup
      console.warn('cronjes: restored from backup storage key');
    } else {
      recs=main||bak||[];
    }
  }
  if(!store.get(WK))go('welcome');
  else if(!getKey())go('settings');
  else{
    // Restore last screen so app-switching doesn't lose your place
    const last=sessionStorage.getItem('cronjes_screen')||'main';
    go(last==='welcome'||last==='add'?'main':last);
  }
  // Migrate any legacy base64 images from localStorage → IndexedDB in background
  migrateImagesToIdb();
}
function save(){
  // Write backup FIRST so if the app is killed mid-write on the main key,
  // the backup is already intact and load() can restore from it.
  // Base64 images can easily exceed the 5-10 MB localStorage quota on iOS Safari.
  // Strategy: try full save; if quota is exceeded strip base64 data URIs (keep
  // external URLs which are tiny), then try again; only alert on total failure.
  const _write=json=>{
    // Use localStorage directly so we can catch quota errors that store.set swallows.
    try{localStorage.setItem(SKB,json);localStorage.setItem(SK,json);return true;}
    catch(e){
      // Fall back to in-memory so the current session still works.
      _mem[SKB]=json;_mem[SK]=json;return false;
    }
  };
  try{
    const json=JSON.stringify(recs);
    if(!_write(json)){
      // Quota hit — strip base64 data URIs (uploaded photos) and retry.
      // External image URLs (https://…) are kept; they're tiny strings.
      const slim=recs.map(r=>({...r,imageData:(r.imageData&&r.imageData.startsWith('data:'))?null:r.imageData}));
      const slimJson=JSON.stringify(slim);
      if(!_write(slimJson)){
        // Still failing — storage is completely full.
        alert('⚠️ Storage is full — your latest changes could not be saved.\nGo to Settings → Export All Recipes to back up your data, then clear some space.');
      } else {
        console.warn('cronjes: saved without uploaded photos (base64) to free up storage. External image URLs were kept.');
      }
    }
  }catch(e){console.error('cronjes: save error',e);}
}
function welcomeDone(){store.set(WK,'1');if(!getKey())go('settings');else{buildChips();render();go('main');}}

async function migrateImagesToIdb(){
  // Move any base64 images still in localStorage → IndexedDB in background.
  // Frees up localStorage quota so images are never silently stripped on save.
  const toMigrate=recs.filter(r=>r.imageData&&r.imageData.startsWith('data:'));
  if(!toMigrate.length)return;
  let migrated=0;
  for(const r of toMigrate){
    const ok=await ImgStore.set(r.id,r.imageData);
    if(ok){r.imageData='__idb__';migrated++;}
  }
  if(migrated>0){save();console.log('cronjes: migrated '+migrated+' image(s) to IndexedDB');}
}

function getKey(){return store.get(KK)||'';}
function saveKey(){
  const v=document.getElementById('keyinp').value.trim();
  if(!v.startsWith('gsk_')){alert('That doesn\'t look like a valid Groq key. It should start with gsk_');return;}
  store.set(KK,v);store.remove('cronjes_keydraft');
  document.getElementById('keyinp').value='';
  showKinfo();alert('API key saved ✓');buildChips();render();go('main');
}
function clearKey(){if(!confirm('Remove saved API key?'))return;store.remove(KK);document.getElementById('kinfo').style.display='none';}
function showKinfo(){
  document.getElementById('kinfo').style.display=getKey()?'block':'none';
  // Auto-save key field draft so switching apps doesn't lose it
  const ki=document.getElementById('keyinp');
  if(ki&&!ki._autoSave){ki._autoSave=true;ki.addEventListener('input',()=>store.set('cronjes_keydraft',ki.value.trim()));}
  // Restore draft if no key saved yet
  if(!getKey()){const d=store.get('cronjes_keydraft');if(d&&ki)ki.value=d;}
}

function go(s){
  const ids={main:'sm',add:'sadd',detail:'sdet',settings:'sset',welcome:'swel'};
  document.querySelectorAll('.scr').forEach(x=>x.classList.remove('on'));
  const el=document.getElementById(ids[s]);
  if(!el)return;
  el.classList.add('on');
  sessionStorage.setItem('cronjes_screen',s);
  if(s==='add')resetAdd();
  if(s==='main'){if(editMode)exitEditMode();if(multiSelectMode)exitMultiSelect(true);buildChips();setTab('c');}
  if(s==='settings'){showKinfo();document.getElementById('impresult').style.display='none';loadSyncFields();renderCatManager();renderStorageBar();}
}

function setTab(t){
  tab=t;catF='All';vibe('tap');
  ['a','f','c'].forEach(x=>document.getElementById('nt-'+x).classList.toggle('on',x===t));
  document.getElementById('pall').style.display=t==='a'?'grid':'none';
  document.getElementById('pfav').style.display=t==='f'?'grid':'none';
  document.getElementById('pcat').style.display=t==='c'?'grid':'none';
  document.getElementById('pcat-detail').style.display='none';
  document.querySelector('.srch').style.display=t==='c'?'none':'block';
  if(t==='c')renderCats();else render();
}

function buildChips(){
  const used=[...new Set(recs.map(r=>r.category).filter(Boolean))];
  const drop=document.getElementById('catdrop');
  if(!drop)return;
  drop.innerHTML='<option value="All">All Categories</option>'
    +used.map(c=>`<option value="${c}"${catF===c?' selected':''}>${catEmoji(c)} ${c}</option>`).join('');
  if(catF&&catF!=='All')drop.value=catF;
}
function filterCatDrop(val){catF=val;render();}

function makeRecipeCard(r, showCat){
  const card=document.createElement('div');
  const isSelected=multiSelectMode&&selectedIds.has(r.id);
  card.className='rc'+(isSelected?' ms-selected':'');
  if(multiSelectMode){card.onclick=()=>{vibe('toggle');toggleSelect(r.id);};}
  else{card.onclick=()=>{vibe('tap');showDetail(r.id);};}
  const bg=catColor(r.category);
  const isIdb=r.imageData==='__idb__';
  const img=(r.imageData&&!isIdb)
    ?`<div class="rc-img" style="padding:0;overflow:hidden"><img src="${r.imageData}" style="width:100%;height:110px;object-fit:cover;display:block"/></div>`
    :`<div class="rc-img" style="background:${bg}">${r.emoji}</div>`;
  card.innerHTML=`${img}${r.favourite?'<div class="rc-star">⭐</div>':''}<div class="rc-body"><div class="rc-title">${r.title}</div><div class="rc-meta">${[r.time,r.servings].filter(Boolean).join(' · ')}</div>${showCat&&r.category?`<span class="rc-cat">${r.category}</span>`:''}</div>`;
  if(!multiSelectMode)addLongPress(card,r.id);
  // Async-load IDB image after card is created
  if(isIdb){
    ImgStore.get(r.id).then(data=>{
      if(data&&card.isConnected){
        const d=card.querySelector('.rc-img');
        if(d){d.style.padding='0';d.style.overflow='hidden';d.innerHTML=`<img src="${data}" style="width:100%;height:110px;object-fit:cover;display:block"/>`;}
      }
    });
  }
  return card;
}

function addLongPress(card,id){
  let timer=null,moved=false;
  // Touch: long press enters multi-select mode
  card.addEventListener('touchstart',()=>{moved=false;timer=setTimeout(()=>{if(!moved){vibe('select');enterMultiSelect(id);}},580);},{passive:true});
  card.addEventListener('touchmove',()=>{moved=true;clearTimeout(timer);},{passive:true});
  card.addEventListener('touchend',()=>clearTimeout(timer));
  card.addEventListener('touchcancel',()=>clearTimeout(timer));
  // Desktop: right-click or long mouse press as alternative
  card.addEventListener('contextmenu',e=>{e.preventDefault();enterMultiSelect(id);});
}

// ── Multi-select ──────────────────────────────────────────────────────────
function enterMultiSelect(id){
  multiSelectMode=true;
  selectedIds=new Set([id]);
  _rerenderForSelect();
  _updateMsToolbar();
}
function exitMultiSelect(skipRerender){
  multiSelectMode=false;
  selectedIds=new Set();
  const tb=document.getElementById('ms-toolbar');if(tb)tb.style.display='none';
  if(!skipRerender)_rerenderForSelect();
}
function toggleSelect(id){
  if(selectedIds.has(id))selectedIds.delete(id);else selectedIds.add(id);
  if(selectedIds.size===0){exitMultiSelect();return;}
  _rerenderForSelect();
  _updateMsToolbar();
}
function _updateMsToolbar(){
  const tb=document.getElementById('ms-toolbar');if(!tb)return;
  const n=selectedIds.size;
  tb.style.display=n>0?'flex':'none';
  const cnt=document.getElementById('ms-count');if(cnt)cnt.textContent=n+' selected';
  const btn=document.getElementById('ms-del-btn');if(btn)btn.textContent='Delete ('+n+')';
}
function _rerenderForSelect(){
  if(_openCat)openCatDetail(_openCat);
  else if(tab==='c')renderCats();
  else render();
}
async function deleteSelected(){
  const n=selectedIds.size;if(!n)return;
  if(!confirm('Delete '+n+' recipe'+(n!==1?'s':'')+' permanently?'))return;
  vibe('delete');
  for(const id of selectedIds)await ImgStore.del(id);
  const ids=new Set(selectedIds);
  recs=recs.filter(r=>!ids.has(r.id));
  save();
  buildChips();
  exitMultiSelect(); // also re-renders
}


function render(){
  const q=(document.getElementById('srch').value||'').toLowerCase();
  let list=recs;
  if(catF&&catF!=='All')list=list.filter(r=>r.category===catF);
  if(q)list=list.filter(r=>r.title.toLowerCase().includes(q)||(r.cuisine||'').toLowerCase().includes(q));
  if(tab==='f')list=list.filter(r=>r.favourite);
  const pid=tab==='f'?'pfav':'pall';
  const p=document.getElementById(pid);p.innerHTML='';
  const empty=document.getElementById('pempty');
  if(!list.length){empty.style.display='block';document.getElementById('emptymsg').innerHTML=tab==='f'?'No favourites yet.<br>Tap ★ on a recipe to save it!':'No recipes yet.<br>Tap + to add your first one!';}
  else empty.style.display='none';
  list.forEach(r=>p.appendChild(makeRecipeCard(r,true)));
}

function renderCats(){
  const p=document.getElementById('pcat');p.innerHTML='';
  document.getElementById('pcat-detail').style.display='none';
  p.style.display='grid';
  const usedCats=allCats().filter(c=>recs.some(r=>r.category===c));
  if(!usedCats.length){
    p.style.display='none';
    const empty=document.getElementById('pempty');
    empty.style.display='block';
    document.getElementById('emptymsg').innerHTML='No recipes yet.<br>Tap + to add your first one!';
    return;
  }
  document.getElementById('pempty').style.display='none';
  usedCats.forEach(c=>{
    // recs is newest-first, so the first match with an image is the latest saved
    const catRecs=recs.filter(r=>r.category===c);
    const n=catRecs.length;
    const hero=catRecs.find(r=>r.imageData)||null;

    const d=document.createElement('div');d.className='ccard';
    d.style.borderColor='transparent';
    d.onclick=()=>{vibe('tap');openCatDetail(c);};

    // Shared overlay markup (sits on top of the image)
    const overlay=`<div class="ccard-overlay"><span class="cico">${catEmoji(c)}</span><div class="cname">${c}</div><div class="ccnt">${n} recipe${n!==1?'s':''}</div></div>`;
    // Fallback markup (used when there is no image)
    const fallback=`<div class="ccard-fallback" style="background:${catColor(c)};position:absolute;inset:0;"><span class="cico">${catEmoji(c)}</span><div class="cname">${c}</div><div class="ccnt">${n} recipe${n!==1?'s':''}</div></div>`;

    if(hero&&hero.imageData==='__idb__'){
      // Render fallback immediately, then swap image in once IDB resolves
      d.innerHTML=fallback;
      ImgStore.get(hero.id).then(data=>{
        if(data&&d.isConnected)d.innerHTML=`<img class="ccard-img" src="${data}"/>${overlay}`;
      });
    }else if(hero&&hero.imageData){
      d.innerHTML=`<img class="ccard-img" src="${hero.imageData}"/>${overlay}`;
    }else{
      d.innerHTML=fallback;
    }
    p.appendChild(d);
  });
}

function openCatDetail(c){
  _openCat=c;
  document.getElementById('pcat').style.display='none';
  document.getElementById('pempty').style.display='none';
  const det=document.getElementById('pcat-detail');
  det.style.display='flex';
  document.getElementById('pcat-detail-title').textContent=catEmoji(c)+' '+c;
  const grid=document.getElementById('pcat-detail-grid');
  grid.innerHTML='';
  const list=recs.filter(r=>r.category===c);
  if(!list.length){
    grid.innerHTML='<div style="grid-column:1/-1;text-align:center;padding:50px 24px;font-family:Arial,sans-serif;color:var(--mu);">No recipes in this category yet.</div>';
    return;
  }
  list.forEach(r=>grid.appendChild(makeRecipeCard(r,false)));
}

function closeCatDetail(){
  _openCat=null;
  document.getElementById('pcat-detail').style.display='none';
  renderCats();
}

function toggleEditMode(){
  if(editMode)cancelEdit();else enterEditMode();
}

function enterEditMode(){
  const r=recs.find(x=>x.id===rid);if(!r)return;
  editMode=true;editPendingImg=undefined;
  // Image preview
  setEditImgPreview(r.imageData||null,r);
  // Populate form
  document.getElementById('edit-title').value=r.title||'';
  document.getElementById('edit-servings').value=r.servings||'';
  document.getElementById('edit-time').value=r.time||'';
  document.getElementById('edit-cuisine').value=r.cuisine||'';
  document.getElementById('edit-notes').value=r.notes||'';
  const imgQ=document.getElementById('img-search-query');if(imgQ)imgQ.value=r.title||'';
  // Category
  const catSel=document.getElementById('edit-cat');
  catSel.innerHTML=allCats().map(c=>`<option value="${c}"${c===r.category?' selected':''}>${catEmoji(c)} ${c}</option>`).join('');
  // Ingredients list
  renderEditList('edit-ings-list',r.ingredients||[],false);
  // Steps list
  renderEditList('edit-steps-list',r.steps||[],true);
  // Toggle UI
  document.getElementById('ddet-view').style.display='none';
  document.getElementById('ddet-edit').style.display='block';
  document.getElementById('dhero-refresh').style.display='flex';
  document.getElementById('dedit-ico').setAttribute('stroke','#C05050');
  document.querySelector('#sdet .sa').scrollTop=0;
}

function renderEditList(containerId,items,isSteps){
  const el=document.getElementById(containerId);
  el.innerHTML='';
  items.forEach((item,i)=>{
    el.appendChild(makeEditRow(item,isSteps,i));
  });
}

function makeEditRow(value,isSteps,idx){
  const wrap=document.createElement('div');wrap.className='edit-row';
  const ta=document.createElement('textarea');
  ta.value=value;ta.rows=isSteps?2:1;
  ta.style.minHeight=isSteps?'60px':'38px';
  ta.oninput=function(){this.style.height='auto';this.style.height=this.scrollHeight+'px';};
  ta.placeholder=isSteps?'Step description...':'Ingredient...';
  const rm=document.createElement('button');rm.className='edit-rm';rm.textContent='×';
  rm.title='Remove';rm.type='button';
  rm.onclick=function(){wrap.remove();};
  wrap.appendChild(ta);wrap.appendChild(rm);
  return wrap;
}

function editAddIng(){
  const el=document.getElementById('edit-ings-list');
  el.appendChild(makeEditRow('',false,el.children.length));
  el.lastChild.querySelector('textarea').focus();
}

function editAddStep(){
  const el=document.getElementById('edit-steps-list');
  el.appendChild(makeEditRow('',true,el.children.length));
  el.lastChild.querySelector('textarea').focus();
}

function getEditListValues(containerId){
  return [...document.getElementById(containerId).querySelectorAll('textarea')]
    .map(t=>t.value.trim()).filter(Boolean);
}

function saveEdit(){
  const r=recs.find(x=>x.id===rid);if(!r)return;
  const title=document.getElementById('edit-title').value.trim();
  if(!title){document.getElementById('edit-title').focus();return;}
  r.title=title;
  r.servings=document.getElementById('edit-servings').value.trim()||null;
  r.time=document.getElementById('edit-time').value.trim()||null;
  r.cuisine=document.getElementById('edit-cuisine').value.trim()||null;
  r.category=document.getElementById('edit-cat').value;
  r.ingredients=getEditListValues('edit-ings-list');
  r.steps=getEditListValues('edit-steps-list');
  r.notes=document.getElementById('edit-notes').value.trim()||null;
  if(editPendingImg!==undefined){
    // If the new image is an IDB upload, persist it now
    if(editPendingImg==='__idb__'&&_editPendingImgData){
      ImgStore.set(r.id,_editPendingImgData);
    } else if(editPendingImg!=='__idb__'&&r.imageData==='__idb__'){
      // Replacing an IDB image with an external URL — clean up old IDB entry
      ImgStore.del(r.id);
    }
    r.imageData=editPendingImg;
    _editPendingImgData=null;
  }
  r.savedAt=new Date().toISOString();
  vibe('save');
  save();
  exitEditMode();
  showDetail(rid);
  buildChips();
}

function cancelEdit(){
  _editPendingImgData=null;
  exitEditMode();
}

function exitEditMode(){
  editMode=false;
  document.getElementById('ddet-view').style.display='block';
  document.getElementById('ddet-edit').style.display='none';
  document.getElementById('dhero-refresh').style.display='none';
  document.getElementById('dedit-ico').setAttribute('stroke','#4A9090');
  document.querySelector('#sdet .sa').scrollTop=0;
}

function goBack(){
  const backTab=_prevTab||'c';
  const backCat=_prevCat;
  go('main');
  if(backTab==='c'&&backCat){
    if(recs.some(r=>r.category===backCat))openCatDetail(backCat);
  }else if(backTab!=='c'){
    setTab(backTab);
  }
}
function showDetail(id){
  _prevTab=tab;_prevCat=_openCat;
  rid=id;const r=recs.find(x=>x.id===id);if(!r)return;
  exitEditMode();
  go('detail');
  document.getElementById('dnav').textContent=r.title;
  document.getElementById('dtitle').textContent=r.title;
  const h=document.getElementById('dhero');
  if(r.imageData==='__idb__'){
    h.innerHTML=r.emoji;h.style.minHeight='150px';h.style.background=catColor(r.category);
    ImgStore.get(id).then(data=>{
      if(data&&rid===id){h.innerHTML=`<img src="${data}"/>`;h.style.minHeight='';}
    });
  }else if(r.imageData){h.innerHTML=`<img src="${r.imageData}"/>`;h.style.minHeight='';}
  else{h.innerHTML=r.emoji;h.style.minHeight='150px';h.style.background=catColor(r.category);}
  document.getElementById('dcatb-txt').textContent=(r.category||'Other');
  document.getElementById('dcatb').style.display='';
  document.getElementById('dcatsel').style.display='none';
  document.getElementById('dmeta').innerHTML=[r.servings&&{l:r.servings,k:'Servings'},r.time&&{l:r.time,k:'Time'},r.cuisine&&{l:r.cuisine,k:'Cuisine'}].filter(Boolean).map(m=>`<div class="dmi"><strong>${m.l}</strong>${m.k}</div>`).join('');
  document.getElementById('dings').innerHTML=(r.ingredients||[]).map(i=>`<li>${i}</li>`).join('');
  document.getElementById('dsteps').innerHTML=(r.steps||[]).map((s,i)=>`<li><div class="snum">${i+1}</div><div>${s}</div></li>`).join('');
  if(r.notes){document.getElementById('dnotes').textContent=r.notes;document.getElementById('dnoteswrap').style.display='block';}
  else document.getElementById('dnoteswrap').style.display='none';
  updStar(r.favourite);renderCmts(r);
  document.querySelector('#sdet .sa').scrollTop=0;
}
function updStar(fav){
  const sv=document.getElementById('starsvg');sv.setAttribute('fill',fav?'#2ABBBB':'none');sv.setAttribute('stroke',fav?'#1A8080':'#4A9090');
  const db=document.getElementById('dstarbtn');db.classList.toggle('fav',fav);
  document.getElementById('dstarlbl').textContent=fav?'Favourited':'Add to Favourites';
  db.querySelector('svg').setAttribute('fill',fav?'#1A8080':'none');
}
function openCatEdit(){
  const r=recs.find(x=>x.id===rid);if(!r)return;
  const sel=document.getElementById('dcatsel');
  sel.innerHTML=allCats().map(c=>`<option value="${c}"${c===r.category?' selected':''}>${catEmoji(c)} ${c}</option>`).join('');
  document.getElementById('dcatb').style.display='none';
  sel.style.display='';sel.focus();
}
function saveCatEdit(){
  const r=recs.find(x=>x.id===rid);if(!r)return;
  const sel=document.getElementById('dcatsel');
  r.category=sel.value;r.savedAt=new Date().toISOString();save();
  document.getElementById('dcatb-txt').textContent=r.category;
  document.getElementById('dcatb').style.display='';
  sel.style.display='none';
  buildChips();
}
function togFav(){const r=recs.find(x=>x.id===rid);if(!r)return;r.favourite=!r.favourite;r.savedAt=new Date().toISOString();vibe('fav');updStar(r.favourite);save();}
function renderCmts(r){
  const cmts=r.comments||[];
  document.getElementById('cmtlist').innerHTML=cmts.length?cmts.map(c=>`<div class="cmtitem"><div class="cmttxt">${c.text}</div><div class="cmtrow"><div class="cmtdate">${fmtDate(c.date)}</div><button class="cmtrm" onclick="delCmt('${c.id}')">Remove</button></div></div>`).join(''):`<p style="font-size:13px;color:var(--mu);font-family:Arial,sans-serif;margin-bottom:10px;">No notes yet.</p>`;
}
function postCmt(){const el=document.getElementById('cmtinp');const tx=el.value.trim();if(!tx)return;const r=recs.find(x=>x.id===rid);if(!r)return;if(!r.comments)r.comments=[];r.comments.push({id:Date.now().toString(),text:tx,date:new Date().toISOString()});r.savedAt=new Date().toISOString();el.value='';renderCmts(r);save();}
function delCmt(cid){const r=recs.find(x=>x.id===rid);if(!r)return;r.comments=(r.comments||[]).filter(c=>c.id!==cid);r.savedAt=new Date().toISOString();renderCmts(r);save();}
function fmtDate(iso){const d=new Date(iso);return d.toLocaleDateString('en-NZ',{day:'numeric',month:'short',year:'numeric'})+' '+d.toLocaleTimeString('en-NZ',{hour:'2-digit',minute:'2-digit'});}
async function delRecipe(){if(!confirm('Delete this recipe?'))return;vibe('delete');await ImgStore.del(rid);recs=recs.filter(r=>r.id!==rid);save();goBack();}


function resetAdd(){
  mode='p';fb64=null;dtxt=null;pendingRec=null;multiImgs=[];batchResults=[];
  ['fip','dip'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  const _h=(id,prop,val)=>{const el=document.getElementById(id);if(el)el[prop]=val;};
  _h('imgprev','src','');
  _h('urlinp','value','');
  _h('docname','textContent','');
  ['errmsg','catpanel','batchpanel','multi-count-badge','batch-done-btn'].forEach(id=>{const el=document.getElementById(id);if(el)el.style.display='none';});
  _h('extractbtn','style.display','block');
  document.getElementById('extractbtn').style.display='block';
  ['p','u','d'].forEach(x=>{
    const op=document.getElementById('op-'+x);if(op)op.classList.toggle('on',x==='p');
    const sec=document.getElementById('sec-'+x);if(sec)sec.style.display='none';
  });
  _h('op-p-hint','textContent','Tap to choose image');
  _h('op-d-hint','textContent','Tap to choose file');
}
function selMode(m){
  const prev=mode;
  mode=m;
  ['p','u','d'].forEach(x=>document.getElementById('op-'+x).classList.toggle('on',x===m));
  // Hide all content sections first
  ['p','u','d'].forEach(x=>document.getElementById('sec-'+x).style.display='none');
  if(m==='p'){
    // Open image picker immediately; show preview section only if already have image
    if(fb64){document.getElementById('sec-p').style.display='block';}
    else{document.getElementById('fip').click();}
  } else if(m==='u'){
    document.getElementById('sec-u').style.display='block';
    setTimeout(()=>document.getElementById('urlinp').focus(),50);
  } else if(m==='d'){
    // Open doc picker immediately; show confirmation section only if already have doc
    if(dtxt){document.getElementById('sec-d').style.display='block';}
    else{document.getElementById('dip').click();}
  }
}
// ── Image compression ─────────────────────────────────────────────────────
// Resizes and re-encodes an image to a storage-safe size.
// Max 900px on longest side, JPEG @ 72% quality.
// A typical phone photo (3-5 MB) compresses to ~80-150 KB — about a 25× saving —
// with no visible quality loss at mobile screen sizes.
function compressImage(dataUrl,maxPx=900,quality=0.72){
  return new Promise(resolve=>{
    const img=new Image();
    img.onload=()=>{
      let w=img.width,h=img.height;
      if(w>maxPx||h>maxPx){
        if(w>=h){h=Math.round(h*(maxPx/w));w=maxPx;}
        else{w=Math.round(w*(maxPx/h));h=maxPx;}
      }
      const c=document.createElement('canvas');c.width=w;c.height=h;
      c.getContext('2d').drawImage(img,0,0,w,h);
      resolve(c.toDataURL('image/jpeg',quality));
    };
    img.onerror=()=>resolve(dataUrl); // fall back to original if canvas fails
    img.src=dataUrl;
  });
}

function onImg(e){
  const files=Array.from(e.target.files);
  if(!files.length)return;
  multiImgs=[];
  const badge=document.getElementById('multi-count-badge');

  // Load and compress all selected files in parallel
  const compress=f=>new Promise(resolve=>{
    if(f.size>15728640){resolve(null);return;}
    const rd=new FileReader();
    rd.onload=async ev=>{
      const c=await compressImage(ev.target.result);
      resolve({fb64:c,name:f.name});
    };
    rd.readAsDataURL(f);
  });

  (async()=>{
    const results=await Promise.all(files.map(compress));
    multiImgs=results.filter(Boolean);
    if(!multiImgs.length){showErr('No valid images could be loaded.');return;}

    fb64=multiImgs[0].fb64;
    document.getElementById('imgprev').src=fb64;
    document.getElementById('sec-p').style.display='block';

    if(multiImgs.length===1){
      document.getElementById('op-p-hint').textContent='Image ready ✓';
      badge.style.display='none';
    } else {
      document.getElementById('op-p-hint').textContent=multiImgs.length+' images ready ✓';
      badge.style.display='block';
      badge.textContent='📷 '+multiImgs.length+' screenshots selected — AI will extract each recipe one by one';
    }
  })();
}
async function onDoc(e){
  const f=e.target.files[0];if(!f)return;
  const dn=document.getElementById('docname');
  const isPdf=f.name.toLowerCase().endsWith('.pdf')||f.type==='application/pdf';
  if(isPdf){
    if(typeof pdfjsLib==='undefined'){showErr('PDF reader still loading. Please try again in a moment.');return;}
    try{
      pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      const buf=await f.arrayBuffer();
      const pdf=await pdfjsLib.getDocument({data:buf}).promise;
      let text='';
      for(let i=1;i<=Math.min(pdf.numPages,20);i++){
        const page=await pdf.getPage(i);
        const content=await page.getTextContent();
        text+=content.items.map(it=>it.str).join(' ')+'\n';
      }
      dtxt=text.replace(/\n{3,}/g,'\n\n').trim();
      if(!dtxt){showErr('Could not extract text from this PDF. Try a Word document instead.');return;}
      dn.textContent='📄 '+f.name+' · '+pdf.numPages+' page'+(pdf.numPages!==1?'s':'')+' · PDF';document.getElementById('sec-d').style.display='block';document.getElementById('op-d-hint').textContent='File ready ✓';
    }catch(er){showErr('Could not read this PDF. ('+(er.message||er)+')');}
  } else {
    if(typeof mammoth==='undefined'){showErr('Document reader still loading. Try again.');return;}
    try{const buf=await f.arrayBuffer();const res=await mammoth.extractRawText({arrayBuffer:buf});dtxt=res.value.replace(/\n{3,}/g,'\n\n').trim();dn.textContent='📄 '+f.name;document.getElementById('sec-d').style.display='block';document.getElementById('op-d-hint').textContent='File ready ✓';}
    catch(er){showErr('Could not read this Word document.');}
  }
}

// CATEGORY MANAGER
function renderCatManager(){
  const custom=getCustomCats();
  const el=document.getElementById('catlist');
  if(!el)return;
  const all=[...CATS.map(c=>({c,custom:false})),...custom.map(c=>({c,custom:true}))];
  el.innerHTML=all.map(({c,custom})=>`
    <div style="display:flex;align-items:center;justify-content:space-between;padding:9px 0;border-bottom:1px solid var(--bd);">
      <span style="font-size:14px;">${catEmoji(c)} ${c}</span>
      ${custom
        ?`<button onclick="deleteCustomCat('${c}')" style="background:none;border:1px solid #E0B0B0;color:#C05050;border-radius:20px;padding:4px 12px;font-size:12px;font-family:Arial,sans-serif;cursor:pointer;">Remove</button>`
        :`<span style="font-size:11px;font-family:Arial,sans-serif;color:var(--mu);">Default</span>`}
    </div>`).join('');
}

function addCustomCat(){
  const inp=document.getElementById('newcatinp');
  const val=inp.value.trim();
  if(!val){inp.focus();return;}
  if(val.length>30){alert('Category name too long (max 30 characters).');return;}
  const custom=getCustomCats();
  const combined=[...CATS,...custom].map(c=>c.toLowerCase());
  if(combined.includes(val.toLowerCase())){alert('"'+val+'" already exists.');inp.value='';return;}
  custom.push(val);
  saveCustomCats(custom);
  inp.value='';
  renderCatManager();
  buildChips();
}

function deleteCustomCat(c){
  if(!confirm('Remove "'+c+'" category? Recipes in this category will be moved to Other.'))return;
  const custom=getCustomCats().filter(x=>x!==c);
  saveCustomCats(custom);
  recs=recs.map(r=>r.category===c?{...r,category:'Other'}:r);
  save();renderCatManager();buildChips();render();
}

// ── Firebase Realtime Database Sync ───────────────────────────────────────
const FBK='cronjes_fburl';   // database URL
const FBSK='cronjes_fbsecret'; // database secret
const FBID='cronjes_fbsyncid'; // sync node name

function loadSyncFields(){
  const url=store.get(FBK)||store.get('cronjes_fburl_draft')||'';
  const sid=store.get(FBID)||store.get('cronjes_fbsid_draft')||'cronjes';
  // Restore typed-but-unsaved values from draft store
  const urlEl=document.getElementById('jbbin');
  const keyEl=document.getElementById('jbkey');
  const sidEl=document.getElementById('fbsyncid');
  if(urlEl)urlEl.value=url;
  if(keyEl)keyEl.value=''; // never show secret in field for security, but restore if draft exists
  const secretDraft=store.get('cronjes_fbsecret_draft')||'';
  if(keyEl&&secretDraft)keyEl.value=secretDraft;
  if(sidEl)sidEl.value=sid;
  const si=document.getElementById('syncinfo');
  const last=store.get('cronjes_lastsync');
  if(url){
    si.textContent='Database: '+url.replace('https://','').split('.')[0]+(last?' · Last synced: '+new Date(last).toLocaleString('en-NZ',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'');
    si.style.display='block';
  }else{si.style.display='none';}
  // Wire up auto-save on every keystroke so switching apps never loses input
  if(urlEl&&!urlEl._autoSave){urlEl._autoSave=true;urlEl.addEventListener('input',()=>store.set('cronjes_fburl_draft',urlEl.value.trim()));}
  if(keyEl&&!keyEl._autoSave){keyEl._autoSave=true;keyEl.addEventListener('input',()=>store.set('cronjes_fbsecret_draft',keyEl.value.trim()));}
  if(sidEl&&!sidEl._autoSave){sidEl._autoSave=true;sidEl.addEventListener('input',()=>store.set('cronjes_fbsid_draft',sidEl.value.trim()));}
}

function saveSyncCreds(){
  const url=(document.getElementById('jbbin').value.trim()||store.get('cronjes_fburl_draft')||'').replace(/\/+$/,'');
  const secret=document.getElementById('jbkey').value.trim()||store.get('cronjes_fbsecret_draft')||'';
  const sid=((document.getElementById('fbsyncid')?.value||store.get('cronjes_fbsid_draft')||'cronjes').trim().replace(/[^a-zA-Z0-9_-]/g,'-'))||'cronjes';
  if(url){store.set(FBK,url);store.remove('cronjes_fburl_draft');}
  if(secret){store.set(FBSK,secret);store.remove('cronjes_fbsecret_draft');}
  store.set(FBID,sid);store.remove('cronjes_fbsid_draft');
  return{url:url||store.get(FBK)||'',secret:secret||store.get(FBSK)||'',sid};
}

function setSyncResult(msg,ok){
  const el=document.getElementById('syncresult');
  el.textContent=msg;el.style.color=ok?'var(--tc)':'#a03030';el.style.display='block';
}

function mergeRecipes(local,remote){
  // Pass 1: id-based dedup.
  // Iterate remote first, then local — local is processed LAST so it wins on
  // equal savedAt. A local edit always beats an identically-stamped cloud copy.
  const idMap=new Map();
  [...remote,...local].forEach(r=>{
    if(!r||!r.id)return;
    const existing=idMap.get(r.id);
    const rTs=r.savedAt||'';
    const exTs=existing?.savedAt||'';
    if(!existing||rTs>=exTs)idMap.set(r.id,r);
  });
  return [...idMap.values()].sort((a,b)=>(b.savedAt||'').localeCompare(a.savedAt||''));
}

async function syncNow(){
  const{url,secret,sid}=saveSyncCreds();
  if(!url){setSyncResult('Please enter your Firebase Database URL first.',false);return;}
  setSyncResult('Syncing…',true);
  const endpoint=`${url}/cronjes_sync/${sid}.json${secret?'?auth='+encodeURIComponent(secret):''}`;
  try{
    // GET remote data
    const gr=await fetch(endpoint);
    if(!gr.ok)throw new Error('Read failed: '+gr.status+' '+gr.statusText);
    const remote=await gr.json();

    // Firebase RTDB sometimes returns a numeric-keyed object instead of an array
    // when elements have been partially updated. Normalise to a plain array.
    let remoteRecs=remote?.recipes||[];
    if(!Array.isArray(remoteRecs))remoteRecs=Object.values(remoteRecs).filter(r=>r&&r.id);

    // Safety guard: never let an empty cloud response wipe a non-empty local collection.
    // This prevents data loss when Firebase is unreachable, returns null, or was
    // accidentally cleared — and also guards against a corrupt local load().
    if(remoteRecs.length===0&&recs.length>0){
      // Still push local data up so the cloud is populated, but don't wipe local.
      const pw=await fetch(endpoint,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({recipes:recs,syncedAt:new Date().toISOString(),device:navigator.userAgent.slice(0,60)})});
      if(!pw.ok)throw new Error('Write failed: '+pw.status+' '+pw.statusText);
      store.set('cronjes_lastsync',new Date().toISOString());
      loadSyncFields();
      setSyncResult(`✓ Synced! Pushed ${recs.length} recipe${recs.length!==1?'s':''} to cloud (cloud was empty).`,true);
      return;
    }

    // Merge local + remote
    const merged=mergeRecipes(recs,remoteRecs);

    // Final safety check: merged should never be empty if either side had data.
    if(merged.length===0&&(recs.length>0||remoteRecs.length>0)){
      throw new Error('Merge produced no recipes unexpectedly — sync aborted to protect your data. Please try again.');
    }

    // PUT merged back
    const pw=await fetch(endpoint,{
      method:'PUT',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({recipes:merged,syncedAt:new Date().toISOString(),device:navigator.userAgent.slice(0,60)})
    });
    if(!pw.ok)throw new Error('Write failed: '+pw.status+' '+pw.statusText);

    const prevIds=new Set(recs.map(r=>r.id));
    const added=merged.filter(m=>!prevIds.has(m.id)).length;
    recs=merged;save();buildChips();
    if(tab==='c')renderCats();else render();
    store.set('cronjes_lastsync',new Date().toISOString());
    loadSyncFields();
    setSyncResult(`✓ Synced! ${merged.length} recipe${merged.length!==1?'s':''} in collection.${added>0?'\n'+added+' new recipe'+(added!==1?'s':'')+' pulled from cloud.':''}`,true);
  }catch(e){
    setSyncResult('Sync failed: '+(e.message||String(e))+'\n\nYour local recipes are untouched. Check your Database URL and secret, and ensure Firebase rules allow read/write.',false);
  }
}

function getStorageStats(){
  try{
    const recJson=localStorage.getItem(SK)||'';
    const totalBytes=recJson.length;
    const base64Bytes=recs.reduce((acc,r)=>{
      if(r.imageData&&r.imageData.startsWith('data:'))acc+=r.imageData.length;
      return acc;
    },0);
    const limitBytes=5*1024*1024; // 5 MB conservative iOS Safari limit
    const pct=Math.min(100,Math.round((totalBytes/limitBytes)*100));
    const fmt=b=>b>1048576?(b/1048576).toFixed(1)+' MB':b>1024?(b/1024).toFixed(0)+' KB':b+' B';
    return{total:fmt(totalBytes),images:fmt(base64Bytes),pct,count:recs.length,limitBytes,totalBytes};
  }catch(e){return null;}
}
function renderStorageBar(){
  const el=document.getElementById('storage-bar-wrap');if(!el)return;
  const s=getStorageStats();if(!s){el.style.display='none';return;}
  el.style.display='block';
  const color=s.pct>80?'#C05050':s.pct>55?'#C07820':'var(--tc)';
  document.getElementById('storage-bar-fill').style.width=s.pct+'%';
  document.getElementById('storage-bar-fill').style.background=color;
  document.getElementById('storage-bar-label').textContent=
    s.total+' used of ~5 MB ('+s.pct+'%) · '+s.count+' recipe'+(s.count!==1?'s':'')+
    (s.images!=='0 B'?' · '+s.images+' in uploaded photos':'');
  document.getElementById('storage-bar-warn').style.display=s.pct>80?'block':'none';
}

function clearAllData(){
  if(!confirm('This will permanently delete ALL your recipes, your API key, and all settings.\n\nHave you exported a backup? This cannot be undone.'))return;
  // Clear every known key
  [SK,SKB,KK,WK,CK,FBK,FBSK,FBID,'cronjes_lastsync','cronjes_screen',
   'cronjes_keydraft','cronjes_fburl_draft','cronjes_fbsecret_draft','cronjes_fbsid_draft'
  ].forEach(k=>store.remove(k));
  // Also clear session
  try{sessionStorage.clear();}catch(e){}
  recs=[];
  alert('All data cleared. The app will now restart.');
  location.reload();
}

// BACKUP
function exportBackup(){
  if(!recs.length){alert('No recipes to export yet.');return;}
  const blob=new Blob([JSON.stringify({version:1,exportedAt:new Date().toISOString(),recipes:recs},null,2)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='cronjes_backup_'+new Date().toISOString().slice(0,10)+'.json';a.click();URL.revokeObjectURL(a.href);
}
async function importBackup(e){
  const f=e.target.files[0];if(!f)return;
  const res=document.getElementById('impresult');
  try{
    const data=JSON.parse(await f.text());
    const incoming=Array.isArray(data)?data:(data.recipes||[]);
    if(!incoming.length){res.textContent='No recipes found in this file.';res.style.color='#a03030';res.style.display='block';return;}
    // Use the same timestamp-aware merge as cloud sync so the newest version of
    // each recipe wins — not just "skip if ID already exists".
    const prevCount=recs.length;
    const merged=mergeRecipes(recs,incoming);
    const added=merged.length-prevCount;
    const updated=incoming.filter(r=>{
      const local=recs.find(x=>x.id===r.id);
      return local&&(r.savedAt||'')>(local.savedAt||'');
    }).length;
    recs=merged;save();buildChips();
    if(tab==='c')renderCats();else render();
    res.textContent=`✓ Import complete: ${added} new recipe${added!==1?'s':''} added${updated>0?', '+updated+' updated from backup':''}. ${merged.length} total in collection.`;
    res.style.color='var(--tc)';res.style.display='block';
  }catch(err){res.textContent='Could not read file. Make sure it\'s a valid Cronjes backup.';res.style.color='#a03030';res.style.display='block';}
  e.target.value='';
}

// AI
function showLoad(m){document.getElementById('loader').style.display='flex';document.getElementById('loadmsg').textContent=m;}
function hideLoad(){document.getElementById('loader').style.display='none';}
function showErr(m){vibe('error');const e=document.getElementById('errmsg');e.textContent=m;e.style.display='block';}

function getPrompt(){
return `Extract the recipe from the provided content and return ONLY valid JSON with no markdown, no backticks, no extra text:
{"title":"Recipe Name","servings":"4 servings","time":"30 mins","cuisine":"Italian","category":"Dinner","ingredients":["200g pasta","2 eggs","50g cheese"],"steps":["Boil pasta in salted water for 10 minutes.","Whisk eggs with cheese."],"notes":"Optional tips here"}
Pick the best category from: ${allCats().join(', ')} — or choose the closest fit. If truly unknown use "Other".
ingredients and steps must be arrays of strings. If a value is unknown use null.`;
}

async function callGroq(parts){
  const key=getKey();if(!key)throw new Error('No API key. Tap ⚙️ Settings.');
  const content=parts.map(p=>p.text?{type:'text',text:p.text}:p.inline_data?{type:'image_url',image_url:{url:`data:${p.inline_data.mime_type};base64,${p.inline_data.data}`}}:null).filter(Boolean);
  const res=await fetch('https://api.groq.com/openai/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+key},body:JSON.stringify({model:'meta-llama/llama-4-scout-17b-16e-instruct',max_tokens:1200,temperature:0.1,messages:[{role:'user',content}]})});
  const d=await res.json();if(d.error)throw new Error(d.error.message||'Groq error');
  return d.choices?.[0]?.message?.content||'';
}

async function testKey(){
  const key=getKey();const out=document.getElementById('modelout');
  if(!key){out.textContent='No key saved yet.';out.style.display='block';return;}
  out.textContent='Checking...';out.style.display='block';
  try{const res=await fetch('https://api.groq.com/openai/v1/models',{headers:{'Authorization':'Bearer '+key}});const d=await res.json();
    if(d.error){out.textContent='Error: '+d.error.message;return;}
    out.textContent='✓ Connected!\n\nAvailable models:\n\n'+(d.data||[]).map(m=>m.id).join('\n');
  }catch(e){out.textContent='Failed: '+e.message;}
}

async function doExtract(){
  document.getElementById('errmsg').style.display='none';
  if(mode==='p'){
    if(!multiImgs.length){showErr('Please select an image first.');return;}
    if(multiImgs.length>1){
      await doBatchExtract();
    } else {
      showLoad('Reading your screenshot...');await extImg();
    }
  }
  else if(mode==='u'){const u=document.getElementById('urlinp').value.trim();if(!u||!u.startsWith('http')){showErr('Please enter a valid URL starting with https://');return;}showLoad('Fetching recipe from website...');await extUrl(u);}
  else{if(!dtxt){showErr('Please select a file first.');return;}showLoad('Reading your document...');await extDocSmart();}
}
async function extImg(){
  try{
    // Extra compression before API call to avoid 413 Entity Too Large
    const apiImg=await compressImage(fb64,600,0.60);
    const[hd,b64]=apiImg.split(',');const mime=hd.match(/:(.*?);/)[1];
    proc(await callGroq([{inline_data:{mime_type:mime,data:b64}},{text:getPrompt()}]),fb64);
  }
  catch(e){hideLoad();showErr('Could not read image. ('+(e.message||e)+')');}
}

// ── Batch extraction (multiple screenshots) ───────────────────────────────
async function doBatchExtract(){
  const total=multiImgs.length;
  batchResults=[];
  for(let i=0;i<total;i++){
    const img=multiImgs[i];
    showLoad('Extracting recipe '+(i+1)+' of '+total+'…');
    try{
      const apiImg=await compressImage(img.fb64,600,0.60);
      const[hd,b64]=apiImg.split(',');const mime=hd.match(/:(.*?);/)[1];
      const raw=await callGroq([{inline_data:{mime_type:mime,data:b64}},{text:getPrompt()}]);
      const d=JSON.parse(raw.replace(/```json|```/g,'').trim());
      const aiCat=allCats().includes(d.category)?d.category:'Other';
      batchResults.push({
        rec:{id:(Date.now()+i*7).toString(),title:d.title||'Untitled Recipe',servings:d.servings||null,time:d.time||null,cuisine:d.cuisine||null,category:aiCat,ingredients:Array.isArray(d.ingredients)?d.ingredients:[],steps:Array.isArray(d.steps)?d.steps:[],notes:d.notes||null,imageData:null,emoji:FE[Math.floor(Math.random()*FE.length)],savedAt:new Date().toISOString(),favourite:false,comments:[]},
        imgData:img.fb64,status:'pending'
      });
    }catch(err){
      batchResults.push({
        rec:{id:(Date.now()+i*7).toString(),title:img.name.replace(/\.[^.]+$/,'')||('Recipe '+(i+1)),category:'Other',ingredients:[],steps:[],emoji:'🍴',savedAt:new Date().toISOString(),favourite:false,comments:[]},
        imgData:img.fb64,status:'error',error:err.message
      });
    }
  }
  hideLoad();
  showBatchPanel();
}

function showBatchPanel(){
  document.getElementById('catpanel').style.display='none';
  document.getElementById('extractbtn').style.display='none';
  document.getElementById('batchpanel').style.display='block';
  renderBatchList();
  document.querySelector('#sadd .sa').scrollTop=9999;
}

function renderBatchList(){
  const list=document.getElementById('batchlist');
  list.innerHTML='';
  const active=batchResults.filter(r=>r.status==='pending'||r.status==='error');
  active.forEach(item=>{
    const i=batchResults.indexOf(item);
    const div=document.createElement('div');
    div.className='batch-item';
    div.id='batch-item-'+i;
    const thumbHtml=item.imgData
      ?`<img src="${item.imgData}" style="width:100%;height:100%;object-fit:cover;display:block;border-radius:9px;"/>`
      :`<span style="font-size:22px;">${item.rec.emoji||'🍴'}</span>`;
    div.innerHTML=`
      <div style="background:${catColor(item.rec.category)};width:58px;height:58px;border-radius:10px;overflow:hidden;flex-shrink:0;display:flex;align-items:center;justify-content:center;">
        ${thumbHtml}
      </div>
      <div style="flex:1;min-width:0;">
        <div style="font-size:13px;font-weight:bold;line-height:1.35;margin-bottom:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${item.rec.title}</div>
        ${item.status==='error'?'<div style="font-size:11px;color:#C05050;font-family:Arial,sans-serif;margin-bottom:4px;">⚠️ Extraction failed — will save as-is</div>':''}
        <select data-idx="${i}" style="width:100%;background:var(--bg);border:1px solid var(--bds);border-radius:8px;padding:5px 8px;font-size:12px;font-family:Arial,sans-serif;color:var(--tx);outline:none;">
          ${allCats().map(c=>`<option value="${c}"${c===item.rec.category?' selected':''}>${catEmoji(c)} ${c}</option>`).join('')}
        </select>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0;margin-left:4px;">
        <button onclick="saveBatchItem(${i})" style="background:var(--tc);color:white;border:none;border-radius:20px;padding:9px 14px;font-size:12px;font-family:Arial,sans-serif;cursor:pointer;">Save ✓</button>
        <button onclick="skipBatchItem(${i})" style="background:none;border:1.5px solid var(--bd);border-radius:20px;padding:7px 12px;font-size:11px;font-family:Arial,sans-serif;color:var(--mu);cursor:pointer;">Skip</button>
      </div>`;
    list.appendChild(div);
  });

  const pending=batchResults.filter(r=>r.status==='pending').length;
  const saved=batchResults.filter(r=>r.status==='saved').length;
  const errors=batchResults.filter(r=>r.status==='error').length;
  let txt=pending+' recipe'+(pending!==1?'s':'')+' to save';
  if(saved)txt+=' · '+saved+' saved';
  if(errors)txt+=' · '+errors+' failed';
  document.getElementById('batch-status').textContent=txt;

  if(!active.length){
    document.getElementById('batch-status').textContent='All done! '+saved+' recipe'+(saved!==1?'s':'')+' saved ✓';
    document.getElementById('batch-done-btn').style.display='block';
    buildChips();render();
  }
}

function saveBatchItem(i){
  const item=batchResults[i];if(!item)return;
  const sel=document.querySelector('#batch-item-'+i+' select');
  if(sel)item.rec.category=sel.value;
  if(item.imgData){item.rec.imageData='__idb__';ImgStore.set(item.rec.id,item.imgData);}
  const savedId=item.rec.id,savedTitle=item.rec.title,hadPhoto=!!item.rec.imageData;
  item.status='saved';
  recs.unshift(item.rec);save();vibe('save');
  if(!hadPhoto)genFoodImage(savedId,savedTitle);
  renderBatchList();
}

function skipBatchItem(i){
  const item=batchResults[i];if(!item)return;
  item.status='skipped';vibe('tap');renderBatchList();
}

// ── Smart document extraction (single or multi-recipe) ────────────────────
async function extDocSmart(){
  try{
    const multiPrompt=`Extract ALL recipes from this document. Return ONLY a valid JSON array (even if there is only one recipe):
[{"title":"Recipe Name","servings":"4 servings","time":"30 mins","cuisine":"Italian","category":"Dinner","ingredients":["200g pasta"],"steps":["Boil pasta."],"notes":"Tips here"}]
Pick categories from: ${allCats().join(', ')}. ingredients and steps must be arrays of strings. Unknown values use null.`;
    const raw=await callGroq([{text:`Document text:\n\n${dtxt.slice(0,7500)}\n\n${multiPrompt}`}]);
    const arr=JSON.parse(raw.replace(/```json|```/g,'').trim());
    if(!Array.isArray(arr)||!arr.length)throw new Error('not-array');
    if(arr.length===1){
      // Single recipe — use normal single-save flow
      proc(JSON.stringify(arr[0]),null);
    } else {
      // Multiple recipes — batch review flow
      batchResults=arr.map((d,i)=>{
        const aiCat=allCats().includes(d.category)?d.category:'Other';
        return {
          rec:{id:(Date.now()+i*7).toString(),title:d.title||'Untitled Recipe',servings:d.servings||null,time:d.time||null,cuisine:d.cuisine||null,category:aiCat,ingredients:Array.isArray(d.ingredients)?d.ingredients:[],steps:Array.isArray(d.steps)?d.steps:[],notes:d.notes||null,imageData:null,emoji:FE[Math.floor(Math.random()*FE.length)],savedAt:new Date().toISOString(),favourite:false,comments:[]},
          imgData:null,status:'pending'
        };
      });
      hideLoad();showBatchPanel();
    }
  }catch(e){
    // Fallback: single-recipe extraction with original prompt
    hideLoad();showLoad('Extracting recipe…');
    await extDoc();
  }
}
async function fetchViaProxy(u){
  const proxies=[()=>fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`),()=>fetch(`https://corsproxy.io/?${encodeURIComponent(u)}`),()=>fetch(`https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`)];
  for(const p of proxies){try{const r=await p();if(r.ok){const t=await r.text();if(t&&t.length>100)return t;}}catch(e){}}
  throw new Error('All proxies failed — try saving the recipe as a Word doc instead.');
}
async function extUrl(u){
  try{
    showLoad('Fetching page...');
    const html=await fetchViaProxy(u);
    const txt=html.replace(/<script[\s\S]*?<\/script>/gi,'').replace(/<style[\s\S]*?<\/style>/gi,'').replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/\s{3,}/g,'\n').trim().slice(0,8000);
    if(!txt)throw new Error('No text found on page');
    showLoad('Extracting recipe...');
    proc(await callGroq([{text:`Webpage text from ${u}:\n\n${txt}\n\n${getPrompt()}`}]),null);
  }catch(e){hideLoad();showErr('Could not fetch recipe. ('+(e.message||e)+')');}
}
async function extDoc(){
  try{proc(await callGroq([{text:`Word document text:\n\n${dtxt.slice(0,7000)}\n\n${getPrompt()}`}]),null);}
  catch(e){hideLoad();showErr('Could not extract recipe. ('+(e.message||e)+')');}
}

function proc(raw,imgData){
  try{
    const d=JSON.parse(raw.replace(/```json|```/g,'').trim());
    const aiCat=allCats().includes(d.category)?d.category:'Other';
    pendingRec={id:Date.now().toString(),title:d.title||'Untitled Recipe',servings:d.servings||null,time:d.time||null,cuisine:d.cuisine||null,category:aiCat,ingredients:Array.isArray(d.ingredients)?d.ingredients:[],steps:Array.isArray(d.steps)?d.steps:[],notes:d.notes||null,imageData:imgData||null,emoji:FE[Math.floor(Math.random()*FE.length)],savedAt:new Date().toISOString(),favourite:false,comments:[]};
    hideLoad();
    document.getElementById('catsel').innerHTML=allCats().map(c=>`<option value="${c}"${c===aiCat?' selected':''}>${catEmoji(c)} ${c}</option>`).join('');
    document.getElementById('catpreview').textContent=pendingRec.title;
    document.getElementById('catpanel').style.display='block';
    document.getElementById('extractbtn').style.display='none';
    document.querySelector('#sadd .sa').scrollTop=9999;
  }catch(e){hideLoad();showErr('Could not parse the recipe. Please try again.');}
}
function confirmSave(){
  if(!pendingRec)return;
  pendingRec.category=document.getElementById('catsel').value;
  const imgData=fb64; // user-uploaded photo (base64), if any
  if(imgData){
    pendingRec.imageData='__idb__';
    ImgStore.set(pendingRec.id,imgData); // async — store in IDB
  }
  const savedId=pendingRec.id;
  const savedTitle=pendingRec.title;
  const hasPhoto=!!pendingRec.imageData;
  recs.unshift(pendingRec);save();vibe('save');
  showDetail(savedId);pendingRec=null;
  if(!hasPhoto)genFoodImage(savedId,savedTitle);
}

// ── Edit-mode image helpers ───────────────────────────────────────────────
function setEditImgPreview(src,r){
  const el=document.getElementById('edit-img-preview');
  if(!el)return;
  if(src==='__idb__'){
    const rec=r||recs.find(x=>x.id===rid);
    el.style.background=catColor(rec?.category);
    el.innerHTML=`<span style="font-size:48px;">${rec?.emoji||'🍴'}</span>`;
    ImgStore.get(rid).then(data=>{
      if(data&&el.isConnected)el.innerHTML=`<img src="${data}" style="width:100%;height:100%;object-fit:cover;display:block;">`;
    });
  }else if(src){el.innerHTML=`<img src="${src}" style="width:100%;height:100%;object-fit:cover;display:block;">`;}
  else{const rec=r||recs.find(x=>x.id===rid);el.style.background=catColor(rec?.category);el.innerHTML=`<span style="font-size:48px;">${rec?.emoji||'🍴'}</span>`;}
}
function editOnImg(e){
  const f=e.target.files[0];if(!f)return;
  if(f.size>15728640){alert('Image too large (max 15MB)');return;}
  const rd=new FileReader();rd.onload=async ev=>{
    const compressed=await compressImage(ev.target.result);
    // Store compressed data in memory for saveEdit(), flag the pending image
    _editPendingImgData=compressed;
    editPendingImg='__idb__';
    setEditImgPreview(compressed); // show the actual data in preview
  };rd.readAsDataURL(f);
  e.target.value='';
}
async function editSearchImage(){
  const queryInput=document.getElementById('img-search-query');
  const query=(queryInput?queryInput.value.trim():'')||document.getElementById('edit-title').value.trim()||(recs.find(x=>x.id===rid)?.title||'food');
  showImgPicker(query);
}

async function showImgPicker(query){
  const modal=document.getElementById('img-picker-modal');
  const grid=document.getElementById('img-picker-grid');
  const loading=document.getElementById('img-picker-loading');
  const none=document.getElementById('img-picker-none');
  const subtitle=document.getElementById('img-picker-subtitle');
  modal.style.display='flex';
  grid.style.display='none';grid.innerHTML='';
  loading.style.display='block';none.style.display='none';
  subtitle.textContent='AI is searching for: '+query;

  let urls=[];

  // 1. Try Groq compound-beta — uses built-in web search to find real food images
  const key=getKey();
  if(key){
    try{
      const resp=await fetch('https://api.groq.com/openai/v1/chat/completions',{
        method:'POST',
        headers:{'Authorization':'Bearer '+key,'Content-Type':'application/json'},
        body:JSON.stringify({
          model:'compound-beta-mini',
          messages:[{role:'user',content:`Find 6 high-quality food photography image URLs for: "${query.slice(0,80)}". Return ONLY a JSON array of direct image URLs ending in .jpg .jpeg .png or .webp. No markdown, no explanation.`}],
          max_tokens:400
        })
      });
      if(resp.ok){
        const data=await resp.json();
        const text=data.choices?.[0]?.message?.content||'';
        const match=text.match(/\[[\s\S]*?\]/);
        if(match){
          const parsed=JSON.parse(match[0]);
          urls=parsed.filter(u=>typeof u==='string'&&u.startsWith('http'));
        }
      }
      // Non-OK status (413, 429, etc.) — silently fall through to MealDB/Pollinations
    }catch(e){
      // Network or parse error — silently fall through
      console.warn('cronjes: image search unavailable:',e.message);
    }
  }

  // 2. Fallback — MealDB real photos + Pollinations AI generation
  if(urls.length<3){
    try{
      const r=await fetch(`https://www.themealdb.com/api/json/v1/1/search.php?s=${encodeURIComponent(query)}`);
      const d=await r.json();
      if(d.meals)d.meals.slice(0,2).forEach(m=>{if(m.strMealThumb&&!urls.includes(m.strMealThumb))urls.unshift(m.strMealThumb);});
    }catch(e){}
    const prompt=encodeURIComponent(`professional food photography of ${query}, appetizing, restaurant quality, soft natural lighting, no text, no watermarks`);
    for(let s=1;urls.length+s<=7;s++){
      urls.push(`https://image.pollinations.ai/prompt/${prompt}?width=600&height=400&seed=${s*41}&nologo=true`);
    }
  }

  loading.style.display='none';
  const slots=urls.slice(0,6);
  if(!slots.length){none.style.display='block';return;}
  grid.style.display='grid';

  slots.forEach(src=>{
    const wrap=document.createElement('div');
    wrap.style.cssText='border-radius:12px;overflow:hidden;height:130px;cursor:pointer;border:3px solid transparent;transition:border-color 0.15s;background:linear-gradient(90deg,#c8dede 25%,#d8eaea 50%,#c8dede 75%);background-size:200% 100%;animation:shimmer 1.4s infinite;';
    const img=new Image();
    img.crossOrigin='anonymous';
    img.onload=()=>{wrap.style.cssText='border-radius:12px;overflow:hidden;height:130px;cursor:pointer;border:3px solid transparent;transition:border-color 0.15s;';wrap.innerHTML=`<img src="${src}" style="width:100%;height:100%;object-fit:cover;display:block;"/>`;};
    img.onerror=()=>{wrap.style.display='none';};
    img.src=src;
    wrap.onclick=()=>selectPickerImage(src);
    wrap.addEventListener('touchstart',()=>wrap.style.borderColor='var(--tc)',{passive:true});
    wrap.addEventListener('touchend',()=>wrap.style.borderColor='transparent',{passive:true});
    grid.appendChild(wrap);
  });
}

function selectPickerImage(url){
  editPendingImg=url;setEditImgPreview(url);closeImgPicker();
}

function closeImgPicker(){
  document.getElementById('img-picker-modal').style.display='none';
}

async function refreshImage(){
  const r=recs.find(x=>x.id===rid);if(!r)return;
  if(r.imageData==='__idb__')await ImgStore.del(rid);
  r.imageData=null;save();
  const h=document.getElementById('dhero');
  h.innerHTML=r.emoji;h.style.background=catColor(r.category);h.style.minHeight='150px';h.style.animation='';
  genFoodImage(rid,r.title);
}

// ── Image search pipeline ─────────────────────────────────────────────────
// 1. TheMealDB  — real food photos matched by dish name
// 2. loremflickr — real Flickr photos searched by title keywords
// 3. Pollinations.ai — AI-generated fallback

function setHeroShimmer(id){
  if(rid!==id)return;
  const h=document.getElementById('dhero');
  h.innerHTML='';
  h.style.minHeight='160px';
  h.style.background='linear-gradient(90deg,#c8dede 25%,#d8eaea 50%,#c8dede 75%)';
  h.style.backgroundSize='200% 100%';
  h.style.animation='shimmer 1.4s infinite';
}
function clearHeroShimmer(id,emoji,color){
  if(rid!==id)return;
  const h=document.getElementById('dhero');
  h.style.animation='';h.style.background=color;h.innerHTML=emoji;
}
function applyHeroImage(id,url){
  const r=recs.find(x=>x.id===id);if(!r||r.imageData)return;
  r.imageData=url;save();
  if(rid===id){const h=document.getElementById('dhero');h.style.animation='';h.innerHTML=`<img src="${url}"/>`;h.style.minHeight='';}
  buildChips();render();
}

async function tryLoadImage(url,timeoutMs=8000){
  return new Promise((res,rej)=>{
    const t=setTimeout(()=>rej(new Error('timeout')),timeoutMs);
    const i=new Image();i.crossOrigin='anonymous';
    i.onload=()=>{clearTimeout(t);res(url);};
    i.onerror=()=>{clearTimeout(t);rej(new Error('load failed'));};
    i.src=url;
  });
}

async function searchMealDB(title){
  const queries=[title.trim(),title.trim().split(/\s+/).slice(0,2).join(' '),title.trim().split(/\s+/)[0]];
  for(const q of queries){
    if(!q)continue;
    try{
      const r=await fetch(`https://www.themealdb.com/api/json/v1/1/search.php?s=${encodeURIComponent(q)}`);
      const d=await r.json();
      if(d.meals?.[0]?.strMealThumb)return await tryLoadImage(d.meals[0].strMealThumb);
    }catch(e){}
  }
  return null;
}

async function searchLoremFlickr(title){
  // Use first 1-2 meaningful words as search terms alongside "food"
  const words=title.trim().split(/\s+/).slice(0,2).map(w=>w.replace(/[^a-z0-9]/gi,'')).filter(Boolean);
  const keyword=words.length?words.join(','):'food';
  const url=`https://loremflickr.com/600/400/${encodeURIComponent(keyword)},food?lock=${Math.floor(Math.random()*10000)}`;
  return await tryLoadImage(url,12000);
}

async function searchPollinations(title){
  const prompt=encodeURIComponent(`professional food photography of "${title}", appetizing dish, restaurant quality, soft natural lighting, top-down or 45-degree angle view, no text, no watermarks`);
  const url=`https://image.pollinations.ai/prompt/${prompt}?width=600&height=400&nologo=true&seed=${Date.now()}`;
  return await tryLoadImage(url,18000);
}

async function genFoodImage(id,title){
  const r=recs.find(x=>x.id===id);if(!r||r.imageData)return;
  setHeroShimmer(id);
  try{
    let url=await searchMealDB(title).catch(()=>null);
    if(!url)url=await searchLoremFlickr(title).catch(()=>null);
    if(!url)url=await searchPollinations(title).catch(()=>null);
    if(url)applyHeroImage(id,url);
    else clearHeroShimmer(id,r.emoji,catColor(r.category));
  }catch(e){clearHeroShimmer(id,r.emoji,catColor(r.category));}
}

// PWA — register real service worker file
if('serviceWorker' in navigator){
  navigator.serviceWorker.register('./sw.js').catch(()=>{});
}

// PWA — install prompt
let _deferredInstall=null;
function hideInstallBanner(){document.getElementById('install-banner').style.display='none';}
function showInstallBanner(platform){
  const banner=document.getElementById('install-banner');
  const msg=document.getElementById('install-msg');
  const btn=document.getElementById('install-btn');
  if(platform==='android-prompt'){
    msg.textContent='Add Cronjes to your home screen for the best experience.';
    btn.style.display='inline-block';
    btn.onclick=async function(){if(!_deferredInstall)return;_deferredInstall.prompt();const res=await _deferredInstall.userChoice;if(res.outcome==='accepted')hideInstallBanner();_deferredInstall=null;};
  }else if(platform==='ios'){
    msg.innerHTML='Install: tap <strong style="color:#7EE8E8">Share ↑</strong> then <strong style="color:#7EE8E8">"Add to Home Screen"</strong>';
    btn.style.display='none';
  }else if(platform==='android-manual'){
    msg.innerHTML='Install: tap <strong style="color:#7EE8E8">⋮</strong> in Chrome → <strong style="color:#7EE8E8">"Add to Home Screen"</strong>';
    btn.style.display='none';
  }
  banner.style.display='flex';
}
window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();_deferredInstall=e;showInstallBanner('android-prompt');});
window.addEventListener('appinstalled',hideInstallBanner);
(function(){
  const isIos=/iphone|ipad|ipod/i.test(navigator.userAgent);
  const isAndroid=/android/i.test(navigator.userAgent);
  const standalone=window.navigator.standalone===true||window.matchMedia('(display-mode:standalone)').matches;
  if(standalone)return;
  if(isIos&&!sessionStorage.getItem('ios-hint')){
    showInstallBanner('ios');
    document.getElementById('install-banner').querySelector('button:last-child').addEventListener('click',function(){sessionStorage.setItem('ios-hint','1');hideInstallBanner();},{once:true});
  }else if(isAndroid&&!sessionStorage.getItem('android-hint')){
    setTimeout(()=>{if(!_deferredInstall&&!window.matchMedia('(display-mode:standalone)').matches){showInstallBanner('android-manual');sessionStorage.setItem('android-hint','1');document.getElementById('install-banner').querySelector('button:last-child').addEventListener('click',function(){hideInstallBanner();},{once:true});}},2500);
  }
})();

document.addEventListener('DOMContentLoaded', function(){
  try{ load(); }
  catch(e){
    document.body.innerHTML='<div style="padding:40px;font-family:Arial,sans-serif;color:#a03030;"><h2>App Error</h2><pre style="font-size:12px;white-space:pre-wrap;">'+e.stack+'</pre></div>';
  }
});