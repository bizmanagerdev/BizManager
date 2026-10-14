"use client";

import { Suspense, use, useCallback, useMemo, useState } from "react";
import { HistoryIcon, NoteIcon, ReceiptIcon } from "@/components/ui/icons";
import { Badge } from "@/components/ui/badge";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { SECTION_ICON_CLASS, SectionCount } from "@/components/ui/section-card";
import MorningCustomerCard, { morningStatusClass, morningStatusLabel } from "@/components/morning/MorningCustomerCard";
import EntityActivityTimeline from "@/app/(app)/activity/EntityActivityTimeline";
import type { EditCustomerInput } from "@/components/customers/EditCustomerDialog";
import CustomerPageHeading from "@/app/(app)/customers/[id]/CustomerPageHeading";
import CustomerHeaderMenu from "@/app/(app)/customers/[id]/CustomerHeaderMenu";
import CustomerProfileCard from "@/app/(app)/customers/[id]/CustomerProfileCard";
import CustomerMoneyCard from "@/app/(app)/customers/[id]/CustomerMoneyCard";
import CustomerTagsSection from "@/app/(app)/customers/[id]/CustomerTagsSection";
import CustomerDeliveryDetails from "@/app/(app)/customers/[id]/CustomerDeliveryDetails";
import CustomerOrdersSection from "@/app/(app)/customers/[id]/CustomerOrdersSection";
import CustomerProjectsSection from "@/app/(app)/customers/[id]/CustomerProjectsSection";
import CustomerCollectionSection, {
  type CollectionFormRequest,
} from "@/app/(app)/customers/[id]/CustomerCollectionSection";
import CustomerTasksSection from "@/app/(app)/customers/[id]/CustomerTasksSection";
import CustomerPaymentsSection from "@/app/(app)/customers/[id]/CustomerPaymentsSection";
import CustomerPromisesSection from "@/app/(app)/customers/[id]/CustomerPromisesSection";
import CustomerContactsSection from "@/app/(app)/customers/[id]/CustomerContactsSection";
import CustomerDocumentsSection from "@/app/(app)/customers/[id]/CustomerDocumentsSection";
import CustomerNotesEditor from "@/app/(app)/customers/[id]/CustomerNotesEditor";
import CustomerLeasesSection from "@/app/(app)/customers/[id]/CustomerLeasesSection";
import EditCustomerButton from "@/app/(app)/customers/[id]/EditCustomerButton";
import {
  AddActionButton,
  CountSkeleton,
  SECTION_IDS,
  openSection,
} from "@/app/(app)/customers/[id]/customerSectionUi";
import {
  customerDeleteBlocker,
  type CustomerDocumentsResult,
  type CustomerHistory,
  type CustomerPageTop,
  type CustomerPaymentsResult,
} from "@/app/(app)/customers/[id]/customerPageModel";

// A customer's page, from what the server read for it (loadCustomerPage.ts):
// one page, made like the project page (owner, 2026-10-13 — no tabs). The name
// and a ⋮ in the top bar; at the top the לקוח card and the money card; then
// the sections, each folding to its header line — open when it holds what the
// reader came for (orders, projects, a debt to collect), folded to the count
// and its "+" when empty. On a computer the sections stand in two columns
// under the two cards; on a phone, one after another in the same order.
//
// The payments, the documents and the history come after the page (`payments`,
// `documents`, `history` — promises the server keeps sending into): their
// sections are folded until opened, so nothing moves when they land.

function HistoryCount({ history }: { history: Promise<CustomerHistory> }) {
  return <SectionCount count={use(history).items.length} />;
}

function HistoryBody({ history }: { history: Promise<CustomerHistory> }) {
  const { items, error } = use(history);
  if (error) return <p className="text-sm text-destructive">{error}</p>;
  return <EntityActivityTimeline items={items} previewCount={5} />;
}

export default function CustomerPageView({
  top,
  payments,
  documents,
  history,
  viewer,
  today,
}: {
  top: CustomerPageTop;
  payments: Promise<CustomerPaymentsResult>;
  documents: Promise<CustomerDocumentsResult>;
  /** Admin only, mirroring /activity access; null for everyone else. */
  history: Promise<CustomerHistory> | null;
  viewer: { id: string; role: string };
  /** Israel's today on the server — the first paint's "overdue" and "how long ago". */
  today: string;
}) {
  const { customer } = top;
  const canManage = viewer.role === "admin" || viewer.role === "office";

  // What the page changed itself without being read again — the notes saved
  // in place, the customer marked inactive from the ⋮. A fresh reading (after
  // an edit) replaces them.
  const [notes, setNotes] = useState(customer.notes);
  const [active, setActive] = useState(customer.active);
  const [seen, setSeen] = useState(customer);
  if (customer !== seen) {
    setSeen(customer);
    setNotes(customer.notes);
    setActive(customer.active);
  }

  const [editOpen, setEditOpen] = useState(false);
  const [taskCreateOpen, setTaskCreateOpen] = useState(false);
  const [collectionRequest, setCollectionRequest] = useState<CollectionFormRequest | null>(null);
  const [notesEditRequest, setNotesEditRequest] = useState(0);

  const openEdit = useCallback(() => setEditOpen(true), []);
  const openNewTask = useCallback(() => setTaskCreateOpen(true), []);
  const openCollectionForm = useCallback((form: CollectionFormRequest["form"]) => {
    setCollectionRequest({ form, key: Date.now() });
    openSection(SECTION_IDS.collection);
  }, []);
  const openCollection = useCallback(() => openSection(SECTION_IDS.collection), []);
  const logCall = useCallback(() => openCollectionForm("call"), [openCollectionForm]);

  const deleteBlocker = customerDeleteBlocker({
    orders: top.orders.length,
    projects: top.projects.length,
    leases: top.leases.length,
    morningDocuments: top.morningDocuments.length,
  });

  // The edit dialog opens with what the page shows now — the notes saved in
  // place and the inactive mark included, or saving it would undo them.
  const editInput = useMemo<EditCustomerInput>(
    () => ({
      id: customer.id,
      name: customer.name,
      name_for_invoice: customer.invoiceName,
      registration_number: customer.registrationNumber,
      phone: customer.phone,
      whatsapp: customer.whatsapp,
      email: customer.email,
      address: customer.address,
      notes,
      active,
      requires_prepayment: customer.requiresPrepayment,
      linked_user_id: customer.linkedUserId,
      contacts: top.contacts.map((contact) => ({
        id: contact.id,
        full_name: contact.fullName,
        role: contact.role,
        phone: contact.phone,
        email: contact.email,
        whatsapp: contact.whatsapp,
        is_primary: contact.isPrimary,
        active: contact.active,
        notes: contact.notes,
      })),
    }),
    [customer, notes, active, top.contacts]
  );

  const projectNames = useMemo(() => new Map(top.projects.map((project) => [project.id, project.name])), [top.projects]);
  // The Morning header's status follows the card (a create or a link there).
  const [morningStatus, setMorningStatus] = useState({
    matchStatus: customer.morningMatchStatus,
    hasError: Boolean(customer.morningLastSyncError),
  });

  return (
    // Phone: ONE vertical rhythm — 0.75rem between every card. Desktop keeps
    // the roomier stack, as the project page does.
    <div className="space-y-3 md:space-y-5">
      <CustomerPageHeading
        name={customer.name}
        actions={
          <CustomerHeaderMenu
            customerId={customer.id}
            customerName={customer.name}
            active={active}
            deleteBlocker={deleteBlocker}
            canManage={canManage}
            onEdit={openEdit}
            onNewTask={openNewTask}
            onCollectionForm={openCollectionForm}
            onActiveChange={setActive}
          />
        }
      />

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <CustomerProfileCard
          customer={customer}
          active={active}
          linkedWorker={top.linkedWorker}
          onLogCall={canManage ? logCall : null}
        >
          <div className="space-y-2">
            <CustomerTagsSection customerId={customer.id} tags={top.tags} />
            <CustomerDeliveryDetails
              customerId={customer.id}
              customerName={customer.name}
              instructions={customer.deliveryInstructions}
              pin={customer.deliveryPin}
            />
          </div>
        </CustomerProfileCard>
        <CustomerMoneyCard
          money={top.money}
          balance={top.balance}
          payments={payments}
          today={today}
          onCollectionActions={canManage ? openCollection : null}
        />
      </div>

      <div className="flex flex-col gap-3 lg:grid lg:grid-cols-2 lg:items-start">
        <div className="min-w-0 space-y-3">
          <CustomerOrdersSection
            customerId={customer.id}
            customerName={customer.name}
            orders={top.orders}
            error={top.errors.orders}
          />
          <CustomerProjectsSection
            customerId={customer.id}
            customerName={customer.name}
            projects={top.projects}
            error={top.errors.projects}
          />
          {canManage ? (
            <CustomerCollectionSection
              customerId={customer.id}
              customerName={customer.name}
              customerPhone={customer.phone}
              initialData={top.collection}
              hasDebt={top.money.openBalance > 0.009}
              formRequest={collectionRequest}
              onRequestForm={openCollectionForm}
              today={today}
            />
          ) : null}
          {canManage ? (
            <CustomerTasksSection
              customerId={customer.id}
              customerName={customer.name}
              customerPhone={customer.phone}
              tasks={top.tasks}
              users={top.taskUsers}
              currentUserId={viewer.id}
              today={today}
              createOpen={taskCreateOpen}
              onCreateOpenChange={setTaskCreateOpen}
            />
          ) : null}
          <CustomerPaymentsSection customerId={customer.id} customerName={customer.name} payments={payments} />
          {canManage ? <CustomerPromisesSection customerId={customer.id} promises={top.promises} /> : null}
        </div>

        <div className="min-w-0 space-y-3">
          <CustomerContactsSection
            customerId={customer.id}
            customerName={customer.name}
            contacts={top.contacts}
            branches={top.branches}
            onEditCustomer={openEdit}
          />
          <CustomerDocumentsSection
            customerId={customer.id}
            customerName={customer.name}
            documents={documents}
            projectNames={projectNames}
          />
          <CollapsibleSection
            id={SECTION_IDS.notes}
            title="הערות"
            icon={<NoteIcon className={SECTION_ICON_CLASS} />}
            // Written down for whoever deals with this customer next: open when there's something.
            defaultOpen={Boolean(customer.notes)}
            action={
              notes ? null : (
                <AddActionButton
                  label="הערה"
                  ariaLabel="הוספת הערה"
                  onClick={() => {
                    setNotesEditRequest((n) => n + 1);
                    openSection(SECTION_IDS.notes);
                  }}
                />
              )
            }
          >
            <CustomerNotesEditor
              customerId={customer.id}
              initialNotes={notes}
              onSaved={setNotes}
              editRequest={notesEditRequest}
            />
          </CollapsibleSection>
          <CollapsibleSection
            id={SECTION_IDS.morning}
            title="Morning"
            icon={<ReceiptIcon className={SECTION_ICON_CLASS} />}
            summary={
              <Badge className={morningStatusClass(morningStatus.matchStatus, morningStatus.hasError)}>
                {morningStatusLabel(morningStatus.matchStatus, morningStatus.hasError)}
              </Badge>
            }
          >
            <MorningCustomerCard
              customerId={customer.id}
              morningClientId={customer.morningClientId}
              morningMatchStatus={customer.morningMatchStatus}
              morningSyncedAt={customer.morningSyncedAt}
              morningLastSyncError={customer.morningLastSyncError}
              morningDocuments={top.morningDocuments}
              bare
              onStatusChange={setMorningStatus}
            />
          </CollapsibleSection>
          <CustomerLeasesSection leases={top.leases} />
          {history ? (
            <CollapsibleSection
              id={SECTION_IDS.history}
              title="היסטוריית פעילות"
              icon={<HistoryIcon className={SECTION_ICON_CLASS} />}
              summary={
                <Suspense fallback={<CountSkeleton />}>
                  <HistoryCount history={history} />
                </Suspense>
              }
            >
              <Suspense fallback={<div className="h-20 animate-pulse rounded-xl bg-muted/40" aria-busy="true" />}>
                <HistoryBody history={history} />
              </Suspense>
            </CollapsibleSection>
          ) : null}
        </div>
      </div>

      <EditCustomerButton
        customer={editInput}
        open={editOpen}
        onOpenChange={setEditOpen}
        onSaved={(payload) => {
          const saved = payload.customer;
          if ("notes" in saved) setNotes(typeof saved.notes === "string" && saved.notes ? saved.notes : null);
          if ("active" in saved) setActive(saved.active !== false);
        }}
      />
    </div>
  );
}
