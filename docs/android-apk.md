# BizH Android APK (Capacitor shell)

BizH is a server-rendered Next.js app (SSR, API routes, Supabase cookie auth), so
it **cannot** be exported as static files and bundled into an APK. Instead we ship
a thin **Capacitor** native Android shell whose WebView loads the live site
(`https://biz-h.com`) directly. The APK is a real, signed, inspectable Android
package — suitable to hand to a content-filter provider (e.g. NetFree) for approval.

## Deliverable

- **APK:** `Desktop/BizH-release.apk` (also at `android/app/build/outputs/apk/release/app-release.apk`)
- **Package name:** `com.bizh.app`
- **App label:** BizH
- **Loads:** `https://biz-h.com`
- **min / target SDK:** 23 / 35
- **Signing cert:** `CN=BizH, O=BizH, L=Israel, C=IL`
  - SHA-256: `30fe593bcd56dfbdab2fe12a0ede4ca8db054743a3a2bc0db58a26f100e6c9e9`
  - SHA-1:   `0a1b37c93fffad00c79d7cb1a4496cb47f467722`

## Signing keystore — BACK THIS UP

- Keystore: `android/app/bizh-release.keystore` (git-ignored — not in the repo)
- Credentials: `android/keystore.properties` (git-ignored; alias = `bizh`, password stored there locally)

If you lose this keystore you can no longer publish updates that Android/the filter
recognise as the *same* app — you'd have to ship a new package under a new signature.
Copy `bizh-release.keystore` + the password somewhere safe (password manager / backup).
Neither the keystore nor `keystore.properties` should be committed to source control.

## Rebuilding the APK

From `android/`:

```bash
export ANDROID_HOME="$LOCALAPPDATA/Android/Sdk"
# This machine is behind the NetFree filter, which TLS-intercepts dl.google.com.
# NetFree's CA is in the Windows cert store, so tell the JVM to trust it:
export GRADLE_OPTS="-Djavax.net.ssl.trustStoreType=WINDOWS-ROOT"
export JAVA_OPTS="-Djavax.net.ssl.trustStoreType=WINDOWS-ROOT"
./gradlew assembleRelease
```

(The same `trustStoreType=WINDOWS-ROOT` is also baked into `android/gradle.properties`
for the Gradle daemon; the two env vars above cover the wrapper/bootstrap JVM.)

### After changing the deployed URL, app name, or web behaviour
`capacitor.config.ts` is the source of truth. After editing it run
`npx cap sync android`, then rebuild.

### Shipping an update
Bump `versionCode` (and usually `versionName`) in `android/app/build.gradle`,
rebuild, and hand over the new APK. Keep the **same keystore** so the signature matches.

## Notes / limitations
- Because the shell loads a remote URL, the app needs internet; offline it shows the
  fallback page in `capacitor-shell/index.html`.
- Web Push inside a plain Android WebView is not guaranteed to behave like the PWA.
  The existing web-push/PWA notification path is unaffected on the website itself.
- The Android SDK (build-tools 35, platform 35, platform-tools) was installed by
  downloading the package zips directly via curl into `%LOCALAPPDATA%\Android\Sdk`,
  because `sdkmanager` (Java) can't fetch through NetFree's intercepted `dl.google.com`.
