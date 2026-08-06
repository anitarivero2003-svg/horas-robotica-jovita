const app = document.getElementById('app');
const cfg = window.APP_CONFIG || {};
const installButton = document.getElementById('installAppButton');
const networkNotice = document.getElementById('networkNotice');

let client = null;
let profile = null;
let profiles = [];
let entries = [];
let currentPeriod = getPeriod(new Date());
let recoveryScreenActive = false;
let deferredInstallPrompt = null;

const FILA_MENSUAL_FIJA = { nombre: 'Bruno', texto: 'cobra por mes' };

function esc(v = '') {
  return String(v).replace(/[&<>'"]/g, (m) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[m]));
}

function iso(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function fmt(d) {
  return d.toLocaleDateString('es-AR');
}

function getPeriod(ref) {
  const y = ref.getFullYear();
  const m = ref.getMonth();
  const day = ref.getDate();
  const start = day > 20 ? new Date(y, m, 20) : new Date(y, m - 1, 20);
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 20);
  return { start, end };
}

function daysBetween(a, b) {
  const out = [];
  for (let d = new Date(a); d <= b; d.setDate(d.getDate() + 1)) {
    out.push(new Date(d));
  }
  return out;
}

function configured() {
  return cfg.SUPABASE_URL?.startsWith('https://')
    && cfg.SUPABASE_ANON_KEY
    && !cfg.SUPABASE_ANON_KEY.includes('PEGAR_AQUI');
}

function recoveryMarkerInUrl() {
  const url = window.location.href;
  return url.includes('type=recovery') || url.includes('flow=reset_password');
}

function cleanAuthUrl() {
  window.history.replaceState({}, document.title, window.location.pathname);
}

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
}

function isIOS() {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

function isAndroid() {
  return /android/i.test(window.navigator.userAgent);
}

function isInAppBrowser() {
  return /FBAN|FBAV|Instagram|Line|WhatsApp/i.test(window.navigator.userAgent);
}

function authLayout({ title, subtitle, content, message = '', success = false }) {
  return `
    <section class="auth-wrap">
      <div class="auth-hero">
        <div class="brand-lockup">
          <img class="brand-logo" src="/icon-192.png" alt="" />
          <div>
            <span class="brand-kicker">Escuela de Robótica</span>
            <div class="brand-name">Jovita</div>
          </div>
        </div>

        <div class="hero-copy">
          <h1>Las horas claras, simples y ordenadas.</h1>
          <p>Cada compañera carga lo suyo. Ana ve la planilla completa y descarga el Excel del período.</p>
          <div class="hero-pills">
            <span class="hero-pill">📅 Del 20 al 20</span>
            <span class="hero-pill">🔒 Datos privados</span>
            <span class="hero-pill">📊 Excel automático</span>
          </div>
        </div>
      </div>

      <div class="auth-form">
        <img class="mini-logo" src="/icon-192.png" alt="" />
        <h1 class="title">${title}</h1>
        <p class="subtitle">${subtitle}</p>
        ${message ? `<div class="${success ? 'notice' : 'error'}">${esc(message)}</div>` : ''}
        ${content}
        <div class="auth-help">Horas Robótica Jovita · Acceso privado</div>
      </div>
    </section>
  `;
}

function showInfoModal(title, bodyHtml) {
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = `
    <div class="modal-card" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <h2>${esc(title)}</h2>
      ${bodyHtml}
      <button class="btn btn-primary" data-close-modal>ENTENDIDO</button>
    </div>
  `;
  document.body.appendChild(modal);
  const close = () => modal.remove();
  modal.querySelector('[data-close-modal]').onclick = close;
  modal.addEventListener('click', (event) => {
    if (event.target === modal) close();
  });
}

function setInstallButtonState(state) {
  if (!installButton) return;

  const icon = installButton.querySelector('span:first-child');
  const label = installButton.querySelector('span:last-child');
  installButton.dataset.state = state;
  installButton.classList.toggle('is-preparing', state === 'preparing');

  if (state === 'ready') {
    if (icon) icon.textContent = '📲';
    if (label) label.textContent = 'Instalar app';
    installButton.title = 'Instalar Horas Robótica Jovita';
  } else if (state === 'ios') {
    if (icon) icon.textContent = '➕';
    if (label) label.textContent = 'Agregar al inicio';
    installButton.title = 'Agregar a la pantalla de inicio';
  } else {
    if (icon) icon.textContent = '⏳';
    if (label) label.textContent = 'Preparando app…';
    installButton.title = 'Chrome está preparando la instalación';
  }
}

function showInstallInstructions() {
  if (isIOS()) {
    showInfoModal('Agregar al inicio del iPhone', `
      <p>Abrí esta página con <b>Safari</b> y seguí estos pasos:</p>
      <ol class="install-steps">
        <li>Tocá el botón <b>Compartir</b>.</li>
        <li>Elegí <b>Añadir a pantalla de inicio</b>.</li>
        <li>Tocá <b>Añadir</b>.</li>
      </ol>
    `);
    return;
  }

  showInfoModal('Chrome está preparando la app', `
    <p>No tenés que buscar ninguna opción en los tres puntitos.</p>
    <p>Dejá esta pantalla abierta durante <b>30 segundos</b> y tocá cualquier parte de la aplicación. Cuando Chrome la habilite, el botón cambiará de <b>“Preparando app…”</b> a <b>“Instalar app”</b>.</p>
    <p>Después tocás ese mismo botón y aparecerá la ventana real de Android para instalarla.</p>
  `);
}

async function requestInstall() {
  if (isStandalone()) {
    showInfoModal('Ya está instalada', '<p>La aplicación ya está abierta desde el ícono del celular.</p>');
    return;
  }

  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    const choice = await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    updateInstallButton();
    if (choice.outcome !== 'accepted') {
      showInfoModal('Instalación cancelada', '<p>Cuando quieras, podés volver a tocar <b>Instalar app</b>.</p>');
    }
    return;
  }

  showInstallInstructions();
}

function updateInstallButton() {
  if (!installButton) return;

  if (isStandalone()) {
    installButton.hidden = true;
    return;
  }

  installButton.hidden = false;
  if (isIOS()) {
    setInstallButtonState('ios');
  } else if (deferredInstallPrompt) {
    setInstallButtonState('ready');
  } else {
    setInstallButtonState('preparing');
  }
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return false;
  try {
    if (window.HORAS_PWA_READY) await window.HORAS_PWA_READY;
    const registration = await navigator.serviceWorker.ready;
    await registration.update();
    return true;
  } catch (error) {
    console.warn('No se pudo registrar el service worker:', error);
    return false;
  }
}

function updateNetworkNotice() {
  if (!networkNotice) return;
  networkNotice.hidden = window.navigator.onLine;
}

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  updateInstallButton();
});

// Chrome exige al menos una interacción y unos segundos de uso antes de ofrecer la instalación.
window.addEventListener('pointerdown', () => updateInstallButton(), { once: true });
setTimeout(updateInstallButton, 31000);

window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  updateInstallButton();
});

window.addEventListener('online', updateNetworkNotice);
window.addEventListener('offline', updateNetworkNotice);
installButton?.addEventListener('click', requestInstall);

async function init() {
  updateInstallButton();
  updateNetworkNotice();
  registerServiceWorker();

  if (!configured()) return renderConfigHelp();

  client = supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

  client.auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY' || (event === 'SIGNED_IN' && recoveryMarkerInUrl())) {
      recoveryScreenActive = true;
      setTimeout(() => renderNewPassword(), 0);
    }

    if (event === 'SIGNED_OUT' && !recoveryScreenActive) {
      profile = null;
      renderLogin();
    }
  });

  const { data: { session } } = await client.auth.getSession();

  if (recoveryMarkerInUrl()) {
    recoveryScreenActive = true;
    return renderNewPassword();
  }

  if (session?.user) {
    await loadApp(session.user.id);
  } else {
    renderLogin();
  }
}

function renderConfigHelp() {
  app.innerHTML = authLayout({
    title: 'Falta conectar Supabase',
    subtitle: 'La aplicación necesita la dirección y la clave pública del proyecto.',
    content: `
      <div class="notice">
        Abrí <b>config.js</b> y colocá Project URL y Publishable key.
        Nunca uses una secret key ni service_role.
      </div>
    `
  });
}

function renderLogin(message = '', success = false, emailValue = '') {
  recoveryScreenActive = false;
  app.innerHTML = authLayout({
    title: 'Bienvenida',
    subtitle: 'Ingresá para cargar las horas trabajadas.',
    message,
    success,
    content: `
      <label class="label" for="email">Correo</label>
      <input id="email" class="field" type="email" autocomplete="email"
        placeholder="nombre@gmail.com" value="${esc(emailValue)}" />

      <label class="label" for="password">Contraseña</label>
      <input id="password" class="field" type="password"
        autocomplete="current-password" placeholder="Tu contraseña" />

      <button id="login" class="btn btn-primary" type="button">INGRESAR</button>
      <button id="forgot" class="btn btn-soft" type="button">OLVIDÉ MI CONTRASEÑA</button>
    `
  });

  document.getElementById('login').onclick = signIn;
  document.getElementById('forgot').onclick = () => {
    renderForgotPassword(document.getElementById('email').value.trim());
  };
  document.getElementById('password').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') signIn();
  });
}

async function signIn() {
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;

  if (!email || !password) {
    return renderLogin('Ingresá el correo y la contraseña.', false, email);
  }

  const { data, error } = await client.auth.signInWithPassword({ email, password });

  if (error || !data.user) {
    return renderLogin('No se pudo ingresar. Revisá el correo o la contraseña.', false, email);
  }

  await loadApp(data.user.id);
}

function renderForgotPassword(emailValue = '', message = '', success = false) {
  app.innerHTML = authLayout({
    title: 'Recuperar contraseña',
    subtitle: 'Te enviaremos un enlace para elegir una contraseña nueva.',
    message,
    success,
    content: `
      <label class="label" for="resetEmail">Correo</label>
      <input id="resetEmail" class="field" type="email" autocomplete="email"
        placeholder="nombre@gmail.com" value="${esc(emailValue)}" />
      <button id="sendReset" class="btn btn-primary" type="button">ENVIAR ENLACE</button>
      <button id="backLogin" class="btn btn-soft" type="button">VOLVER</button>
    `
  });

  document.getElementById('sendReset').onclick = sendPasswordReset;
  document.getElementById('backLogin').onclick = () => {
    renderLogin('', false, document.getElementById('resetEmail').value.trim());
  };
}

async function sendPasswordReset() {
  const email = document.getElementById('resetEmail').value.trim();

  if (!email) {
    return renderForgotPassword('', 'Escribí tu correo.', false);
  }

  const redirectTo = `${window.location.origin}${window.location.pathname}`;
  const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo });

  if (error) {
    return renderForgotPassword(email, `No se pudo enviar el correo: ${error.message}`, false);
  }

  renderForgotPassword(
    email,
    'Listo. Revisá tu correo y la carpeta Spam. Abrí el enlace recibido para crear una contraseña nueva.',
    true
  );
}

function renderNewPassword(message = '', success = false) {
  recoveryScreenActive = true;
  app.innerHTML = authLayout({
    title: 'Crear contraseña nueva',
    subtitle: 'Elegí una contraseña de al menos 6 caracteres.',
    message,
    success,
    content: `
      <label class="label" for="newPassword">Contraseña nueva</label>
      <input id="newPassword" class="field" type="password"
        autocomplete="new-password" placeholder="Contraseña nueva" />

      <label class="label" for="repeatPassword">Repetir contraseña</label>
      <input id="repeatPassword" class="field" type="password"
        autocomplete="new-password" placeholder="Repetir contraseña" />

      <button id="savePassword" class="btn btn-primary" type="button">
        GUARDAR CONTRASEÑA
      </button>
    `
  });

  document.getElementById('savePassword').onclick = saveNewPassword;
}

async function saveNewPassword() {
  const password = document.getElementById('newPassword').value;
  const repeat = document.getElementById('repeatPassword').value;

  if (password.length < 6) {
    return renderNewPassword('La contraseña debe tener al menos 6 caracteres.');
  }

  if (password !== repeat) {
    return renderNewPassword('Las dos contraseñas no coinciden.');
  }

  const { data: { session } } = await client.auth.getSession();

  if (!session) {
    return renderNewPassword(
      'El enlace venció o ya fue usado. Volvé a solicitar otro desde “Olvidé mi contraseña”.'
    );
  }

  const { error } = await client.auth.updateUser({ password });

  if (error) {
    return renderNewPassword(`No se pudo guardar: ${error.message}`);
  }

  recoveryScreenActive = false;
  cleanAuthUrl();
  await client.auth.signOut();
  renderLogin('Contraseña actualizada. Ya podés ingresar.', true);
}

async function loadApp(userId) {
  if (recoveryScreenActive) return;

  app.innerHTML = `
    <div class="loading-card">
      <div class="spinner" aria-hidden="true"></div>
      <h1 class="title">Cargando tus horas…</h1>
    </div>
  `;

  const { data: userProfile, error: profileError } = await client
    .from('usuarios')
    .select('id,nombre,email,rol,activo')
    .eq('id', userId)
    .single();

  if (profileError || !userProfile) {
    await client.auth.signOut();
    return renderLogin('La cuenta existe, pero falta crearla en la tabla usuarios.');
  }

  profile = userProfile;

  const start = iso(currentPeriod.start);
  const end = iso(currentPeriod.end);

  const hoursPromise = client
    .from('horas')
    .select('id,usuario_id,fecha,horas')
    .gte('fecha', start)
    .lte('fecha', end);

  const usersPromise = userProfile.rol === 'admin'
    ? client
      .from('usuarios')
      .select('id,nombre,email,rol,activo')
      .eq('activo', true)
      .order('nombre')
    : Promise.resolve({ data: [userProfile], error: null });

  const [hoursResult, usersResult] = await Promise.all([hoursPromise, usersPromise]);

  if (hoursResult.error) {
    return renderLogin(hoursResult.error.message);
  }

  entries = hoursResult.data || [];
  profiles = usersResult.data || [userProfile];
  renderDashboard();
}

function entryMap() {
  return new Map(
    entries.map((entry) => [`${entry.usuario_id}|${entry.fecha}`, Number(entry.horas)])
  );
}

function renderDashboard() {
  const days = daysBetween(currentPeriod.start, currentPeriod.end);
  const map = entryMap();
  const todayIso = iso(new Date());

  const ownTotal = entries
    .filter((entry) => entry.usuario_id === profile.id)
    .reduce((sum, entry) => sum + Number(entry.horas), 0);

  const calendar = days.map((day) => {
    const date = iso(day);
    const value = map.get(`${profile.id}|${date}`);
    const classes = [
      'day',
      value !== undefined ? 'done' : '',
      date === todayIso ? 'today' : ''
    ].filter(Boolean).join(' ');

    return `
      <button class="${classes}" type="button" data-date="${date}"
        aria-label="${day.toLocaleDateString('es-AR')}: ${value !== undefined ? `${value} horas` : 'sin horas cargadas'}">
        <div class="n">${day.getDate()}</div>
        <div class="m">${day.toLocaleDateString('es-AR', { month: 'short' })}</div>
        <div class="h">${value !== undefined ? `${String(value).replace('.', ',')} h` : '—'}</div>
      </button>
    `;
  }).join('');

  app.innerHTML = `
    <header class="dashboard-head">
      <div class="dashboard-brand">
        <img src="/icon-192.png" alt="" />
        <div>
          <div class="dashboard-app-name">Horas Robótica Jovita</div>
          <div class="hello">Hola, ${esc(profile.nombre)}</div>
          <div class="muted">Período ${fmt(currentPeriod.start)} al ${fmt(currentPeriod.end)}</div>
        </div>
      </div>
      <button id="logout" class="btn btn-danger" type="button">Salir</button>
    </header>

    <section class="summary">
      <div>
        <div class="summary-label"><span aria-hidden="true">⏱️</span> Mis horas</div>
        <strong>${ownTotal.toLocaleString('es-AR')} h</strong>
        <div class="summary-period">Total acumulado del período actual</div>
      </div>
      <img class="summary-art" src="/icon-192.png" alt="" />
    </section>

    <section class="panel">
      <div class="panel-head">
        <div>
          <h2 class="section">Cargá tus horas</h2>
          <p class="section-note">Tocá el día y escribí solamente la cantidad de horas trabajadas.</p>
        </div>
      </div>
      <div class="grid">${calendar}</div>
    </section>

    ${profile.rol === 'admin' ? renderAdminTable(days, map) : ''}
  `;

  document.querySelectorAll('.day').forEach((button) => {
    button.onclick = () => {
      openHoursModal(button.dataset.date, map.get(`${profile.id}|${button.dataset.date}`));
    };
  });

  document.getElementById('logout').onclick = async () => {
    await client.auth.signOut();
    profile = null;
    renderLogin();
  };

  const excelButton = document.getElementById('exportExcel');
  if (excelButton) excelButton.onclick = exportExcel;
}

function renderAdminTable(days, map) {
  const header = days.map((day) => `<th>${day.getDate()}</th>`).join('');

  const rows = profiles.map((person) => {
    let total = 0;
    const cells = days.map((day) => {
      const value = map.get(`${person.id}|${iso(day)}`);
      total += Number(value || 0);
      return `<td>${value !== undefined ? String(value).replace('.', ',') : ''}</td>`;
    }).join('');

    return `
      <tr>
        <td>${esc(person.nombre)}</td>
        ${cells}
        <td><b>${total.toLocaleString('es-AR')}</b></td>
      </tr>
    `;
  }).join('');

  const fixedMonthlyRow = `
    <tr class="monthly-row">
      <td>${esc(FILA_MENSUAL_FIJA.nombre)}</td>
      ${days.map(() => '<td></td>').join('')}
      <td><b>${esc(FILA_MENSUAL_FIJA.texto)}</b></td>
    </tr>
  `;

  return `
    <section class="panel">
      <div class="panel-head">
        <div>
          <h2 class="section">Planilla completa</h2>
          <p class="section-note">Solo Ana puede ver esta tabla con todas las compañeras.</p>
        </div>
        <div class="toolbar">
          <button id="exportExcel" class="btn btn-secondary" type="button">
            📊 Descargar Excel
          </button>
        </div>
      </div>

      <div class="table-box">
        <table class="hours-table">
          <thead>
            <tr>
              <th>Nombre</th>
              ${header}
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
            ${fixedMonthlyRow}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function openHoursModal(date, value) {
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = `
    <div class="modal-card" role="dialog" aria-modal="true">
      <h2>Horas del ${date.split('-').reverse().join('/')}</h2>
      <p>Elegí una opción rápida o escribí otra cantidad, por ejemplo 2,5.</p>

      <div class="quick">
        ${[1, 2, 3, 4].map((hours) => `
          <button type="button" data-hours="${hours}">${hours} h</button>
        `).join('')}
      </div>

      <label class="label" for="hoursInput">Cantidad de horas</label>
      <input id="hoursInput" class="field" inputmode="decimal"
        placeholder="Ejemplo: 3,5"
        value="${value !== undefined ? String(value).replace('.', ',') : ''}" />

      <button id="saveHours" class="btn btn-primary" type="button">GUARDAR</button>
      <button id="cancelHours" class="btn btn-soft" type="button">Cancelar</button>
    </div>
  `;

  document.body.appendChild(modal);

  modal.querySelectorAll('[data-hours]').forEach((button) => {
    button.onclick = () => {
      document.getElementById('hoursInput').value = button.dataset.hours;
    };
  });

  document.getElementById('cancelHours').onclick = () => modal.remove();

  document.getElementById('saveHours').onclick = async () => {
    const raw = document.getElementById('hoursInput').value.replace(',', '.');
    const valueToSave = Number(raw);

    if (!Number.isFinite(valueToSave) || valueToSave < 0 || valueToSave > 24) {
      alert('Escribí una cantidad entre 0 y 24.');
      return;
    }

    const { error } = await client
      .from('horas')
      .upsert(
        { usuario_id: profile.id, fecha: date, horas: valueToSave },
        { onConflict: 'usuario_id,fecha' }
      );

    if (error) {
      alert(error.message);
      return;
    }

    modal.remove();
    await loadApp(profile.id);
  };
}

function exportExcel() {
  const days = daysBetween(currentPeriod.start, currentPeriod.end);
  const map = entryMap();

  const data = profiles.map((person) => {
    const row = { Nombre: person.nombre };
    let total = 0;

    days.forEach((day) => {
      const value = map.get(`${person.id}|${iso(day)}`);
      row[`${day.getDate()}/${day.getMonth() + 1}`] = value ?? '';
      total += Number(value || 0);
    });

    row.Total = total;
    return row;
  });

  const fixedMonthlyRow = { Nombre: FILA_MENSUAL_FIJA.nombre };
  days.forEach((day) => {
    fixedMonthlyRow[`${day.getDate()}/${day.getMonth() + 1}`] = '';
  });
  fixedMonthlyRow.Total = FILA_MENSUAL_FIJA.texto;
  data.push(fixedMonthlyRow);

  const worksheet = XLSX.utils.json_to_sheet(data);
  worksheet['!freeze'] = { xSplit: 1, ySplit: 1 };
  worksheet['!cols'] = [
    { wch: 24 },
    ...days.map(() => ({ wch: 7 })),
    { wch: 16 }
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Horas');

  XLSX.writeFile(
    workbook,
    `Horas_${iso(currentPeriod.start)}_al_${iso(currentPeriod.end)}.xlsx`
  );
}

init();
