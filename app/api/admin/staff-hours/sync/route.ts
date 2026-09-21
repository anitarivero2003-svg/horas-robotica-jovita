import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SOURCE_SYSTEM = "horas_robotica_jovita";
const PAGE_SIZE = 1000;

type SourceUser = {
  id: string;
  nombre: string;
  email?: string | null;
  rol?: string | null;
  activo?: boolean | null;
};

type SourceHour = {
  id: number | string;
  usuario_id: string;
  fecha: string;
  horas: number | string;
};

type DestinationHour = {
  id: string;
  staff_name: string;
  work_date: string;
  total_hours: number | string;
  notes?: string | null;
  status?: string | null;
  source_system?: string | null;
  source_entry_id?: string | null;
  source_user_id?: string | null;
};

function normalizeName(value: string) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function titleCase(value: string) {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/(^|\s)\p{L}/gu, (letter) => letter.toUpperCase());
}

function canonicalStaffName(value: string) {
  const key = normalizeName(value);

  const aliases: Record<string, string> = {
    "ana bazan": "Ana Bazan",
    "anabella martinez": "Anabella Martinez",
    "anabella s martinez": "Anabella Martinez",
    "catalina leon": "Catalina Leon",
    "martinez lorena": "Martinez Lorena",
    "lorena martinez": "Martinez Lorena",
    "sathya torres": "Sathya Torres",
  };

  return aliases[key] ?? titleCase(value);
}

function personDayKey(name: string, date: string) {
  return `${normalizeName(canonicalStaffName(name))}|${String(date ?? "").trim()}`;
}

async function fetchAllRows<T>(
  client: any,
  table: string,
  columns: string,
): Promise<{ rows: T[]; error?: string }> {
  const rows: T[] = [];

  for (let start = 0; ; start += PAGE_SIZE) {
    const { data, error } = await client
      .from(table)
      .select(columns)
      .range(start, start + PAGE_SIZE - 1);

    if (error) {
      return { rows: [], error: error.message };
    }

    const page = (data ?? []) as T[];
    rows.push(...page);

    if (page.length < PAGE_SIZE) break;
  }

  return { rows };
}

export async function GET() {
  const actor = await requireRole(["admin"]);

  const sourceUrl = process.env.HOURS_SUPABASE_URL;
  const sourceSecret = process.env.HOURS_SUPABASE_SECRET_KEY;

  if (!sourceUrl || !sourceSecret) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Faltan HOURS_SUPABASE_URL o HOURS_SUPABASE_SECRET_KEY en Vercel.",
      },
      { status: 500 },
    );
  }

  const source: any = createClient(sourceUrl, sourceSecret, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });

  const destination: any = createAdminClient();

  const [usersResult, hoursResult] = await Promise.all([
    fetchAllRows<SourceUser>(
      source,
      "usuarios",
      "id,nombre,email,rol,activo",
    ),
    fetchAllRows<SourceHour>(
      source,
      "horas",
      "id,usuario_id,fecha,horas",
    ),
  ]);

  if (usersResult.error || hoursResult.error) {
    return NextResponse.json(
      {
        ok: false,
        error: usersResult.error || hoursResult.error,
      },
      { status: 500 },
    );
  }

  const { data: destinationData, error: destinationReadError } =
    await destination
      .from("staff_hours")
      .select(
        "id,staff_name,work_date,total_hours,notes,status,source_system,source_entry_id,source_user_id",
      )
      .order("work_date", { ascending: true });

  if (destinationReadError) {
    return NextResponse.json(
      {
        ok: false,
        error: `No se pudo leer staff_hours: ${destinationReadError.message}`,
      },
      { status: 500 },
    );
  }

  let destinationRows = (destinationData ?? []) as DestinationHour[];

  /*
   * PRIMERA LIMPIEZA:
   * unifica mayúsculas, minúsculas y los nombres que sabemos que
   * corresponden a la misma persona.
   */
  let namesNormalized = 0;

  for (const row of destinationRows) {
    const canonical = canonicalStaffName(row.staff_name);

    if (canonical && canonical !== row.staff_name) {
      const { error: renameError } = await destination
        .from("staff_hours")
        .update({ staff_name: canonical })
        .eq("id", row.id);

      if (renameError) {
        return NextResponse.json(
          {
            ok: false,
            error: `No se pudo unificar un nombre: ${renameError.message}`,
          },
          { status: 500 },
        );
      }

      row.staff_name = canonical;
      namesNormalized += 1;
    }
  }

  const usersById = new Map(
    usersResult.rows.map((user) => [String(user.id), user]),
  );

  const sourceIds = new Set<string>();

  let created = 0;
  let updated = 0;
  let adoptedExisting = 0;
  let deletedBecauseMissingAtSource = 0;
  let duplicatesRemoved = 0;
  let skipped = 0;

  /*
   * SINCRONIZACIÓN:
   * la app Horas Robótica Jovita es la fuente de verdad.
   */
  for (const hour of hoursResult.rows) {
    const sourceEntryId = String(hour.id);
    const sourceUserId = String(hour.usuario_id);
    const user = usersById.get(sourceUserId);

    const staffName = canonicalStaffName(String(user?.nombre ?? ""));
    const workDate = String(hour.fecha ?? "").trim();
    const totalHours = Number(hour.horas);

    sourceIds.add(sourceEntryId);

    if (
      !staffName ||
      !workDate ||
      !Number.isFinite(totalHours) ||
      totalHours <= 0
    ) {
      skipped += 1;
      continue;
    }

    const syncRow = {
      staff_name: staffName,
      work_date: workDate,
      total_hours: totalHours,
      notes: "Sincronizado desde Horas Robótica Jovita",
      status: "confirmed",
      source_system: SOURCE_SYSTEM,
      source_entry_id: sourceEntryId,
      source_user_id: sourceUserId,
      synced_at: new Date().toISOString(),
    };

    /*
     * Si ese registro de origen ya está vinculado, se actualiza.
     */
    const existingSynced = destinationRows.find(
      (row) =>
        row.source_system === SOURCE_SYSTEM &&
        String(row.source_entry_id ?? "") === sourceEntryId,
    );

    if (existingSynced) {
      const { error: updateError } = await destination
        .from("staff_hours")
        .update(syncRow)
        .eq("id", existingSynced.id);

      if (updateError) {
        return NextResponse.json(
          {
            ok: false,
            error: `No se pudo actualizar una hora: ${updateError.message}`,
          },
          { status: 500 },
        );
      }

      Object.assign(existingSynced, syncRow);
      updated += 1;
      continue;
    }

    /*
     * Si había una hora manual de la misma persona y fecha,
     * la adopta en lugar de crear otra.
     */
    const key = personDayKey(staffName, workDate);

    const manualCandidates = destinationRows.filter(
      (row) =>
        !row.source_system &&
        personDayKey(row.staff_name, row.work_date) === key,
    );

    if (manualCandidates.length) {
      const exactHours =
        manualCandidates.find(
          (row) =>
            Math.abs(Number(row.total_hours) - totalHours) < 0.0001,
        ) ?? manualCandidates[0];

      const { error: adoptError } = await destination
        .from("staff_hours")
        .update(syncRow)
        .eq("id", exactHours.id);

      if (adoptError) {
        return NextResponse.json(
          {
            ok: false,
            error: `No se pudo vincular una hora existente: ${adoptError.message}`,
          },
          { status: 500 },
        );
      }

      Object.assign(exactHours, syncRow);
      adoptedExisting += 1;

      /*
       * Si quedaron otras filas manuales de esa misma persona y fecha,
       * son copias de la misma jornada. Se conserva la fila sincronizada.
       */
      const extraManualRows = manualCandidates.filter(
        (row) => row.id !== exactHours.id,
      );

      if (extraManualRows.length) {
        const { error: duplicateDeleteError } = await destination
          .from("staff_hours")
          .delete()
          .in(
            "id",
            extraManualRows.map((row) => row.id),
          );

        if (duplicateDeleteError) {
          return NextResponse.json(
            {
              ok: false,
              error:
                `No se pudieron quitar jornadas duplicadas: ${duplicateDeleteError.message}`,
            },
            { status: 500 },
          );
        }

        const ids = new Set(extraManualRows.map((row) => row.id));
        destinationRows = destinationRows.filter(
          (row) => !ids.has(row.id),
        );
        duplicatesRemoved += extraManualRows.length;
      }

      continue;
    }

    /*
     * Si no existía nada, crea la jornada sincronizada.
     */
    const { data: inserted, error: insertError } = await destination
      .from("staff_hours")
      .insert(syncRow)
      .select(
        "id,staff_name,work_date,total_hours,notes,status,source_system,source_entry_id,source_user_id",
      )
      .single();

    if (insertError || !inserted) {
      return NextResponse.json(
        {
          ok: false,
          error:
            `No se pudo copiar una hora: ${insertError?.message ?? "Error desconocido"}`,
        },
        { status: 500 },
      );
    }

    destinationRows.push(inserted as DestinationHour);
    created += 1;
  }

  /*
   * Si una hora fue borrada en la app original,
   * elimina solamente su copia sincronizada.
   */
  const missingAtSource = destinationRows.filter(
    (row) =>
      row.source_system === SOURCE_SYSTEM &&
      row.source_entry_id &&
      !sourceIds.has(String(row.source_entry_id)),
  );

  if (missingAtSource.length) {
    const { error: deleteMissingError } = await destination
      .from("staff_hours")
      .delete()
      .in(
        "id",
        missingAtSource.map((row) => row.id),
      );

    if (deleteMissingError) {
      return NextResponse.json(
        {
          ok: false,
          error:
            `No se pudieron quitar horas eliminadas en la app original: ${deleteMissingError.message}`,
        },
        { status: 500 },
      );
    }

    const ids = new Set(missingAtSource.map((row) => row.id));
    destinationRows = destinationRows.filter(
      (row) => !ids.has(row.id),
    );
    deletedBecauseMissingAtSource = missingAtSource.length;
  }

  /*
   * LIMPIEZA FINAL DE DUPLICADOS:
   * Si existe una fila sincronizada y además una fila manual con
   * la misma persona y fecha, conserva solamente la sincronizada.
   */
  const syncedKeys = new Set(
    destinationRows
      .filter((row) => row.source_system === SOURCE_SYSTEM)
      .map((row) => personDayKey(row.staff_name, row.work_date)),
  );

  const staleManualDuplicates = destinationRows.filter(
    (row) =>
      !row.source_system &&
      syncedKeys.has(personDayKey(row.staff_name, row.work_date)),
  );

  if (staleManualDuplicates.length) {
    const { error: staleDeleteError } = await destination
      .from("staff_hours")
      .delete()
      .in(
        "id",
        staleManualDuplicates.map((row) => row.id),
      );

    if (staleDeleteError) {
      return NextResponse.json(
        {
          ok: false,
          error:
            `No se pudieron limpiar horas duplicadas antiguas: ${staleDeleteError.message}`,
        },
        { status: 500 },
      );
    }

    duplicatesRemoved += staleManualDuplicates.length;
  }

  await destination.from("audit_logs").insert({
    actor_id: actor.id,
    action: "staff_hours.synced_and_deduplicated",
    entity_type: "staff_hours",
    metadata: {
      source: SOURCE_SYSTEM,
      source_users: usersResult.rows.length,
      source_hours: hoursResult.rows.length,
      created,
      updated,
      adopted_existing: adoptedExisting,
      names_normalized: namesNormalized,
      duplicates_removed: duplicatesRemoved,
      deleted_missing_at_source: deletedBecauseMissingAtSource,
      skipped,
    },
  });


  return NextResponse.json({
    ok: true,
    source: "Horas Robótica Jovita",
    usersRead: usersResult.rows.length,
    hoursRead: hoursResult.rows.length,
    created,
    updated,
    adoptedExisting,
    namesNormalized,
    duplicatesRemoved,
    deleted: deletedBecauseMissingAtSource,
    skipped,
    message:
      "Sincronización terminada. Se unificaron los nombres y se eliminaron las jornadas duplicadas.",
  });
}
