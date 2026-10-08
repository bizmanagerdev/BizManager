import { readyDeviceSaves } from "@/lib/powersync/store";
import {
  changeProjectOnDevice,
  createProjectOnDevice,
  deviceProjectBody,
  updateProjectOnDevice,
  type ProjectChange,
} from "@/lib/powersync/local-writes";
import { projectRowFrom, type ProjectRowFields } from "@/lib/projects/project-input";
import { normalizeVatRate } from "@/lib/settings/vat";

// Saving a project on the phone first (lib/powersync/local-writes.ts): created
// or edited, it's on every page drawn from the device copy — the projects
// list, the project's own page, the dashboard — the moment it's saved, with no
// connection too, and goes to the server in the background (in order after a
// customer made with it). For the people whose project pages are drawn from
// the copy; null for everyone else, who save on the server as before.

type Db = NonNullable<ReturnType<typeof readyDeviceSaves>>["db"];

export type DeviceProjectSaves = {
  /** A new project, from the form's fields: its id and row. */
  create: (fields: Record<string, unknown>) => Promise<{ id: string; row: ProjectRowFields }>;
  /**
   * An edit: the form's fields over the project as the phone has it (what the
   * form doesn't show — its branch, payment terms, due date — stays). Null
   * when the phone doesn't have the project: save on the server.
   */
  update: (id: string, fields: Record<string, unknown>) => Promise<{ row: ProjectRowFields } | null>;
  /**
   * Its status changed, its quote approved, its agreed price set — sent on
   * through that change's own route. False when the phone doesn't have the
   * project: save on the server.
   */
  change: (id: string, change: ProjectChange) => Promise<boolean>;
};

function rowOrThrow(fields: Record<string, unknown>): ProjectRowFields {
  const parsed = projectRowFrom(fields);
  if ("error" in parsed) throw new Error(parsed.error);
  return parsed.row;
}

/** The VAT rate as the copy has it now (the server freezes its own on arrival). */
async function currentVatRate(db: Db): Promise<number> {
  const settings = await db.getOptional<{ vat_rate: unknown }>("SELECT vat_rate FROM business_settings LIMIT 1");
  return normalizeVatRate(settings?.vat_rate);
}

const sameDay = (a: unknown, b: unknown) =>
  (typeof a === "string" ? a.slice(0, 10) : null) === (typeof b === "string" ? b.slice(0, 10) : null);

/** `page`: where the save shows — the projects list, or a project's own page. */
export function deviceProjectSaves(page: "projects" | "projectPage" = "projects"): DeviceProjectSaves | null {
  const ready = readyDeviceSaves(page);
  if (!ready) return null;
  const { db } = ready;
  return {
    async create(fields) {
      const row = rowOrThrow(fields);
      const id = crypto.randomUUID();
      const vatRate = row.price_includes_vat ? await currentVatRate(db) : null;
      await createProjectOnDevice(db, { id, row, vatRate });
      return { id, row };
    },
    async update(id, fields) {
      const stored = await db.getOptional<Record<string, unknown>>("SELECT * FROM projects WHERE id = ?", [id]);
      if (!stored) return null;
      const before = deviceProjectBody(id, stored);
      const merged: Record<string, unknown> = { ...before, ...fields };
      // A form without the due date (the project page's) that moved the start:
      // the due date follows it, by the project's terms.
      if (!("due_date" in fields) && "start_date" in fields && !sameDay(fields.start_date, before.start_date)) {
        merged.due_date = null;
      }
      const row = rowOrThrow(merged);
      // As the server does: a frozen rate stays; the current one when the mode
      // is turned on; none when it's off.
      const frozen = Number(stored.vat_rate);
      const vatRate = row.price_includes_vat
        ? Number.isFinite(frozen) && frozen > 0
          ? frozen
          : await currentVatRate(db)
        : null;
      await updateProjectOnDevice(db, { id, row, vatRate });
      return { row };
    },
    change: (id, change) => changeProjectOnDevice(db, id, change),
  };
}

/**
 * A project's full record from the phone's copy, as the edit form takes it
 * (what /api/projects/edit-context reads on the server) — at once, with no
 * signal too. Null when the phone can't serve it: read it from the server.
 */
export async function deviceProjectForEdit(id: string): Promise<Record<string, unknown> | null> {
  const ready = readyDeviceSaves("projects");
  if (!ready) return null;
  const stored = await ready.db
    .getOptional<Record<string, unknown>>("SELECT * FROM projects WHERE id = ?", [id])
    .catch(() => null);
  return stored ? { ...deviceProjectBody(id, stored), vat_rate: stored.vat_rate ?? null } : null;
}

/** Undo of a project made on the phone that hasn't reached the server yet (no connection). */
export const PROJECT_NOT_SENT_YET = "הפרויקט עוד לא הגיע לשרת — אפשר למחוק אותו כשיחזור החיבור.";
