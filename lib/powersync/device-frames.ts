// The device pages' frames the service worker saves (public/sw.js,
// FRAMES_CACHE) so the app opens on them at once. They show the signed-in
// person's layout, so they go at logout and when someone else signs in.

const FRAMES_PREFIX = "bizh-frames-";
const FRAMES_USER_KEY = "bizh-frames-user";

export async function clearDeviceFrames(): Promise<void> {
  try {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith(FRAMES_PREFIX)).map((name) => caches.delete(name)));
  } catch {
    // No Cache Storage here (or blocked): nothing was saved.
  }
}

/** Someone other than the frames' person is signed in on this device: drop them. */
export function keepDeviceFramesFor(userId: string): void {
  try {
    if (localStorage.getItem(FRAMES_USER_KEY) === userId) return;
    localStorage.setItem(FRAMES_USER_KEY, userId);
  } catch {
    // Storage blocked: clear, to be safe.
  }
  void clearDeviceFrames();
}
