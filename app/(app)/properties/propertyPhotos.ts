// The properties' photos for the list's cards (/api/properties/photos — signed,
// so the server's), asked for once the list is on screen and kept for the
// visit, so coming back to the list doesn't ask again. A photo added on a
// property's page forgets them, so the list asks again and shows it.

let photosCache: Record<string, string> | null = null;
let photosRequest: Promise<Record<string, string>> | null = null;

export function cachedPropertyPhotos(): Record<string, string> | null {
  return photosCache;
}

export function loadPropertyPhotos(): Promise<Record<string, string>> {
  if (photosCache) return Promise.resolve(photosCache);
  photosRequest ??= fetch("/api/properties/photos")
    .then((res) => (res.ok ? (res.json() as Promise<{ photos?: Record<string, string> }>) : { photos: {} }))
    .then((json) => (photosCache = json.photos ?? {}))
    .catch(() => {
      photosRequest = null;
      return {};
    });
  return photosRequest;
}

/** A property's photo changed: the list asks for them again next time. */
export function forgetPropertyPhotos() {
  photosCache = null;
  photosRequest = null;
}
