// A safe filename for a single download.
//
// What is left of the bulk-zip machinery: zipping a selection in the browser
// was a dependency and a lot of code for something a person does one file at a
// time, but the naming was worth keeping — a document's title is Hebrew prose
// and may contain characters a file system refuses.

export type DownloadableDocument = {
  id: string;
  title: string;
  file_name: string | null;
};

/** Characters a file name cannot carry, including the ones Windows refuses. */
const UNSAFE = /[\/:*?"<>|\u0000-\u001f]/g;

export function downloadFileName(doc: DownloadableDocument): string {
  const source = (doc.file_name ?? "").trim() || (doc.title ?? "").trim() || doc.id;
  return source.replace(UNSAFE, " ").replace(/\s+/g, " ").trim() || doc.id;
}
