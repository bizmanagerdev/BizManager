"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DndContext, KeyboardSensor, MouseSensor, TouchSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { AddressPicker } from "@/components/ui/address-picker";
import { CallIconButton } from "@/components/ui/contact-link";
import { StepWizard, type WizardStepDef } from "@/components/ui/step-wizard";
import { TOGGLE_OFF, TOGGLE_ON } from "@/components/ui/filter-chip";
import {
  AddIcon,
  CashIcon,
  CheckIcon,
  ChevronDownIcon,
  CloseIcon,
  FlagIcon,
  InfoIcon,
  LockIcon,
  ShareIcon,
  SpinnerIcon,
  WarningIcon,
} from "@/components/ui/icons";
import { addressLine, type StructuredAddress } from "@/lib/address/structured";
import { cityColour } from "@/lib/deliveries/city-colours";
import { wazeLinkForPin } from "@/lib/delivery-location";
import { formatShortDate } from "@/lib/date";
import { parseDrive, type Drive } from "@/lib/routes/drive";
import { decodePolyline } from "@/lib/routes/polyline";
import {
  chainRules,
  firstLastRules,
  formatDistance,
  formatDuration,
  MAX_ROUTE_STOPS,
  pinnedRules,
  stopPhase,
  type RouteCost,
  type RouteEnd,
  type RoutePlanRequest,
  type RoutePlanResult,
  type RoutePoint,
} from "@/lib/routes/plan";
import { isRoutable, type PlannerStop } from "@/lib/routes/planner-stops";
import { israelDateKey, israelParts, israelWallClockToUtc } from "@/lib/timezone";
import { getCityRegion } from "@/lib/ui/cities";
import { cn } from "@/lib/utils";
import { legColour, type MapPoint, type MapStop } from "./map-parts";
import RouteDrive from "./RouteDrive";
import { CityDot, clock, placeLine, Segmented } from "./route-ui";

const RouteMap = dynamic(() => import("./RouteMap"), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse bg-muted" />,
});

// The planner as steps you can go back to (owner, 2026-10-26: "like a steps
// bar … each step has a name, and you could choose which step you want to go
// back to"), with the map beside them on a computer and above them on a phone.

type Step = "stops" | "places" | "order" | "route";
const STEPS: WizardStepDef<Step>[] = [
  { n: "stops", label: "עצירות" },
  { n: "places", label: "יציאה וסיום" },
  { n: "order", label: "סדר" },
  { n: "route", label: "המסלול" },
];

const REGIONS = ["צפון", "מרכז", "דרום"] as const;
const STORAGE_KEY = "bizh.routePlanner.v1";
const DRIVE_KEY = "bizh.routeDrive.v1";

type StartMode = "gps" | "address";
type EndMode = "return" | "last" | "address";

/** What the planner keeps on this device between visits (never the stops: they change daily). */
type Saved = {
  startMode: StartMode;
  startAddress: StructuredAddress | null;
  endMode: EndMode;
  endAddress: StructuredAddress | null;
  serviceMinutes: number;
};

/** How the order was asked for: Google's fastest with the choices, around stops moved by hand, or exactly as arranged. */
type PlanMode = "best" | "around" | "exact";

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
  mode: PlanMode;
  /** Stops that keep their place: the first / last asked for and the ones moved by hand. */
  pinned: Set<string>;
  signature: string;
};

/** What the person chose about the order on step 3. */
type Choices = { first: string | null; last: string | null; steps: string[] };

/** Stops moved by hand on the route, not planned yet. */
type Arranged = { order: string[]; pinned: Set<string> };

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

function pointOf(address: StructuredAddress | null): RoutePoint | null {
  return address && address.lat !== null && address.lng !== null ? { lat: address.lat, lng: address.lng } : null;
}

function readSaved(): Saved {
  const fallback: Saved = { startMode: "address", startAddress: null, endMode: "return", endAddress: null, serviceMinutes: 10 };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<Saved> | null;
    if (!saved) return fallback;
    return {
      startMode: saved.startMode === "gps" ? "gps" : "address",
      startAddress: saved.startAddress ?? null,
      endMode: saved.endMode === "last" || saved.endMode === "address" ? saved.endMode : "return",
      endAddress: saved.endAddress ?? null,
      serviceMinutes:
        typeof saved.serviceMinutes === "number" && saved.serviceMinutes >= 0 && saved.serviceMinutes <= 120 ? saved.serviceMinutes : 10,
    };
  } catch {
    // No storage on this device (a private window): the defaults.
    return fallback;
  }
}

/** A computer: the map beside the steps. (The planner is drawn in the browser only.) */
function useWideScreen(): boolean {
  const query = "(min-width: 1024px)";
  const [wide, setWide] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => setWide(list.matches);
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, []);
  return wide;
}

/** Why the device gave no location, in words that say what to do (one message for all three sent people looking in the wrong place). */
export function locationError(code: number | null): string {
  if (code === 1) return "הגישה למיקום חסומה. אפשרו מיקום לאתר בדפדפן, או ל-BizH בהגדרות הטלפון — או בחרו כתובת יציאה.";
  if (code === 2) return "המכשיר לא מצא את המיקום שלו. בדקו שהמיקום (GPS) פתוח — או בחרו כתובת יציאה.";
  if (code === 3) return "מציאת המיקום לקחה יותר מדי זמן. נסו שוב — או בחרו כתובת יציאה.";
  return "המכשיר לא נותן מיקום. בחרו כתובת יציאה.";
}

function askPosition(options: PositionOptions): Promise<RoutePoint> {
  return new Promise((resolve, reject) =>
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude }),
      reject,
      options
    )
  );
}

/** The device's location: its GPS first; when that finds nothing in time, the coarser one the phone already has (Wi-Fi, cell). */
export async function currentPosition(): Promise<RoutePoint> {
  if (typeof navigator === "undefined" || !navigator.geolocation) throw new Error(locationError(null));
  try {
    return await askPosition({ enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 });
  } catch (first) {
    const code = (first as GeolocationPositionError).code;
    // Blocked is blocked: asking again only waits for the same answer.
    if (code === 1) throw new Error(locationError(1));
    try {
      return await askPosition({ enableHighAccuracy: false, timeout: 10_000, maximumAge: 5 * 60_000 });
    } catch (second) {
      throw new Error(locationError((second as GeolocationPositionError).code ?? code));
    }
  }
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

const chipClass = (on: boolean) =>
  cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold", on ? `border-secondary ${TOGGLE_ON}` : `border-border bg-background ${TOGGLE_OFF}`);

/** Why a stop can't be in the route, in the words the office uses. */
function missingReason(stop: PlannerStop): string {
  if (stop.notFound) return "הכתובת לא נמצאה ב-Google";
  if (!stop.address.trim() || stop.address.trim() === stop.city.trim()) return "שמורה רק עיר — בלי רחוב ומספר בית";
  return "הכתובת לא נבחרה מרשימת Google — אין לה נקודה על המפה";
}

function StepHeading({ title, hint }: { title: string; hint?: ReactNode }) {
  return (
    <div className="space-y-1">
      <h2 className="text-base font-semibold">{title}</h2>
      {hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export default function RoutePlanner({ stops, canEditAddress }: { stops: PlannerStop[]; canEditAddress: boolean }) {
  const wide = useWideScreen();
  const [step, setStep] = useState<Step>("stops");

  const [extras, setExtras] = useState<PlannerStop[]>([]);
  const allStops = useMemo(() => [...stops, ...extras], [stops, extras]);
  const routable = useMemo(() => allStops.filter(isRoutable), [allStops]);
  const missing = useMemo(() => stops.filter((stop) => !isRoutable(stop)), [stops]);

  // Nothing chosen to begin with: the person picks the stops (owner, 2026-10-26).
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const chosen = useMemo(() => routable.filter((stop) => selected.has(stop.key)), [routable, selected]);

  // The last start, end and minutes, kept on this device.
  const [saved] = useState(readSaved);
  const [startMode, setStartMode] = useState<StartMode>(saved.startMode);
  const [startAddress, setStartAddress] = useState<StructuredAddress | null>(saved.startAddress);
  const [gpsPoint, setGpsPoint] = useState<RoutePoint | null>(null);
  const [locating, setLocating] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [endMode, setEndMode] = useState<EndMode>(saved.endMode);
  const [endAddress, setEndAddress] = useState<StructuredAddress | null>(saved.endAddress);
  const [departureTime, setDepartureTime] = useState("");
  const [serviceMinutes, setServiceMinutes] = useState(saved.serviceMinutes);
  useEffect(() => {
    try {
      const next: Saved = { startMode, startAddress, endMode, endAddress, serviceMinutes };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Not kept; nothing else depends on it.
    }
  }, [startMode, startAddress, endMode, endAddress, serviceMinutes]);

  // The route being driven, kept on the phone: back from Waze — or after the
  // phone closed the app — it opens on the same stop.
  const [drive, setDrive] = useState<Drive | null>(() => {
    try {
      return parseDrive(localStorage.getItem(DRIVE_KEY), israelDateKey());
    } catch {
      return null;
    }
  });
  useEffect(() => {
    try {
      if (drive) localStorage.setItem(DRIVE_KEY, JSON.stringify(drive));
      else localStorage.removeItem(DRIVE_KEY);
    } catch {
      // Not kept: the drive still runs while the page stays open.
    }
  }, [drive]);

  // The order: the stop to start or finish with, and the cities' order.
  const [firstStop, setFirstStop] = useState<string | null>(null);
  const [lastStop, setLastStop] = useState<string | null>(null);
  const [cityOrder, setCityOrder] = useState<string[]>([]);

  const [adding, setAdding] = useState(false);
  const [extraAddress, setExtraAddress] = useState<StructuredAddress | null>(null);
  const [extraNote, setExtraNote] = useState("");
  const [showMissing, setShowMissing] = useState(false);

  const [plan, setPlan] = useState<Plan | null>(null);
  const [arranged, setArranged] = useState<Arranged | null>(null);
  const [working, setWorking] = useState<PlanMode | null>(null);
  const [error, setError] = useState<PlanError | null>(null);
  const [activeLeg, setActiveLeg] = useState<number | null>(null);

  // On a computer the steps scroll inside their own card; on a phone the page scrolls.
  const panelRef = useRef<HTMLDivElement>(null);
  const toTop = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
    panelRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

  // A choice that went away with its stop is dropped with it.
  const chosenKeys = new Set(chosen.map((stop) => stop.key));
  const first = firstStop && chosenKeys.has(firstStop) ? firstStop : null;
  const last = lastStop && chosenKeys.has(lastStop) && lastStop !== first ? lastStop : null;
  const presentRegions = REGIONS.filter((region) => chosen.some((stop) => getCityRegion(stop.city) === region));
  const presentCities = Array.from(new Set(chosen.map((stop) => stop.city))).sort((a, b) => a.localeCompare(b, "he"));
  const cityChoices = [...(presentRegions.length > 1 ? presentRegions : []), ...presentCities];
  const steps = cityOrder.filter((token) => cityChoices.includes(token));

  // "המיקום שלי" is looked for as soon as it's chosen, so a phone that won't
  // give it says so on this step — not two steps later at "תכנון המסלול".
  const locate = () => {
    if (locating) return;
    setLocating(true);
    setGpsError(null);
    currentPosition()
      .then(setGpsPoint, (e: unknown) => setGpsError(e instanceof Error ? e.message : locationError(null)))
      .finally(() => setLocating(false));
  };

  const startPoint = startMode === "gps" ? gpsPoint : pointOf(startAddress);
  const endPoint: RoutePoint | null = endMode === "address" ? pointOf(endAddress) : null;
  const placesReady = startPoint !== null && (endMode !== "address" || endPoint !== null);

  // What a plan was asked with; a change shows "תכנון מחדש".
  const signatureOf = (choices: Choices) =>
    JSON.stringify({
      keys: chosen.map((stop) => stop.key),
      start: startMode === "gps" ? "gps" : startPoint,
      endMode,
      endPoint,
      ...choices,
      departureTime,
      serviceMinutes,
    });
  const signature = signatureOf({ first, last, steps });
  const stale = plan !== null && plan.signature !== signature;

  const stopsReady = chosen.length > 0 && chosen.length <= MAX_ROUTE_STOPS;
  const satisfied = (id: Step) =>
    id === "stops" ? stopsReady : id === "places" ? placesReady : id === "order" ? plan !== null : true;
  const stepIndex = STEPS.findIndex((s) => s.n === step);
  const canClickStep = (id: Step) => {
    const at = STEPS.findIndex((s) => s.n === id);
    if (at <= stepIndex) return true;
    return STEPS.slice(0, at).every((s) => satisfied(s.n));
  };

  /** Plans the route. `over` asks with other choices than the steps hold: an option picked in "why this route". */
  const compute = async (mode: PlanMode, over: Partial<Choices> & { order?: string[] } = {}) => {
    const choices: Choices = {
      first: over.first !== undefined ? over.first : first,
      last: over.last !== undefined ? over.last : last,
      steps: over.steps ?? steps,
    };
    const exactOrder = over.order ?? arranged?.order ?? null;
    if (working) return;
    setWorking(mode);
    setError(null);
    try {
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        throw new Error("אין חיבור לרשת — תכנון מסלול צריך את Google.");
      }
      // Where the device is now; if it can't say this time, where it was found on step 2.
      let start = startPoint;
      if (startMode === "gps") {
        try {
          start = await currentPosition();
          setGpsPoint(start);
        } catch (e) {
          if (!gpsPoint) throw e;
        }
      }
      if (!start) throw new Error("בחרו מאיפה יוצאים.");
      const end: RouteEnd =
        endMode === "last" ? { mode: "last" } : endMode === "address" && endPoint ? { mode: "point", point: endPoint } : { mode: "return" };
      const departure = departureFrom(departureTime, new Date());

      // Stops moved by hand keep their place; so do the first and last asked for.
      const ids = chosen.map((stop) => stop.key);
      let before: Array<[string, string]>;
      let pinned = new Set<string>();
      const ends = [...(choices.first ? [choices.first] : []), ...(choices.last ? [choices.last] : [])];
      if (mode === "exact" && exactOrder) {
        before = chainRules(exactOrder);
        pinned = new Set(exactOrder);
      } else if (mode === "around" && arranged) {
        pinned = new Set([...arranged.pinned, ...ends]);
        before = pinnedRules(arranged.order, pinned);
      } else {
        before = firstLastRules(ids, choices.first, choices.last);
        pinned = new Set(ends);
      }
      const request: RoutePlanRequest = {
        start,
        end,
        stops: chosen.map((stop) => ({
          id: stop.key,
          lat: stop.lat!,
          lng: stop.lng!,
          phase: mode === "exact" || choices.steps.length === 0 || pinned.has(stop.key) ? null : stopPhase(stop.city, choices.steps),
        })),
        before,
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
        startLabel: startMode === "gps" ? "המיקום שלי" : startAddress ? addressLine(startAddress, { withUnit: false }) || startAddress.formatted : "",
        end: endMode === "address" ? endPoint : null,
        endLabel: endMode === "address" && endAddress ? addressLine(endAddress, { withUnit: false }) || endAddress.formatted : "",
        endIsStart: endMode === "return",
        serviceMinutes,
        mode,
        pinned,
        signature: signatureOf(choices),
      });
      setArranged(null);
      setActiveLeg(null);
      setStep("route");
      toTop();
    } catch (e) {
      setError({ message: e instanceof Error ? e.message : "חישוב המסלול נכשל. נסו שוב." });
    } finally {
      setWorking(null);
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
        address: addressLine(extraAddress) || extraAddress.formatted,
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

  // ── Moving stops by hand on the route ──
  const showPlan = plan !== null && !stale;
  const routeOrder = useMemo(() => arranged?.order ?? plan?.stops.map((stop) => stop.key) ?? [], [arranged, plan]);
  // Dragged by its number (owner, 2026-10-27: "reorder should be by the dots, not the arrows").
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!plan || !over || active.id === over.id) return;
    const key = String(active.id);
    const from = routeOrder.indexOf(key);
    const to = routeOrder.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    setArranged({ order: arrayMove(routeOrder, from, to), pinned: new Set([...(arranged?.pinned ?? plan.pinned), key]) });
  };

  // Another option picked in "why this route": Google's fastest with none of the choices, or the list's order.
  const pickFastest = () => {
    setFirstStop(null);
    setLastStop(null);
    setCityOrder([]);
    setArranged(null);
    void compute("best", { first: null, last: null, steps: [] });
  };
  const pickListOrder = () => {
    setArranged(null);
    void compute("exact", { order: chosen.map((stop) => stop.key) });
  };

  // ── The map ──
  const stopByKey = useMemo(() => new Map(allStops.map((stop) => [stop.key, stop])), [allStops]);
  const mapStops: MapStop[] = useMemo(() => {
    if (step === "route" && plan && showPlan) {
      return routeOrder
        .map((key) => stopByKey.get(key))
        .filter((stop): stop is PlannerStop => Boolean(stop))
        .map((stop, index) => ({ key: stop.key, lat: stop.lat!, lng: stop.lng!, color: cityColour(stop.city), label: stop.name, number: index + 1 }));
    }
    // Choosing the stops: every one that can go, the chosen ones in colour. After that, only the chosen.
    const shown = step === "stops" ? routable : chosen;
    return shown.map((stop) => ({
      key: stop.key,
      lat: stop.lat!,
      lng: stop.lng!,
      color: cityColour(stop.city),
      label: stop.name,
      number: null,
      muted: !selected.has(stop.key),
    }));
  }, [step, plan, showPlan, routeOrder, stopByKey, routable, chosen, selected]);
  const mapLegs = useMemo(() => {
    // Moved by hand: the old lines no longer match the order.
    if (step !== "route" || !plan || !showPlan || arranged) return [];
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
  }, [step, plan, showPlan, arranged]);
  // Driving: the stops in their order, the ones behind the driver in grey.
  const driveStops: MapStop[] = useMemo(
    () =>
      drive
        ? drive.stops.map((stop, index) => ({
            key: stop.key,
            lat: stop.lat,
            lng: stop.lng,
            color: cityColour(stop.city),
            label: stop.name,
            number: index + 1,
            muted: Boolean(drive.outcome[stop.key]),
          }))
        : [],
    [drive]
  );
  const onRoute = step === "route" && plan !== null && showPlan;
  const mapStart: MapPoint | null = onRoute ? plan.start : startPoint;
  const mapEnd: MapPoint | null = onRoute ? plan.end : endPoint;
  const mapEndIsStart = onRoute ? plan.endIsStart : endMode === "return";

  // "יציאה לדרך": the route becomes a drive, and Waze opens on the first stop
  // (owner, 2026-10-27); sending it to a driver is the side option.
  const startDrive = () => {
    if (!plan || plan.stops.length === 0) return;
    const next: Drive = {
      day: israelDateKey(),
      stops: plan.stops.map((stop, index) => ({
        key: stop.key,
        kind: stop.kind,
        name: stop.name,
        phone: stop.phone,
        city: stop.city,
        address: stop.address,
        orderIds: stop.orderIds,
        collectOnDelivery: stop.collectOnDelivery,
        note: stop.note,
        lat: stop.lat!,
        lng: stop.lng!,
        arrival: plan.result.arrivals[index] ?? null,
      })),
      end: plan.endIsStart ? { point: plan.start, label: "נקודת היציאה" } : plan.end ? { point: plan.end, label: "נקודת הסיום" } : null,
      at: 0,
      outcome: {},
      confirmed: [],
    };
    setDrive(next);
    window.open(wazeLinkForPin(next.stops[0]), "_blank", "noopener,noreferrer");
    window.scrollTo({ top: 0 });
  };

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

  const map = (
    <RouteMap
      className="h-full w-full"
      start={mapStart}
      end={mapEnd}
      endIsStart={mapEndIsStart}
      stops={mapStops}
      legs={mapLegs}
      activeLeg={activeLeg}
      onStopClick={step === "stops" ? toggle : undefined}
    />
  );

  const goTo = (id: Step) => {
    setError(null);
    setStep(id);
    panelRef.current?.scrollTo({ top: 0 });
    if (id === "places" && startMode === "gps" && !gpsPoint) locate();
  };

  // ── The footer: what "next" does on each step ──
  const footer: {
    onNext: () => void;
    nextDisabled: boolean;
    nextLabel?: ReactNode;
    isLastStep?: boolean;
    footerCenter?: ReactNode;
    onBack?: () => void;
    backLabel?: string;
  } = (() => {
    if (step === "stops") {
      return {
        onNext: () => goTo("places"),
        nextDisabled: !stopsReady,
        footerCenter:
          chosen.length > MAX_ROUTE_STOPS ? (
            <span className="text-xs font-semibold text-destructive">נבחרו {chosen.length} — אפשר עד {MAX_ROUTE_STOPS}</span>
          ) : (
            <span className="text-xs text-muted-foreground">{chosen.length === 0 ? "בחרו עצירות מהרשימה או מהמפה" : `נבחרו ${chosen.length} עצירות`}</span>
          ),
      };
    }
    if (step === "places") return { onNext: () => goTo("order"), nextDisabled: !placesReady };
    if (step === "order") {
      return {
        onNext: () => void compute("best"),
        nextDisabled: working !== null,
        nextLabel: working ? (
          <span className="inline-flex items-center gap-1.5">
            <SpinnerIcon className="h-4 w-4 animate-spin" />
            Google מתכנן…
          </span>
        ) : (
          "תכנון המסלול"
        ),
      };
    }
    if (stale) {
      return { onNext: () => void compute("best"), nextDisabled: working !== null, nextLabel: working ? "Google מתכנן…" : "תכנון מחדש" };
    }
    // Stops moved by hand: the question sits here, where the buttons always
    // are, not in a box above the list (owner, 2026-10-27: "I couldn't figure
    // out where to look").
    if (arranged) {
      return {
        onNext: () => void compute("around"),
        nextDisabled: working !== null,
        isLastStep: true,
        nextLabel: working === "around" ? "Google מתכנן…" : "Google יסדר את השאר סביב השינוי",
        onBack: () => setArranged(null),
        backLabel: "ביטול",
        footerCenter: (
          <div className="flex w-full flex-col items-center gap-1.5 text-center">
            <p className="text-sm font-semibold">שיניתם את הסדר — איך לתכנן?</p>
            <Button type="button" size="sm" variant="outline" onClick={() => void compute("exact")} disabled={working !== null}>
              {working === "exact" ? <SpinnerIcon className="animate-spin" /> : null}
              בדיוק בסדר הזה
            </Button>
          </div>
        ),
      };
    }
    return {
      onNext: startDrive,
      nextDisabled: !plan || plan.stops.length === 0 || arranged !== null,
      isLastStep: true,
      nextLabel: "יציאה לדרך ב-Waze",
    };
  })();

  const backTo: Record<Step, Step | null> = { stops: null, places: "stops", order: "places", route: "order" };
  const unreachableNames = (error?.unreachable ?? []).map((key) => stopByKey.get(key)?.name).filter(Boolean);

  if (drive) {
    return (
      <div className="lg:grid lg:grid-cols-[minmax(360px,460px)_minmax(0,1fr)] lg:items-start lg:gap-6">
        <div
          ref={panelRef}
          className={cn(wide && "sticky top-20 h-[calc(100dvh-7.75rem)] min-h-[420px] min-w-0 overflow-y-auto overscroll-contain rounded-card border border-border/60 bg-muted/30 p-3 shadow-card")}
        >
          <RouteDrive
            drive={drive}
            update={(change) => setDrive((current) => (current ? change(current) : current))}
            onEnd={() => setDrive(null)}
            onNextStop={toTop}
          />
        </div>
        {wide ? (
          <div className="sticky top-20 h-[calc(100dvh-7.75rem)] min-h-[420px] overflow-hidden rounded-card border border-border/60 shadow-card">
            <RouteMap
              className="h-full w-full"
              start={null}
              end={drive.end?.point ?? null}
              endIsStart={false}
              stops={driveStops}
              legs={[]}
              activeLeg={null}
              onStopClick={(key) =>
                setDrive((current) => {
                  if (!current) return current;
                  const at = current.stops.findIndex((stop) => stop.key === key);
                  const outcome = current.stops[at] ? current.outcome[key] : undefined;
                  return at < 0 || outcome === "delivered" || outcome === "done" ? current : { ...current, at };
                })
              }
            />
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="lg:grid lg:grid-cols-[minmax(360px,460px)_minmax(0,1fr)] lg:items-start lg:gap-6">
      <StepWizard
        // A computer: one card as tall as the map, only its middle scrolls (owner, 2026-10-27).
        variant={wide ? "panel" : "page"}
        bodyRef={panelRef}
        steps={STEPS}
        current={step}
        canClickStep={canClickStep}
        onStepClick={(id) => {
          if (canClickStep(id)) goTo(id);
        }}
        onBack={footer.onBack ?? (backTo[step] ? () => goTo(backTo[step]!) : undefined)}
        backLabel={footer.backLabel}
        onNext={footer.onNext}
        nextDisabled={footer.nextDisabled}
        nextLabel={footer.nextLabel}
        isLastStep={footer.isLastStep}
        footerCenter={footer.footerCenter}
        error={error?.message}
        note={
          error?.setup
            ? "זה חלק מההגדרה ב-Google Cloud."
            : unreachableNames.length > 0
              ? `לא נמצאה דרך אל: ${unreachableNames.join(", ")}. הורידו אותן ונסו שוב.`
              : undefined
        }
        className={wide ? "sticky top-20 h-[calc(100dvh-7.75rem)] min-h-[420px] min-w-0 overflow-hidden rounded-card border border-border/60 bg-card shadow-card" : "min-w-0"}
      >
        {/* On a phone the map rides above the step; on a computer it stands beside the steps. */}
        {wide ? null : <div className="h-64 overflow-hidden rounded-card border border-border/60 shadow-card">{map}</div>}

        {step === "stops" ? (
          <div className="space-y-4">
            <StepHeading title="אילו עצירות נוסעים היום?" hint="לחצו על עצירה ברשימה או על נקודה במפה." />

            {missing.length > 0 ? (
              <div className="rounded-xl border border-warning/60 bg-warning-soft/60 text-sm text-warning-soft-foreground">
                <button
                  type="button"
                  onClick={() => setShowMissing((open) => !open)}
                  aria-expanded={showMissing}
                  className="flex w-full items-center gap-2 px-3 py-2 text-right"
                >
                  <WarningIcon className="h-4 w-4 shrink-0" />
                  <span className="flex-1 font-medium">
                    {missing.length === 1 ? "משלוח אחד בלי כתובת מדויקת — לא יופיע" : `${missing.length} משלוחים בלי כתובת מדויקת — לא יופיעו`}
                  </span>
                  <ChevronDownIcon className={cn("h-4 w-4 shrink-0 transition-transform", showMissing && "rotate-180")} />
                </button>
                {showMissing ? (
                  <ul className="space-y-1.5 px-3 pb-3">
                    {missing.map((stop) => (
                      <li key={stop.key} className="rounded-lg bg-background/80 px-2.5 py-1.5 text-foreground">
                        <div className="flex flex-wrap items-center gap-x-2">
                          <CityDot city={stop.city} />
                          <span className="font-medium">{stop.name}</span>
                          <span className="text-muted-foreground">· {stop.city}</span>
                        </div>
                        <div className="text-xs text-muted-foreground">{missingReason(stop)}</div>
                        {canEditAddress && stop.customerId ? (
                          <Link href={`/customers/${stop.customerId}`} className="text-xs font-semibold text-secondary hover:underline">
                            עדכון הכתובת בכרטיס הלקוח
                          </Link>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}

            {routable.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setSelected(allOn(routable) ? new Set() : new Set(routable.map((stop) => stop.key)))}
                  className={chipClass(false)}
                >
                  {allOn(routable) ? "ניקוי הבחירה" : `בחירת הכל · ${routable.length}`}
                </button>
                {routableCities.map(({ city, members }) => (
                  <button key={city} type="button" onClick={() => toggleGroup(members)} aria-pressed={allOn(members)} className={chipClass(allOn(members))}>
                    <CityDot city={city} className="h-2 w-2" />
                    {city} · {members.length}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">אין משלוחים פתוחים עם כתובת על המפה. אפשר להוסיף עצירה למטה.</p>
            )}

            {routable.length > 0 ? (
              <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/60">
                {routable.map((stop) => {
                  const on = selected.has(stop.key);
                  return (
                    <li key={stop.key} className={cn("flex items-start gap-2.5 p-2.5 transition-colors", on && "bg-secondary/5")}>
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => toggle(stop.key)}
                        aria-label={`${stop.name} במסלול`}
                        className="mt-1 h-5 w-5 shrink-0 accent-secondary"
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
                  data-no-enter-next
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
          </div>
        ) : null}

        {step === "places" ? (
          <div className="space-y-5">
            <StepHeading title="מאיפה יוצאים, לאן חוזרים ומתי" />
            <div className="space-y-2">
              <p className="text-sm font-medium">יוצאים מ…</p>
              <Segmented
                value={startMode}
                onChange={(mode) => {
                  setStartMode(mode);
                  if (mode === "gps" && !gpsPoint) locate();
                }}
                options={[
                  { value: "address", label: "כתובת" },
                  { value: "gps", label: "המיקום שלי" },
                ]}
              />
              {startMode === "address" ? (
                <AddressPicker value={startAddress} onChange={setStartAddress} allowUnit={false} ariaLabel="כתובת היציאה" placeholder="מאיפה יוצאים? רחוב ומספר" />
              ) : locating ? (
                <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <SpinnerIcon className="h-4 w-4 animate-spin" />
                  מאתרים את המיקום…
                </p>
              ) : gpsPoint ? (
                <p className="flex items-center gap-1.5 text-sm text-success">
                  <CheckIcon className="h-4 w-4 shrink-0" />
                  המיקום נמצא. ברגע התכנון הוא נלקח שוב, מעודכן.
                </p>
              ) : gpsError ? (
                <div className="space-y-2 rounded-xl border border-destructive/40 bg-destructive/5 p-3">
                  <p className="text-sm text-destructive">{gpsError}</p>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={locate}>
                      נסו שוב
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => setStartMode("address")}>
                      בחירת כתובת
                    </Button>
                  </div>
                </div>
              ) : null}
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
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1 text-sm">
                <span className="font-medium">שעת יציאה</span>
                <Input type="time" value={departureTime} onChange={(e) => setDepartureTime(e.target.value)} aria-label="שעת יציאה" />
                <span className="block text-xs text-muted-foreground">{departureTime ? "לפי העומס הצפוי מהשעה הזו" : "ריק = יוצאים עכשיו"}</span>
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
          </div>
        ) : null}

        {step === "order" ? (
          <div className="space-y-5">
            <StepHeading
              title="הסדר"
              hint="Google בוחר את הסדר הכי מהיר — עם העומס הצפוי בכל קטע בשעה שתגיעו אליו. אפשר לקבוע כאן מה חשוב לכם, והשאר Google יסדר."
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-sm">
                <span className="font-medium">להתחיל ב…</span>
                <NativeSelect value={first ?? ""} onChange={(e) => setFirstStop(e.target.value || null)} aria-label="העצירה הראשונה">
                  <option value="">Google יחליט</option>
                  {chosen.map((stop) => (
                    <option key={stop.key} value={stop.key}>
                      {stop.name} · {stop.city}
                    </option>
                  ))}
                </NativeSelect>
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-medium">לסיים ב…</span>
                <NativeSelect value={last ?? ""} onChange={(e) => setLastStop(e.target.value || null)} aria-label="העצירה האחרונה">
                  <option value="">Google יחליט</option>
                  {chosen
                    .filter((stop) => stop.key !== first)
                    .map((stop) => (
                      <option key={stop.key} value={stop.key}>
                        {stop.name} · {stop.city}
                      </option>
                    ))}
                </NativeSelect>
              </label>
            </div>
            {cityChoices.length > 1 ? (
              <div className="space-y-2">
                <p className="text-sm font-medium">סדר לפי ערים (לא חובה)</p>
                <p className="text-xs text-muted-foreground">לחצו לפי הסדר שבו תרצו לנסוע — למשל קודם ירושלים, אחר כך צפון. לחיצה נוספת מורידה.</p>
                <div className="flex flex-wrap gap-1.5">
                  {cityChoices.map((token) => {
                    const at = steps.indexOf(token);
                    const region = (REGIONS as readonly string[]).includes(token);
                    return (
                      <button
                        key={token}
                        type="button"
                        onClick={() => setCityOrder(at >= 0 ? steps.filter((t) => t !== token) : [...steps, token])}
                        aria-pressed={at >= 0}
                        className={chipClass(at >= 0)}
                      >
                        {at >= 0 ? (
                          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-secondary-foreground text-[0.65rem] font-bold text-secondary">
                            {at + 1}
                          </span>
                        ) : region ? null : (
                          <CityDot city={token} className="h-2 w-2" />
                        )}
                        {region ? `אזור ${token}` : token}
                      </button>
                    );
                  })}
                </div>
                {steps.length > 0 ? (
                  <p className="text-sm">
                    <span className="text-muted-foreground">הסדר: </span>
                    <span className="font-medium">{[...steps, "כל השאר"].join(" ← ")}</span>
                  </p>
                ) : null}
              </div>
            ) : null}
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              אחרי שהמסלול מוכן אפשר גם להזיז עצירות ביד, ו-Google יסדר את השאר סביבן.
            </p>
          </div>
        ) : null}

        {step === "route" ? (
          plan ? (
            <div className="space-y-4">
              {stale ? (
                <div className="flex items-start gap-2 rounded-xl border border-secondary/40 bg-secondary/5 p-3 text-sm">
                  <InfoIcon className="mt-0.5 h-4 w-4 shrink-0 text-secondary" />
                  <span>שיניתם משהו בשלבים הקודמים — המסלול שלמטה הוא הקודם. לחצו &quot;תכנון מחדש&quot;.</span>
                </div>
              ) : null}

              <Card className={cn("space-y-3 p-4", (stale || arranged) && "opacity-60")}>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Figure label="זמן נסיעה" value={formatDuration(plan.result.total.durationSec)} />
                  <Figure label="מרחק" value={formatDistance(plan.result.total.distanceM)} />
                  <Figure label="יציאה" value={clock(plan.result.departure)} />
                  <Figure label="סיום משוער" value={clock(plan.result.finish)} />
                </div>
                <p className="text-xs text-muted-foreground">כולל {plan.serviceMinutes} דק׳ בכל עצירה · זמני הנסיעה עם העומס הצפוי בכל קטע</p>
                <ChoiceCost plan={plan} />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => void share()}
                  disabled={stale || arranged !== null}
                >
                  <ShareIcon />
                  שליחת המסלול לנהג
                </Button>
              </Card>

              <Card className={cn("p-2 sm:p-3", stale && "opacity-60")}>
                {stale ? null : (
                  <p className="flex items-start gap-1.5 px-2 pb-2 pt-1 text-sm text-muted-foreground">
                    <InfoIcon className="mt-0.5 h-4 w-4 shrink-0 text-secondary" />
                    {arranged ? "בחרו למטה איך לתכנן." : "לשינוי הסדר — גררו עצירה במספר שלה."}
                  </p>
                )}
                <DndContext id="route-stops-dnd" sensors={sensors} onDragEnd={onDragEnd}>
                  <SortableContext items={routeOrder} strategy={verticalListSortingStrategy}>
                <ol>
                  <TimelinePoint
                    marker={<span className="text-[0.7rem] font-bold">{plan.endIsStart ? "⇆" : "▶"}</span>}
                    markerClass="bg-emerald-700 text-white"
                    title={plan.startLabel}
                    meta={`יציאה ${clock(plan.result.departure)}`}
                  />
                  {routeOrder.map((key, index) => {
                    const stop = stopByKey.get(key);
                    if (!stop) return null;
                    const leg = arranged ? null : plan.result.legs[index];
                    const kept = (arranged?.pinned ?? plan.pinned).has(key);
                    return (
                      <SortableStop
                        key={key}
                        id={key}
                        number={index + 1}
                        name={stop.name}
                        color={cityColour(stop.city)}
                        disabled={stale || working !== null}
                        highlighted={arranged !== null && kept}
                        leg={
                          leg ? (
                            <TimelineLeg index={index} count={plan.result.legs.length} leg={leg} active={activeLeg === index} onHover={setActiveLeg} />
                          ) : (
                            <div className="h-3" />
                          )
                        }
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline gap-x-2">
                            <span className="break-words font-semibold">{stop.name}</span>
                            {arranged ? null : (
                              <span className="text-sm font-semibold tabular-nums text-secondary">{clock(plan.result.arrivals[index])}</span>
                            )}
                            {kept ? (
                              <span className="inline-flex items-center gap-1 text-[0.7rem] text-muted-foreground" title="נשאר במקום שבחרתם">
                                <LockIcon className="h-3 w-3" />
                                במקום שבחרתם
                              </span>
                            ) : null}
                          </div>
                          <p className="text-xs text-muted-foreground">{placeLine(stop)}</p>
                          {stop.collectOnDelivery ? (
                            <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-warning-soft px-2 py-0.5 text-[0.7rem] font-semibold text-warning-soft-foreground">
                              <CashIcon className="h-3 w-3" />
                              גבייה במסירה
                            </span>
                          ) : null}
                        </div>
                        {stop.phone ? <CallIconButton phone={stop.phone} name={stop.name} className="shrink-0" /> : null}
                      </SortableStop>
                    );
                  })}
                  {!arranged && plan.result.legs.length > plan.stops.length ? (
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
                    meta={arranged ? "השעות יתעדכנו אחרי התכנון" : `סיום משוער ${clock(plan.result.finish)}`}
                  />
                </ol>
                  </SortableContext>
                </DndContext>
              </Card>

              <div className={cn(arranged && "pointer-events-none opacity-60")}>
                <WhyCard plan={plan} working={working} onFastest={pickFastest} onListOrder={pickListOrder} />
              </div>
            </div>
          ) : null
        ) : null}
      </StepWizard>

      {/* A computer: the map beside the steps, held on screen while they scroll. */}
      {wide ? (
        <div className="sticky top-20 h-[calc(100dvh-7.75rem)] min-h-[420px] overflow-hidden rounded-card border border-border/60 shadow-card">
          {map}
        </div>
      ) : null}
    </div>
  );
}

/** A stop on the route, dragged up or down by its number. */
function SortableStop({
  id,
  number,
  name,
  color,
  disabled,
  highlighted,
  leg,
  children,
}: {
  id: string;
  number: number;
  name: string;
  color: string;
  disabled: boolean;
  /** Moved by hand, waiting for "how to plan". */
  highlighted: boolean;
  /** The drive to this stop, drawn above it. */
  leg: ReactNode;
  children: ReactNode;
}) {
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id, disabled });
  return (
    <li
      ref={setNodeRef}
      // Up and down only.
      style={{ transform: CSS.Translate.toString(transform && { ...transform, x: 0 }), transition }}
      className={cn("relative", isDragging && "z-10")}
    >
      {leg}
      <div
        className={cn(
          "flex items-center gap-2.5 rounded-xl bg-card p-2",
          isDragging ? "shadow-lg ring-2 ring-secondary" : highlighted ? "bg-secondary/10" : "hover:bg-muted/40"
        )}
      >
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          disabled={disabled}
          aria-label={`גררו כדי להזיז את ${name}`}
          title="גררו לשינוי הסדר"
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-white text-sm font-bold text-primary shadow",
            !disabled && "cursor-grab touch-none active:cursor-grabbing"
          )}
          style={{ backgroundColor: color }}
        >
          {number}
        </button>
        {children}
      </div>
    </li>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-bold tabular-nums">{value}</p>
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

/** One way to drive the stops: its time against this route's, and a tap to switch to it. */
function CompareRow({
  label,
  cost,
  base,
  max,
  current,
  onPick,
  busy,
  disabled,
}: {
  label: string;
  cost: RouteCost;
  base: RouteCost;
  max: number;
  current: boolean;
  onPick?: () => void;
  busy: boolean;
  disabled: boolean;
}) {
  const diff = cost.durationSec - base.durationSec;
  const body = (
    <>
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-sm">
        <span className={cn("inline-flex items-center gap-1.5 font-medium", current && "text-success")}>
          {current ? <CheckIcon className="h-4 w-4" /> : null}
          {label}
        </span>
        <span className="tabular-nums text-muted-foreground">
          {formatDuration(cost.durationSec)} · {formatDistance(cost.distanceM)}
          {!current && diff > 0 ? <span className="ms-1.5 font-semibold text-destructive">+{formatDuration(diff)}</span> : null}
          {!current && diff < 0 ? <span className="ms-1.5 font-semibold text-success">−{formatDuration(-diff)}</span> : null}
        </span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full", current ? "bg-secondary" : diff > 0 ? "bg-destructive/70" : "bg-success")}
          style={{ width: `${max > 0 ? Math.max(4, (cost.durationSec / max) * 100) : 0}%` }}
        />
      </div>
      {onPick ? (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-secondary">
          {busy ? <SpinnerIcon className="h-3.5 w-3.5 animate-spin" /> : null}
          {busy ? "Google מתכנן…" : "לעבור למסלול הזה"}
        </span>
      ) : null}
    </>
  );
  if (!onPick) return <div className="space-y-1 rounded-lg p-2">{body}</div>;
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={disabled}
      className="block w-full space-y-1 rounded-lg border border-border/70 p-2 text-right hover:border-secondary/50 hover:bg-secondary/5 disabled:opacity-60"
    >
      {body}
    </button>
  );
}

/** What the chosen order costs against Google's fastest, at the top of the route (owner: the box at the bottom was missed). */
function ChoiceCost({ plan }: { plan: Plan }) {
  const free = plan.result.compare.freeBest;
  if (!free) return null;
  const cost = plan.result.total.durationSec - free.durationSec;
  const exact = plan.mode === "exact";
  return (
    <p
      className={cn(
        "flex items-start gap-1.5 rounded-lg px-2.5 py-2 text-sm",
        cost > 0 ? "bg-warning-soft text-warning-soft-foreground" : "bg-success/10 text-success"
      )}
    >
      {cost > 0 ? <InfoIcon className="mt-0.5 h-4 w-4 shrink-0" /> : <CheckIcon className="mt-0.5 h-4 w-4 shrink-0" />}
      {cost > 0 ? (
        <span>
          {exact ? "הסדר שלכם מוסיף" : "הבחירות שלכם מוסיפות"} <b>+{formatDuration(cost)}</b> לעומת הכי מהיר
        </span>
      ) : (
        <span>{exact ? "הסדר שלכם לא מוסיף זמן" : "הבחירות שלכם לא מוסיפות זמן"}</span>
      )}
    </p>
  );
}

/** Why this route, in a line, and the other ways to drive it — each one a tap away (owner, 2026-10-27: "too much text … let me choose"). */
function WhyCard({
  plan,
  working,
  onFastest,
  onListOrder,
}: {
  plan: Plan;
  working: PlanMode | null;
  onFastest: () => void;
  onListOrder: () => void;
}) {
  const { result } = plan;
  const n = plan.stops.length;
  const list = n > 1 ? result.compare.listOrder : null;
  const free = result.compare.freeBest;
  const rows = [
    { label: plan.mode === "exact" ? "הסדר שלכם" : "המסלול הזה", cost: result.total, current: true },
    ...(free ? [{ label: "הכי מהיר, בלי הבחירות שלכם", cost: free, current: false, onPick: onFastest, busy: working === "best" }] : []),
    ...(list ? [{ label: "לפי הסדר ברשימה", cost: list, current: false, onPick: onListOrder, busy: working === "exact" }] : []),
  ];
  const max = Math.max(...rows.map((row) => row.cost.durationSec));
  const partialTraffic = result.legs.some((leg) => leg.trafficUnavailable);

  return (
    <Card className="space-y-3 p-4">
      <div className="space-y-1">
        <p className="flex items-center gap-2 font-semibold">
          <InfoIcon className="h-4 w-4 text-secondary" />
          למה המסלול הזה?
        </p>
        <p className="text-sm text-muted-foreground">
          {plan.mode === "exact"
            ? "בדיוק בסדר שבחרתם, עם העומס הצפוי בכל קטע."
            : n > 1
              ? `הכי מהיר מתוך ${formatCount(result.possibleOrders)} סדרים אפשריים, עם העומס הצפוי בכל קטע.`
              : "עם העומס הצפוי בכל קטע."}
        </p>
      </div>
      {rows.length > 1 ? (
        <div className="space-y-2">
          {rows.map((row) => (
            <CompareRow
              key={row.label}
              label={row.label}
              cost={row.cost}
              base={result.total}
              max={max}
              current={row.current}
              onPick={"onPick" in row ? row.onPick : undefined}
              busy={"busy" in row ? Boolean(row.busy) : false}
              disabled={working !== null}
            />
          ))}
        </div>
      ) : null}
      {partialTraffic ? <p className="text-xs text-muted-foreground">בחלק מהקטעים אין ל-Google נתוני עומס.</p> : null}
    </Card>
  );
}
