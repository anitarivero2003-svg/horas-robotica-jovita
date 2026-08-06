# Código completo — actualización PWA de Horas Robótica Jovita

## `index.html`

```html
<!doctype html>
<html lang="es-AR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />

  <title>Horas Robótica Jovita</title>
  <meta name="description" content="Registro privado de horas trabajadas de la Escuela de Robótica Jovita." />
  <meta name="application-name" content="Horas Robótica Jovita" />
  <meta name="theme-color" content="#7c3aed" />
  <meta name="background-color" content="#ffffff" />
  <meta name="color-scheme" content="light" />
  <meta name="format-detection" content="telephone=no" />

  <!-- Integración como aplicación en Android y navegadores Chromium. -->
  <meta name="mobile-web-app-capable" content="yes" />

  <!-- Compatibilidad de instalación en iPhone/iPad. -->
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="default" />
  <meta name="apple-mobile-web-app-title" content="Horas Jovita" />

  <link rel="manifest" href="/manifest.webmanifest" />
  <link rel="icon" href="/icon-192.png" sizes="192x192" type="image/png" />
  <link rel="icon" href="/icon-512.png" sizes="512x512" type="image/png" />
  <link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180" />

  <link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin />
  <link rel="stylesheet" href="/styles.css" />
</head>
<body>
  <main id="app" class="app-shell"></main>

  <!-- Solo se muestra cuando Chrome confirma que la PWA puede instalarse. -->
  <button id="installAppButton" class="install-fab" type="button" hidden>
    <span aria-hidden="true">📲</span>
    <span>INSTALAR APLICACIÓN</span>
  </button>

  <div id="networkNotice" class="network-notice" role="status" hidden>
    Sin conexión. Podés abrir la app, pero necesitás internet para guardar horas.
  </div>

  <noscript>Necesitás activar JavaScript para usar Horas Robótica Jovita.</noscript>

  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
  <script src="/config.js"></script>
  <script src="/app.js"></script>
</body>
</html>
```

## `app.js`

```javascript
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

function updateInstallButton() {
  if (!installButton) return;

  // El botón aparece únicamente cuando Chrome entrega el evento nativo de instalación.
  installButton.hidden = isStandalone() || !deferredInstallPrompt;
  installButton.disabled = false;
}

async function requestInstall() {
  if (!deferredInstallPrompt || isStandalone()) {
    updateInstallButton();
    return;
  }

  installButton.disabled = true;
  deferredInstallPrompt.prompt();

  try {
    await deferredInstallPrompt.userChoice;
  } finally {
    deferredInstallPrompt = null;
    updateInstallButton();
  }
}

function updateNetworkNotice() {
  if (!networkNotice) return;
  networkNotice.hidden = window.navigator.onLine;
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;

  try {
    const registration = await navigator.serviceWorker.register('/sw.js', {
      scope: '/',
      updateViaCache: 'none'
    });

    await navigator.serviceWorker.ready;
    registration.update().catch(() => {});
    return registration;
  } catch (error) {
    console.warn('No se pudo registrar el service worker:', error);
    return null;
  }
}

window.addEventListener('beforeinstallprompt', (event) => {
  // Evita el aviso automático y habilita nuestro botón solo cuando la app es instalable.
  event.preventDefault();
  deferredInstallPrompt = event;
  updateInstallButton();
});

window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  updateInstallButton();
});

window.matchMedia('(display-mode: standalone)').addEventListener?.('change', updateInstallButton);
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
  const hasSavedHours = value !== undefined;
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = `
    <div class="modal-card" role="dialog" aria-modal="true">
      <h2>Horas del ${date.split('-').reverse().join('/')}</h2>
      <p>${hasSavedHours
        ? 'Podés corregir la cantidad o borrar este registro si elegiste mal el día.'
        : 'Elegí una opción rápida o escribí otra cantidad, por ejemplo 2,5.'}</p>

      <div class="quick">
        ${[1, 2, 3, 4].map((hours) => `
          <button type="button" data-hours="${hours}">${hours} h</button>
        `).join('')}
      </div>

      <label class="label" for="hoursInput">Cantidad de horas</label>
      <input id="hoursInput" class="field" inputmode="decimal"
        placeholder="Ejemplo: 3,5"
        value="${hasSavedHours ? String(value).replace('.', ',') : ''}" />

      <button id="saveHours" class="btn btn-primary" type="button">
        ${hasSavedHours ? 'GUARDAR CAMBIO' : 'GUARDAR'}
      </button>
      ${hasSavedHours ? `
        <button id="deleteHours" class="btn btn-danger" type="button"
          style="width:100%;margin-top:10px;">
          BORRAR HORAS DE ESTE DÍA
        </button>
      ` : ''}
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

  const deleteButton = document.getElementById('deleteHours');
  if (deleteButton) {
    deleteButton.onclick = async () => {
      const confirmed = window.confirm(
        `¿Borrar las horas cargadas del ${date.split('-').reverse().join('/')}?`
      );

      if (!confirmed) return;

      deleteButton.disabled = true;
      deleteButton.textContent = 'BORRANDO…';

      const { error } = await client
        .from('horas')
        .delete()
        .eq('usuario_id', profile.id)
        .eq('fecha', date);

      if (error) {
        deleteButton.disabled = false;
        deleteButton.textContent = 'BORRAR HORAS DE ESTE DÍA';
        alert(`No se pudo borrar: ${error.message}`);
        return;
      }

      modal.remove();
      await loadApp(profile.id);
    };
  }

  document.getElementById('saveHours').onclick = async () => {
    const raw = document.getElementById('hoursInput').value.trim().replace(',', '.');
    const valueToSave = Number(raw);

    if (!raw || !Number.isFinite(valueToSave) || valueToSave <= 0 || valueToSave > 24) {
      alert('Escribí una cantidad mayor que 0 y hasta 24 horas. Para borrar, usá el botón rojo.');
      return;
    }

    const saveButton = document.getElementById('saveHours');
    saveButton.disabled = true;
    saveButton.textContent = 'GUARDANDO…';

    const { error } = await client
      .from('horas')
      .upsert(
        { usuario_id: profile.id, fecha: date, horas: valueToSave },
        { onConflict: 'usuario_id,fecha' }
      );

    if (error) {
      saveButton.disabled = false;
      saveButton.textContent = hasSavedHours ? 'GUARDAR CAMBIO' : 'GUARDAR';
      alert(error.message);
      return;
    }

    modal.remove();
    await loadApp(profile.id);
  };
}

let xlsxLoaderPromise = null;

function loadXlsxLibrary() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (xlsxLoaderPromise) return xlsxLoaderPromise;

  xlsxLoaderPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    script.async = true;
    script.onload = () => resolve(window.XLSX);
    script.onerror = () => reject(new Error('No se pudo cargar el generador de Excel. Revisá la conexión.'));
    document.head.appendChild(script);
  });

  return xlsxLoaderPromise;
}

async function exportExcel() {
  const button = document.getElementById('exportExcel');
  const originalText = button?.innerHTML;

  if (button) {
    button.disabled = true;
    button.textContent = 'PREPARANDO EXCEL…';
  }

  try {
    await loadXlsxLibrary();
  } catch (error) {
    if (button) {
      button.disabled = false;
      button.innerHTML = originalText || '📊 Descargar Excel';
    }
    alert(error.message);
    return;
  }

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

  if (button) {
    button.disabled = false;
    button.innerHTML = originalText || '📊 Descargar Excel';
  }
}

init();
```

## `manifest.webmanifest`

```json
{
  "id": "/",
  "name": "Horas Robótica Jovita",
  "short_name": "Horas Jovita",
  "description": "Registro privado de horas trabajadas de la Escuela de Robótica Jovita.",
  "lang": "es-AR",
  "dir": "ltr",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "theme_color": "#7c3aed",
  "background_color": "#ffffff",
  "prefer_related_applications": false,
  "categories": [
    "business",
    "productivity",
    "education"
  ],
  "icons": [
    {
      "src": "/icon-192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any"
    },
    {
      "src": "/icon-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any"
    },
    {
      "src": "/icon-maskable-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "maskable"
    }
  ]
}
```

## `sw.js`

```javascript
const CACHE_VERSION = 'horas-robotica-jovita-v12';

const APP_SHELL = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/config.js',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-512.png',
  '/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key !== CACHE_VERSION)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Los datos de Supabase y otros servicios externos siempre continúan por red.
  if (url.origin !== self.location.origin) return;

  // Para navegación usamos red primero y la portada en caché como respaldo.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put('/index.html', copy));
          }
          return response;
        })
        .catch(async () => (
          (await caches.match('/index.html')) ||
          (await caches.match('/')) ||
          Response.error()
        ))
    );
    return;
  }

  // Archivos estáticos: respuesta rápida desde caché y actualización en segundo plano.
  event.respondWith((async () => {
    const cachedResponse = await caches.match(request);
    const networkRequest = fetch(request)
      .then(async (response) => {
        if (response.ok) {
          const cache = await caches.open(CACHE_VERSION);
          await cache.put(request, response.clone());
        }
        return response;
      })
      .catch(() => null);

    if (cachedResponse) {
      event.waitUntil(networkRequest);
      return cachedResponse;
    }

    return (await networkRequest) || Response.error();
  })());
});
```

## `vercel.json`

```json
{
  "cleanUrls": true,
  "trailingSlash": false,
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        {
          "key": "X-Content-Type-Options",
          "value": "nosniff"
        },
        {
          "key": "Referrer-Policy",
          "value": "strict-origin-when-cross-origin"
        }
      ]
    },
    {
      "source": "/",
      "headers": [
        {
          "key": "Cache-Control",
          "value": "public, max-age=0, must-revalidate"
        }
      ]
    },
    {
      "source": "/index.html",
      "headers": [
        {
          "key": "Cache-Control",
          "value": "public, max-age=0, must-revalidate"
        }
      ]
    },
    {
      "source": "/app.js",
      "headers": [
        {
          "key": "Content-Type",
          "value": "application/javascript; charset=utf-8"
        },
        {
          "key": "Cache-Control",
          "value": "public, max-age=0, must-revalidate"
        }
      ]
    },
    {
      "source": "/styles.css",
      "headers": [
        {
          "key": "Content-Type",
          "value": "text/css; charset=utf-8"
        },
        {
          "key": "Cache-Control",
          "value": "public, max-age=0, must-revalidate"
        }
      ]
    },
    {
      "source": "/config.js",
      "headers": [
        {
          "key": "Content-Type",
          "value": "application/javascript; charset=utf-8"
        },
        {
          "key": "Cache-Control",
          "value": "public, max-age=0, must-revalidate"
        }
      ]
    },
    {
      "source": "/sw.js",
      "headers": [
        {
          "key": "Content-Type",
          "value": "application/javascript; charset=utf-8"
        },
        {
          "key": "Cache-Control",
          "value": "public, max-age=0, must-revalidate"
        },
        {
          "key": "Service-Worker-Allowed",
          "value": "/"
        }
      ]
    },
    {
      "source": "/manifest.webmanifest",
      "headers": [
        {
          "key": "Content-Type",
          "value": "application/manifest+json; charset=utf-8"
        },
        {
          "key": "Cache-Control",
          "value": "public, max-age=0, must-revalidate"
        }
      ]
    }
  ]
}
```
