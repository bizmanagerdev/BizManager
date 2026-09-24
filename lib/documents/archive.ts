// The shapes the documents archive passes around: one item as the page builds
// it, and the relations hanging off it. Their own module because the page
// component, its pure helpers and its stored preferences all need them, and a
// type import must not drag a client component along with it.

export type DocumentArchiveFilters = {
  customer_id: string;
  customer_name: string;
  customer_phone: string;
  customer_page: string;
  project_id: string;
  property_id: string;
  business_domain: string;
  entity_type: string;
  type: string;
  q: string;
  /** "unlinked" — money documents with no expense/payment link (the
   *  document_unlinked_money inbox rule links here). */
  money: string;
};

export type ArchiveRelation = {
  id: string;
  label: string;
  /** Where this relation lives — a customer page, an order, a vehicle. Null
   *  only for kinds with no page of their own. */
  href?: string | null;
};

export type ArchiveTargetOption = {
  /** Ranking hints for suggestions — an order knows who it is for and when. */
  customerId?: string | null;
  date?: string | null;
  id: string;
  label: string;
};

export type ArchiveLinkedEntity = {
  type: string;
  id: string;
  label: string;
  href: string | null;
};

export type DocumentArchiveItem = {
  id: string;
  title: string;
  file_name: string | null;
  document_type: string | null;
  source: string | null;
  valid_until: string | null;
  no_link_needed: boolean;
  file_kind: string;
  storage_key: string | null;
  uploaded_at: string | null;
  created_at: string | null;
  uploaded_by_name: string | null;
  uploaded_by_color: string | null;
  url: string | null;
  entity_types: string[];
  linked_entities: ArchiveLinkedEntity[];
  customers: ArchiveRelation[];
  projects: ArchiveRelation[];
  properties: ArchiveRelation[];
  tasks: ArchiveRelation[];
  orders: ArchiveRelation[];
  business_domains: string[];
  ref_year: number | null;
  tags: ArchiveRelation[];
  search_text: string;
};

/** A field label in the viewer's details rail — one tone lighter than the body. */
