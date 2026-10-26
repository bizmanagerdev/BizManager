"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { SectionCard, SECTION_ICON_CLASS, SectionCount } from "@/components/ui/section-card";
import { AddressPicker } from "@/components/ui/address-picker";
import { CallIconButton } from "@/components/ui/contact-link";
import { SEGMENT, SEGMENTED_GROUP, TOGGLE_OFF, TOGGLE_ON } from "@/components/ui/filter-chip";
import {
  AddIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  CashIcon,
  ClockIcon,
  CloseIcon,
  DeliveryIcon,
  ExternalLinkIcon,
  FlagIcon,
  InfoIcon,
  LocationIcon,
  RouteIcon,
  ShareIcon,
  SpinnerIcon,
  WarningIcon,
  WazeIcon,
} from "@/components/ui/icons";
import { addressLine, type StructuredAddress } from "@/lib/address/structured";
import { cityColour } from "@/lib/deliveries/city-colours";
import { wazeLinkForPin } from "@/lib/delivery-location";
import { formatShortDate } from "@/lib/date";
import { decodePolyline } from "@/lib/routes/polyline";
import {
  formatDistance,
  formatDuration,
  MAX_ROUTE_STOPS,
  stopPhase,
  type RouteCost,
  type RouteEnd,
  type RoutePlanRequest,
  type RoutePlanResult,
  type RoutePoint,
} from "@/lib/routes/plan";
import { isRoutable, type PlannerStop } from "@/lib/routes/planner-stops";
import { israelParts, israelWallClockToUtc } from "@/lib/timezone";
import { getCityRegion } from "@/lib/ui/cities";
import { cn } from "@/lib/utils";
import { legColour, type MapPoint, type MapStop } from "./map-parts";

const RouteMap = dynamic(() => import("./RouteMap"), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse bg-muted" />,
});

const REGIONS = ["צפון", "מרכז", "דרום"] as const;
const STORAGE_KEY = "bizh.routePlanner.v1";

type StartMode = "gps" | "address";
type EndMode = "return" | "last" | "address";

/** What the planner keeps on this device between visits (never the stops: they change daily). */
type Saved = {
  startMode: StartMode;
  startAddress: StructuredAddress | null;
  endMode: EndMode;
  endAddress: StructuredAddress | null;
  objective: "time" | "distance";
  serviceMinutes: number;
};

function readSaved(): Saved {
  const fallback: Saved = { startMode: "address", startAddress: null, endMode: "return", endAddress: null, objective: "time", serviceMinutes: 10 };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<Saved> | null;
    if (!saved) return fallback;
    return {
      startMode: saved.startMode === "gps" ? "gps" : "address",
      startAddress: saved.startAddress ?? null,
      endMode: saved.endMode === "last" || saved.endMode === "address" ? saved.endMode : "return",
      endAddress: saved.endAddress ?? null,
      objective: saved.objective === "distance" ? "distance" : "time",
      serviceMinutes:
        typeof saved.serviceMinutes === "number" && saved.serviceMinutes >= 0 && saved.serviceMinutes <= 120 ? saved.serviceMinutes : 10,
    };
  } catch {
    // No storage on this device (a private window): the defaults.
    return fallback;
  }
}

type Plan = {
  result: RoutePlanResult;
  /** The stops in visiting order, as they were when the plan was worked out. */
  stops: PlannerStop[];
  start: RoutePoint;
  startLabel: string;
  end: RoutePoint | null;
  endLabel: string;
  endIsStart: boolean;
  serviceMinutes: number;
  objective: "time" | "distance";
  steps: string[];
  signature: string;
};

type PlanError = { message: string; setup?: boolean; unreachable?: string[] };

export function formatCount(n: number): string {
  if (n < 1e6) return Math.round(n).toLocaleString("he-IL");
  for (const [size, word] of [
    [1e12, "טריליון"],
    [1e9, "מיליארד"],
    [1e6, "מיליון"],
  ] as const) {
    if (n >= size && n / size < 1000) {
      const v = n / size;
      return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${word}`;
    }
  }
  return "יותר ממיליון מיליארד";
}

/** "08:30" today in Israel — tomorrow if that hour has already passed. Null for now. */
export function departureFrom(time: string, now: Date): Date | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!match) return null;
  const today = israelParts(now);
  let at = israelWallClockToUtc(today.year, today.month, today.day, Number(match[1]), Number(match[2]));
  if (at.getTime() < now.getTime() - 5 * 60_000) at = new Date(at.getTime() + 24 * 3600_000);
  return at;
}

function clock(iso: string): string {
  const p = israelParts(new Date(iso));
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

function pointOf(address: StructuredAddress | null): RoutePoint | null {
  return address && address.lat !== null && address.lng !== null ? { lat: address.lat, lng: address.lng } : null;
}

/** "הרצל 5, ירושלים" — the city added when the address line doesn't name it. */
function placeLine(stop: PlannerStop): string {
  return [stop.address, stop.address.includes(stop.city) ? null : stop.city].filter(Boolean).join(", ");
}

function currentPosition(): Promise<RoutePoint> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new Error("המכשיר לא נותן מיקום. בחרו כתובת יציאה."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude }),
      () => reject(new Error("לא הצלחנו לקבל את המיקום שלכם. אשרו גישה למיקום או בחרו כתובת יציאה.")),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 }
    );
  });
}

/** Google Maps links for the route, 9 stops between each start and end at most (Google's limit). */
export function googleMapsLinks(points: RoutePoint[]): string[] {
  const at = (p: RoutePoint) => `${p.lat},${p.lng}`;
  const links: string[] = [];
  for (let from = 0; from < points.length - 1; from += 10) {
    const part = points.slice(from, Math.min(points.length, from + 11));
    const params = new URLSearchParams({ api: "1", origin: at(part[0]), destination: at(part[part.length - 1]), travelmode: "driving" });
    const middle = part.slice(1, -1);
    if (middle.length > 0) params.set("waypoints", middle.map(at).join("|"));
    links.push(`https://www.google.com/maps/dir/?${params.toString()}`);
  }
  return links;
}

/** The route as text for the driver: each stop with its time, address, phone and Waze link. */
function shareText(plan: Plan): string {
  const { result } = plan;
  const lines = [
    `מסלול משלוחים · יציאה ${clock(result.departure)} מ${plan.startLabel}`,
    `${plan.stops.length} עצירות · ${formatDuration(result.total.durationSec)} נסיעה · ${formatDistance(result.total.distanceM)}`,
    "",
  ];
  plan.stops.forEach((stop, index) => {
    lines.push(`${index + 1}. ${clock(result.arrivals[index])} · ${stop.name}`);
    const place = placeLine(stop);
    if (place) lines.push(`   ${place}`);
    if (stop.phone) lines.push(`   ${stop.phone}`);
    if (stop.collectOnDelivery) lines.push('   גבייה ע"י הנהג');
    if (stop.lat !== null && stop.lng !== null) lines.push(`   ${wazeLinkForPin({ lat: stop.lat, lng: stop.lng })}`);
  });
  lines.push("", `סיום משוער: ${clock(result.finish)}${plan.endIsStart ? " (חזרה לנקודת היציאה)" : plan.end ? ` · ${plan.endLabel}` : ""}`);
  return lines.join("\n");
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div className={cn(SEGMENTED_GROUP, "flex w-full", className)} role="radiogroup">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(SEGMENT, "flex-1 px-2 text-center", value === option.value ? TOGGLE_ON : TOGGLE_OFF)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function CityDot({ city, className }: { city: string; className?: string }) {
  return <span aria-hidden className={cn("inline-block h-2.5 w-2.5 shrink-0 rounded-full", className)} style={{ backgroundColor: cityColour(city) }} />;
}

const chipClass = (on: boolean) =>
  cn("rounded-full border px-3 py-1 text-xs font-semibold", on ? `border-secondary ${TOGGLE_ON}` : `border-border bg-background ${TOGGLE_OFF}`);

/** Why a stop can't be in the route, in the words the office uses. */
function missingReason(stop: PlannerStop): string {
  if (stop.notFound) return "הכתובת לא נמצאה ב-Google";
  if (!stop.address.trim() || stop.address.trim() === stop.city.trim()) return "שמורה רק עיר — בלי רחוב ומספר בית";
  return "הכתובת לא נבחרה מרשימת Google — אין לה נקודה על המפה";
}

export default function RoutePlanner({ stops, canEditAddress }: { stops: PlannerStop[]; canEditAddress: boolean }) {
  const [extras, setExtras] = useState<PlannerStop[]>([]);
  const allStops = useMemo(() => [...stops, ...extras], [stops, extras]);
  const routable = useMemo(() => allStops.filter(isRoutable), [allStops]);
  const missing = useMemo(() => stops.filter((stop) => !isRoutable(stop)), [stops]);

  // Every stop with a place on the map starts chosen; the chips and boxes narrow it.
  const [selected, setSelected] = useState<Set<string>>(() => new Set(stops.filter(isRoutable).map((s) => s.key)));
  const chosen = useMemo(() => routable.filter((stop) => selected.has(stop.key)), [routable, selected]);

  // The last start, end and settings, kept on this device (the planner is drawn in the browser only).
  const [saved] = useState(readSaved);
  const [startMode, setStartMode] = useState<StartMode>(saved.startMode);
  const [startAddress, setStartAddress] = useState<StructuredAddress | null>(saved.startAddress);
  const [gpsPoint, setGpsPoint] = useState<RoutePoint | null>(null);
  const [endMode, setEndMode] = useState<EndMode>(saved.endMode);
  const [endAddress, setEndAddress] = useState<StructuredAddress | null>(saved.endAddress);
  const [orderMode, setOrderMode] = useState<"auto" | "custom">("auto");
  const [steps, setSteps] = useState<string[]>([]);
  const [restFirst, setRestFirst] = useState(false);
  const [objective, setObjective] = useState<"time" | "distance">(saved.objective);
  const [departureTime, setDepartureTime] = useState("");
  const [serviceMinutes, setServiceMinutes] = useState(saved.serviceMinutes);

  const [adding, setAdding] = useState(false);
  const [extraAddress, setExtraAddress] = useState<StructuredAddress | null>(null);
  const [extraNote, setExtraNote] = useState("");

  const [plan, setPlan] = useState<Plan | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<PlanError | null>(null);
  const [activeLeg, setActiveLeg] = useState<number | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const next: Saved = { startMode, startAddress, endMode, endAddress, objective, serviceMinutes };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Not kept; nothing else depends on it.
    }
  }, [startMode, startAddress, endMode, endAddress, objective, serviceMinutes]);

  // The places on offer for "first … then …": the regions and the cities of the chosen stops.
  const presentRegions = REGIONS.filter((region) => chosen.some((stop) => getCityRegion(stop.city) === region));
  const presentCities = Array.from(new Set(chosen.map((stop) => stop.city))).sort((a, b) => a.localeCompare(b, "he"));
  const stepOptions: string[] = [...presentRegions, ...presentCities];
  const activeSteps = orderMode === "custom" ? steps : [];
  const phaseOf = (stop: PlannerStop) => stopPhase(stop.city, activeSteps, restFirst);
  const stepCounts = activeSteps.map((_, index) => chosen.filter((stop) => phaseOf(stop) === index + (restFirst ? 1 : 0)).length);
  const restCount = chosen.filter((stop) => phaseOf(stop) === (restFirst ? 0 : activeSteps.length)).length;

  const startPoint = startMode === "gps" ? gpsPoint : pointOf(startAddress);
  const endPoint: RoutePoint | null = endMode === "address" ? pointOf(endAddress) : null;

  // What a worked-out plan was asked with; a change shows "חישוב מחדש".
  const signature = JSON.stringify({
    keys: chosen.map((stop) => stop.key),
    start: startMode === "gps" ? "gps" : startPoint,
    endMode,
    endPoint,
    steps: activeSteps,
    restFirst,
    objective,
    departureTime,
    serviceMinutes,
  });
  const stale = plan !== null && plan.signature !== signature;

  const blocker =
    chosen.length === 0
      ? "בחרו לפחות עצירה אחת."
      : chosen.length > MAX_ROUTE_STOPS
        ? `נבחרו ${chosen.length} עצירות — אפשר עד ${MAX_ROUTE_STOPS} במסלול אחד.`
        : startMode === "address" && !startPoint
          ? "בחרו מאיפה יוצאים."
          : endMode === "address" && !endPoint
            ? "בחרו איפה מסיימים."
            : null;

  const compute = async () => {
    if (blocker || working) return;
    setWorking(true);
    setError(null);
    try {
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        throw new Error("אין חיבור לרשת — תכנון מסלול צריך את Google.");
      }
      const start = startMode === "gps" ? await currentPosition() : startPoint;
      if (startMode === "gps") setGpsPoint(start);
      if (!start) throw new Error("בחרו מאיפה יוצאים.");
      const end: RouteEnd =
        endMode === "last" ? { mode: "last" } : endMode === "address" && endPoint ? { mode: "point", point: endPoint } : { mode: "return" };
      const departure = departureFrom(departureTime, new Date());
      const request: RoutePlanRequest = {
        start,
        end,
        stops: chosen.map((stop) => ({ id: stop.key, lat: stop.lat!, lng: stop.lng!, phase: phaseOf(stop) })),
        objective,
        departure: departure ? departure.toISOString() : null,
        serviceMinutes,
      };
      const res = await fetch("/api/deliveries/route-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      const body = (await res.json().catch(() => ({}))) as RoutePlanResult & PlanError & { error?: string };
      if (!res.ok) {
        setError({ message: body.error || "חישוב המסלול נכשל. נסו שוב.", setup: body.setup, unreachable: body.unreachable });
        return;
      }
      const byKey = new Map(chosen.map((stop) => [stop.key, stop]));
      setPlan({
        result: body,
        stops: body.order.map((key) => byKey.get(key)).filter((stop): stop is PlannerStop => Boolean(stop)),
        start,
        startLabel: startMode === "gps" ? "המיקום שלי" : addressLine(startAddress!, { withUnit: false }),
        end: endMode === "address" ? endPoint : null,
        endLabel: endMode === "address" && endAddress ? addressLine(endAddress, { withUnit: false }) : "",
        endIsStart: endMode === "return",
        serviceMinutes,
        objective,
        steps: activeSteps,
        signature,
      });
      setActiveLeg(null);
      // On a phone the results are below the settings: bring them up.
      requestAnimationFrame(() => {
        if (window.matchMedia("(max-width: 1023px)").matches) {
          resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });
    } catch (e) {
      setError({ message: e instanceof Error ? e.message : "חישוב המסלול נכשל. נסו שוב." });
    } finally {
      setWorking(false);
    }
  };

  // ── Choosing stops ──
  const toggle = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const allOn = (members: PlannerStop[]) => members.length > 0 && members.every((stop) => selected.has(stop.key));
  const toggleGroup = (members: PlannerStop[]) =>
    setSelected((prev) => {
      const next = new Set(prev);
      const on = members.every((stop) => next.has(stop.key));
      for (const stop of members) {
        if (on) next.delete(stop.key);
        else next.add(stop.key);
      }
      return next;
    });
  const routableRegions = REGIONS.map((region) => ({
    region,
    members: routable.filter((stop) => getCityRegion(stop.city) === region),
  })).filter((group) => group.members.length > 0);
  const routableCities = Array.from(new Set(routable.map((stop) => stop.city)))
    .sort((a, b) => a.localeCompare(b, "he"))
    .map((city) => ({ city, members: routable.filter((stop) => stop.city === city) }));

  const addExtra = () => {
    const point = pointOf(extraAddress);
    if (!extraAddress || !point) return;
    const key = `extra:${Date.now().toString(36)}`;
    const note = extraNote.trim();
    setExtras((prev) => [
      ...prev,
      {
        key,
        kind: "extra",
        name: note || "עצירה נוספת",
        phone: null,
        city: extraAddress.city,
        address: addressLine(extraAddress),
        lat: point.lat,
        lng: point.lng,
        notFound: false,
        customerId: null,
        orderIds: [],
        collectOnDelivery: false,
        requestedDate: null,
        note: note || null,
      },
    ]);
    setSelected((prev) => new Set(prev).add(key));
    setExtraAddress(null);
    setExtraNote("");
    setAdding(false);
  };
  const removeExtra = (key: string) => {
    setExtras((prev) => prev.filter((stop) => stop.key !== key));
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  };

  // ── "First … then …" ──
  const addStep = () => {
    const unused = stepOptions.find((option) => !steps.includes(option));
    if (unused) setSteps((prev) => [...prev, unused]);
  };
  const moveStep = (index: number, by: -1 | 1) =>
    setSteps((prev) => {
      const next = [...prev];
      const to = index + by;
      if (to < 0 || to >= next.length) return prev;
      [next[index], next[to]] = [next[to], next[index]];
      return next;
    });
  const presets =
    presentRegions.length >= 2
      ? [
          { label: "צפון ← דרום", steps: REGIONS.filter((r) => presentRegions.includes(r)) as string[] },
          { label: "דרום ← צפון", steps: [...REGIONS].reverse().filter((r) => presentRegions.includes(r)) as string[] },
        ]
      : [];

  // ── The map ──
  const showPlan = plan !== null && !stale;
  const mapStops: MapStop[] = useMemo(() => {
    if (plan && showPlan) {
      return plan.stops.map((stop, index) => ({
        key: stop.key,
        lat: stop.lat!,
        lng: stop.lng!,
        color: cityColour(stop.city),
        label: `${index + 1}. ${stop.name}`,
        number: index + 1,
      }));
    }
    return chosen.map((stop) => ({ key: stop.key, lat: stop.lat!, lng: stop.lng!, color: cityColour(stop.city), label: stop.name, number: null }));
  }, [plan, showPlan, chosen]);
  const mapLegs = useMemo(() => {
    if (!plan || !showPlan) return [];
    const points = [
      plan.start,
      ...plan.stops.map((stop) => ({ lat: stop.lat!, lng: stop.lng! })),
      ...(plan.endIsStart ? [plan.start] : plan.end ? [plan.end] : []),
    ];
    return plan.result.legs.map((leg, index): Array<[number, number]> =>
      leg.polyline
        ? decodePolyline(leg.polyline)
        : [
            [points[index].lat, points[index].lng],
            [points[index + 1].lat, points[index + 1].lng],
          ]
    );
  }, [plan, showPlan]);
  const mapStart: MapPoint | null = plan && showPlan ? plan.start : startPoint;
  const mapEnd: MapPoint | null = plan && showPlan ? plan.end : endPoint;
  const mapEndIsStart = plan && showPlan ? plan.endIsStart : endMode === "return";

  const share = async () => {
    if (!plan) return;
    const text = shareText(plan);
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await navigator.share({ title: "מסלול משלוחים", text });
        return;
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      toast.success("המסלול הועתק — אפשר להדביק בוואטסאפ");
    } catch {
      toast.error("לא הצלחנו להעתיק את המסלול.");
    }
  };
  const mapsLinks = plan
    ? googleMapsLinks([
        plan.start,
        ...plan.stops.map((stop) => ({ lat: stop.lat!, lng: stop.lng! })),
        ...(plan.endIsStart ? [plan.start] : plan.end ? [plan.end] : []),
      ])
    : [];
  const unreachableNames = (error?.unreachable ?? [])
    .map((key) => allStops.find((stop) => stop.key === key)?.name)
    .filter(Boolean);

  return (
    // One column no wider than the screen on a phone (a long line can't stretch it past the edge).
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(340px,420px)_minmax(0,1fr)] lg:items-start">
      {/* The map: first on a phone, beside the settings on a computer. */}
      <div className="relative h-72 overflow-hidden rounded-card border border-border/60 shadow-card sm:h-96 lg:col-start-2 lg:row-start-1 lg:h-[520px]">
        <RouteMap
          className="h-full w-full"
          start={mapStart}
          end={mapEnd}
          endIsStart={mapEndIsStart}
          stops={mapStops}
          legs={mapLegs}
          activeLeg={activeLeg}
        />
        {plan && showPlan ? (
          <div className="pointer-events-none absolute inset-x-2 top-2 z-[1000] flex justify-center">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-full border border-border/60 bg-background/95 px-4 py-1.5 text-sm shadow-card">
              <span className="font-bold">{formatDuration(plan.result.total.durationSec)}</span>
              <span className="text-muted-foreground">{formatDistance(plan.result.total.distanceM)}</span>
              <span className="text-muted-foreground">{plan.stops.length} עצירות</span>
            </div>
          </div>
        ) : null}
      </div>

      {/* The settings. */}
      <div className="space-y-4 lg:col-start-1 lg:row-span-2 lg:row-start-1">
        {missing.length > 0 ? (
          <div role="alert" className="space-y-2 rounded-card border border-warning bg-warning-soft p-3 text-warning-soft-foreground">
            <div className="flex items-start gap-2 text-sm font-semibold">
              <WarningIcon className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                {missing.length === 1
                  ? "משלוח אחד בלי כתובת מדויקת — הוא לא ייכנס למסלול"
                  : `${missing.length} משלוחים בלי כתובת מדויקת — הם לא ייכנסו למסלול`}
              </span>
            </div>
            <ul className="space-y-1.5 text-sm">
              {missing.map((stop) => (
                <li key={stop.key} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg bg-background/70 px-2.5 py-1.5 text-foreground">
                  <CityDot city={stop.city} />
                  <span className="font-medium">{stop.name}</span>
                  <span className="text-muted-foreground">· {stop.city}</span>
                  <span className="w-full text-xs text-muted-foreground">
                    {stop.address && stop.address.trim() !== stop.city.trim() ? `"${stop.address}" — ` : ""}
                    {missingReason(stop)}
                  </span>
                  {canEditAddress && stop.customerId ? (
                    <Link href={`/customers/${stop.customerId}`} className="text-xs font-semibold text-secondary hover:underline">
                      עדכון הכתובת בכרטיס הלקוח
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <SectionCard icon={<DeliveryIcon className={SECTION_ICON_CLASS} />} title="עצירות במסלול" aside={<SectionCount count={chosen.length} />}>
          {routable.length === 0 ? (
            <p className="text-sm text-muted-foreground">אין משלוחים פתוחים עם כתובת על המפה. אפשר להוסיף עצירה למטה.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setSelected(allOn(routable) ? new Set() : new Set(routable.map((stop) => stop.key)))}
                aria-pressed={allOn(routable)}
                className={chipClass(allOn(routable))}
              >
                הכל · {routable.length}
              </button>
              {/* "רק צפון" only when there's more than one region to choose from. */}
              {(routableRegions.length > 1 ? routableRegions : []).map(({ region, members }) => {
                const only = allOn(members) && chosen.length === members.length;
                return (
                  <button
                    key={region}
                    type="button"
                    // "רק צפון": only the north; pressed again, everything back.
                    onClick={() => setSelected(new Set((only ? routable : members).map((stop) => stop.key)))}
                    aria-pressed={only}
                    className={chipClass(only)}
                  >
                    רק {region} · {members.length}
                  </button>
                );
              })}
              {routableCities.map(({ city, members }) => (
                <button
                  key={city}
                  type="button"
                  onClick={() => toggleGroup(members)}
                  aria-pressed={allOn(members)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold",
                    allOn(members) ? "border-secondary/50 bg-secondary/10 text-foreground" : `border-border bg-background ${TOGGLE_OFF}`
                  )}
                >
                  <CityDot city={city} className="h-2 w-2" />
                  {city} · {members.length}
                </button>
              ))}
            </div>
          )}

          {routable.length > 0 ? (
            <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/60">
              {routable.map((stop) => {
                const on = selected.has(stop.key);
                return (
                  <li key={stop.key} className={cn("flex items-start gap-2.5 p-2.5", !on && "opacity-55")}>
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggle(stop.key)}
                      aria-label={`${stop.name} במסלול`}
                      className="mt-1 h-4 w-4 shrink-0 accent-secondary"
                    />
                    <button type="button" onClick={() => toggle(stop.key)} className="min-w-0 flex-1 text-right">
                      <span className="flex items-start gap-1.5">
                        <CityDot city={stop.city} className="mt-1.5" />
                        <span className="min-w-0 break-words text-sm font-semibold">{stop.name}</span>
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">{placeLine(stop)}</span>
                      <span className="mt-1 flex flex-wrap gap-1">
                        {stop.kind === "extra" ? (
                          <span className="rounded-full bg-secondary/10 px-2 py-0.5 text-[0.7rem] font-semibold text-secondary">עצירה נוספת</span>
                        ) : null}
                        {stop.orderIds.length > 1 ? (
                          <span className="rounded-full bg-muted px-2 py-0.5 text-[0.7rem] text-muted-foreground">{stop.orderIds.length} משלוחים</span>
                        ) : null}
                        {stop.collectOnDelivery ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-warning-soft px-2 py-0.5 text-[0.7rem] font-semibold text-warning-soft-foreground">
                            <CashIcon className="h-3 w-3" />
                            גבייה
                          </span>
                        ) : null}
                        {stop.requestedDate ? (
                          <span className="rounded-full border border-border px-2 py-0.5 text-[0.7rem] text-muted-foreground">
                            למשלוח: {formatShortDate(stop.requestedDate)}
                          </span>
                        ) : null}
                      </span>
                    </button>
                    {stop.kind === "extra" ? (
                      <button
                        type="button"
                        onClick={() => removeExtra(stop.key)}
                        aria-label="הסרת העצירה"
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        <CloseIcon className="h-4 w-4" />
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : null}

          {adding ? (
            <div className="space-y-2 rounded-xl border border-dashed border-secondary/40 p-3">
              <p className="text-sm font-semibold">עצירה נוספת במסלול</p>
              <AddressPicker value={extraAddress} onChange={setExtraAddress} allowUnit={false} ariaLabel="כתובת העצירה" />
              <Input
                value={extraNote}
                onChange={(e) => setExtraNote(e.target.value)}
                placeholder="מה עושים שם? (לא חובה) — למשל איסוף סחורה"
                aria-label="מה עושים בעצירה"
              />
              <div className="flex gap-2">
                <Button type="button" size="sm" onClick={addExtra} disabled={!pointOf(extraAddress)}>
                  הוספה למסלול
                </Button>
                <Button type="button" size="sm" variant="muted" onClick={() => setAdding(false)}>
                  ביטול
                </Button>
              </div>
            </div>
          ) : (
            <Button type="button" variant="soft" size="sm" className="w-full" onClick={() => setAdding(true)}>
              <AddIcon />
              עצירה נוספת (כתובת שלא במשלוחים)
            </Button>
          )}
        </SectionCard>

        <SectionCard icon={<LocationIcon className={SECTION_ICON_CLASS} />} title="יציאה וסיום">
          <div className="space-y-2">
            <p className="text-sm font-medium">יוצאים מ…</p>
            <Segmented
              value={startMode}
              onChange={setStartMode}
              options={[
                { value: "address", label: "כתובת" },
                { value: "gps", label: "המיקום שלי" },
              ]}
            />
            {startMode === "address" ? (
              <AddressPicker value={startAddress} onChange={setStartAddress} allowUnit={false} ariaLabel="כתובת היציאה" placeholder="מאיפה יוצאים? רחוב ומספר" />
            ) : (
              <p className="text-xs text-muted-foreground">המיקום של המכשיר נלקח ברגע החישוב.</p>
            )}
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">מסיימים ב…</p>
            <Segmented
              value={endMode}
              onChange={setEndMode}
              options={[
                { value: "return", label: "חזרה להתחלה" },
                { value: "last", label: "בעצירה האחרונה" },
                { value: "address", label: "כתובת אחרת" },
              ]}
            />
            {endMode === "address" ? (
              <AddressPicker value={endAddress} onChange={setEndAddress} allowUnit={false} ariaLabel="כתובת הסיום" placeholder="איפה מסיימים? רחוב ומספר" />
            ) : null}
          </div>
        </SectionCard>

        <SectionCard icon={<RouteIcon className={SECTION_ICON_CLASS} />} title="סדר הנסיעה">
          <Segmented
            value={orderMode}
            onChange={(mode) => {
              setOrderMode(mode);
              if (mode === "custom" && steps.length === 0 && stepOptions.length > 0) setSteps([stepOptions[0]]);
            }}
            options={[
              { value: "auto", label: "הכי טוב — Google בוחר" },
              { value: "custom", label: "אני קובע מה קודם" },
            ]}
          />
          {orderMode === "custom" ? (
            <div className="space-y-2">
              {presets.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  {presets.map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => setSteps(preset.steps)}
                      className={chipClass(JSON.stringify(steps) === JSON.stringify(preset.steps))}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              ) : null}
              <ol className="space-y-1.5">
                {steps.map((step, index) => (
                  <li key={index} className="flex items-center gap-1.5">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-bold text-secondary-foreground">
                      {index + 1}
                    </span>
                    <NativeSelect
                      dense
                      value={step}
                      onChange={(e) => setSteps((prev) => prev.map((s, i) => (i === index ? e.target.value : s)))}
                      aria-label={`שלב ${index + 1}`}
                      className="min-w-0 flex-1"
                    >
                      {[...stepOptions, ...(stepOptions.includes(step) ? [] : [step])].map((option) => (
                        <option key={option} value={option}>
                          {(REGIONS as readonly string[]).includes(option) ? `אזור ${option}` : option}
                        </option>
                      ))}
                    </NativeSelect>
                    <span className="w-14 shrink-0 text-center text-xs text-muted-foreground">{stepCounts[index]} עצירות</span>
                    <button
                      type="button"
                      onClick={() => moveStep(index, -1)}
                      disabled={index === 0}
                      aria-label="להקדים"
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted disabled:opacity-30"
                    >
                      <ArrowUpIcon className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveStep(index, 1)}
                      disabled={index === steps.length - 1}
                      aria-label="לאחר"
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted disabled:opacity-30"
                    >
                      <ArrowDownIcon className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setSteps((prev) => prev.filter((_, i) => i !== index))}
                      aria-label="הסרת השלב"
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <CloseIcon className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ol>
              {stepOptions.some((option) => !steps.includes(option)) ? (
                <Button type="button" variant="soft" size="sm" onClick={addStep}>
                  <AddIcon />
                  ואז…
                </Button>
              ) : null}
              {restCount > 0 && steps.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>{restCount === 1 ? "עצירה אחת שלא בשלבים:" : `${restCount} עצירות שלא בשלבים:`}</span>
                  <Segmented
                    className="w-auto"
                    value={restFirst ? "first" : "last"}
                    onChange={(value) => setRestFirst(value === "first")}
                    options={[
                      { value: "last", label: "בסוף" },
                      { value: "first", label: "בהתחלה" },
                    ]}
                  />
                </div>
              ) : null}
              <p className="text-xs text-muted-foreground">בתוך כל שלב Google מוצא את הסדר הכי טוב.</p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Google בוחר את הסדר הכי טוב, עם העומס הצפוי בכל שעה של הנסיעה.</p>
          )}
        </SectionCard>

        <SectionCard icon={<ClockIcon className={SECTION_ICON_CLASS} />} title="זמנים">
          <Segmented
            value={objective}
            onChange={setObjective}
            options={[
              { value: "time", label: "הכי מהיר (זמן)" },
              { value: "distance", label: "הכי קצר (ק״מ)" },
            ]}
          />
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1 text-sm">
              <span className="font-medium">שעת יציאה</span>
              <Input type="time" value={departureTime} onChange={(e) => setDepartureTime(e.target.value)} aria-label="שעת יציאה" />
              <span className="block text-xs text-muted-foreground">{departureTime ? "העומס הצפוי מהשעה הזו" : "ריק = עכשיו"}</span>
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">דקות בכל עצירה</span>
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                max={120}
                value={serviceMinutes}
                onChange={(e) => setServiceMinutes(Math.max(0, Math.min(120, Number(e.target.value) || 0)))}
                aria-label="דקות בכל עצירה"
              />
              <span className="block text-xs text-muted-foreground">לפריקה ומסירה</span>
            </label>
          </div>
        </SectionCard>

        {/* Held at the bottom of the screen on a computer, on a solid strip so the list scrolls under it. */}
        <div className="space-y-2 lg:sticky lg:bottom-0 lg:-mx-1 lg:rounded-t-card lg:bg-background lg:px-1 lg:pb-3 lg:pt-2">

          <Button type="button" size="lg" className="w-full gap-2" onClick={compute} disabled={Boolean(blocker) || working}>
            {working ? <SpinnerIcon className="animate-spin" /> : <RouteIcon />}
            {working ? "Google מתכנן את המסלול…" : plan && !stale ? "תכנון מחדש" : `תכנון המסלול · ${chosen.length} עצירות`}
          </Button>
          {blocker ? <p className="text-center text-xs text-muted-foreground">{blocker}</p> : null}
        </div>
      </div>

      {/* The results. */}
      <div ref={resultsRef} className="scroll-mt-20 space-y-4 lg:col-start-2 lg:row-start-2">
        {error ? (
          <div role="alert" className="space-y-1.5 rounded-card border border-destructive/40 bg-destructive/5 p-3 text-sm">
            <p className="flex items-start gap-2 font-semibold text-destructive">
              <WarningIcon className="mt-0.5 h-4 w-4 shrink-0" />
              {error.message}
            </p>
            {unreachableNames.length > 0 ? <p>לא נמצאה דרך אל: {unreachableNames.join(", ")}. הורידו אותן מהמסלול ונסו שוב.</p> : null}
            {error.setup ? <p className="text-muted-foreground">זה חלק מההגדרה ב-Google Cloud. אחרי שהיא תושלם, המסלול יתוכנן כאן.</p> : null}
          </div>
        ) : null}

        {stale ? (
          <div className="flex flex-wrap items-center gap-2 rounded-card border border-secondary/40 bg-secondary/5 p-3 text-sm">
            <InfoIcon className="h-4 w-4 shrink-0 text-secondary" />
            <span className="flex-1">שיניתם את ההגדרות — המסלול שלמטה הוא הקודם.</span>
            <Button type="button" size="sm" onClick={compute} disabled={Boolean(blocker) || working}>
              תכנון מחדש
            </Button>
          </div>
        ) : null}

        {!plan ? (
          <Card className="space-y-2 p-4 text-sm text-muted-foreground">
            <p className="flex items-center gap-2 font-semibold text-foreground">
              <RouteIcon className="h-4 w-4 text-secondary" />
              איך זה עובד
            </p>
            <p>בוחרים עצירות, מאיפה יוצאים ואיפה מסיימים — ואם צריך, מה קודם (למשל ירושלים ואז צפון).</p>
            <p>
              מתכנן המסלולים של Google — אותו מתכנן שחברות משלוחים עובדות איתו — בוחר את הסדר עם העומס הצפוי בכל קטע בשעה שתגיעו אליו, לא רק
              העומס של עכשיו.
            </p>
            <p>מקבלים מפה, שעת הגעה לכל עצירה, ניווט ב-Waze לכל אחת, ומסלול לשליחה לנהג.</p>
          </Card>
        ) : (
          <>
            <Card className={cn("space-y-3 p-4", stale && "opacity-60")}>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div>
                  <p className="text-xs text-muted-foreground">זמן נסיעה</p>
                  <p className="text-xl font-bold tabular-nums">{formatDuration(plan.result.total.durationSec)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">מרחק</p>
                  <p className="text-xl font-bold tabular-nums">{formatDistance(plan.result.total.distanceM)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">יציאה</p>
                  <p className="text-xl font-bold tabular-nums">{clock(plan.result.departure)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">סיום משוער</p>
                  <p className="text-xl font-bold tabular-nums">{clock(plan.result.finish)}</p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">כולל {plan.serviceMinutes} דק׳ בכל עצירה · זמני הנסיעה עם העומס הצפוי בכל קטע</p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={share} className="gap-1.5">
                  <ShareIcon />
                  שליחת המסלול לנהג
                </Button>
                {mapsLinks.map((href, index) => (
                  <Button key={href} asChild variant="outline" className="gap-1.5">
                    <a href={href} target="_blank" rel="noopener noreferrer">
                      <ExternalLinkIcon />
                      {mapsLinks.length > 1 ? `Google Maps · חלק ${index + 1}` : "פתיחה ב-Google Maps"}
                    </a>
                  </Button>
                ))}
              </div>
            </Card>

            <WhyCard plan={plan} />

            <Card className={cn("p-2 sm:p-3", stale && "opacity-60")}>
              <ol>
                <TimelinePoint
                  marker={<span className="text-[0.7rem] font-bold">{plan.endIsStart ? "⇆" : "▶"}</span>}
                  markerClass="bg-emerald-700 text-white"
                  title={plan.startLabel}
                  meta={`יציאה ${clock(plan.result.departure)}`}
                />
                {plan.stops.map((stop, index) => (
                  <li key={stop.key}>
                    <TimelineLeg
                      index={index}
                      count={plan.result.legs.length}
                      leg={plan.result.legs[index]}
                      active={activeLeg === index}
                      onHover={setActiveLeg}
                    />
                    <div className="flex items-start gap-3 rounded-xl p-2 hover:bg-muted/40">
                      <span
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-white text-sm font-bold text-primary shadow"
                        style={{ backgroundColor: cityColour(stop.city) }}
                      >
                        {index + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-2">
                          <span className="break-words font-semibold">{stop.name}</span>
                          <span className="text-sm font-semibold tabular-nums text-secondary">{clock(plan.result.arrivals[index])}</span>
                        </div>
                        <p className="text-xs text-muted-foreground">{placeLine(stop)}</p>
                        {stop.collectOnDelivery ? (
                          <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-warning-soft px-2 py-0.5 text-[0.7rem] font-semibold text-warning-soft-foreground">
                            <CashIcon className="h-3 w-3" />
                            גבייה במסירה
                          </span>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {stop.phone ? <CallIconButton phone={stop.phone} name={stop.name} /> : null}
                        <a
                          href={wazeLinkForPin({ lat: stop.lat!, lng: stop.lng! })}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`ניווט אל ${stop.name}`}
                          className="flex h-9 w-9 items-center justify-center rounded-xl bg-secondary text-secondary-foreground"
                        >
                          <WazeIcon className="h-5 w-5" />
                        </a>
                      </div>
                    </div>
                  </li>
                ))}
                {plan.result.legs.length > plan.stops.length ? (
                  <li>
                    <TimelineLeg
                      index={plan.stops.length}
                      count={plan.result.legs.length}
                      leg={plan.result.legs[plan.stops.length]}
                      active={activeLeg === plan.stops.length}
                      onHover={setActiveLeg}
                    />
                  </li>
                ) : null}
                <TimelinePoint
                  marker={<FlagIcon className="h-3.5 w-3.5" />}
                  markerClass="bg-primary text-primary-foreground"
                  title={plan.endIsStart ? `חזרה ל${plan.startLabel}` : plan.end ? plan.endLabel : "סיום בעצירה האחרונה"}
                  meta={`סיום משוער ${clock(plan.result.finish)}`}
                />
              </ol>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

function TimelinePoint({ marker, markerClass, title, meta }: { marker: ReactNode; markerClass: string; title: string; meta: string }) {
  return (
    <li className="flex items-center gap-3 p-2">
      <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full shadow", markerClass)}>{marker}</span>
      <div className="min-w-0">
        <p className="break-words font-semibold">{title}</p>
        <p className="text-xs text-muted-foreground">{meta}</p>
      </div>
    </li>
  );
}

function TimelineLeg({
  index,
  count,
  leg,
  active,
  onHover,
}: {
  index: number;
  count: number;
  leg: RoutePlanResult["legs"][number];
  active: boolean;
  onHover: (index: number | null) => void;
}) {
  return (
    <button
      type="button"
      onMouseEnter={() => onHover(index)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(index)}
      onBlur={() => onHover(null)}
      onClick={() => onHover(active ? null : index)}
      className="flex w-full items-center gap-3 px-2 py-0.5 text-right"
    >
      <span className="flex w-8 shrink-0 justify-center">
        <span className="h-7 w-1.5 rounded-full" style={{ backgroundColor: legColour(index, count) }} />
      </span>
      <span className={cn("rounded-full px-2 py-0.5 text-xs tabular-nums", active ? "bg-secondary text-secondary-foreground" : "bg-muted text-muted-foreground")}>
        {formatDuration(leg.durationSec)} · {formatDistance(leg.distanceM)}
        {leg.trafficUnavailable ? " · בלי נתוני עומס" : ""}
      </span>
    </button>
  );
}

function CompareRow({
  label,
  cost,
  base,
  max,
  objective,
  best,
}: {
  label: string;
  cost: RouteCost;
  base: RouteCost;
  max: number;
  objective: "time" | "distance";
  best: boolean;
}) {
  const value = objective === "time" ? cost.durationSec : cost.distanceM;
  const diff = value - (objective === "time" ? base.durationSec : base.distanceM);
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 text-sm">
        <span className={cn("font-medium", best && "text-success")}>{label}</span>
        <span className="tabular-nums text-muted-foreground">
          {formatDuration(cost.durationSec)} · {formatDistance(cost.distanceM)}
          {!best && diff > 0 ? (
            <span className="ms-1.5 font-semibold text-destructive">+{objective === "time" ? formatDuration(diff) : formatDistance(diff)}</span>
          ) : null}
        </span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full", best ? "bg-success" : diff > 0 ? "bg-destructive/70" : "bg-secondary/70")}
          style={{ width: `${max > 0 ? Math.max(4, (value / max) * 100) : 0}%` }}
        />
      </div>
    </div>
  );
}

function WhyCard({ plan }: { plan: Plan }) {
  const { result, objective } = plan;
  const n = plan.stops.length;
  const metric = (cost: RouteCost) => (objective === "time" ? cost.durationSec : cost.distanceM);
  const show = (amount: number) => (objective === "time" ? formatDuration(amount) : formatDistance(amount));
  const list = result.compare.listOrder;
  const free = result.compare.freeBest;
  const listGap = list ? metric(list) - metric(result.total) : 0;
  const preferenceCost = free ? metric(result.total) - metric(free) : 0;
  const rows = [
    { label: "המסלול הזה", cost: result.total, best: true },
    ...(list ? [{ label: "לפי הסדר ברשימת המשלוחים", cost: list, best: false }] : []),
    ...(free ? [{ label: "בלי מה שקבעתם שיהיה קודם", cost: free, best: false }] : []),
  ];
  const max = Math.max(...rows.map((row) => metric(row.cost)));
  const partialTraffic = result.legs.some((leg) => leg.trafficUnavailable);

  return (
    <Card className={cn("space-y-3 p-4")}>
      <p className="flex items-center gap-2 font-semibold">
        <InfoIcon className="h-4 w-4 text-secondary" />
        למה זה המסלול הטוב ביותר?
      </p>
      <ul className="space-y-1.5 text-sm">
        <li>
          • את הסדר בחר <b>מתכנן המסלולים של Google</b> — עם העומס ש-Google צופה בכל קטע בשעה שתגיעו אליו, לא רק העומס של עכשיו.
        </li>
        {n > 1 ? (
          <li>
            • ל-{n} עצירות יש {formatCount(result.possibleOrders)} סדרים אפשריים{plan.steps.length > 0 ? " (בסדר שקבעתם)" : ""}.
            {result.triedRoutes > 1
              ? ` Google תכנן את המסלול ${result.triedRoutes} פעמים — בחיפוש החופשי שלו, וכל פעם מתחיל בעצירה קרובה אחרת — ונבחר ה${objective === "time" ? "מהיר" : "קצר"} מכולם.`
              : ` זה ה${objective === "time" ? "מהיר" : "קצר"} ש-Google מצא.`}
          </li>
        ) : (
          <li>• עצירה אחת — אין סדר לבחור.</li>
        )}
        {list && n > 1 ? (
          <li>
            •{" "}
            {listGap > 0 ? (
              <>
                חוסך <b>{show(listGap)}</b> לעומת נסיעה לפי הסדר ברשימה, באותה שעה ובאותו עומס.
              </>
            ) : (
              "הסדר ברשימה יוצא טוב בדיוק כמו המסלול הזה."
            )}
          </li>
        ) : null}
        {free ? (
          <li>
            •{" "}
            {preferenceCost > 0 ? (
              <>
                מה שקבעתם ({plan.steps.join(" ← ")}) מוסיף <b>{show(preferenceCost)}</b> לעומת הסדר הכי טוב בלי הגבלה.
              </>
            ) : (
              <>מה שקבעתם ({plan.steps.join(" ← ")}) לא עולה כלום — זה גם הסדר הכי טוב.</>
            )}
          </li>
        ) : null}
      </ul>
      {rows.length > 1 ? (
        <div className="space-y-2.5">
          {rows.map((row) => (
            <CompareRow key={row.label} label={row.label} cost={row.cost} base={result.total} max={max} objective={objective} best={row.best} />
          ))}
        </div>
      ) : null}
      {partialTraffic ? <p className="text-xs text-muted-foreground">בחלק מהקטעים ל-Google לא היו נתוני עומס — הזמן שלהם לפי כביש פנוי.</p> : null}
    </Card>
  );
}
