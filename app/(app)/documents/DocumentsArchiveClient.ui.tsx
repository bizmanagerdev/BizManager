"use client";

import Link from "next/link";
import { useLongPress } from "@/hooks/useLongPress";
import Image from "next/image";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  CalendarIcon,
  CameraIcon,
  CashIcon,
  ShieldIcon,
  DeleteIcon,
  DocumentIcon,
  ExternalLinkIcon,
  GalleryIcon,
  LayersIcon,
  LinkIcon,
  MoreIcon,
  TagIcon,
  UnlinkIcon,
} from "@/components/ui/icons";
import { InitialsAvatar } from "@/components/dashboard/InitialsAvatar";
import PdfThumbnail from "@/components/documents/PdfThumbnail";
import { getDocumentCategoryLabel, getDocumentSourceLabel } from "@/lib/documents";
import { getBusinessDomainLabel } from "@/lib/expenses";
import { categoryIcon, type DocumentCategoryRow } from "@/lib/documents/categories";
import { isUnlinkedMoneyDocument } from "@/lib/documents/moneyLink";
import { describeMatch } from "@/lib/documents/suggestions";
import { expiryBadgeTone, expiryLabel, type ExpiryResult } from "@/lib/documents/expiry";
import type { DocumentArchiveItem } from "@/lib/documents/archive";
import {
  cardTitle,
  entityTypeLabel,
  fileKindLabel,
  formatDate,
  groupHref,
  groupLabel as groupLabelFor,
} from "@/app/(app)/documents/DocumentsArchiveClient.helpers";

// ────────────────────────────────────────────────────────────────────────────
// What the archive looks like: one document as a tile, and one as a list row.
//
// Presentational by the project's convention (see CollectionsClient.ui.tsx):
// everything arrives as props, including the setters. The container owns the
// state; these decide only how a document reads.
// ────────────────────────────────────────────────────────────────────────────

/** Everything both views need from the page around them. */
export type DocumentRowContext = {
  groupBy: string;
  normalizedQuery: string;
  moneyCodes: Set<string>;
  categoryRows: DocumentCategoryRow[];
  selectedIds: Set<string>;
  toggleSelected: (id: string) => void;
  /** Long-pressing a tile turns this on, and every tile shows its checkbox. */
  selectionMode: boolean;
  onEnterSelection: (doc: DocumentArchiveItem) => void;
  /** The active category filter — a row does not repeat a type you filtered to. */
  typeChips: Set<string>;
  expiryOf: (doc: DocumentArchiveItem) => ExpiryResult | null;
  attentionReason: (doc: DocumentArchiveItem) => string | null;
  onPreview: (doc: DocumentArchiveItem) => void;
  onAssign: (doc: DocumentArchiveItem) => void;
  onToggleNoLinkNeeded: (doc: DocumentArchiveItem) => void;
  onEditCategory: (doc: DocumentArchiveItem) => void;
  onEditDomain: (doc: DocumentArchiveItem) => void;
  onLinkToLedger: (doc: DocumentArchiveItem) => void;
  onDelete: (doc: DocumentArchiveItem) => void;
};

const CATEGORY_ICONS = {
  camera: CameraIcon,
  money: CashIcon,
  expiry: ShieldIcon,
  document: DocumentIcon,
} as const;

export function DocumentTile({
  doc,
  members,
  groupLabel,
  uniformCategoryLabel,
  KindIcon,
  ...ctx
}: DocumentRowContext & {
  doc: DocumentArchiveItem;
  members: DocumentArchiveItem[];
  groupLabel: string;
  uniformCategoryLabel: string | null;
  KindIcon: (props: { className?: string }) => React.ReactNode;
}) {
  const {
    groupBy,
    normalizedQuery,
    moneyCodes,
    categoryRows,
    selectedIds,
    toggleSelected,
    expiryOf,
    attentionReason,
    selectionMode,
  } = ctx;
  // A long press is how a phone asks "which ones?"; the tap that follows it
  // must not also open the document it was selecting.
  const longPress = useLongPress(() => ctx.onEnterSelection(doc));
  return (
                      <div
                        key={doc.id}
                        data-focus-id={doc.id}
                        onTouchStart={longPress.onTouchStart}
                        onTouchMove={longPress.onTouchMove}
                        onTouchEnd={longPress.onTouchEnd}
                        onTouchCancel={longPress.onTouchCancel}
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          if (longPress.consumed()) return;
                          if (selectionMode || selectedIds.size > 0) {
                            toggleSelected(doc.id);
                            return;
                          }
                          ctx.onPreview(doc);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            ctx.onPreview(doc);
                          }
                        }}
                        className={`group/card flex cursor-pointer flex-col overflow-hidden rounded-lg border bg-background transition-colors hover:border-secondary ${
                          selectedIds.has(doc.id)
                            ? "border-secondary bg-muted ring-1 ring-inset ring-secondary"
                            : "border-[rgb(var(--secondary-9))]"
                        }`}
                      >
                        <div className="relative flex h-24 items-center justify-center overflow-hidden bg-muted/40 @[40em]:h-33">
                          {/* Visible once anything is selected, on hover otherwise,
                              and always on touch where there is no hover. */}
                          <label
                            className={`absolute start-1 top-1 z-20 flex h-7 w-7 cursor-pointer items-center justify-center rounded-md bg-background/90 shadow-sm transition-opacity ${
                              selectedIds.size > 0 || selectionMode
                                ? "opacity-100"
                                : "opacity-0 focus-within:opacity-100 group-hover/card:opacity-100"
                            }`}
                            onClick={(event) => event.stopPropagation()}
                          >
                            <input
                              type="checkbox"
                              className="h-4 w-4"
                              checked={selectedIds.has(doc.id)}
                              onChange={() => toggleSelected(doc.id)}
                              aria-label={`בחירת ${doc.title}`}
                            />
                          </label>
                          <div
                            className="absolute end-1 top-1 z-10 rounded-md bg-background/90 opacity-0 shadow-sm transition-opacity focus-within:opacity-100 group-hover/card:opacity-100"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <DropdownMenu modal={false}>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="-my-1 h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                                  title="פעולות"
                                  aria-label={`פעולות — ${doc.title}`}
                                >
                                  <MoreIcon className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-48">
                                <DropdownMenuItem onClick={() => ctx.onAssign(doc)}>
                                  <LinkIcon className="me-2 h-4 w-4" />
                                  שייך ל…
                                </DropdownMenuItem>
                                <DropdownMenuCheckboxItem
                                  checked={doc.no_link_needed}
                                  onCheckedChange={() => ctx.onToggleNoLinkNeeded(doc)}
                                >
                                  <UnlinkIcon className="me-2 h-4 w-4" />
                                  לא דורש שיוך
                                </DropdownMenuCheckboxItem>
                                <DropdownMenuItem
                                  onClick={() => ctx.onEditCategory(doc)}
                                >
                                  <TagIcon className="me-2 h-4 w-4" />
                                  קטגוריה
                                </DropdownMenuItem>
                                {expiryOf(doc) ? (
                                  <DropdownMenuItem
                                    onClick={() => ctx.onEditCategory(doc)}
                                  >
                                    <CalendarIcon className="me-2 h-4 w-4" />
                                    קבע תוקף
                                  </DropdownMenuItem>
                                ) : null}
                                <DropdownMenuItem
                                  onClick={() => ctx.onEditDomain(doc)}
                                >
                                  <LayersIcon className="me-2 h-4 w-4" />
                                  תחום
                                </DropdownMenuItem>
                                {isUnlinkedMoneyDocument(doc.document_type, doc.entity_types, moneyCodes) ? (
                                  <DropdownMenuItem onClick={() => ctx.onLinkToLedger(doc)}>
                                    <LinkIcon className="me-2 h-4 w-4" />
                                    שיוך לתנועה
                                  </DropdownMenuItem>
                                ) : null}
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  onClick={() => ctx.onDelete(doc)}
                                  className="text-destructive focus:text-destructive"
                                >
                                  <DeleteIcon className="me-2 h-4 w-4" />
                                  מחיקה
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>

                          </div>
                          {doc.file_kind === "image" && doc.url ? (
                            <Image
                              src={doc.url}
                              alt={doc.title}
                              width={240}
                              height={160}
                              loading="lazy"
                              className="h-full w-full object-cover"
                            />
                          ) : doc.file_kind === "pdf" && doc.url ? (
                            <PdfThumbnail
                              cacheKey={doc.id}
                              url={doc.url}
                              fallback={<KindIcon className="h-8 w-8 text-muted-foreground" />}
                            />
                          ) : (
                            <KindIcon className="h-8 w-8 text-muted-foreground" />
                          )}
                          {/* Only STATE survives on the card, and only as a dot:
                              the document says it needs a person, and hovering
                              says which kind of attention. */}
                          {(() => {
                            const expiry = expiryOf(doc);
                            const tone = expiry ? expiryBadgeTone(expiry.status) : null;
                            if (expiry && tone) {
                              return (
                                <Badge
                                  variant={tone}
                                  className="absolute bottom-1 start-1 max-w-[calc(100%-4rem)]"
                                >
                                  {expiryLabel(expiry)}
                                </Badge>
                              );
                            }
                            if (expiry?.status === "superseded") {
                              return (
                                <Badge
                                  variant="outline"
                                  className="absolute bottom-1 start-1 max-w-[calc(100%-4rem)] bg-background/90 text-muted-foreground"
                                  title="מסמך חדש יותר החליף אותו"
                                >
                                  הוחלף
                                </Badge>
                              );
                            }
                            const reason = attentionReason(doc);
                            return reason ? (
                              <span
                                className="absolute bottom-1 start-1 h-2.5 w-2.5 rounded-full bg-warning ring-2 ring-background"
                                title={reason}
                                aria-label={reason}
                              />
                            ) : null;
                          })()}
                          {(() => {
                            const Glyph = CATEGORY_ICONS[categoryIcon(categoryRows, doc.document_type)];
                            const label = getDocumentCategoryLabel(doc.document_type);
                            return (
                              <span
                                className="absolute top-1 start-1 flex items-center rounded-full bg-primary/70 p-1 text-primary-foreground transition-opacity group-hover/card:opacity-0"
                                title={label}
                                aria-label={label}
                              >
                                <Glyph className="h-3 w-3" />
                              </span>
                            );
                          })()}
                          {members.length > 1 ? (
                            <>
                              <span className="absolute bottom-1 end-1 flex items-center gap-1 rounded-full bg-primary/70 px-1.5 py-0.5 text-[0.625rem] font-medium text-primary-foreground">
                                <GalleryIcon className="h-3 w-3" />
                                {members.length}
                              </span>
                              <span className="absolute inset-x-0 bottom-1 flex justify-center gap-1 opacity-0 transition-opacity group-hover/card:opacity-100">
                                {members.slice(0, 5).map((member, index) => (
                                  <span
                                    key={member.id}
                                    className={`h-1.5 w-1.5 rounded-full ${
                                      index === 0 ? "bg-primary" : "bg-primary/40"
                                    }`}
                                  />
                                ))}
                              </span>
                            </>
                          ) : null}
                        </div>
                        <div className="flex flex-1 flex-col gap-0.5 p-2">
                          {(() => {
                            const hasPicture = doc.file_kind === "image" && doc.url;
                            if (hasPicture) return null;
                            const shown = cardTitle(doc, groupLabel);
                            if (uniformCategoryLabel && shown.trim() === uniformCategoryLabel) {
                              return null;
                            }
                            return (
                              <div
                                className="text-sm font-medium leading-tight [-webkit-box-orient:vertical] [-webkit-line-clamp:2] [display:-webkit-box] [overflow-wrap:anywhere] overflow-hidden"
                                title={doc.title}
                              >
                                {shown}
                              </div>
                            );
                          })()}

                          {normalizedQuery ? (
                            (() => {
                              const why = describeMatch(doc, normalizedQuery);
                              return why ? (
                                <div className="text-xs text-primary">{why}</div>
                              ) : null;
                            })()
                          ) : null}
                          {groupBy !== "entity" || normalizedQuery ? (
                            (() => {
                              const label = groupLabelFor("entity", doc);
                              const href = groupHref("entity", doc);
                              if (label === "ללא שיוך" || label === "ללא שיוך נדרש") {
                                return (
                                  <div className="text-xs text-muted-foreground">{label}</div>
                                );
                              }
                              return (
                                <div className="text-xs">
                                  {href ? (
                                    <Link
                                      href={href}
                                      className="text-secondary hover:underline"
                                      onClick={(event) => event.stopPropagation()}
                                    >
                                      {label}
                                    </Link>
                                  ) : (
                                    <span className="text-muted-foreground">{label}</span>
                                  )}
                                </div>
                              );
                            })()
                          ) : null}
                          <div className="mt-auto flex items-center gap-1 pt-1 text-xs text-muted-foreground">
                            <span>{formatDate(doc.uploaded_at)}</span>
                            {doc.uploaded_by_name ? (
                              <InitialsAvatar
                                name={doc.uploaded_by_name}
                                color={doc.uploaded_by_color}
                                size="xs"
                                className="ms-auto"
                              />
                            ) : null}
                          </div>
                        </div>
                      </div>
  );
}

export function DocumentListRow({
  doc,
  KindIcon,
  ...ctx
}: DocumentRowContext & {
  doc: DocumentArchiveItem;
  KindIcon: (props: { className?: string }) => React.ReactNode;
}) {
  const { groupBy, moneyCodes, expiryOf, typeChips } = ctx;
  return (
                  <div
                    key={doc.id}
                    // Lets /documents?focus=<id> (e.g. from the activity feed)
                    // land on this exact file — see FocusHighlighter.
                    data-focus-id={doc.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => ctx.onPreview(doc)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        ctx.onPreview(doc);
                      }
                    }}
                    className="flex cursor-pointer items-center gap-x-3 border-b border-border/50 px-2 py-1.5 transition-colors last:border-b-0 hover:bg-secondary/10"
                  >
                    {doc.file_kind === "image" && doc.url ? (
                      <a
                        href={doc.url}
                        target="_blank"
                        rel="noreferrer"
                        className="shrink-0"
                        title="פתיחת התמונה"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <Image
                          src={doc.url}
                          alt={doc.title}
                          width={48}
                          height={48}
                          loading="lazy"
                          className="h-12 w-12 rounded-lg border border-border/60 object-cover"
                        />
                      </a>
                    ) : (
                      <div className="shrink-0 rounded bg-muted p-1.5 text-muted-foreground">
                        <KindIcon className="h-4 w-4" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium">{doc.title}</span>
                        {doc.file_kind === "image" ? null : (
                          <Badge variant="outline">{fileKindLabel(doc.file_kind)}</Badge>
                        )}
                        {groupBy === "domain"
                          ? null
                          : doc.business_domains.map((domain) => (
                              <Badge key={`${doc.id}-${domain}`} variant="outline">
                                {getBusinessDomainLabel(domain)}
                              </Badge>
                            ))}
                        {groupBy === "type" ||
                        (typeChips.size === 1 && typeChips.has(doc.document_type ?? "")) ? null : doc
                            .document_type ? (
                          <Badge variant="outline">{getDocumentCategoryLabel(doc.document_type)}</Badge>
                        ) : getDocumentSourceLabel(doc.source) ? (
                          <Badge variant="outline">{getDocumentSourceLabel(doc.source)}</Badge>
                        ) : (
                          <Badge variant="outline">ללא קטגוריה</Badge>
                        )}
                        {isUnlinkedMoneyDocument(doc.document_type, doc.entity_types, moneyCodes) ? (
                          <Badge variant="outline" className="border-warning text-warning">
                            לא משויך לתנועה
                          </Badge>
                        ) : null}
                        {(() => {
                          const expiry = expiryOf(doc);
                          const tone = expiry ? expiryBadgeTone(expiry.status) : null;
                          if (!expiry || !tone) return null;
                          return <Badge variant={tone}>{expiryLabel(expiry)}</Badge>;
                        })()}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground [&>*+*]:before:me-2 [&>*+*]:before:text-border [&>*+*]:before:content-['·']">
                        <span>{formatDate(doc.uploaded_at)}</span>
                        {doc.uploaded_by_name ? <span>{doc.uploaded_by_name}</span> : null}
                        {doc.linked_entities.length > 0 ? (
                          doc.linked_entities.map((entity) =>
                            entity.href ? (
                              <Link
                                key={`${entity.type}:${entity.id}`}
                                href={entity.href}
                                onClick={(event) => event.stopPropagation()}
                                className="text-foreground hover:underline"
                              >
                                · {entityTypeLabel(entity.type)}: {entity.label}
                              </Link>
                            ) : (
                              <span key={`${entity.type}:${entity.id}`}>
                                · {entityTypeLabel(entity.type)}: {entity.label}
                              </span>
                            )
                          )
                        ) : (
                          <span>· ללא שיוך</span>
                        )}
                        {doc.customers.length > 0 &&
                        !doc.linked_entities.some((entity) => entity.type === "customer") ? (
                          <span>· לקוח: {doc.customers.map((item) => item.label).join(", ")}</span>
                        ) : null}
                      </div>
                    </div>
                    {/* Actions act on the row, not on it — don't let them open
                        the preview too. */}
                    <div
                      className="flex shrink-0 items-center gap-1"
                      onClick={(event) => event.stopPropagation()}
                    >
                      {doc.url ? (
                        <Button asChild variant="outline" size="icon" aria-label="פתיחה" title="פתיחה">
                          <a href={doc.url} target="_blank" rel="noreferrer">
                            <ExternalLinkIcon className="h-4 w-4" />
                          </a>
                        </Button>
                      ) : null}
                      <DropdownMenu modal={false}>
                        <DropdownMenuTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-foreground"
                            title="פעולות"
                            aria-label={`פעולות — ${doc.title}`}
                          >
                            <MoreIcon className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          {doc.url ? (
                            <DropdownMenuItem asChild>
                              <a href={doc.url} target="_blank" rel="noreferrer">
                                <ExternalLinkIcon className="me-2 h-4 w-4" />
                                פתיחה
                              </a>
                            </DropdownMenuItem>
                          ) : null}
                          <DropdownMenuItem onClick={() => ctx.onAssign(doc)}>
                            <LinkIcon className="me-2 h-4 w-4" />
                            שייך ל…
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => ctx.onEditCategory(doc)}
                          >
                            <TagIcon className="me-2 h-4 w-4" />
                            קטגוריה
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => ctx.onEditDomain(doc)}
                          >
                            <LayersIcon className="me-2 h-4 w-4" />
                            תחום
                          </DropdownMenuItem>
                          {isUnlinkedMoneyDocument(doc.document_type, doc.entity_types, moneyCodes) ? (
                            <DropdownMenuItem onClick={() => ctx.onLinkToLedger(doc)}>
                              <LinkIcon className="me-2 h-4 w-4" />
                              שיוך לתנועה
                            </DropdownMenuItem>
                          ) : null}
                          <DropdownMenuItem
                            onClick={() => ctx.onDelete(doc)}
                            className="text-destructive focus:text-destructive"
                          >
                            <DeleteIcon className="me-2 h-4 w-4" />
                            מחיקה
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
  );
}
