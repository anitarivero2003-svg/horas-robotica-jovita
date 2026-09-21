import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { GET as syncStaffHoursFromRobotica } from "@/app/api/admin/staff-hours/sync/route";

type StaffHour = {
  id: string;
  staff_name: string;
  work_date: string;
  total_hours: number | string;
  notes: string | null;
  status: "confirmed" | "pending_review";
};

function formatDate(date: string) {
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(`${date}T12:00:00`));
}

function getCurrentPeriod() {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const day = today.getDate();

  const start =
    day >= 21
      ? new Date(year, month, 21)
      : new Date(year, month - 1, 21);

  const end = new Date(
    start.getFullYear(),
    start.getMonth() + 1,
    20,
  );

  return { start, end };
}

function toDateOnly(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function periodForWorkDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  const reference = new Date(year, month - 1, day);
  const start =
    day >= 21
      ? new Date(reference.getFullYear(), reference.getMonth(), 21)
      : new Date(reference.getFullYear(), reference.getMonth() - 1, 21);
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 20);
  return { start: toDateOnly(start), end: toDateOnly(end) };
}

type StaffHoursPageProps = {
  searchParams: Promise<{ period?: string }>;
};

export default async function StaffHoursPage({ searchParams }: StaffHoursPageProps) {
  const params = await searchParams;
  const admin = createAdminClient();

  let syncMessage = "";
  let syncError = "";
  try {
    const syncResponse = await syncStaffHoursFromRobotica();
    const syncResult = await syncResponse.json();
    if (syncResponse.ok && syncResult?.ok) {
      syncMessage = `Horas sincronizadas: ${Number(syncResult.hoursRead ?? 0)} registros leídos desde Horas Robótica Jovita.`;
    } else {
      syncError = String(syncResult?.error ?? "No se pudo sincronizar Horas Robótica Jovita.");
    }
  } catch (error) {
    syncError = error instanceof Error ? error.message : "No se pudo sincronizar Horas Robótica Jovita.";
  }

  const { data, error } = await admin
    .from("staff_hours")
    .select("id, staff_name, work_date, total_hours, notes, status")
    .order("work_date", { ascending: false });

  const records = (data ?? []) as StaffHour[];

  const actualPeriod = getCurrentPeriod();
  const actualPeriodStart = toDateOnly(actualPeriod.start);
  const actualPeriodEnd = toDateOnly(actualPeriod.end);

  const requestedPeriod =
    typeof params.period === "string" && /^\d{4}-\d{2}-21$/.test(params.period)
      ? params.period
      : null;

  let periodStart = actualPeriodStart;
  let periodEnd = actualPeriodEnd;

  if (requestedPeriod) {
    const [year, month] = requestedPeriod.split("-").map(Number);
    const selectedStart = new Date(year, month - 1, 21);
    const selectedEnd = new Date(year, month, 20);
    periodStart = toDateOnly(selectedStart);
    periodEnd = toDateOnly(selectedEnd);
  }

  const [shownYear, shownMonth] = periodStart.split("-").map(Number);
  const previousPeriodStart = toDateOnly(
    new Date(shownYear, shownMonth - 2, 21),
  );
  const nextPeriodStart = toDateOnly(
    new Date(shownYear, shownMonth, 21),
  );
  const isCurrentPeriod = periodStart === actualPeriodStart;
  const canGoNext = nextPeriodStart <= actualPeriodStart;

  const periodRecords = records.filter(
    (record) => record.work_date >= periodStart && record.work_date <= periodEnd,
  );

  const totalHours = periodRecords.reduce(
    (total, record) => total + Number(record.total_hours || 0),
    0,
  );
  const totalDays = periodRecords.length;
  const pendingRecords = periodRecords.filter(
    (record) => record.status === "pending_review",
  ).length;

  const hoursByStaff = periodRecords.reduce(
    (summary, record) => {
      const name = record.staff_name.trim();
      if (!summary[name]) {
        summary[name] = { hours: 0, days: 0, pending: 0 };
      }
      summary[name].hours += Number(record.total_hours || 0);
      summary[name].days += 1;
      if (record.status === "pending_review") summary[name].pending += 1;
      return summary;
    },
    {} as Record<string, { hours: number; days: number; pending: number }>,
  );

  const staffSummaries = Object.entries(hoursByStaff).sort(([a], [b]) =>
    a.localeCompare(b, "es"),
  );

  const monthlyHistory = Array.from(
    records.reduce((map, record) => {
      const period = periodForWorkDate(record.work_date);
      const key = period.start;
      const existing = map.get(key) ?? {
        start: period.start,
        end: period.end,
        hours: 0,
        days: 0,
        people: new Map<string, number>(),
      };
      existing.hours += Number(record.total_hours || 0);
      existing.days += 1;
      const name = record.staff_name.trim();
      existing.people.set(
        name,
        (existing.people.get(name) ?? 0) + Number(record.total_hours || 0),
      );
      map.set(key, existing);
      return map;
    }, new Map<string, { start: string; end: string; hours: number; days: number; people: Map<string, number> }>()),
  )
    .map(([, value]) => value)
    .sort((a, b) => b.start.localeCompare(a.start));

  async function createStaffHour(formData: FormData) {
    "use server";
    const staffName = String(formData.get("staff_name") ?? "").trim();
    const workDate = String(formData.get("work_date") ?? "").trim();
    const totalHours = Number(formData.get("total_hours") ?? 0);
    const notes = String(formData.get("notes") ?? "").trim();
    const status = String(formData.get("status") ?? "confirmed");
    if (!staffName || !workDate || totalHours <= 0) return;

    const admin = createAdminClient();
    await admin.from("staff_hours").insert({
      staff_name: staffName,
      work_date: workDate,
      total_hours: totalHours,
      notes: notes || null,
      status: status === "pending_review" ? "pending_review" : "confirmed",
    });
    revalidatePath("/admin/staff-hours");
  }

  async function updateStaffHour(formData: FormData) {
    "use server";
    const id = String(formData.get("id") ?? "");
    const staffName = String(formData.get("staff_name") ?? "").trim();
    const workDate = String(formData.get("work_date") ?? "").trim();
    const totalHours = Number(formData.get("total_hours") ?? 0);
    const notes = String(formData.get("notes") ?? "").trim();
    const status = String(formData.get("status") ?? "confirmed");
    if (!id || !staffName || !workDate || totalHours <= 0) return;

    const admin = createAdminClient();
    await admin
      .from("staff_hours")
      .update({
        staff_name: staffName,
        work_date: workDate,
        total_hours: totalHours,
        notes: notes || null,
        status: status === "pending_review" ? "pending_review" : "confirmed",
      })
      .eq("id", id);
    revalidatePath("/admin/staff-hours");
  }

  async function deleteStaffHour(formData: FormData) {
    "use server";
    const id = String(formData.get("id") ?? "");
    if (!id) return;
    const admin = createAdminClient();
    await admin.from("staff_hours").delete().eq("id", id);
    revalidatePath("/admin/staff-hours");
  }

  return (
    <main className="page-shell">
      <section className="panel">
        <p className="eyebrow gold">PERSONAL</p>
        <h1>Horas del personal</h1>
        <p>Registrá los días y las horas trabajadas por cada seño. Todos los datos se pueden corregir posteriormente.</p>
        <p>Período mostrado: <strong>{formatDate(periodStart)} al {formatDate(periodEnd)}</strong></p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", marginTop: "12px", marginBottom: "10px" }}>
          <a
            href={`/admin/staff-hours?period=${previousPeriodStart}`}
            className="button"
            style={{ textDecoration: "none" }}
          >
            ← Período anterior
          </a>
          {canGoNext ? (
            <a
              href={nextPeriodStart === actualPeriodStart ? "/admin/staff-hours" : `/admin/staff-hours?period=${nextPeriodStart}`}
              className="button"
              style={{ textDecoration: "none" }}
            >
              Período siguiente →
            </a>
          ) : null}
          {!isCurrentPeriod ? (
            <a
              href="/admin/staff-hours"
              className="button button-primary"
              style={{ textDecoration: "none" }}
            >
              Ir al período actual
            </a>
          ) : null}
        </div>
        {syncMessage ? <p style={{ color: "#18794e", fontWeight: 700 }}>{syncMessage}</p> : null}
        {syncError ? <p style={{ color: "#b42318", fontWeight: 700 }}>La sincronización automática no pudo completarse: {syncError}</p> : null}
      </section>

      <section className="panel" style={{ marginTop: "24px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "16px" }}>
        <div><p className="eyebrow gold">REGISTROS</p><h2>{totalDays}</h2><p>Días registrados en el período</p></div>
        <div><p className="eyebrow gold">HORAS</p><h2>{totalHours.toFixed(2)}</h2><p>Horas acumuladas en el período</p></div>
        <div><p className="eyebrow gold">REVISAR</p><h2>{pendingRecords}</h2><p>Registros pendientes</p></div>
      </section>

      <section className="panel" style={{ marginTop: "24px" }}>
        <p className="eyebrow gold">RESUMEN INDIVIDUAL</p>
        <h2>Horas por cada seño</h2>
        {staffSummaries.length === 0 ? <p>Todavía no hay horas registradas en este período.</p> : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "16px", marginTop: "20px" }}>
            {staffSummaries.map(([name, summary]) => (
              <article key={name} className="panel">
                <h3>{name}</h3>
                <p>Horas acumuladas: <strong>{summary.hours.toFixed(2)}</strong></p>
                <p>Días registrados: <strong>{summary.days}</strong></p>
                <p>Pendientes de revisar: <strong>{summary.pending}</strong></p>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="panel" style={{ marginTop: "24px" }}>
        <p className="eyebrow gold">HISTORIAL MENSUAL</p>
        <h2>Períodos guardados del 21 al 20</h2>
        <p>Los períodos anteriores quedan registrados y no desaparecen cuando comienza un mes nuevo.</p>
        {monthlyHistory.length === 0 ? (
          <p>Todavía no hay períodos con horas registradas.</p>
        ) : (
          <div style={{ display: "grid", gap: "12px", marginTop: "18px" }}>
            {monthlyHistory.map((period) => (
              <details key={period.start} className="panel">
                <summary style={{ cursor: "pointer", fontWeight: 800 }}>
                  {formatDate(period.start)} al {formatDate(period.end)} · {period.hours.toFixed(2)} horas
                </summary>
                <div style={{ marginTop: "14px", display: "grid", gap: "6px" }}>
                  <p>Jornadas registradas: <strong>{period.days}</strong></p>
                  {Array.from(period.people.entries())
                    .sort(([a], [b]) => a.localeCompare(b, "es"))
                    .map(([name, hours]) => (
                      <p key={name}>{name}: <strong>{hours.toFixed(2)} h</strong></p>
                    ))}
                </div>
              </details>
            ))}
          </div>
        )}
      </section>

      <section className="panel" style={{ marginTop: "24px" }}>
        <p className="eyebrow gold">NUEVA JORNADA</p>
        <h2>Registrar horas</h2>
        <form action={createStaffHour} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "16px", marginTop: "20px" }}>
          <label>Nombre de la seño<input type="text" name="staff_name" required placeholder="Ejemplo: María López" /></label>
          <label>Fecha trabajada<input type="date" name="work_date" required /></label>
          <label>Cantidad de horas<input type="number" name="total_hours" required min="0.25" step="0.25" placeholder="Ejemplo: 3" /></label>
          <label>Estado<select name="status" defaultValue="confirmed"><option value="confirmed">Confirmado</option><option value="pending_review">Pendiente de revisar</option></select></label>
          <label style={{ gridColumn: "1 / -1" }}>Observaciones<textarea name="notes" rows={3} placeholder="Información opcional" /></label>
          <div style={{ gridColumn: "1 / -1" }}><button type="submit" className="button button-primary">Guardar jornada</button></div>
        </form>
      </section>

      <section className="panel" style={{ marginTop: "24px" }}>
        <p className="eyebrow gold">HISTORIAL</p>
        <h2>Jornadas del período mostrado</h2>
        {error ? <p>No se pudieron cargar las horas del personal.</p> : periodRecords.length === 0 ? <p>Todavía no hay jornadas registradas en este período.</p> : (
          <div style={{ display: "grid", gap: "16px", marginTop: "20px" }}>
            {periodRecords.map((record) => (
              <article key={record.id} className="panel" style={{ border: record.status === "pending_review" ? "1px solid #efb323" : undefined }}>
                <div>
                  <h3>{record.staff_name}</h3>
                  <p>Fecha: <strong>{formatDate(record.work_date)}</strong></p>
                  <p>Horas trabajadas: <strong>{Number(record.total_hours)}</strong></p>
                  <p>Estado: <strong>{record.status === "confirmed" ? "Confirmado" : "Pendiente de revisar"}</strong></p>
                  {record.notes ? <p>Observaciones: {record.notes}</p> : null}
                </div>

                <details style={{ marginTop: "16px" }}>
                  <summary style={{ cursor: "pointer", fontWeight: 700 }}>Editar registro</summary>
                  <form action={updateStaffHour} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "14px", marginTop: "18px" }}>
                    <input type="hidden" name="id" value={record.id} />
                    <label>Nombre<input type="text" name="staff_name" required defaultValue={record.staff_name} /></label>
                    <label>Fecha<input type="date" name="work_date" required defaultValue={record.work_date} /></label>
                    <label>Horas<input type="number" name="total_hours" required min="0.25" step="0.25" defaultValue={Number(record.total_hours)} /></label>
                    <label>Estado<select name="status" defaultValue={record.status}><option value="confirmed">Confirmado</option><option value="pending_review">Pendiente de revisar</option></select></label>
                    <label style={{ gridColumn: "1 / -1" }}>Observaciones<textarea name="notes" rows={3} defaultValue={record.notes ?? ""} /></label>
                    <div style={{ gridColumn: "1 / -1" }}><button type="submit" className="button button-primary">Guardar correcciones</button></div>
                  </form>
                </details>

                <form action={deleteStaffHour} style={{ marginTop: "14px" }}>
                  <input type="hidden" name="id" value={record.id} />
                  <button type="submit" className="button button-secondary">Eliminar registro</button>
                </form>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
