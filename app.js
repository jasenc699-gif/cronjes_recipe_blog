const SK='cronjes_blog_v1',KK='cronjes_apikey',WK='cronjes_welcomed',JBK='cronjes_jbkey',JBB='cronjes_jbbin',CK='cronjes_customcats';
const CATS=['Breakfast','Lunch','Dinner','Dessert','Snacks','Soups','Salads','Baking','Drinks','Other'];
const CE={Breakfast:'🍳',Lunch:'🥙',Dinner:'🍽️',Dessert:'🍰',Snacks:'🧀',Soups:'🍲',Salads:'🥗',Baking:'🥐',Drinks:'🥤',Other:'🍴'};
const CC={Breakfast:'#FFF0D0',Lunch:'#E2F2E0',Dinner:'#D5E8F5',Dessert:'#FFD6E8',Snacks:'#FFFAC0',Soups:'#FFE4C8',Salads:'#DCF2CC',Baking:'#F5E8D0',Drinks:'#CCE8F8',Other:'#E8E4DC'};
const CUSTOMCC='#E0EEF0';
const FE=['🍝','🥗','🍜','🥘','🍲','🍛','🥩','🍕','🥞','🧆','🍗','🥕','🥧','🍱','🫔','🫕'];

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
let recs=[],tab='c',catF='All',rid=null,mode='p',fb64=null,dtxt=null,pendingRec=null,editMode=false,editPendingImg=undefined;

function load(){
  try{const v=store.get(SK);if(v)recs=JSON.parse(v);}catch(e){recs=[];}
  if(!store.get(WK))go('welcome');
  else if(!getKey())go('settings');
  else{go('main');}
}
function save(){try{store.set(SK,JSON.stringify(recs));}catch(e){}}
function welcomeDone(){store.set(WK,'1');if(!getKey())go('settings');else{buildChips();render();go('main');}}

function getKey(){return store.get(KK)||'';}
function saveKey(){
  const v=document.getElementById('keyinp').value.trim();
  if(!v.startsWith('gsk_')){alert('That doesn\'t look like a valid Groq key. It should start with gsk_');return;}
  store.set(KK,v);
  document.getElementById('keyinp').value='';
  showKinfo();alert('API key saved ✓');buildChips();render();go('main');
}
function clearKey(){if(!confirm('Remove saved API key?'))return;store.remove(KK);document.getElementById('kinfo').style.display='none';}
function showKinfo(){document.getElementById('kinfo').style.display=getKey()?'block':'none';}

function go(s){
  const ids={main:'sm',add:'sadd',detail:'sdet',settings:'sset',welcome:'swel'};
  document.querySelectorAll('.scr').forEach(x=>x.classList.remove('on'));
  const el=document.getElementById(ids[s]);
  if(!el)return;
  el.classList.add('on');
  if(s==='add')resetAdd();
  if(s==='main'){if(editMode)exitEditMode();buildChips();setTab('c');}
  if(s==='settings'){showKinfo();document.getElementById('impresult').style.display='none';loadSyncFields();renderCatManager();}
}

function setTab(t){
  tab=t;catF='All';
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
function filterCat(c){catF=c;buildChips();render();}

function makeRecipeCard(r, showCat){
  const card=document.createElement('div');card.className='rc';card.onclick=()=>showDetail(r.id);
  const bg=catColor(r.category);
  const img=r.imageData?`<div class="rc-img" style="padding:0;overflow:hidden"><img src="${r.imageData}" style="width:100%;height:110px;object-fit:cover;display:block"/></div>`:`<div class="rc-img" style="background:${bg}">${r.emoji}</div>`;
  card.innerHTML=`${img}${r.favourite?'<div class="rc-star">⭐</div>':''}<div class="rc-body"><div class="rc-title">${r.title}</div><div class="rc-meta">${[r.time,r.servings].filter(Boolean).join(' · ')}</div>${showCat&&r.category?`<span class="rc-cat">${r.category}</span>`:''}</div>`;
  addLongPress(card,r.id);
  return card;
}

let _longPressId=null;
function addLongPress(card,id){
  let timer=null,moved=false;
  card.addEventListener('touchstart',()=>{moved=false;timer=setTimeout(()=>{if(!moved){showCardSheet(id);}},580);},{passive:true});
  card.addEventListener('touchmove',()=>{moved=true;clearTimeout(timer);},{passive:true});
  card.addEventListener('touchend',()=>clearTimeout(timer));
  card.addEventListener('touchcancel',()=>clearTimeout(timer));
}

function showCardSheet(id){
  _longPressId=id;
  const r=recs.find(x=>x.id===id);if(!r)return;
  document.getElementById('card-sheet-title').textContent=r.title;
  document.getElementById('card-action-sheet').style.display='block';
}
function closeCardSheet(){document.getElementById('card-action-sheet').style.display='none';_longPressId=null;}
function cardSheetView(){const id=_longPressId;closeCardSheet();if(id)showDetail(id);}
function cardSheetDelete(){
  const id=_longPressId;closeCardSheet();
  const r=recs.find(x=>x.id===id);if(!r)return;
  if(!confirm('Delete "'+r.title+'"?'))return;
  recs=recs.filter(x=>x.id!==id);save();
  if(tab==='c')renderCats();else render();
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
    const n=recs.filter(r=>r.category===c).length;
    const d=document.createElement('div');d.className='ccard';
    d.style.cssText=`background:${catColor(c)};border-color:transparent;`;
    d.onclick=()=>openCatDetail(c);
    d.innerHTML=`<span class="cico" style="font-size:36px;margin-bottom:10px;">${catEmoji(c)}</span><div class="cname" style="font-size:15px;font-weight:bold;">${c}</div><div class="ccnt">${n} recipe${n!==1?'s':''}</div>`;
    p.appendChild(d);
  });
}

function openCatDetail(c){
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
  if(editPendingImg!==undefined)r.imageData=editPendingImg;
  r.savedAt=new Date().toISOString();
  save();
  exitEditMode();
  showDetail(rid);
  buildChips();render();
}

function cancelEdit(){
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

function showDetail(id){
  rid=id;const r=recs.find(x=>x.id===id);if(!r)return;
  exitEditMode();
  go('detail');
  document.getElementById('dnav').textContent=r.title;
  document.getElementById('dtitle').textContent=r.title;
  const h=document.getElementById('dhero');
  if(r.imageData){h.innerHTML=`<img src="${r.imageData}"/>`;h.style.minHeight='';}
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
  r.category=sel.value;save();
  document.getElementById('dcatb-txt').textContent=r.category;
  document.getElementById('dcatb').style.display='';
  sel.style.display='none';
  buildChips();
}
function togFav(){const r=recs.find(x=>x.id===rid);if(!r)return;r.favourite=!r.favourite;updStar(r.favourite);save();}
function renderCmts(r){
  const cmts=r.comments||[];
  document.getElementById('cmtlist').innerHTML=cmts.length?cmts.map(c=>`<div class="cmtitem"><div class="cmttxt">${c.text}</div><div class="cmtrow"><div class="cmtdate">${fmtDate(c.date)}</div><button class="cmtrm" onclick="delCmt('${c.id}')">Remove</button></div></div>`).join(''):`<p style="font-size:13px;color:var(--mu);font-family:Arial,sans-serif;margin-bottom:10px;">No notes yet.</p>`;
}
function postCmt(){const el=document.getElementById('cmtinp');const tx=el.value.trim();if(!tx)return;const r=recs.find(x=>x.id===rid);if(!r)return;if(!r.comments)r.comments=[];r.comments.push({id:Date.now().toString(),text:tx,date:new Date().toISOString()});el.value='';renderCmts(r);save();}
function delCmt(cid){const r=recs.find(x=>x.id===rid);if(!r)return;r.comments=(r.comments||[]).filter(c=>c.id!==cid);renderCmts(r);save();}
function fmtDate(iso){const d=new Date(iso);return d.toLocaleDateString('en-NZ',{day:'numeric',month:'short',year:'numeric'})+' '+d.toLocaleTimeString('en-NZ',{hour:'2-digit',minute:'2-digit'});}
async function delRecipe(){if(!confirm('Delete this recipe?'))return;recs=recs.filter(r=>r.id!==rid);save();go('main');}


function resetAdd(){
  mode='p';fb64=null;dtxt=null;pendingRec=null;
  ['fip','dip'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('imgprev').src='';
  document.getElementById('urlinp').value='';
  document.getElementById('docname').textContent='';
  document.getElementById('errmsg').style.display='none';
  document.getElementById('catpanel').style.display='none';
  document.getElementById('extractbtn').style.display='block';
  ['p','u','d'].forEach(x=>{document.getElementById('op-'+x).classList.toggle('on',x==='p');document.getElementById('sec-'+x).style.display='none';});
  document.getElementById('op-p-hint').textContent='Tap to choose image';
  document.getElementById('op-d-hint').textContent='Tap to choose file';
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
function onImg(e){
  const f=e.target.files[0];if(!f)return;
  if(f.size>5242880){showErr('Image too large (max 5MB).');return;}
  const rd=new FileReader();rd.onload=ev=>{
    fb64=ev.target.result;
    const im=document.getElementById('imgprev');im.src=fb64;
    document.getElementById('sec-p').style.display='block';
    document.getElementById('op-p-hint').textContent='Image ready ✓';
  };rd.readAsDataURL(f);
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

function loadSyncFields(){
  const k=store.get(JBK)||'';
  const b=store.get(JBB)||'';
  document.getElementById('jbkey').value=''; // keep password hidden
  document.getElementById('jbbin').value=b;
  const si=document.getElementById('syncinfo');
  const last=store.get('cronjes_lastsync');
  if(b){si.textContent='Bin ID: '+b+(last?' · Last synced: '+new Date(last).toLocaleString('en-NZ',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'');si.style.display='block';}
  else{si.style.display='none';}
}

function saveSyncCreds(){
  const k=document.getElementById('jbkey').value.trim();
  const b=document.getElementById('jbbin').value.trim();
  if(k)store.set(JBK,k);
  if(b)store.set(JBB,b);
}

function setSyncResult(msg,ok){
  const el=document.getElementById('syncresult');
  el.textContent=msg;el.style.color=ok?'var(--tc)':'#a03030';el.style.display='block';
}

function mergeRecipes(local,remote){
  // Merge by ID, keeping most recently saved version on conflict
  const map=new Map();
  [...remote,...local].forEach(r=>{
    if(!r||!r.id)return;
    const existing=map.get(r.id);
    if(!existing||(r.savedAt&&(!existing.savedAt||r.savedAt>existing.savedAt)))map.set(r.id,r);
  });
  return [...map.values()].sort((a,b)=>(b.savedAt||'').localeCompare(a.savedAt||''));
}

async function syncNow(){
  saveSyncCreds();
  const key=store.get(JBK)||document.getElementById('jbkey').value.trim();
  let binId=store.get(JBB)||document.getElementById('jbbin').value.trim();
  if(!key){setSyncResult('Please enter your JSONBin Master Key first.',false);return;}
  setSyncResult('Syncing…',true);
  try{
    if(!binId){
      // Create a new bin
      const cr=await fetch('https://api.jsonbin.io/v3/b',{
        method:'POST',
        headers:{'Content-Type':'application/json','X-Master-Key':key,'X-Bin-Name':'Cronjes Recipes','X-Bin-Private':'true'},
        body:JSON.stringify({recipes:recs,syncedAt:new Date().toISOString()})
      });
      const cd=await cr.json();
      if(cd.message&&!cd.metadata)throw new Error(cd.message);
      binId=cd.metadata.id;
      store.set(JBB,binId);
      document.getElementById('jbbin').value=binId;
      store.set('cronjes_lastsync',new Date().toISOString());
      loadSyncFields();
      setSyncResult(`✓ New bin created!\n\nBin ID: ${binId}\n\nCopy this ID to your other device, paste it into the Bin ID field there, and tap Sync Now.`,true);
      return;
    }
    // Read remote
    const gr=await fetch(`https://api.jsonbin.io/v3/b/${binId}/latest`,{headers:{'X-Master-Key':key}});
    const gd=await gr.json();
    if(gd.message&&!gd.record)throw new Error(gd.message);
    const remote=gd.record?.recipes||[];
    // Merge
    const merged=mergeRecipes(recs,remote);
    // Push merged back
    const pr=await fetch(`https://api.jsonbin.io/v3/b/${binId}`,{
      method:'PUT',
      headers:{'Content-Type':'application/json','X-Master-Key':key},
      body:JSON.stringify({recipes:merged,syncedAt:new Date().toISOString()})
    });
    const pd=await pr.json();
    if(pd.message&&!pd.record)throw new Error(pd.message);
    const added=merged.length-recs.length;
    recs=merged;save();buildChips();render();
    store.set('cronjes_lastsync',new Date().toISOString());
    loadSyncFields();
    setSyncResult(`✓ Synced! ${merged.length} recipes in collection.${added>0?' '+added+' new recipe'+(added!==1?'s':'')+ ' pulled from cloud.':''}`,true);
  }catch(e){setSyncResult('Sync failed: '+(e.message||e),false);}
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
    if(!incoming.length){res.textContent='No recipes found in this file.';res.style.display='block';return;}
    const ids=new Set(recs.map(r=>r.id));
    const newOnes=incoming.filter(r=>r.id&&!ids.has(r.id));
    recs=recs.concat(newOnes);save();buildChips();render();
    res.textContent=`✓ Imported ${newOnes.length} new recipe${newOnes.length!==1?'s':''} (${incoming.length-newOnes.length} skipped as duplicates).`;
    res.style.color='var(--tc)';res.style.display='block';
  }catch(err){res.textContent='Could not read file. Make sure it\'s a valid Cronjes backup.';res.style.color='#a03030';res.style.display='block';}
  e.target.value='';
}

// AI
function showLoad(m){document.getElementById('loader').style.display='flex';document.getElementById('loadmsg').textContent=m;}
function hideLoad(){document.getElementById('loader').style.display='none';}
function showErr(m){const e=document.getElementById('errmsg');e.textContent=m;e.style.display='block';}

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
  if(mode==='p'){if(!fb64){showErr('Please select an image first.');return;}showLoad('Reading your screenshot...');await extImg();}
  else if(mode==='u'){const u=document.getElementById('urlinp').value.trim();if(!u||!u.startsWith('http')){showErr('Please enter a valid URL starting with https://');return;}showLoad('Fetching recipe from website...');await extUrl(u);}
  else{if(!dtxt){showErr('Please select a Word document first.');return;}showLoad('Reading your Word document...');await extDoc();}
}
async function extImg(){
  try{const[hd,b64]=fb64.split(',');const mime=hd.match(/:(.*?);/)[1];proc(await callGroq([{inline_data:{mime_type:mime,data:b64}},{text:getPrompt()}]),fb64);}
  catch(e){hideLoad();showErr('Could not read image. ('+(e.message||e)+')');}
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
  recs.unshift(pendingRec);save();
  const savedId=pendingRec.id;
  const savedTitle=pendingRec.title;
  const hasPhoto=!!pendingRec.imageData;
  showDetail(savedId);pendingRec=null;
  // Generate AI food image in background if no user photo
  if(!hasPhoto)genFoodImage(savedId,savedTitle);
}

// ── Image search pipeline ─────────────────────────────────────────────────
// ── Edit-mode image helpers ───────────────────────────────────────────────
function setEditImgPreview(src,r){
  const el=document.getElementById('edit-img-preview');
  if(!el)return;
  if(src){el.innerHTML=`<img src="${src}" style="width:100%;height:100%;object-fit:cover;display:block;">`;}
  else{const rec=r||recs.find(x=>x.id===rid);el.style.background=catColor(rec?.category);el.innerHTML=`<span style="font-size:48px;">${rec?.emoji||'🍴'}</span>`;}
}
function editOnImg(e){
  const f=e.target.files[0];if(!f)return;
  if(f.size>8388608){alert('Image too large (max 8MB)');return;}
  const rd=new FileReader();rd.onload=ev=>{editPendingImg=ev.target.result;setEditImgPreview(ev.target.result);};rd.readAsDataURL(f);
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
          messages:[{role:'user',content:`Search the web and find 6 high-quality food photography image URLs for the dish: "${query}". Look on recipe sites, food blogs, and cooking websites. Return ONLY a raw JSON array of direct image URLs (ending in .jpg .jpeg .png or .webp). No markdown, no explanation, just the JSON array. Example format: ["https://example.com/image.jpg","https://..."]`}],
          max_tokens:600
        })
      });
      const data=await resp.json();
      const text=data.choices?.[0]?.message?.content||'';
      const match=text.match(/\[[\s\S]*?\]/);
      if(match){
        const parsed=JSON.parse(match[0]);
        urls=parsed.filter(u=>typeof u==='string'&&u.startsWith('http'));
      }
    }catch(e){}
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
