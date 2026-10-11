// A short buzz for touch feedback: a task card held long enough to open its menu,
// pull to refresh reaching its line.
//
// In the Android app (APK 1.1.0 and later) this is the phone's own haptic
// (@capacitor/haptics), which Android always plays. The web's navigator.vibrate
// never reached the phone from inside the app: on the test phone it answered
// "true" and Android's vibration log showed nothing, while a haptic from the
// helper played at once (owner, 2026-10-11: "I don't feel the vibrate").
// In a browser, and in the old APK, it falls back to navigator.vibrate.
//
// Capacitor is loaded with import() so nothing here runs during SSR.

export type HapticStrength = "light" | "medium";

type Buzz = (strength: HapticStrength) => void;

let nativeBuzz: Promise<Buzz | null> | undefined;

function loadNativeBuzz(): Promise<Buzz | null> {
  nativeBuzz ??= import("@capacitor/core")
    .then(async ({ Capacitor }) => {
      if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable("Haptics")) return null;
      const { Haptics, ImpactStyle } = await import("@capacitor/haptics");
      return (strength: HapticStrength) => {
        Haptics.impact({ style: strength === "light" ? ImpactStyle.Light : ImpactStyle.Medium }).catch(() => {});
      };
    })
    .catch(() => null);
  return nativeBuzz;
}

/** Buzz the phone once. Fire-and-forget; does nothing where there's no vibration. */
export function haptic(strength: HapticStrength = "medium"): void {
  void loadNativeBuzz().then((buzz) => {
    if (buzz) buzz(strength);
    else navigator.vibrate?.(strength === "light" ? 20 : 35);
  });
}

/** Load the helper ahead of the first buzz, so that one isn't late. */
export function warmUpHaptics(): void {
  void loadNativeBuzz();
}
