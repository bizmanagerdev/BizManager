package com.bizh.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import androidx.biometric.BiometricManager;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Fingerprint sign-in and the app lock (APK 1.2; owner, 2026-10-11: "signing in
 * with your fingerprint is also very valuable", the password always works too).
 *
 * Sign-in: the email and password are kept encrypted with a key in the phone's
 * secure hardware (Android Keystore). The key opens only right after a
 * fingerprint (or another strong biometric) matches, so nothing on the phone,
 * the website included, can read the password without the owner's finger. A
 * fingerprint added to the phone later voids the key, and the saved sign-in with
 * it: the password is typed once and fingerprint sign-in is turned on again.
 *
 * App lock: a setting kept here; MainActivity covers the app until the phone's
 * owner unlocks it (fingerprint, face, or the phone's own PIN / pattern).
 */
final class Fingerprint {

    static final String PREFS = "bizh_security";
    private static final String PREF_EMAIL = "fingerprint_email";
    private static final String PREF_SECRET = "fingerprint_secret";
    private static final String PREF_APP_LOCK = "app_lock";
    private static final String KEY_ALIAS = "bizh_fingerprint_login";
    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";

    /** What the app lock accepts: a fingerprint or face, or the phone's own PIN / pattern / password. */
    static final int LOCK_AUTHENTICATORS =
        BiometricManager.Authenticators.BIOMETRIC_WEAK | BiometricManager.Authenticators.DEVICE_CREDENTIAL;

    private Fingerprint() {}

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** A fingerprint (strong biometric) is set up on this phone. */
    static boolean canSignIn(Context context) {
        return BiometricManager.from(context).canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG) ==
        BiometricManager.BIOMETRIC_SUCCESS;
    }

    /** The phone has a screen lock (or a biometric) the app lock can ask for. */
    static boolean canLock(Context context) {
        return BiometricManager.from(context).canAuthenticate(LOCK_AUTHENTICATORS) == BiometricManager.BIOMETRIC_SUCCESS;
    }

    static boolean hasSignIn(Context context) {
        return prefs(context).getString(PREF_SECRET, null) != null;
    }

    static String signInEmail(Context context) {
        return hasSignIn(context) ? prefs(context).getString(PREF_EMAIL, null) : null;
    }

    static void deleteSignIn(Context context) {
        prefs(context).edit().remove(PREF_EMAIL).remove(PREF_SECRET).apply();
        try {
            KeyStore keyStore = KeyStore.getInstance(KEYSTORE);
            keyStore.load(null);
            keyStore.deleteEntry(KEY_ALIAS);
        } catch (Exception e) {
            // Nothing there to delete.
        }
    }

    /** A fresh key and a cipher ready to encrypt once a fingerprint unlocks it. */
    static Cipher encryptCipher() throws Exception {
        KeyStore keyStore = KeyStore.getInstance(KEYSTORE);
        keyStore.load(null);
        keyStore.deleteEntry(KEY_ALIAS);

        KeyGenParameterSpec.Builder spec = new KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setUserAuthenticationRequired(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) spec.setInvalidatedByBiometricEnrollment(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) spec.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG);

        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE);
        generator.init(spec.build());
        SecretKey key = generator.generateKey();
        Cipher cipher = Cipher.getInstance(TRANSFORMATION);
        cipher.init(Cipher.ENCRYPT_MODE, key);
        return cipher;
    }

    /**
     * A cipher ready to decrypt the saved sign-in once a fingerprint unlocks it.
     * Throws KeyPermanentlyInvalidatedException when a fingerprint was added or
     * removed since it was saved.
     */
    static Cipher decryptCipher(Context context) throws Exception {
        String secret = prefs(context).getString(PREF_SECRET, null);
        if (secret == null) throw new IllegalStateException("No saved sign-in");
        byte[] iv = Base64.decode(secret.substring(0, secret.indexOf(':')), Base64.NO_WRAP);
        KeyStore keyStore = KeyStore.getInstance(KEYSTORE);
        keyStore.load(null);
        SecretKey key = (SecretKey) keyStore.getKey(KEY_ALIAS, null);
        if (key == null) throw new IllegalStateException("No key");
        Cipher cipher = Cipher.getInstance(TRANSFORMATION);
        cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, iv));
        return cipher;
    }

    /** Encrypt and keep the sign-in, with the cipher a fingerprint just unlocked. */
    static void saveSignIn(Context context, String email, Cipher unlocked, String secretJson) throws Exception {
        byte[] encrypted = unlocked.doFinal(secretJson.getBytes(StandardCharsets.UTF_8));
        String secret =
            Base64.encodeToString(unlocked.getIV(), Base64.NO_WRAP) + ":" + Base64.encodeToString(encrypted, Base64.NO_WRAP);
        prefs(context).edit().putString(PREF_EMAIL, email).putString(PREF_SECRET, secret).apply();
    }

    /** The saved sign-in, decrypted with the cipher a fingerprint just unlocked. */
    static String readSignIn(Context context, Cipher unlocked) throws Exception {
        String secret = prefs(context).getString(PREF_SECRET, null);
        if (secret == null) throw new IllegalStateException("No saved sign-in");
        byte[] encrypted = Base64.decode(secret.substring(secret.indexOf(':') + 1), Base64.NO_WRAP);
        return new String(unlocked.doFinal(encrypted), StandardCharsets.UTF_8);
    }

    static boolean appLockOn(Context context) {
        return prefs(context).getBoolean(PREF_APP_LOCK, false);
    }

    static void setAppLock(Context context, boolean on) {
        prefs(context).edit().putBoolean(PREF_APP_LOCK, on).apply();
    }
}
