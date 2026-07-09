/** A move endpoint as stored on the projects row. */
export type MovingEndpoint = {
  address: string | null;
  floor: string | null;
  hasElevator: boolean | null;
};

/** One-line human summary of a move endpoint, e.g.
 *  "רח׳ יונה 16 · קומה 4 · ללא מעלית". Returns null when there is no address
 *  to show (floor/elevator alone aren't worth rendering). */
export function formatMovingEndpoint(endpoint: MovingEndpoint | null | undefined): string | null {
  const address = endpoint?.address?.trim();
  if (!address) return null;
  const parts = [address];
  const floor = endpoint?.floor?.trim();
  if (floor) parts.push(`קומה ${floor}`);
  if (endpoint?.hasElevator === true) parts.push("עם מעלית");
  else if (endpoint?.hasElevator === false) parts.push("ללא מעלית");
  return parts.join(" · ");
}
