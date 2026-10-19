import type { GlobalSearchReason } from "@/lib/global-search";
import type { CustomerSearchIndexEntry } from "@/app/(app)/customers/loadCustomers";
import type { OrderSearchIndexEntry } from "@/app/(app)/sales/loadOrders";
import type { ProjectSearchIndexEntry } from "@/app/(app)/projects/loadProjects";
import { fuzzyTextMatch, phoneMatchesQuery, substringMatch } from "@/lib/search/customerMatch";
import { PROJECT_TYPE_LABELS } from "@/lib/search/projectTypeLabels";

// Why the quick on-device search (searchOrderEntries / searchProjectEntries)
// brought a row in — the same checks it made, in the same order, so a row it
// found says which field matched and the screen can paint it (owner,
// 2026-10-19: "it should paint whatever it found matching so I understand").

function text(label: string, value: string | null | undefined): GlobalSearchReason[] {
  return value ? [{ kind: "text", label, value }] : [];
}

/** Which of a customer's fields the query matched (customerMatchesQuery's checks). */
export function customerMatchReason(customer: CustomerSearchIndexEntry | undefined, query: string): GlobalSearchReason[] {
  if (!customer || !query.trim()) return [];
  if (fuzzyTextMatch(customer.name, query)) return text("לקוח", customer.name);
  if (fuzzyTextMatch(customer.name_for_invoice, query)) return text("שם לחשבונית", customer.name_for_invoice);
  if (substringMatch(customer.email, query)) return text("אימייל", customer.email);
  if (substringMatch(customer.address, query)) return text("כתובת", customer.address);
  if (phoneMatchesQuery([customer.phone], query)) return text("טלפון", customer.phone);
  if (phoneMatchesQuery([customer.whatsapp], query)) return text("וואטסאפ", customer.whatsapp);
  for (const contact of customer.contacts ?? []) {
    if (fuzzyTextMatch(contact.full_name, query)) return text("איש קשר", contact.full_name);
    if (substringMatch(contact.email, query)) return text("אימייל איש קשר", contact.email);
    if (phoneMatchesQuery([contact.phone], query)) return text(`טלפון ${contact.full_name}`, contact.phone);
    if (phoneMatchesQuery([contact.whatsapp], query)) return text(`וואטסאפ ${contact.full_name}`, contact.whatsapp);
  }
  return [];
}

/** Why searchOrderEntries matched an order: its customer, or its branch. */
export function orderInstantReason(
  order: OrderSearchIndexEntry,
  customer: CustomerSearchIndexEntry | undefined,
  query: string
): GlobalSearchReason[] {
  const fromCustomer = customerMatchReason(customer, query);
  if (fromCustomer.length > 0) return fromCustomer;
  if (fuzzyTextMatch(order.customer_branch_name, query)) return text("סניף", order.customer_branch_name);
  return [];
}

/** Why searchProjectEntries matched a project: its name, its customer, or its type. */
export function projectInstantReason(
  project: ProjectSearchIndexEntry,
  customer: CustomerSearchIndexEntry | undefined,
  query: string
): GlobalSearchReason[] {
  // The name is the row's own title — painted there, nothing to add.
  if (fuzzyTextMatch(project.name, query)) return [];
  if (fuzzyTextMatch(project.customer_name, query)) return text("לקוח", project.customer_name);
  const fromCustomer = customerMatchReason(customer, query);
  if (fromCustomer.length > 0) return fromCustomer;
  return text("סוג", PROJECT_TYPE_LABELS[project.project_type]);
}
