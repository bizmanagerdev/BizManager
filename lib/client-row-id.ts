// A row id chosen by the app (a task or comment written on the phone first,
// so it stays the same row once the server has it): a well-formed UUID, or
// nothing — then the database picks one, as before. Lower-cased, as Postgres
// prints uuids. Never trusted for anything but the new row's own id: a clash
// with an existing row is refused by the database.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function clientRowId(value: unknown): string | null {
  return typeof value === "string" && UUID.test(value.trim()) ? value.trim().toLowerCase() : null;
}
