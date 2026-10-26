// What the route map (RouteMap.tsx) is given, and the route's colours — apart
// from the map itself, which loads Leaflet and so only runs in a browser.

export type MapStop = {
  key: string;
  lat: number;
  lng: number;
  /** The city's colour (lib/deliveries/city-colours.ts). */
  color: string;
  label: string;
  /** The stop's place in the route; null before a route is worked out. */
  number: number | null;
};

export type MapPoint = { lat: number; lng: number };

/** The route's colour from the first leg to the last: deep blue, through teal, to green. */
export function legColour(index: number, count: number): string {
  const t = count <= 1 ? 0 : index / (count - 1);
  return `hsl(${Math.round(205 - 60 * t)} 85% ${Math.round(38 + 4 * t)}%)`;
}
