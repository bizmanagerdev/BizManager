"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Image as ImageIcon, Loader2, Phone } from "lucide-react";
import { toast } from "sonner";
import { WazeIcon } from "@/components/ui/waze-icon";
import { Button } from "@/components/ui/button";
import { toHebrewError } from "@/lib/error-messages";
import { formatDeliveryAddress } from "@/lib/ui/cities";
import { paymentStatusLabel } from "@/lib/orders/paymentStatus";
import type { DeliveryItem } from "@/app/(app)/sales/loadDeliveries";

function formatCurrency(value: number | null) {
  if (value === null) return "-";
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
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
  display: "flex",
  alignItems: "center",
  gap: "18px",
  marginBottom: "14px",
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

export default function DeliveryShareActions({ delivery }: { delivery: DeliveryItem }) {
  const slipRef = useRef<HTMLDivElement>(null);
  const [renderingImage, setRenderingImage] = useState(false);

  // When renderingImage flips on, the off-screen slip is mounted; capture it,
  // hand it to the share sheet (or download), then unmount.
  useEffect(() => {
    if (!renderingImage) return;
    let cancelled = false;

    const run = async () => {
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
        const blob = await toBlob(node, {
          pixelRatio: 2,
          backgroundColor: "#ffffff",
          cacheBust: true,
          width: node.offsetWidth,
          height: node.offsetHeight,
        });
        if (cancelled || !blob) {
          if (!blob) toast.error("יצירת התמונה נכשלה.");
          return;
        }

        const fileName = `משלוח-${delivery.customerName}.png`.replace(/[\\/:*?"<>|]/g, "-");
        const file = new File([blob], fileName, { type: "image/png" });
        // Only the image — the slip already contains every detail. Including text
        // here makes WhatsApp post a separate second message.
        const shareData = {
          title: `משלוח — ${delivery.customerName}`,
          files: [file],
        };

        if (
          typeof navigator !== "undefined" &&
          "canShare" in navigator &&
          navigator.canShare(shareData)
        ) {
          await navigator.share(shareData);
          return;
        }

        // No share sheet (desktop) → download the image so it can be attached.
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = fileName;
        link.click();
        URL.revokeObjectURL(url);
        toast.success("התמונה הורדה למכשיר.");
      } catch (error: unknown) {
        if (error instanceof Error && error.name === "AbortError") return;
        toast.error(toHebrewError(error, "שיתוף התמונה נכשל."));
      } finally {
        if (!cancelled) setRenderingImage(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [renderingImage, delivery]);

  const address = formatDeliveryAddress({ address: delivery.address, city: delivery.city });

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="h-6 gap-1 px-2 text-xs"
        onClick={() => setRenderingImage(true)}
        disabled={renderingImage}
      >
        {renderingImage ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <ImageIcon className="h-3.5 w-3.5" />
        )}
        <span>שיתוף משלוח</span>
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
              alignItems: "center",
              gap: "18px",
              borderBottom: "5px solid #e2e8f0",
              paddingBottom: "18px",
              marginBottom: "22px",
            }}
          >
            <span style={{ fontSize: "80px", lineHeight: 1 }}>🚚</span>
            <span style={{ fontSize: "68px", fontWeight: 700 }}>{delivery.customerName}</span>
          </div>

          {delivery.customerPhone ? (
            <div style={slipRowStyle}>
              <span style={slipIconStyle}>
                <Phone size={58} color="#000000" fill="#000000" strokeWidth={1.5} />
              </span>
              <span dir="ltr" style={{ unicodeBidi: "embed" }}>
                {delivery.customerPhone}
              </span>
            </div>
          ) : null}

          {address ? (
            <div style={slipRowStyle}>
              <span style={slipIconStyle}>
                <WazeIcon size={62} style={{ color: "#33ccff" }} />
              </span>
              <span>{address}</span>
            </div>
          ) : null}

          <div style={slipRowStyle}>
            <span style={slipIconStyle}>💰</span>
            <span>
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
                  style={{ display: "flex", gap: "16px", marginBottom: "10px", paddingInlineStart: "76px" }}
                >
                  <span style={{ flexShrink: 0 }}>•</span>
                  <span>{formatItem(item)}</span>
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
              <span>{delivery.notes}</span>
            </div>
          ) : null}
        </div>
        </div>
      ) : null}
    </>
  );
}
