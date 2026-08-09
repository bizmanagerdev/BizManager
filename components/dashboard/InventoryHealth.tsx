import Link from "next/link";
import { InventoryIcon, StockDownIcon, StockOutIcon } from "@/components/ui/icons";
import type { IconComponent } from "@/components/ui/icons";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { InventoryHealth as InventoryHealthData, InventoryItem } from "@/lib/dashboard/inventory-health";

const numberFormatter = new Intl.NumberFormat("he-IL");

function itemsPreview(items: InventoryItem[], fallback: string) {
  if (items.length === 0) return fallback;
  return items.slice(0, 3).map((i) => i.name).join(", ");
}

/** "בריאות המלאי" — low stock / out of stock / reserved, with sample item names. */
export default function InventoryHealth({ data }: { data: InventoryHealthData }) {
  if (data.lowStockCount === 0 && data.outOfStockCount === 0 && data.reservedProducts === 0) {
    return null;
  }

  const cards: {
    value: number;
    label: string;
    detail: string;
    icon: IconComponent;
    color: string;
  }[] = [
    {
      value: data.lowStockCount,
      label: "מוצרים במלאי נמוך",
      detail: itemsPreview(data.lowStock, "המלאי תקין"),
      icon: StockDownIcon,
      color: "text-warning",
    },
    {
      value: data.outOfStockCount,
      label: "אזלו מהמלאי",
      detail: itemsPreview(data.outOfStock, "אין חוסרים"),
      icon: StockOutIcon,
      color: "text-destructive",
    },
    {
      value: data.reservedProducts,
      label: "מוצרים שמורים",
      detail: "הוקצו להזמנות פתוחות",
      icon: InventoryIcon,
      color: "text-secondary",
    },
  ];

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <InventoryIcon className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-lg">בריאות המלאי</CardTitle>
          </div>
          <Link href="/inventory" className="text-sm text-secondary hover:underline">
            ניהול מלאי ›
          </Link>
        </div>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <Link
              key={card.label}
              href="/inventory"
              className="rounded-2xl border p-4 text-right transition-colors hover:bg-muted/40"
            >
              <div className="flex items-center justify-between">
                <Icon className="h-5 w-5 text-muted-foreground" />
                <div className={cn("text-2xl font-bold", card.color)}>
                  {numberFormatter.format(card.value)}
                </div>
              </div>
              <div className="mt-1 font-medium">{card.label}</div>
              <div className="truncate text-xs text-muted-foreground" title={card.detail}>
                {card.detail}
              </div>
            </Link>
          );
        })}
      </CardContent>
    </Card>
  );
}
