const app = document.getElementById('app');
const cfg = window.APP_CONFIG || {};
let client = null;
let profile = null;
let profiles = [];
let entries = [];
let currentPeriod = getPeriod(new Date());

function esc(v=''){return String(v).replace(/[&<>'"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[m]))}
function iso(d){const y=d.getFullYear();const m=String(d.getMonth()+1).padStart(2,'0');const day=String(d.getDate()).padStart(2,'0');return `${y}-${m}-${day}`}
function fmt(d){return d.toLocaleDateString('es-AR')}
function getPeriod(ref){const y=ref.getFullYear(),m=ref.getMonth(),day=ref.getDate();const start=day>=20?new Date(y,m,20):new Date(y,m-1,20);const end=new Date(start.getFullYear(),start.getMonth()+1,19);return {start,end}}
function daysBetween(a,b){const out=[];for(let d=new Date(a);d<=b;d.setDate(d.getDate()+1))out.push(new Date(d));return out}
function configured(){return cfg.SUPABASE_URL?.startsWith('https://') && cfg.SUPABASE_ANON_KEY && !cfg.SUPABASE_ANON_KEY.includes('PEGAR_AQUI')}

async function init(){
  if(!configured()) return renderConfigHelp();
  client = supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY);
  const {data:{session}}=await client.auth.getSession();
  if(session?.user) await loadApp(session.user.id); else renderLogin();
}

function renderConfigHelp(){
  app.innerHTML=`<div class="card"><div class="logo">⚙️</div><div class="title">Falta conectar Supabase</div><p class="subtitle">Abrí el archivo <b>config.js</b> y pegá Project URL y Publishable key.</p><div class="notice">Usá únicamente la clave pública. Nunca pegues una secret key o service_role.</div></div>`;
}

function renderLogin(message=''){
  app.innerHTML=`<div class="card"><div class="logo">🤖</div><div class="title">Horas Robótica Jovita</div><div class="subtitle">Ingresá para cargar tus horas</div>${message?`<div class="error">${esc(message)}</div>`:''}<input id="email" class="field" type="email" placeholder="Correo"><input id="password" class="field" type="password" placeholder="Contraseña"><button id="login" class="btn btn-primary">INGRESAR</button></div>`;
  document.getElementById('login').onclick=signIn;
}

async function signIn(){
  const email=document.getElementById('email').value.trim();
  const password=document.getElementById('password').value;
  if(!email||!password)return renderLogin('Ingresá correo y contraseña.');
  const {data,error}=await client.auth.signInWithPassword({email,password});
  if(error||!data.user)return renderLogin('No se pudo ingresar. Revisá los datos.');
  await loadApp(data.user.id);
}

async function loadApp(userId){
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
  return `<div class="section">Planilla completa</div><div class="toolbar"><button id="exportExcel" class="btn btn-secondary">Descargar Excel</button></div><div class="table-box"><table class="hours-table"><thead><tr><th>Nombre</th>${head}<th>Total</th></tr></thead><tbody>${rows}</tbody></table></div>`;
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
  const ws=XLSX.utils.json_to_sheet(data);ws['!freeze']={xSplit:1,ySplit:1};
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Horas');
  XLSX.writeFile(wb,`Horas_${iso(currentPeriod.start)}_al_${iso(currentPeriod.end)}.xlsx`);
}

init();
