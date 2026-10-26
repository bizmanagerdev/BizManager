"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { legColour, type MapPoint, type MapStop } from "./map-parts";

// The route on a map (Leaflet with OpenStreetMap's own map, in Hebrew — no key
// and no charge). The road line itself is Google's (lib/routes/google-routes.ts).
// Loaded only in the browser (next/dynamic, ssr: false): Leaflet needs a window.

function pinHtml(text: string, background: string, color: string, size: number, bold = true): string {
  return `<div style="width:${size}px;height:${size}px;border-radius:9999px;background:${background};color:${color};border:2.5px solid #fff;box-shadow:0 2px 6px rgba(10,16,32,.35);display:flex;align-items:center;justify-content:center;font:${bold ? 700 : 600} ${size > 30 ? 12 : 13}px/1 system-ui,sans-serif;">${text}</div>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
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
      const marker = L.marker([stop.lat, stop.lng], {
        icon: L.divIcon({
          className: "",
          html: pinHtml(stop.number === null ? "" : String(stop.number), stop.color, "#0A1020", 30),
          iconSize: [30, 30],
          iconAnchor: [15, 15],
        }),
        zIndexOffset: 500,
      })
        .bindTooltip(escapeHtml(stop.label), { direction: "top", offset: [0, -14] })
        .addTo(group);
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
        .bindTooltip(endIsStart ? "יציאה וסיום" : "יציאה", { direction: "top", offset: [0, -16] })
        .addTo(group);
      bounds.push([start.lat, start.lng]);
    }
    if (end) {
      L.marker([end.lat, end.lng], {
        icon: L.divIcon({ className: "", html: pinHtml("■", "#0A1020", "#fff", 34), iconSize: [34, 34], iconAnchor: [17, 17] }),
        zIndexOffset: 1000,
      })
        .bindTooltip("סיום", { direction: "top", offset: [0, -16] })
        .addTo(group);
      bounds.push([end.lat, end.lng]);
    }

    // Framed again only when what's on it changed — not when a leg is lit up.
    const fit = JSON.stringify(bounds);
    if (fit === lastFit.current) return;
    lastFit.current = fit;
    if (bounds.length === 1) map.setView(bounds[0], 13);
    else if (bounds.length > 1) map.fitBounds(L.latLngBounds(bounds), { padding: [36, 36], maxZoom: 14 });
  }, [start, end, endIsStart, stops, legs, activeLeg]);

  return <div ref={holder} dir="ltr" className={className} style={{ zIndex: 0 }} />;
}
