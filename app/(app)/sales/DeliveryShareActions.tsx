"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { CashIcon, DeliveryIcon, LocationIcon, NoteIcon, PhoneIcon, ProductIcon, SavedLocationIcon, ShareIcon, SpinnerIcon, WarningIcon, WazeIcon } from "@/components/ui/icons";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toHebrewError } from "@/lib/error-messages";
import { formatDeliveryAddress } from "@/lib/ui/cities";
import { paymentStatusLabel } from "@/lib/orders/paymentStatus";
import { pinFrom, wazeLinkForPin, type DeliveryPin } from "@/lib/delivery-location";
import { isNativePlatform, shareImageNative } from "@/lib/native-share";
import { combinedCustomerName, type DeliveryItem } from "@/app/(app)/sales/loadDeliveries";

function formatCurrency(value: number | null) {
  if (value === null) return "-";
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatItem(item: DeliveryItem["items"][number]) {
  const base = `${item.quantity} ${item.name}`;
  return item.notes ? `${base} (${item.notes})` : base;
}

/** Best-effort image clipboard copy — works via the Async Clipboard API alone,
 *  no native plugin required, so (unlike shareImageNative) it doesn't need a
 *  fresh native build to take effect inside the packaged app. Used as the
 *  last-resort fallback on BOTH the phone and desktop paths, once every real
 *  share mechanism has been tried and failed. */
async function copyImageToClipboard(blob: Blob): Promise<boolean> {
  try {
    if (navigator.clipboard && "ClipboardItem" in window) {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      return true;
    }
  } catch {
    // Clipboard blocked (unfocused tab / no permission) or unsupported — the
    // caller falls back to a file download either way.
  }
  return false;
}

/** Plain-text version of the slip, for when the image can't be shared as a file.
 *  Includes the customer's phone as reference text for the driver — this is NOT
 *  a wa.me link and never selects a recipient; the OS share sheet still lets
 *  the person sharing pick who it goes to. */
function buildDeliveryShareText(delivery: DeliveryItem, address: string, pin: DeliveryPin | null): string {
  const lines: string[] = [`משלוח — ${combinedCustomerName(delivery)}`];
  if (delivery.customerPhone) lines.push(delivery.customerPhone);
  if (address) lines.push(address);
  if (delivery.deliveryInstructions) lines.push(delivery.deliveryInstructions);
  if (pin) lines.push(wazeLinkForPin(pin));
  lines.push("");
  lines.push(`${formatCurrency(delivery.totalAmount)} · ${paymentStatusLabel(delivery.paymentStatus)}`);
  if (delivery.collectOnDelivery) lines.push('גבייה ע"י הנהג');
  if (delivery.items.length > 0) {
    lines.push("");
    lines.push("מוצרים:");
    for (const item of delivery.items) lines.push(`• ${formatItem(item)}`);
  }
  if (delivery.notes) {
    lines.push("");
    lines.push(delivery.notes);
  }
  return lines.join("\n");
}

const SLIP_LABEL = "#475569";
const SLIP_TEXT = "#1e293b";

const slipRowStyle: CSSProperties = {
  // align to the TOP, not center: a value that wraps to two lines (a long address,
  // a note) must grow the row downward, never draw over the icon or the next row.
  display: "flex",
  alignItems: "flex-start",
  gap: "18px",
  marginBottom: "14px",
};
// Every text value in a row. flex:1 + minWidth:0 makes it wrap INSIDE its own
// column instead of overflowing the row, and break-word stops an unbreakable
// string (a long link) from pushing the layout wider than the canvas.
const slipValueStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflowWrap: "break-word",
  wordBreak: "break-word",
};
const slipIconStyle: CSSProperties = {
  fontSize: "62px",
  lineHeight: 1,
  flexShrink: 0,
  width: "70px",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  textAlign: "center",
};

export default function DeliveryShareActions({
  delivery,
  className,
  label = "שיתוף",
  variant = "secondary",
}: {
  delivery: DeliveryItem;
  className?: string;
  label?: string;
  /** "ghost" for a bare glyph with no button plate — see the dashboard card. */
  variant?: React.ComponentProps<typeof Button>["variant"];
}) {
  const slipRef = useRef<HTMLDivElement>(null);
  const [renderingImage, setRenderingImage] = useState(false);
  // Guaranteed last-resort fallback (see the touch-path comment below): an
  // object URL for the captured slip, shown full-screen so the user can
  // long-press it to save/copy — doesn't depend on trusting any JS API.
  const [fallbackImageUrl, setFallbackImageUrl] = useState<string | null>(null);
  const [fallbackShareText, setFallbackShareText] = useState<string | null>(null);
  const [fallbackTextCopied, setFallbackTextCopied] = useState(false);

  // Revoke the object URL whenever it's replaced or the component unmounts —
  // it's only ever needed while the fallback overlay is on screen.
  useEffect(() => {
    return () => {
      if (fallbackImageUrl) URL.revokeObjectURL(fallbackImageUrl);
    };
  }, [fallbackImageUrl]);

  // The latest delivery, read inside the capture WITHOUT making it an effect
  // dependency. Depending on `delivery` (a fresh object on every list re-render)
  // used to tear the effect down mid-capture, so the finally that resets the
  // spinner never ran and the button span forever.
  const deliveryRef = useRef(delivery);
  deliveryRef.current = delivery;
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Runs once each time renderingImage flips true. Deps are ONLY [renderingImage]
  // so nothing else can cancel it; the spinner is always reset in finally.
  useEffect(() => {
    if (!renderingImage) return;

    const run = async () => {
      const current = deliveryRef.current;
      // Same reasoning as `current` itself (see the comment above deliveryRef):
      // re-derive from the ref instead of closing over the outer `address`/
      // `slipPin` consts, so a delivery update mid-capture can't leave the
      // share TEXT quoting a different address than the slip IMAGE (captured
      // fresh from the DOM below) actually shows.
      const currentAddress = formatDeliveryAddress({ address: current.address, city: current.city });
      const currentSlipPin = pinFrom(current.deliveryLat, current.deliveryLng);
      try {
        if ("fonts" in document) await document.fonts.ready;
        const node = slipRef.current;
        if (!node) return;

        // WhatsApp shrinks tall/portrait images to fit the chat bubble height, so
        // a slip with many rows would render smaller than a short one. Cap the
        // portrait ratio by widening the canvas when it's too tall — then WhatsApp
        // always fits it by width and every slip displays at a consistent size.
        const MAX_PORTRAIT_RATIO = 1.2; // height / width
        if (node.offsetHeight > node.offsetWidth * MAX_PORTRAIT_RATIO) {
          node.style.width = `${Math.ceil(node.offsetHeight / MAX_PORTRAIT_RATIO)}px`;
          void node.offsetHeight; // force reflow so the new width is measured
        }

        const { toBlob } = await import("html-to-image");
        // Race the capture against a timeout so a hung html-to-image (it can stall
        // indefinitely on some engines) surfaces as an error instead of an
        // endlessly-spinning button.
        const blob = await Promise.race([
          toBlob(node, {
            pixelRatio: 2,
            backgroundColor: "#ffffff",
            cacheBust: true,
            width: node.offsetWidth,
            height: node.offsetHeight,
            // The slip uses only system fonts (system-ui / Segoe UI), so there's
            // nothing to embed. Skipping the font step removes html-to-image's most
            // common stall — it fetches and inlines @font-face CSS, which can hang
            // indefinitely and is exactly the kind of intermittent freeze seen here.
            skipFonts: true,
          }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("timeout")), 15000)
          ),
        ]);
        if (!blob) {
          toast.error("יצירת התמונה נכשלה.");
          return;
        }

        const fileName = `משלוח-${combinedCustomerName(current)}.png`.replace(/[\\/:*?"<>|]/g, "-");
        const file = new File([blob], fileName, { type: "image/png" });
        const shareData = {
          title: `משלוח — ${combinedCustomerName(current)}`,
          files: [file],
        };

        const saveFile = () => {
          const url = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = url;
          link.download = fileName;
          link.click();
          URL.revokeObjectURL(url);
        };

        // Touch devices get the REAL native OS share sheet — pick WhatsApp,
        // email, Drive, whatever's installed, and choose the recipient there.
        // The one thing this must never do is decide the recipient FOR the
        // user (this slip is for the driver, not automatically the customer
        // whose order it is) — see the bottom fallback.
        const isTouch =
          typeof window !== "undefined" &&
          window.matchMedia?.("(pointer: coarse)").matches === true &&
          (navigator.maxTouchPoints ?? 0) > 0;

        if (isTouch) {
          // Inside the packaged Android app, go straight to the native share
          // bridge — the WebView's own navigator.share below is unreliable
          // there (it can report unsupported, or silently no-op) even though
          // the phone shares fine everywhere else. This talks to Android's
          // real share sheet directly, so it works exactly like every other
          // app on the device.
          if (await isNativePlatform()) {
            const nativeResult = await shareImageNative(
              blob,
              fileName,
              `משלוח — ${combinedCustomerName(current)}`
            );
            if (nativeResult !== "unavailable") return;
          }

          if (
            typeof navigator !== "undefined" &&
            "canShare" in navigator &&
            navigator.canShare(shareData)
          ) {
            try {
              const HUNG = Symbol("hung");
              const outcome = await Promise.race([
                navigator.share(shareData).then(() => "shared" as const),
                new Promise<typeof HUNG>((resolve) => setTimeout(() => resolve(HUNG), 6000)),
              ]);
              if (outcome !== HUNG) return;
            } catch (shareError: unknown) {
              if (shareError instanceof Error && shareError.name === "AbortError") return;
            }
          }

          // File sharing wasn't available (or didn't go through) — still a
          // phone, so give a real native share sheet instead of ever falling
          // into the desktop "copy image + open WhatsApp Web" trick below.
          // Text sharing is far more broadly supported across phone
          // browsers/WebViews than file sharing, so this succeeds even where
          // the block above can't.
          const shareText = buildDeliveryShareText(current, currentAddress, currentSlipPin);
          if (typeof navigator !== "undefined" && "share" in navigator) {
            try {
              const HUNG = Symbol("hung");
              const outcome = await Promise.race([
                navigator
                  .share({ title: `משלוח — ${combinedCustomerName(current)}`, text: shareText })
                  .then(() => "shared" as const),
                new Promise<typeof HUNG>((resolve) => setTimeout(() => resolve(HUNG), 6000)),
              ]);
              if (outcome !== HUNG) return;
            } catch (shareError: unknown) {
              if (shareError instanceof Error && shareError.name === "AbortError") return;
            }
          }

          // Nothing else worked. Neither of these can be TRUSTED as proof of
          // success on this device's WebView — clipboard.write can resolve
          // without throwing while not actually placing anything on the
          // system clipboard, and the anchor-download trick needs a download
          // handler the app's shell doesn't have — confirmed by direct
          // on-device testing (both silently no-op here). Attempt them anyway
          // as a bonus in case they DO work on this particular device, but
          // don't claim success either way — instead fall back to something
          // that doesn't depend on trusting a JS API at all: show the image
          // on screen so the driver can long-press it. Android's native
          // "save image" / "copy image" context menu on an <img> is baked
          // into the WebView widget itself, independent of any Capacitor
          // plugin or Clipboard API support.
          void copyImageToClipboard(blob);
          saveFile();
          setFallbackShareText(shareText);
          setFallbackImageUrl(URL.createObjectURL(blob));
          return;
        }

        // Desktop: the OS share picker for images is broken in current Chrome (it
        // hangs), so don't call it. Copy the image to the clipboard and open WhatsApp
        // Web — paste it into a chat with Ctrl+V. The image also downloads as a
        // backup for anyone whose browser can't copy images.
        const copied = await copyImageToClipboard(blob);
        saveFile();
        toast.success(
          copied
            ? "התמונה הועתקה. פתחו וואטסאפ והדביקו בצ׳אט (Ctrl+V)"
            : "התמונה הורדה. צרפו אותה בוואטסאפ.",
          {
            duration: 10000,
            action: {
              label: "פתח וואטסאפ ווב",
              onClick: () => window.open("https://web.whatsapp.com/", "_blank", "noopener"),
            },
          }
        );
      } catch (error: unknown) {
        if (error instanceof Error && error.name === "AbortError") return;
        toast.error(toHebrewError(error, "שיתוף התמונה נכשל."));
      } finally {
        // ALWAYS clear the spinner — a stuck spinner is worse than a rare
        // setState-after-unmount warning (guarded by mountedRef anyway).
        if (mountedRef.current) setRenderingImage(false);
      }
    };

    void run();
  }, [renderingImage]);

  const address = formatDeliveryAddress({ address: delivery.address, city: delivery.city });
  const slipPin = pinFrom(delivery.deliveryLat, delivery.deliveryLng);

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size="sm"
        className={cn("gap-1", className)}
        onClick={() => setRenderingImage(true)}
        disabled={renderingImage}
      >
        {renderingImage ? (
          <SpinnerIcon className="h-4 w-4 animate-spin" />
        ) : (
          <ShareIcon className="h-4 w-4" />
        )}
        <span>{label}</span>
      </Button>

      {/* Guaranteed manual fallback — see the touch-path comment above. A
          plain fixed overlay (not the app's own Dialog) on purpose: it must
          keep working even if something about the WebView's JS environment
          is what's misbehaving elsewhere in this flow. */}
      {fallbackImageUrl ? (
        <div
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-black/85 p-4"
          onClick={() => {
            setFallbackImageUrl(null);
            setFallbackShareText(null);
            setFallbackTextCopied(false);
          }}
        >
          <p
            className="max-w-xs text-center text-sm font-medium text-white"
            onClick={(e) => e.stopPropagation()}
          >
            השיתוף האוטומטי לא עבד במכשיר זה. אם לחיצה ארוכה על התמונה לא פותחת אפשרות שמירה/העתקה — הדרך הבטוחה
            ביותר היא לצלם מסך (Screenshot) של התמונה שלמטה.
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element -- a plain
              <img> is required here: it's what puts Android's native
              long-press "save image / copy image" menu on the element where
              that IS available — and it's also just something a screenshot
              can capture either way, which next/image's wrapper could get in
              the way of. */}
          <img
            src={fallbackImageUrl}
            alt="משלוח"
            className="max-h-[70vh] max-w-full rounded-lg shadow-xl"
            onClick={(e) => e.stopPropagation()}
          />
          {fallbackShareText ? (
            <button
              type="button"
              className="rounded-full bg-white/15 px-5 py-2 text-sm font-medium text-white"
              onClick={async (e) => {
                e.stopPropagation();
                try {
                  await navigator.clipboard.writeText(fallbackShareText);
                  setFallbackTextCopied(true);
                } catch {
                  toast.error("העתקת הטקסט נכשלה גם היא במכשיר זה.");
                }
              }}
            >
              {fallbackTextCopied ? "הפרטים הועתקו כטקסט ✓" : "העתקת הפרטים כטקסט"}
            </button>
          ) : null}
          <button
            type="button"
            className="rounded-full bg-white px-5 py-2 text-sm font-medium text-black"
            onClick={() => {
              setFallbackImageUrl(null);
              setFallbackShareText(null);
              setFallbackTextCopied(false);
            }}
          >
            סגירה
          </button>
        </div>
      ) : null}

      {/* Clean slip rendered only while capturing. It sits at the origin inside a
          zero-size, invisible clip wrapper (NOT off-screen) so html-to-image's
          cloned SVG keeps the content in frame. Inline styles keep the export
          deterministic and free of Tailwind oklch colors. */}
      {renderingImage ? (
        <div
          aria-hidden
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: 0,
            height: 0,
            overflow: "hidden",
            opacity: 0,
            zIndex: -1,
            pointerEvents: "none",
          }}
        >
        <div
          ref={slipRef}
          dir="rtl"
          style={{
            width: "720px",
            boxSizing: "border-box",
            padding: "44px",
            background: "#ffffff",
            color: SLIP_TEXT,
            fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
            fontSize: "54px",
            lineHeight: 1.3,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: "18px",
              borderBottom: "5px solid #e2e8f0",
              paddingBottom: "18px",
              marginBottom: "22px",
            }}
          >
            <DeliveryIcon size={72} color={SLIP_TEXT} strokeWidth={1.75} style={{ flexShrink: 0 }} />
            {/* A long customer name wraps here rather than colliding with the phone
                row below it — flex:1 + minWidth:0 keeps it inside its own column. */}
            <span style={{ ...slipValueStyle, fontSize: "60px", fontWeight: 700, lineHeight: 1.2 }}>
              {combinedCustomerName(delivery)}
            </span>
          </div>

          {delivery.customerPhone ? (
            <div style={slipRowStyle}>
              <span style={slipIconStyle}>
                <PhoneIcon size={58} color="#000000" fill="#000000" strokeWidth={1.5} />
              </span>
              {/* dir=ltr keeps the digits in dialling order; textAlign right pulls
                  the number back to the start edge so it lines up with every other
                  row instead of hanging off on the left. */}
              <span dir="ltr" style={{ ...slipValueStyle, unicodeBidi: "embed", textAlign: "right" }}>
                {delivery.customerPhone}
              </span>
            </div>
          ) : null}

          {address ? (
            <div style={slipRowStyle}>
              <span style={slipIconStyle}>
                <WazeIcon size={62} style={{ color: "#33ccff" }} />
              </span>
              <span style={slipValueStyle}>{address}</span>
            </div>
          ) : null}

          {/* The arrival directions travel WITH the slip. Sharing a delivery to a
              driver on WhatsApp is often the only thing they'll have in hand, so
              leaving "around the corner, blue gate" behind in the app defeats it. */}
          {delivery.deliveryInstructions ? (
            <div style={slipRowStyle}>
              <span style={slipIconStyle}>
                <LocationIcon size={58} color={SLIP_TEXT} strokeWidth={1.75} />
              </span>
              <span style={slipValueStyle}>{delivery.deliveryInstructions}</span>
            </div>
          ) : null}

          {/* The exact drop-off pin, as text. It can't be tapped from an image —
              the share sheet also sends it as a link — but it means the precise
              spot is still legible on the picture alone, e.g. if it's forwarded. */}
          {slipPin ? (
            <div style={slipRowStyle}>
              <span style={slipIconStyle}>
                <SavedLocationIcon size={58} color={SLIP_TEXT} strokeWidth={1.75} />
              </span>
              <span
                dir="ltr"
                style={{ ...slipValueStyle, unicodeBidi: "embed", fontSize: "42px", color: SLIP_LABEL }}
              >
                {wazeLinkForPin(slipPin)}
              </span>
            </div>
          ) : null}

          <div style={slipRowStyle}>
            <span style={slipIconStyle}>
              <CashIcon size={58} color={SLIP_TEXT} strokeWidth={1.75} />
            </span>
            <span style={slipValueStyle}>
              <span style={{ fontWeight: 700 }}>{formatCurrency(delivery.totalAmount)}</span>
              <span style={{ color: SLIP_LABEL }}> · {paymentStatusLabel(delivery.paymentStatus)}</span>
            </span>
          </div>

          {delivery.collectOnDelivery ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "16px",
                margin: "18px 0",
                padding: "14px 24px",
                borderRadius: "18px",
                background: "#fef3c7",
                color: "#92400e",
                fontWeight: 700,
                fontSize: "54px",
              }}
            >
              <WarningIcon size={62} color="#92400e" strokeWidth={2} style={{ flexShrink: 0 }} />
              <span>גבייה ע&quot;י הנהג</span>
            </div>
          ) : null}

          {delivery.items.length > 0 ? (
            <div style={{ marginTop: "18px" }}>
              <div style={{ ...slipRowStyle, marginBottom: "12px", color: SLIP_LABEL }}>
                <span style={slipIconStyle}>
                  <ProductIcon size={58} color={SLIP_LABEL} strokeWidth={1.75} />
                </span>
                <span>מוצרים:</span>
              </div>
              {delivery.items.map((item, index) => (
                <div
                  key={index}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "16px",
                    marginBottom: "10px",
                    paddingInlineStart: "76px",
                  }}
                >
                  <span style={{ flexShrink: 0 }}>•</span>
                  <span style={slipValueStyle}>{formatItem(item)}</span>
                </div>
              ))}
            </div>
          ) : null}

          {delivery.notes ? (
            <div
              style={{
                ...slipRowStyle,
                marginTop: "20px",
                marginBottom: 0,
                paddingTop: "16px",
                borderTop: "1px solid #e2e8f0",
                alignItems: "flex-start",
                color: SLIP_LABEL,
              }}
            >
              <span style={slipIconStyle}>
                <NoteIcon size={58} color={SLIP_LABEL} strokeWidth={1.75} />
              </span>
              <span style={slipValueStyle}>{delivery.notes}</span>
            </div>
          ) : null}
        </div>
        </div>
      ) : null}
    </>
  );
}
