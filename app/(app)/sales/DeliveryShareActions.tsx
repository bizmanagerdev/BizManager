"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Loader2, Phone, Share2 } from "lucide-react";
import { toast } from "sonner";
import { WazeIcon } from "@/components/ui/waze-icon";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toHebrewError } from "@/lib/error-messages";
import { formatDeliveryAddress } from "@/lib/ui/cities";
import { paymentStatusLabel } from "@/lib/orders/paymentStatus";
import { pinFrom, wazeLinkForPin } from "@/lib/delivery-location";
import type { DeliveryItem } from "@/app/(app)/sales/loadDeliveries";

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
}: {
  delivery: DeliveryItem;
  className?: string;
  label?: string;
}) {
  const slipRef = useRef<HTMLDivElement>(null);
  const [renderingImage, setRenderingImage] = useState(false);

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

        const fileName = `משלוח-${current.customerName}.png`.replace(/[\\/:*?"<>|]/g, "-");
        const file = new File([blob], fileName, { type: "image/png" });
        const shareData = {
          title: `משלוח — ${current.customerName}`,
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

        // Touch devices (phones, the Android app's WebView) get the real native
        // share sheet — that opens WhatsApp directly and works reliably there.
        const isTouch =
          typeof window !== "undefined" &&
          window.matchMedia?.("(pointer: coarse)").matches === true &&
          (navigator.maxTouchPoints ?? 0) > 0;

        if (
          isTouch &&
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

        // Desktop: the OS share picker for images is broken in current Chrome (it
        // hangs), so don't call it. Copy the image to the clipboard and open WhatsApp
        // Web — paste it into a chat with Ctrl+V. The image also downloads as a
        // backup for anyone whose browser can't copy images.
        let copied = false;
        try {
          if (navigator.clipboard && "ClipboardItem" in window) {
            await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
            copied = true;
          }
        } catch {
          // Clipboard blocked (tab not focused / no permission) — download covers it.
        }
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
        variant="secondary"
        size="sm"
        className={cn("gap-1", className)}
        onClick={() => setRenderingImage(true)}
        disabled={renderingImage}
      >
        {renderingImage ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Share2 className="h-4 w-4" />
        )}
        <span>{label}</span>
      </Button>

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
            <span style={{ fontSize: "72px", lineHeight: 1.2, flexShrink: 0 }}>🚚</span>
            {/* A long customer name wraps here rather than colliding with the phone
                row below it — flex:1 + minWidth:0 keeps it inside its own column. */}
            <span style={{ ...slipValueStyle, fontSize: "60px", fontWeight: 700, lineHeight: 1.2 }}>
              {delivery.customerName}
            </span>
          </div>

          {delivery.customerPhone ? (
            <div style={slipRowStyle}>
              <span style={slipIconStyle}>
                <Phone size={58} color="#000000" fill="#000000" strokeWidth={1.5} />
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
              <span style={slipIconStyle}>📍</span>
              <span style={slipValueStyle}>{delivery.deliveryInstructions}</span>
            </div>
          ) : null}

          {/* The exact drop-off pin, as text. It can't be tapped from an image —
              the share sheet also sends it as a link — but it means the precise
              spot is still legible on the picture alone, e.g. if it's forwarded. */}
          {slipPin ? (
            <div style={slipRowStyle}>
              <span style={slipIconStyle}>🎯</span>
              <span
                dir="ltr"
                style={{ ...slipValueStyle, unicodeBidi: "embed", fontSize: "42px", color: SLIP_LABEL }}
              >
                {wazeLinkForPin(slipPin)}
              </span>
            </div>
          ) : null}

          <div style={slipRowStyle}>
            <span style={slipIconStyle}>💰</span>
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
              <span style={{ fontSize: "62px", lineHeight: 1 }}>⚠️</span>
              <span>גבייה ע&quot;י הנהג</span>
            </div>
          ) : null}

          {delivery.items.length > 0 ? (
            <div style={{ marginTop: "18px" }}>
              <div style={{ ...slipRowStyle, marginBottom: "12px", color: SLIP_LABEL }}>
                <span style={slipIconStyle}>📦</span>
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
              <span style={slipIconStyle}>📝</span>
              <span style={slipValueStyle}>{delivery.notes}</span>
            </div>
          ) : null}
        </div>
        </div>
      ) : null}
    </>
  );
}
