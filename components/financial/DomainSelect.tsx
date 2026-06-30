"use client";

import { type ComponentType } from "react";
import { Boxes, Building2, FolderKanban, HandHeart, Home, ShoppingCart, Wallet } from "lucide-react";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  EXPENSE_BUSINESS_DOMAINS,
  getBusinessDomainLabel,
  type ExpenseBusinessDomain,
} from "@/lib/expenses";

// Per-domain icon, mirroring the nav-bar icons where a domain maps to a section
// (פרויקטים→FolderKanban, מכירות→ShoppingCart, ניהול נכסים→Building2) and a
// sensible glyph for the domains without a dedicated nav section.
const DOMAIN_ICONS: Record<ExpenseBusinessDomain, ComponentType<{ className?: string }>> = {
  home: Home,
  charity: HandHeart,
  general_business: Wallet,
  logistics_projects: FolderKanban,
  sales: ShoppingCart,
  property_management: Building2,
  spaceit: Boxes,
};

export function getBusinessDomainIcon(domain: string | null | undefined): ComponentType<{ className?: string }> | null {
  return domain && domain in DOMAIN_ICONS ? DOMAIN_ICONS[domain as ExpenseBusinessDomain] : null;
}

export interface DomainSelectProps {
  value: string;
  onChange: (value: string) => void;
  /** Restrict / order the selectable domains (defaults to all expense domains). */
  domains?: readonly ExpenseBusinessDomain[];
  /** Placeholder shown on the trigger when nothing is selected (blank by default). */
  placeholder?: string;
  /** When set, adds a clear/"all" row mapped to value="" (e.g. "כל התחומים" for filters). */
  emptyLabel?: string;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
}

/**
 * The shared "pick a business domain" dropdown — an icon-aware {@link SearchableSelect}
 * that shows each domain (בית / צדקה / שוטף / פרויקטים / מכירות / ניהול נכסים / ספייסיט)
 * with the matching nav-style icon. The trigger is left blank until a domain is chosen.
 */
export function DomainSelect({
  value,
  onChange,
  domains = EXPENSE_BUSINESS_DOMAINS,
  placeholder = "",
  emptyLabel,
  disabled = false,
  ariaLabel = "תחום",
  className,
}: DomainSelectProps) {
  const options = domains.map((domain) => {
    const Icon = DOMAIN_ICONS[domain];
    return {
      value: domain,
      label: getBusinessDomainLabel(domain),
      icon: <Icon className="h-4 w-4" />,
    };
  });

  return (
    <SearchableSelect
      options={options}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      emptyOptionLabel={emptyLabel}
      disabled={disabled}
      ariaLabel={ariaLabel}
      className={className}
      searchThreshold={Infinity}
    />
  );
}
