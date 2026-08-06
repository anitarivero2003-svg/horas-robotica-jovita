const app = document.getElementById('app');
const cfg = window.APP_CONFIG || {};
let client = null;
let profile = null;
let profiles = [];
let entries = [];
let currentPeriod = getPeriod(new Date());
let recoveryScreenActive = false;
const FILA_MENSUAL_FIJA = { nombre: 'Bruno', texto: 'cobra por mes' };

function esc(v=''){return String(v).replace(/[&<>'"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[m]))}
function iso(d){const y=d.getFullYear();const m=String(d.getMonth()+1).padStart(2,'0');const day=String(d.getDate()).padStart(2,'0');return `${y}-${m}-${day}`}
function fmt(d){return d.toLocaleDateString('es-AR')}
function getPeriod(ref){const y=ref.getFullYear(),m=ref.getMonth(),day=ref.getDate();const start=day>20?new Date(y,m,20):new Date(y,m-1,20);const end=new Date(start.getFullYear(),start.getMonth()+1,20);return {start,end}}
function daysBetween(a,b){const out=[];for(let d=new Date(a);d<=b;d.setDate(d.getDate()+1))out.push(new Date(d));return out}
function configured(){return cfg.SUPABASE_URL?.startsWith('https://') && cfg.SUPABASE_ANON_KEY && !cfg.SUPABASE_ANON_KEY.includes('PEGAR_AQUI')}
function recoveryMarkerInUrl(){const u=window.location.href;return u.includes('type=recovery')||u.includes('flow=reset_password')}
function cleanAuthUrl(){window.history.replaceState({},document.title,window.location.pathname)}

async function init(){
  if(!configured()) return renderConfigHelp();
  client = supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY);

  client.auth.onAuthStateChange((event,session)=>{
    if(event==='PASSWORD_RECOVERY'||(event==='SIGNED_IN'&&recoveryMarkerInUrl())){
      recoveryScreenActive=true;
      setTimeout(()=>renderNewPassword(),0);
    }
    if(event==='SIGNED_OUT'&&!recoveryScreenActive){
      profile=null;
      renderLogin();
    }
  });

  const {data:{session}}=await client.auth.getSession();
  if(recoveryMarkerInUrl()){
    recoveryScreenActive=true;
    return renderNewPassword();
  }
  if(session?.user) await loadApp(session.user.id); else renderLogin();
}

function renderConfigHelp(){
  app.innerHTML=`<div class="card"><div class="logo">⚙️</div><div class="title">Falta conectar Supabase</div><p class="subtitle">Abrí el archivo <b>config.js</b> y pegá Project URL y Publishable key.</p><div class="notice">Usá únicamente la clave pública. Nunca pegues una secret key o service_role.</div></div>`;
}

function renderLogin(message='',success=false,emailValue=''){
  recoveryScreenActive=false;
  app.innerHTML=`<div class="card"><div class="logo">🤖</div><div class="title">Horas Robótica Jovita</div><div class="subtitle">Ingresá para cargar tus horas</div>${message?`<div class="${success?'notice':'error'}">${esc(message)}</div>`:''}<input id="email" class="field" type="email" autocomplete="email" placeholder="Correo" value="${esc(emailValue)}"><input id="password" class="field" type="password" autocomplete="current-password" placeholder="Contraseña"><button id="login" class="btn btn-primary">INGRESAR</button><button id="forgot" class="btn" style="width:100%;margin-top:10px;background:#eef2ff;color:#4638b8">OLVIDÉ MI CONTRASEÑA</button></div>`;
  document.getElementById('login').onclick=signIn;
  document.getElementById('forgot').onclick=()=>renderForgotPassword(document.getElementById('email').value.trim());
  document.getElementById('password').addEventListener('keydown',e=>{if(e.key==='Enter')signIn()});
}

async function signIn(){
  const email=document.getElementById('email').value.trim();
  const password=document.getElementById('password').value;
  if(!email||!password)return renderLogin('Ingresá correo y contraseña.',false,email);
  const {data,error}=await client.auth.signInWithPassword({email,password});
  if(error||!data.user)return renderLogin('No se pudo ingresar. Revisá el correo o la contraseña.',false,email);
  await loadApp(data.user.id);
}

function renderForgotPassword(emailValue='',message='',success=false){
  app.innerHTML=`<div class="card"><div class="logo">🔑</div><div class="title">Recuperar contraseña</div><div class="subtitle">Escribí tu correo y te enviaremos un enlace para elegir una contraseña nueva.</div>${message?`<div class="${success?'notice':'error'}">${esc(message)}</div>`:''}<input id="resetEmail" class="field" type="email" autocomplete="email" placeholder="Correo" value="${esc(emailValue)}"><button id="sendReset" class="btn btn-primary">ENVIAR ENLACE</button><button id="backLogin" class="btn" style="width:100%;margin-top:10px;background:#eef2ff;color:#4638b8">VOLVER</button></div>`;
  document.getElementById('sendReset').onclick=sendPasswordReset;
  document.getElementById('backLogin').onclick=()=>renderLogin('',false,document.getElementById('resetEmail').value.trim());
}

async function sendPasswordReset(){
  const email=document.getElementById('resetEmail').value.trim();
  if(!email)return renderForgotPassword('', 'Escribí tu correo.', false);
  const redirectTo=`${window.location.origin}${window.location.pathname}`;
  const {error}=await client.auth.resetPasswordForEmail(email,{redirectTo});
  if(error)return renderForgotPassword(email,`No se pudo enviar el correo: ${error.message}`,false);
  renderForgotPassword(email,'Listo. Revisá tu correo y también la carpeta Spam. Abrí el enlace recibido para crear una contraseña nueva.',true);
}

function renderNewPassword(message='',success=false){
  recoveryScreenActive=true;
  app.innerHTML=`<div class="card"><div class="logo">🔐</div><div class="title">Crear contraseña nueva</div><div class="subtitle">Elegí una contraseña de al menos 6 caracteres.</div>${message?`<div class="${success?'notice':'error'}">${esc(message)}</div>`:''}<input id="newPassword" class="field" type="password" autocomplete="new-password" placeholder="Contraseña nueva"><input id="repeatPassword" class="field" type="password" autocomplete="new-password" placeholder="Repetir contraseña"><button id="savePassword" class="btn btn-primary">GUARDAR CONTRASEÑA</button></div>`;
  document.getElementById('savePassword').onclick=saveNewPassword;
}

async function saveNewPassword(){
  const password=document.getElementById('newPassword').value;
  const repeat=document.getElementById('repeatPassword').value;
  if(password.length<6)return renderNewPassword('La contraseña debe tener al menos 6 caracteres.');
  if(password!==repeat)return renderNewPassword('Las dos contraseñas no coinciden.');
  const {data:{session}}=await client.auth.getSession();
  if(!session)return renderNewPassword('El enlace venció o ya fue usado. Volvé a solicitar otro desde “Olvidé mi contraseña”.');
  const {error}=await client.auth.updateUser({password});
  if(error)return renderNewPassword(`No se pudo guardar: ${error.message}`);
  recoveryScreenActive=false;
  cleanAuthUrl();
  await client.auth.signOut();
  renderLogin('Contraseña actualizada. Ya podés ingresar.',true);
}

async function loadApp(userId){
  if(recoveryScreenActive)return;
  app.innerHTML='<div class="card"><div class="title">Cargando…</div></div>';
  const {data:p,error:pe}=await client.from('usuarios').select('id,nombre,email,rol,activo').eq('id',userId).single();
  if(pe||!p){await client.auth.signOut();return renderLogin('La cuenta existe, pero falta crearla en la tabla usuarios.');}
  profile=p;
  const start=iso(currentPeriod.start),end=iso(currentPeriod.end);
  const hoursPromise=client.from('horas').select('id,usuario_id,fecha,horas').gte('fecha',start).lte('fecha',end);
  const usersPromise=p.rol==='admin'?client.from('usuarios').select('id,nombre,email,rol,activo').eq('activo',true).order('nombre') : Promise.resolve({data:[p],error:null});
  const [hr,ur]=await Promise.all([hoursPromise,usersPromise]);
  if(hr.error)return renderLogin(hr.error.message);
  entries=hr.data||[];profiles=ur.data||[p];renderDashboard();
}

function entryMap(){return new Map(entries.map(e=>[`${e.usuario_id}|${e.fecha}`,Number(e.horas)]))}
function renderDashboard(){
  const days=daysBetween(currentPeriod.start,currentPeriod.end);const map=entryMap();
  const own=entries.filter(e=>e.usuario_id===profile.id).reduce((s,e)=>s+Number(e.horas),0);
  const calendar=days.map(d=>{const date=iso(d),v=map.get(`${profile.id}|${date}`);return `<button class="day ${v!==undefined?'done':''}" data-date="${date}"><div class="n">${d.getDate()}</div><div class="m">${d.toLocaleDateString('es-AR',{month:'short'})}</div><div class="h">${v!==undefined?`${String(v).replace('.',',')} h`:'—'}</div></button>`}).join('');
  app.innerHTML=`<div class="topbar"><div><div class="hello">Hola, ${esc(profile.nombre)}</div><div class="muted">Período ${fmt(currentPeriod.start)} al ${fmt(currentPeriod.end)}</div></div><button id="logout" class="btn btn-danger">Salir</button></div><div class="summary"><span>MIS HORAS</span><strong>${own.toLocaleString('es-AR')} h</strong></div><div class="section">Tocá un día para cargar horas</div><div class="grid">${calendar}</div>${profile.rol==='admin'?renderAdminTable(days,map):''}`;
  document.querySelectorAll('.day').forEach(b=>b.onclick=()=>openModal(b.dataset.date,map.get(`${profile.id}|${b.dataset.date}`)));
  document.getElementById('logout').onclick=async()=>{await client.auth.signOut();profile=null;renderLogin()};
  const x=document.getElementById('exportExcel');if(x)x.onclick=exportExcel;
}

function renderAdminTable(days,map){
  const head=days.map(d=>`<th>${d.getDate()}</th>`).join('');
  const rows=profiles.map(p=>{let total=0;const cells=days.map(d=>{const v=map.get(`${p.id}|${iso(d)}`);total+=Number(v||0);return `<td>${v!==undefined?String(v).replace('.',','):''}</td>`}).join('');return `<tr><td>${esc(p.nombre)}</td>${cells}<td><b>${total.toLocaleString('es-AR')}</b></td></tr>`}).join('');
  const filaMensual=`<tr class="monthly-row"><td>${esc(FILA_MENSUAL_FIJA.nombre)}</td>${days.map(()=>'<td></td>').join('')}<td><b>${esc(FILA_MENSUAL_FIJA.texto)}</b></td></tr>`;
  return `<div class="section">Planilla completa</div><div class="toolbar"><button id="exportExcel" class="btn btn-secondary">Descargar Excel</button></div><div class="table-box"><table class="hours-table"><thead><tr><th>Nombre</th>${head}<th>Total</th></tr></thead><tbody>${rows}${filaMensual}</tbody></table></div>`;
}

function openModal(date,value){
  const m=document.createElement('div');m.className='modal';m.innerHTML=`<div class="modal-card"><h2>Horas del ${date.split('-').reverse().join('/')}</h2><div class="quick">${[1,2,3,4].map(v=>`<button data-v="${v}">${v} h</button>`).join('')}</div><input id="hoursInput" class="field" inputmode="decimal" placeholder="Ejemplo: 3,5" value="${value!==undefined?String(value).replace('.',','):''}"><button id="saveHours" class="btn btn-primary">GUARDAR</button><button id="cancel" class="btn" style="width:100%;margin-top:8px">Cancelar</button></div>`;document.body.appendChild(m);
  m.querySelectorAll('[data-v]').forEach(b=>b.onclick=()=>document.getElementById('hoursInput').value=b.dataset.v);
  document.getElementById('cancel').onclick=()=>m.remove();
  document.getElementById('saveHours').onclick=async()=>{const raw=document.getElementById('hoursInput').value.replace(',','.');const val=Number(raw);if(!Number.isFinite(val)||val<0||val>24)return alert('Escribí una cantidad entre 0 y 24.');const {error}=await client.from('horas').upsert({usuario_id:profile.id,fecha:date,horas:val},{onConflict:'usuario_id,fecha'});if(error)return alert(error.message);m.remove();await loadApp(profile.id)};
}

function exportExcel(){
  const days=daysBetween(currentPeriod.start,currentPeriod.end),map=entryMap();
  const data=profiles.map(p=>{const row={Nombre:p.nombre};let total=0;days.forEach(d=>{const v=map.get(`${p.id}|${iso(d)}`);row[`${d.getDate()}/${d.getMonth()+1}`]=v??'';total+=Number(v||0)});row.Total=total;return row});
  const filaMensual={Nombre:FILA_MENSUAL_FIJA.nombre};
  days.forEach(d=>{filaMensual[`${d.getDate()}/${d.getMonth()+1}`]=''});
  filaMensual.Total=FILA_MENSUAL_FIJA.texto;
  data.push(filaMensual);
  const ws=XLSX.utils.json_to_sheet(data);ws['!freeze']={xSplit:1,ySplit:1};
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Horas');
  XLSX.writeFile(wb,`Horas_${iso(currentPeriod.start)}_al_${iso(currentPeriod.end)}.xlsx`);
}

init();
