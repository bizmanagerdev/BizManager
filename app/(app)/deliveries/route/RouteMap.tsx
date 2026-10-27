"use client";

import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { cn } from "@/lib/utils";
import { legColour, type MapPoint, type MapStop } from "./map-parts";

// The route on a map (Leaflet with OpenStreetMap's own map, in Hebrew — no key
// and no charge). The road line itself is Google's (lib/routes/route-optimization.ts).
// Loaded only in the browser (next/dynamic, ssr: false): Leaflet needs a window.
//
// Every pin has its name beside it (owner, 2026-10-26: "on a phone, I want to
// be able to see right away who each dot is"), and a switch hides the names
// when they crowd the map.

/** The names' look: Leaflet's tooltip, smaller and quieter. */
const LABEL_CSS = `
.route-pin-label{padding:1px 6px;font:600 11px/1.35 system-ui,sans-serif;color:#0A1020;border-radius:6px;border:1px solid rgba(10,16,32,.12);box-shadow:0 1px 3px rgba(10,16,32,.18);white-space:nowrap;max-width:none}
.route-pin-label.is-muted{color:#64748b;font-weight:500;opacity:.85}
.route-pin-label::before{display:none}
`;

function pinHtml(text: string, background: string, color: string, size: number): string {
  return `<div style="width:${size}px;height:${size}px;border-radius:9999px;background:${background};color:${color};border:2.5px solid #fff;box-shadow:0 2px 6px rgba(10,16,32,.35);display:flex;align-items:center;justify-content:center;font:700 ${size > 30 ? 12 : 13}px/1 system-ui,sans-serif;">${text}</div>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** A name short enough to sit beside a pin. */
function shortLabel(label: string): string {
  return label.length > 22 ? `${label.slice(0, 21)}…` : label;
}

export default function RouteMap({
  start,
  end,
  endIsStart,
  stops,
  legs,
  activeLeg,
  onStopClick,
  className,
}: {
  start: MapPoint | null;
  /** Where the route ends, when that isn't the start or the last stop. */
  end: MapPoint | null;
  endIsStart: boolean;
  stops: MapStop[];
  /** Each leg's line, start → first stop → … ; empty before a route is worked out. */
  legs: Array<Array<[number, number]>>;
  activeLeg: number | null;
  /** Tapping a pin (choosing the stops: in or out of the route). */
  onStopClick?: (key: string) => void;
  className?: string;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const overlay = useRef<L.LayerGroup | null>(null);
  const clickRef = useRef(onStopClick);
  useEffect(() => {
    clickRef.current = onStopClick;
  }, [onStopClick]);
  const lastFit = useRef("");
  const [showNames, setShowNames] = useState(true);

  useEffect(() => {
    if (!holder.current || mapRef.current) return;
    const map = L.map(holder.current, { zoomControl: true, attributionControl: true, scrollWheelZoom: true });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
    }).addTo(map);
    // Israel, until there's something to show.
    map.setView([31.77, 35.0], 8);
    overlay.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    // A map drawn inside a box that was still sizing itself draws grey tiles.
    const resize = new ResizeObserver(() => map.invalidateSize());
    resize.observe(holder.current);
    return () => {
      resize.disconnect();
      map.remove();
      mapRef.current = null;
      overlay.current = null;
      lastFit.current = "";
    };
  }, []);

  // Everything on the map, drawn again when any of it changes.
  useEffect(() => {
    const map = mapRef.current;
    const group = overlay.current;
    if (!map || !group) return;
    group.clearLayers();
    const bounds: L.LatLngExpression[] = [];

    legs.forEach((line, index) => {
      if (line.length < 2) return;
      const active = activeLeg === index;
      // A white edge under the coloured line, so it reads on any map colour.
      L.polyline(line, { color: "#fff", weight: active ? 11 : 8, opacity: 0.9 }).addTo(group);
      L.polyline(line, {
        color: legColour(index, legs.length),
        weight: active ? 7 : 5,
        opacity: activeLeg === null || active ? 0.95 : 0.45,
        // A leg Google couldn't draw is a straight dashed line, not a road.
        dashArray: line.length === 2 ? "8 8" : undefined,
      }).addTo(group);
      bounds.push(...line);
    });

    for (const stop of stops) {
      const size = stop.muted ? 20 : 30;
      const marker = L.marker([stop.lat, stop.lng], {
        icon: L.divIcon({
          className: "",
          html: stop.muted
            ? pinHtml("", "#cbd5e1", "#0A1020", size)
            : pinHtml(stop.number === null ? "" : String(stop.number), stop.color, "#0A1020", size),
          iconSize: [size, size],
          iconAnchor: [size / 2, size / 2],
        }),
        zIndexOffset: stop.muted ? 100 : 500,
      }).addTo(group);
      const label = escapeHtml(stop.number === null ? shortLabel(stop.label) : `${stop.number} · ${shortLabel(stop.label)}`);
      marker.bindTooltip(label, {
        permanent: showNames,
        direction: "top",
        offset: [0, -size / 2 - 2],
        className: cn("route-pin-label", stop.muted && "is-muted"),
      });
      marker.on("click", () => clickRef.current?.(stop.key));
      bounds.push([stop.lat, stop.lng]);
    }

    if (start) {
      L.marker([start.lat, start.lng], {
        icon: L.divIcon({
          className: "",
          html: pinHtml(endIsStart ? "⇆" : "▶", "#047857", "#fff", 34),
          iconSize: [34, 34],
          iconAnchor: [17, 17],
        }),
        zIndexOffset: 1000,
      })
        .bindTooltip(endIsStart ? "יציאה וסיום" : "יציאה", { direction: "bottom", offset: [0, 16], className: "route-pin-label" })
        .addTo(group);
      bounds.push([start.lat, start.lng]);
    }
    if (end) {
      L.marker([end.lat, end.lng], {
        icon: L.divIcon({ className: "", html: pinHtml("■", "#0A1020", "#fff", 34), iconSize: [34, 34], iconAnchor: [17, 17] }),
        zIndexOffset: 1000,
      })
        .bindTooltip("סיום", { direction: "bottom", offset: [0, 16], className: "route-pin-label" })
        .addTo(group);
      bounds.push([end.lat, end.lng]);
    }

    // Framed again only when what's on it changed — not when a leg is lit up or names toggled.
    const fit = JSON.stringify(bounds);
    if (fit === lastFit.current) return;
    lastFit.current = fit;
    if (bounds.length === 1) map.setView(bounds[0], 13);
    else if (bounds.length > 1) map.fitBounds(L.latLngBounds(bounds), { padding: [44, 44], maxZoom: 14 });
  }, [start, end, endIsStart, stops, legs, activeLeg, showNames]);

  return (
    <div className={cn("relative", className)}>
      <style>{LABEL_CSS}</style>
      <div ref={holder} dir="ltr" className="h-full w-full" style={{ zIndex: 0 }} />
      <button
        type="button"
        onClick={() => setShowNames((on) => !on)}
        aria-pressed={showNames}
        className="absolute bottom-6 end-2 z-[1000] rounded-lg border border-border/70 bg-background/95 px-2.5 py-1 text-xs font-semibold shadow-sm"
      >
        {showNames ? "הסתרת שמות" : "הצגת שמות"}
      </button>
    </div>
  );
}
