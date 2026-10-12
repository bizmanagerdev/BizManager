"use client";

// THE way the app shows a document, a file or a photo — as a tile in a grid
// (DocumentTile) or as a line in a list (DocumentRow).
//
// The owner's rule (2026-10-12): "wherever there is a doc I want a download
// option and a view option on hover, the edit and delete somewhere else, much
// less prominent." So:
//  - With a mouse, צפייה and הורדה appear over the preview (a tile) or at the
//    row's end (a row) on hover, and on keyboard focus.
//  - On a phone (no hover) a tap on the file opens it; הורדה waits in the ⋮.
//  - עריכה and מחיקה live only in a quiet ⋮ — a grey glyph, no fill, the same
//    ⋮ as the lists' (app/(app)/sales/RowActionsMenu.tsx). The red bin and blue
//    pencil are gone from the file itself.
//
// Each place keeps its own data flow: it hands in the link, the name and the
// callbacks it had; this decides only how the file reads and where its actions
// live. Downloading goes through lib/file-download.ts (a computer saves straight
// from Storage; the Android app saves through its own Downloads).

import * as React from "react";
import Image from "next/image";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  DeleteIcon,
  DocumentIcon,
  DownloadIcon,
  EditIcon,
  MoreIcon,
  ShowIcon,
  SpinnerIcon,
} from "@/components/ui/icons";
import {
  canSaveInApp,
  downloadFile,
  downloadLinkTarget,
  fileDownloadHref,
  downloadNameFor,
  saveFileInApp,
} from "@/lib/file-download";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────── helpers

const IMAGE_FILE = /\.(png|jpe?g|gif|webp|bmp|heic|heif|avif)$/i;

/** A photo, going by its file name — the test every file tile used. */
export function isImageFileName(name: string | null | undefined): boolean {
  return IMAGE_FILE.test((name ?? "").trim());
}

/** "pdf" for "contract.pdf"; null when the name has no extension. */
export function fileExtension(name: string | null | undefined): string | null {
  const match = /\.([a-z0-9]{1,8})$/i.exec((name ?? "").trim());
  return match ? match[1].toLowerCase() : null;
}

/**
 * A place that counts an SVG as a photo (lib/documents' file kinds do) gets it
 * drawn as it is: the image optimizer refuses SVG.
 */
function isSvg(file: { fileName?: string | null; name: string }) {
  return fileExtension(file.fileName || file.name) === "svg";
}

/** Every word the tile says. Hebrew by default; the task screens pass Arabic too. */
export type DocumentLabels = {
  view: string;
  download: string;
  edit: string;
  delete: string;
  more: string;
  downloadFailed: string;
};

export const DOCUMENT_LABELS: DocumentLabels = {
  view: "צפייה",
  download: "הורדה",
  edit: "עריכה",
  delete: "מחיקה",
  more: "פעולות",
  downloadFailed: "ההורדה נכשלה.",
};

// ─────────────────────────────────────────────────────────────── props

export type DocumentFileProps = {
  /** What the person reads: the document's title, else its file name. */
  name: string;
  /**
   * The stored file's own name ("contract.pdf"). Its extension says what kind
   * of file it is, and a download is saved under it. Defaults to `name`.
   */
  fileName?: string | null;
  /** The signed link. Null when it couldn't be signed: the file still shows, without view or download. */
  url: string | null;
  /** When the place knows (a kind or a MIME type); otherwise read from the file name. */
  isImage?: boolean;
  /** An in-app viewer. Without it, צפייה opens the file in a new tab. */
  onView?: () => void;
  /** Omit when the person may not edit — no ⋮ item is drawn. */
  onEdit?: () => void;
  /** What the edit does, as a noun ("עריכת קטגוריה", "החלפת תמונה"). Default "עריכה". */
  editLabel?: string;
  /**
   * Omit when the person may not delete. Called as is when the place opens its
   * own ConfirmDialog; pass `confirmDelete` to have the tile ask first.
   */
  onDelete?: () => void;
  deleteLabel?: string;
  /** The tile asks through ConfirmDialog before calling onDelete. */
  confirmDelete?: { title: string; description?: React.ReactNode; confirmLabel?: string };
  /** More ⋮ items, between עריכה and the ruled-off מחיקה. */
  menuItems?: React.ReactNode;
  /** Work on its way (a delete, a replace): the ⋮ turns into a spinner and stays shut. */
  busy?: boolean;
  labels?: Partial<DocumentLabels>;
};

// ─────────────────────────────────────────────────────────────── shared pieces

function useDocumentActions(props: DocumentFileProps) {
  const labels = { ...DOCUMENT_LABELS, ...props.labels };
  const downloadName = downloadNameFor(props.fileName || props.name, props.url);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const { url, onDelete, confirmDelete } = props;

  const requestDelete = onDelete
    ? confirmDelete
      ? () => setConfirmOpen(true)
      : onDelete
    : undefined;

  const download = React.useCallback(() => {
    if (!url) return;
    downloadFile(url, downloadName).catch(() => toast.error(labels.downloadFailed));
  }, [url, downloadName, labels.downloadFailed]);

  const confirm =
    onDelete && confirmDelete ? (
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={confirmDelete.title}
        description={confirmDelete.description}
        confirmLabel={confirmDelete.confirmLabel ?? labels.delete}
        destructive
        onConfirm={() => {
          setConfirmOpen(false);
          onDelete();
        }}
      />
    ) : null;

  return { labels, downloadName, requestDelete, download, confirm };
}

type ViewTargetProps = {
  url: string | null;
  onView?: () => void;
  className?: string;
  children?: React.ReactNode;
  tabIndex?: number;
  "aria-label"?: string;
  title?: string;
};

/** The file's "open": the in-app viewer when the place has one, else a new tab. */
function ViewTarget({ url, onView, className, children, ...rest }: ViewTargetProps) {
  if (onView) {
    return (
      <button type="button" onClick={onView} className={className} {...rest}>
        {children}
      </button>
    );
  }
  if (url) {
    return (
      <a href={url} target="_blank" rel="noreferrer" className={className} {...rest}>
        {children}
      </a>
    );
  }
  return <span className={className}>{children}</span>;
}

/**
 * A real link to the file with `download`, so a computer saves it straight
 * from Storage (and "save link as" works too). Inside the Android app the
 * click is taken over: the shell would hand the link to the phone's browser.
 */
function DownloadLink({
  url,
  downloadName,
  failedLabel,
  className,
  children,
  ...rest
}: {
  url: string;
  downloadName: string;
  failedLabel: string;
  className?: string;
  children?: React.ReactNode;
  "aria-label"?: string;
  title?: string;
}) {
  return (
    <a
      href={fileDownloadHref(url, downloadName)}
      download={downloadName}
      target={downloadLinkTarget(url)}
      rel="noopener"
      className={className}
      onClick={(event) => {
        if (!canSaveInApp()) return;
        event.preventDefault();
        saveFileInApp(url, downloadName).catch(() => toast.error(failedLabel));
      }}
      {...rest}
    >
      {children}
    </a>
  );
}

/**
 * A link that saves a file, for a place whose download is a button of its own
 * (a statement's "הורדת הקובץ"). Wrap it in `<Button asChild>` for the look.
 */
export function DocumentDownloadLink({
  url,
  name,
  fileName,
  labels: labelOverrides,
  className,
  children,
  ...rest
}: {
  url: string;
  name: string;
  fileName?: string | null;
  labels?: Partial<DocumentLabels>;
  className?: string;
  children?: React.ReactNode;
  "aria-label"?: string;
  title?: string;
}) {
  const labels = { ...DOCUMENT_LABELS, ...labelOverrides };
  return (
    <DownloadLink
      url={url}
      downloadName={downloadNameFor(fileName || name, url)}
      failedLabel={labels.downloadFailed}
      className={className}
      {...rest}
    >
      {children}
    </DownloadLink>
  );
}

export type DocumentQuickActionsProps = {
  name: string;
  url: string | null;
  fileName?: string | null;
  onView?: () => void;
  labels?: Partial<DocumentLabels>;
  /**
   * "overlay": two small round buttons over a preview (a tile).
   * "inline": two quiet glyphs at a row's end.
   */
  variant?: "overlay" | "inline";
  className?: string;
};

const OVERLAY_BUTTON =
  "pointer-events-auto inline-flex h-8 w-8 items-center justify-center rounded-full bg-background/95 text-foreground shadow-sm ring-1 ring-border/60 transition-colors hover:bg-background hover:text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:h-4 [&_svg]:w-4";
const INLINE_BUTTON =
  "inline-flex h-8 w-8 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-secondary/10 hover:text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:h-4 [&_svg]:w-4";

/**
 * צפייה + הורדה — the pair that appears on hover. Exported for a place that
 * keeps its own tile (the documents archive) but wants the same two actions.
 * The caller decides WHEN they show (an opacity on hover); this draws them.
 */
export function DocumentQuickActions({
  name,
  url,
  fileName,
  onView,
  labels: labelOverrides,
  variant = "overlay",
  className,
}: DocumentQuickActionsProps) {
  const labels = { ...DOCUMENT_LABELS, ...labelOverrides };
  const downloadName = downloadNameFor(fileName || name, url);
  const buttonClass = variant === "overlay" ? OVERLAY_BUTTON : INLINE_BUTTON;
  if (!url && !onView) return null;
  return (
    <span className={cn("flex items-center", variant === "overlay" ? "gap-2" : "gap-0.5", className)}>
      <ViewTarget url={url} onView={onView} className={buttonClass} aria-label={labels.view} title={labels.view}>
        <ShowIcon />
      </ViewTarget>
      {url ? (
        <DownloadLink
          url={url}
          downloadName={downloadName}
          failedLabel={labels.downloadFailed}
          className={buttonClass}
          aria-label={labels.download}
          title={labels.download}
        >
          <DownloadIcon />
        </DownloadLink>
      ) : null}
    </span>
  );
}

/**
 * The quiet ⋮: עריכה, the place's own items, then מחיקה ruled off — and
 * הורדה on a phone, where there is no hover to show it. With nothing to edit
 * or delete it exists only on a phone, for that הורדה.
 */
function DocumentMenu({
  labels,
  hasUrl,
  onDownload,
  onEdit,
  editLabel,
  onDelete,
  deleteLabel,
  menuItems,
  busy,
  className,
}: {
  labels: DocumentLabels;
  hasUrl: boolean;
  onDownload: () => void;
  onEdit?: () => void;
  editLabel?: string;
  onDelete?: () => void;
  deleteLabel?: string;
  menuItems?: React.ReactNode;
  busy?: boolean;
  className?: string;
}) {
  const manages = Boolean(onEdit || onDelete || menuItems);
  if (!manages && !hasUrl) return null;
  return (
    // Not modal: a modal menu locks the page's scroll, and taking the scrollbar
    // away re-flowed the grid under it (a name re-wrapped as the menu opened).
    // The documents archive's ⋮ is the same.
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild disabled={busy}>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(
            "h-8 w-8 shrink-0 p-0 text-muted-foreground hover:text-foreground",
            // Only הורדה inside: a mouse has it on hover already.
            !manages && "[@media(hover:hover)]:hidden",
            className
          )}
          title={labels.more}
          aria-label={labels.more}
        >
          {busy ? <SpinnerIcon className="h-4 w-4 animate-spin" /> : <MoreIcon className="h-4 w-4" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-44"
        // Let the dialog an item just opened keep the focus — without this the
        // menu yanks it back to the ⋮ as it closes.
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        {hasUrl ? (
          <DropdownMenuItem className="gap-2 [@media(hover:hover)]:hidden" onSelect={onDownload}>
            <DownloadIcon className="h-4 w-4" />
            <span>{labels.download}</span>
          </DropdownMenuItem>
        ) : null}
        {onEdit ? (
          <DropdownMenuItem className="gap-2" onSelect={onEdit}>
            <EditIcon className="h-4 w-4" />
            <span>{editLabel ?? labels.edit}</span>
          </DropdownMenuItem>
        ) : null}
        {menuItems}
        {onDelete ? (
          <>
            {onEdit || menuItems ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItem className="gap-2 text-destructive focus:text-destructive" onSelect={onDelete}>
              <DeleteIcon className="h-4 w-4" />
              <span>{deleteLabel ?? labels.delete}</span>
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ─────────────────────────────────────────────────────────────── the tile

export type DocumentTileProps = DocumentFileProps & {
  /** Already formatted the place's way. */
  date?: React.ReactNode;
  /** Under the date: a category chip, who uploaded it. */
  meta?: React.ReactNode;
  /** The preview's height — each grid keeps the one it had. Default h-20. */
  previewClassName?: string;
  /** A photo grid that never showed names (delivery photos) keeps not showing them. */
  hideName?: boolean;
  /** next/image's `sizes` for a photo; the default suits a two-column grid. */
  imageSizes?: string;
  className?: string;
};

/**
 * A file in a grid: the preview (the photo itself, or an icon and the file's
 * type), the name and the date; צפייה and הורדה over the preview on hover; the
 * quiet ⋮ in the corner by the name.
 */
export function DocumentTile({
  date,
  meta,
  previewClassName = "h-20",
  hideName = false,
  imageSizes = "(max-width: 768px) 50vw, 240px",
  className,
  ...file
}: DocumentTileProps) {
  const { labels, requestDelete, download, confirm } = useDocumentActions(file);
  const image = file.isImage ?? isImageFileName(file.fileName || file.name);
  const extension = image ? null : fileExtension(file.fileName || file.name);
  const canOpen = Boolean(file.url || file.onView);

  return (
    <div
      className={cn(
        "group/doc relative flex flex-col overflow-hidden rounded-card border border-border/60 bg-card",
        className
      )}
    >
      <div className={cn("group/preview relative flex items-center justify-center bg-muted/40", previewClassName)}>
        {image && file.url ? (
          <Image
            src={file.url}
            alt={file.name}
            fill
            sizes={imageSizes}
            unoptimized={isSvg(file)}
            className="object-cover"
          />
        ) : (
          <DocumentIcon className="h-6 w-6 text-muted-foreground" />
        )}
        {extension ? (
          <span className="absolute bottom-1 start-1 rounded bg-foreground/70 px-1 text-[0.647rem] uppercase text-white">
            {extension}
          </span>
        ) : null}
        {canOpen ? (
          <>
            {/* The whole preview opens the file — the phone's tap, and a click
                anywhere on it. Out of the tab order: the צפייה below is the
                keyboard's way in. */}
            <ViewTarget
              url={file.url}
              onView={file.onView}
              className="absolute inset-0"
              tabIndex={-1}
              aria-label={`${labels.view}: ${file.name}`}
            />
            {/* A light scrim with the two actions — on hover, or when one of
                them has keyboard focus. Not drawn on a phone. */}
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background/45 opacity-0 transition-opacity duration-150 group-focus-within/preview:opacity-100 group-hover/doc:opacity-100 [@media(hover:none)]:hidden">
              <DocumentQuickActions
                name={file.name}
                url={file.url}
                fileName={file.fileName}
                onView={file.onView}
                labels={labels}
              />
            </div>
          </>
        ) : null}
      </div>
      <div className="flex flex-1 items-start gap-1 p-2">
        <div className="min-w-0 flex-1 space-y-1">
          {hideName ? null : <div className="break-words text-xs font-medium">{file.name}</div>}
          {date ? <div className="text-xs text-muted-foreground">{date}</div> : null}
          {meta}
        </div>
        <DocumentMenu
          labels={labels}
          hasUrl={Boolean(file.url)}
          onDownload={download}
          onEdit={file.onEdit}
          editLabel={file.editLabel}
          onDelete={requestDelete}
          deleteLabel={file.deleteLabel}
          menuItems={file.menuItems}
          busy={file.busy}
          className="-my-1 -me-1"
        />
      </div>
      {confirm}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────── the inline link

export type DocumentLinkProps = {
  name: string;
  fileName?: string | null;
  url: string;
  /** What the link shows — a chip ("📎 קובץ"), a small photo. */
  children: React.ReactNode;
  /** The link's own look (the chip / the photo frame). */
  className?: string;
  title?: string;
  labels?: Partial<DocumentLabels>;
};

/**
 * A file that sits inside a line rather than as a tile or a row — a ledger
 * row's "קובץ" chip, a payment's check photo, a lease's signed contract. The
 * link opens the file as it did; a small הורדה glyph follows it, shown on hover
 * (its room kept, so nothing moves) and always on a phone, where there is no
 * hover and no ⋮ to hold it.
 */
export function DocumentLink({ name, fileName, url, children, className, title, labels: labelOverrides }: DocumentLinkProps) {
  const labels = { ...DOCUMENT_LABELS, ...labelOverrides };
  const downloadName = downloadNameFor(fileName || name, url);
  return (
    <span className="group/doc inline-flex max-w-full items-center gap-0.5">
      <a href={url} target="_blank" rel="noreferrer" title={title ?? name} className={className}>
        {children}
      </a>
      <DownloadLink
        url={url}
        downloadName={downloadName}
        failedLabel={labels.downloadFailed}
        aria-label={labels.download}
        title={labels.download}
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity duration-150 hover:bg-secondary/10 hover:text-secondary focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover/doc:opacity-100 [@media(hover:none)]:opacity-100 [&_svg]:h-3.5 [&_svg]:w-3.5"
      >
        <DownloadIcon />
      </DownloadLink>
    </span>
  );
}

// ─────────────────────────────────────────────────────────────── the row

export type DocumentRowProps = DocumentFileProps & {
  /** The line under the name (date, type, who uploaded it) — no links inside: the row opens the file. */
  meta?: React.ReactNode;
  /** Draw a thumbnail (the photo, or an icon) at the row's start. Default true. */
  showThumb?: boolean;
  className?: string;
};

/**
 * A file in a list: a small thumbnail, the name and a line under it; the row
 * opens the file; צפייה and הורדה at its end on hover; the quiet ⋮ last.
 */
export function DocumentRow({ meta, showThumb = true, className, ...file }: DocumentRowProps) {
  const { labels, requestDelete, download, confirm } = useDocumentActions(file);
  const image = file.isImage ?? isImageFileName(file.fileName || file.name);

  return (
    <div
      className={cn(
        "group/doc flex items-center gap-2 rounded-card border border-border/60 bg-background px-2 py-1.5",
        className
      )}
    >
      <ViewTarget
        url={file.url}
        onView={file.onView}
        className="flex min-w-0 flex-1 items-center gap-2 text-start"
        title={file.url || file.onView ? labels.view : undefined}
      >
        {showThumb ? (
          image && file.url ? (
            <Image
              src={file.url}
              alt={file.name}
              width={40}
              height={40}
              unoptimized={isSvg(file)}
              className="h-10 w-10 shrink-0 rounded-md border border-border/60 object-cover"
            />
          ) : (
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <DocumentIcon className="h-4 w-4" />
            </span>
          )
        ) : null}
        <span className="min-w-0 flex-1">
          <span className="block break-words text-sm font-medium">{file.name}</span>
          {meta ? <span className="block text-xs text-muted-foreground">{meta}</span> : null}
        </span>
      </ViewTarget>
      <span className="flex shrink-0 items-center">
        <DocumentQuickActions
          name={file.name}
          url={file.url}
          fileName={file.fileName}
          onView={file.onView}
          labels={labels}
          variant="inline"
          // Their room is kept while hidden, so nothing moves when they show.
          className="opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover/doc:opacity-100 [@media(hover:none)]:hidden"
        />
        <DocumentMenu
          labels={labels}
          hasUrl={Boolean(file.url)}
          onDownload={download}
          onEdit={file.onEdit}
          editLabel={file.editLabel}
          onDelete={requestDelete}
          deleteLabel={file.deleteLabel}
          menuItems={file.menuItems}
          busy={file.busy}
        />
      </span>
      {confirm}
    </div>
  );
}
