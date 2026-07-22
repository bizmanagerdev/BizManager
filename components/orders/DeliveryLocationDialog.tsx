"use client";

// "How do I actually get to the door?" — edit the standing arrival directions
// and the saved drop-off pin for a customer.
//
// Saves to the CUSTOMER, not the order, which is the whole point: the driver who
// works out that it's around the corner behind the blue gate leaves that behind
// for whoever delivers next.
//
// Two ways to set the pin, because the two people who set it are in different
// situations. The driver is standing there and taps once (GPS — the most precise
// source there is). The office is at a desk and pastes a Waze/Maps link.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { MapPin, Navigation } from "lucide-react";
import { AdaptiveDialog } from "@/components/layout/page-layout";
import { Dialog, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toHebrewError } from "@/lib/error-messages";
import {
  formatPin,
  isShortenedMapLink,
  parseMapLink,
  wazeLinkForPin,
  type DeliveryPin,
} from "@/lib/delivery-location";

export function DeliveryLocationDialog({
  open,
  onOpenChange,
  customerId,
  customerName,
  initialInstructions,
  initialPin,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerId: string;
  customerName: string;
  initialInstructions: string | null;
  initialPin: DeliveryPin | null;
  onSaved?: (next: { instructions: string | null; pin: DeliveryPin | null }) => void;
}) {
  const [instructions, setInstructions] = useState(initialInstructions ?? "");
  const [pin, setPin] = useState<DeliveryPin | null>(initialPin);
  const [linkInput, setLinkInput] = useState("");
  const [locating, setLocating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed each time it opens — the customer's saved values may have changed
  // since this row was rendered.
  useEffect(() => {
    if (!open) return;
    setInstructions(initialInstructions ?? "");
    setPin(initialPin);
    setLinkInput("");
    setError(null);
  }, [open, initialInstructions, initialPin]);

  function captureCurrentLocation() {
    if (!navigator.geolocation) {
      setError("המכשיר הזה לא תומך באיתור מיקום.");
      return;
    }
    setLocating(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setPin({ lat: position.coords.latitude, lng: position.coords.longitude });
        setLocating(false);
        toast.success("המיקום נקלט. שמרו כדי לשייך אותו ללקוח.");
      },
      (geoError) => {
        setLocating(false);
        // Spell out the permission case — "failed" sends people hunting for a bug
        // when the browser is simply waiting to be allowed.
        setError(
          geoError.code === geoError.PERMISSION_DENIED
            ? "הגישה למיקום נחסמה. אפשרו מיקום לאתר בהגדרות הדפדפן."
            : "לא הצלחנו לקבוע את המיקום. נסו שוב או הדביקו קישור."
        );
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }

  function applyLink() {
    const parsed = parseMapLink(linkInput);
    if (parsed) {
      setPin(parsed);
      setLinkInput("");
      setError(null);
      return;
    }
    setError(
      isShortenedMapLink(linkInput)
        ? "קישור מקוצר לא מכיל את הקואורדינטות. פתחו אותו במפה והעתיקו את הקישור המלא."
        : "לא זוהה מיקום בקישור. הדביקו קישור מוויז או מגוגל מפות."
    );
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/customers/delivery-location", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          customer_id: customerId,
          instructions: instructions.trim() || null,
          lat: pin?.lat ?? null,
          lng: pin?.lng ?? null,
        }),
      });
      const json = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(toHebrewError(json.error, "שמירת המיקום נכשלה."));
        return;
      }
      onSaved?.({ instructions: instructions.trim() || null, pin });
      onOpenChange(false);
      toast.success("פרטי ההגעה נשמרו ללקוח.");
    } catch (err: unknown) {
      setError(toHebrewError(err, "שמירת המיקום נכשלה."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && saving) return;
        onOpenChange(next);
      }}
    >
      <AdaptiveDialog
        size="formMd"
        aria-describedby={undefined}
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <DialogHeader className="mb-4 text-right">
          <DialogTitle>{customerName}</DialogTitle>
        </DialogHeader>

        <fieldset disabled={saving} className="contents">
          <div className="space-y-4 text-right">
            <label className="block space-y-2 text-sm">
              <span className="font-medium">הוראות הגעה</span>
              <Textarea
                value={instructions}
                onChange={(event) => setInstructions(event.target.value)}
                rows={3}
                className="min-h-[72px]"
              />
            </label>

            {/* Same shape as the section above — a label and its controls, no box
                and no explanatory prose. The empty state used to spell out what
                happens without a pin; not having one is the normal case, so it
                needed no sentence at all. */}
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">נקודת הורדה מדויקת</span>
                {pin ? (
                  <a
                    href={wazeLinkForPin(pin)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-secondary hover:underline"
                  >
                    <Navigation className="h-3.5 w-3.5" />
                    בדקו בוויז
                  </a>
                ) : null}
              </div>

              {pin ? (
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-muted-foreground">נשמר: {formatPin(pin)}</span>
                  <button
                    type="button"
                    className="text-destructive hover:underline"
                    onClick={() => setPin(null)}
                  >
                    מחיקה
                  </button>
                </div>
              ) : null}

              {/* Button's base class is whitespace-nowrap, so a long Hebrew label
                  overflowed a full-width button instead of wrapping. */}
              <Button
                type="button"
                variant="secondary"
                className="h-auto w-full whitespace-normal gap-2 py-2.5"
                onClick={captureCurrentLocation}
                disabled={locating}
              >
                <MapPin className="h-4 w-4" />
                {locating ? "מאתר..." : "אני עומד כאן — שמור מיקום"}
              </Button>

              <div className="flex items-center gap-2">
                <Input
                  value={linkInput}
                  onChange={(event) => setLinkInput(event.target.value)}
                  className="min-w-0 flex-1"
                  aria-label="קישור מוויז או מגוגל מפות"
                />
                <Button
                  type="button"
                  variant="outline"
                  className="shrink-0"
                  onClick={applyLink}
                  disabled={!linkInput.trim()}
                >
                  קליטה
                </Button>
              </div>
            </div>

            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>
        </fieldset>

        {/* One row even on a phone: DialogFooter stacks below `sm` by default, which
            these two short labels don't need. */}
        <DialogFooter className="mt-4 flex-row justify-end">
          {/* Primary text and border, nothing inside — `secondary` gave it the same
              sky blue fill as the save button, so the two read as equal choices. */}
          <Button
            type="button"
            variant="outline"
            className="border-primary/40 bg-transparent text-primary shadow-none hover:border-primary/60 hover:bg-primary/5 hover:text-primary"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            ביטול
          </Button>
          {/* Navy fill, not the default sky blue — this is the dialog's one
              committing action and should sit a step above everything else. */}
          <Button
            type="button"
            className="bg-primary text-primary-foreground shadow-md shadow-primary/20 hover:bg-primary/90"
            onClick={() => void save()}
            disabled={saving}
          >
            {saving ? "שומר..." : "שמירה"}
          </Button>
        </DialogFooter>
      </AdaptiveDialog>
    </Dialog>
  );
}

export default DeliveryLocationDialog;
