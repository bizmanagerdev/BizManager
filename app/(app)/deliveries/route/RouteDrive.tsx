"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CallIconButton } from "@/components/ui/contact-link";
import { CashIcon, CheckIcon, ChevronLeftIcon, CloseIcon, SuccessIcon, WazeIcon } from "@/components/ui/icons";
// Loaded with the drive, not on the tap: a driver may be out of signal by then.
import OrderConfirmDialog, { MARK_DELIVERED_LABEL } from "@/app/(app)/sales/orders/OrderConfirmDialog";
import { cityColour } from "@/lib/deliveries/city-colours";
import { wazeLinkForPin } from "@/lib/delivery-location";
import { finishStop, nextOpen, type Drive, type StopOutcome } from "@/lib/routes/drive";
import { cn } from "@/lib/utils";
import { clock, placeLine } from "./route-ui";

// The route, driven (owner, 2026-10-27): "I drive to the first stop, go back
// into the app, click confirm delivery. After I confirm it, it lets me continue
// to the next location, or not delivered — continue to the next location, and
// it navigates me in Waze again to the next stop. Very simple."

/** A button that sends Waze on to `href` as it does its work, or just does the work when there's nowhere to go. */
function GoButton({
  href,
  onGo,
  variant = "default",
  children,
}: {
  href: string | null;
  onGo: () => void;
  variant?: "default" | "outline";
  children: ReactNode;
}) {
  const className = "h-auto min-h-12 w-full gap-2 whitespace-normal py-2 text-base";
  if (!href) {
    return (
      <Button type="button" variant={variant} className={className} onClick={onGo}>
        {children}
      </Button>
    );
  }
  return (
    <Button asChild variant={variant} className={className}>
      <a href={href} target="_blank" rel="noopener noreferrer" onClick={onGo}>
        {children}
      </a>
    </Button>
  );
}

export default function RouteDrive({
  drive,
  update,
  onEnd,
  onNextStop,
}: {
  drive: Drive;
  /** Changes the drive from its latest state (a confirmation lands after an await). */
  update: (change: (drive: Drive) => Drive) => void;
  onEnd: () => void;
  /** Brings the next stop's card into view, from its top. */
  onNextStop: () => void;
}) {
  const [ending, setEnding] = useState(false);
  const total = drive.stops.length;
  const stop = drive.stops[drive.at] ?? null;
  const outcomes = Object.values(drive.outcome);
  const deliveredCount = outcomes.filter((outcome) => outcome !== "skipped").length;
  const skippedCount = outcomes.filter((outcome) => outcome === "skipped").length;
  const openCount = drive.stops.filter((s) => !drive.outcome[s.key]).length;

  // Where "continue" goes: the next stop with nothing done, else the route's end.
  const nextIndex = stop ? nextOpen(drive, drive.at) : total;
  const nextStop = drive.stops[nextIndex] ?? null;
  const endWords = drive.end ? `המשך ל${drive.end.label}` : "סיום המסלול";
  const goWords = nextStop ? "המשך לעצירה הבאה" : endWords;
  const goHref = nextStop ? wazeLinkForPin(nextStop) : drive.end ? wazeLinkForPin(drive.end.point) : null;
  // The next stop's card from its top when the driver is back from the road.
  const showStop = onNextStop;
  const finish = (outcome: StopOutcome) => {
    update((current) => finishStop(current, outcome));
    showStop();
  };

  const confirmedHere = stop ? stop.orderIds.filter((id) => drive.confirmed.includes(id)) : [];
  const leftHere = stop ? stop.orderIds.filter((id) => !drive.confirmed.includes(id)) : [];
  const confirmOrder = (orderId: string) =>
    update((current) => (current.confirmed.includes(orderId) ? current : { ...current, confirmed: [...current.confirmed, orderId] }));

  return (
    <div className="space-y-4">
      {stop ? (
        <Card className="space-y-4 p-4">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="font-semibold text-secondary">
              עצירה {drive.at + 1} מתוך {total}
            </span>
            {stop.arrival ? <span className="tabular-nums text-muted-foreground">מתוכנן {clock(stop.arrival)}</span> : null}
          </div>

          <div className="space-y-1">
            <h2 className="break-words text-xl font-bold leading-tight">{stop.name}</h2>
            <p className="text-sm text-muted-foreground">{placeLine(stop)}</p>
            {stop.kind === "extra" && stop.note ? <p className="text-sm">{stop.note}</p> : null}
            <div className="flex flex-wrap gap-1.5 pt-1">
              {stop.collectOnDelivery ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-warning-soft px-2 py-0.5 text-xs font-semibold text-warning-soft-foreground">
                  <CashIcon className="h-3.5 w-3.5" />
                  גבייה במסירה
                </span>
              ) : null}
              {stop.orderIds.length > 1 ? (
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{stop.orderIds.length} הזמנות</span>
              ) : null}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {stop.phone ? <CallIconButton phone={stop.phone} name={stop.name} className="h-11 w-11" /> : null}
            <Button asChild variant="outline" className="h-auto min-h-11 min-w-0 flex-1 gap-2 whitespace-normal py-2">
              <a href={wazeLinkForPin(stop)} target="_blank" rel="noopener noreferrer">
                <WazeIcon />
                ניווט לכאן ב-Waze
              </a>
            </Button>
          </div>

          <div className="space-y-2 border-t border-border/60 pt-4">
            {stop.kind === "extra" ? (
              <GoButton href={goHref} onGo={() => finish("done")}>
                <CheckIcon />
                <span>
                  סיימתי כאן — <span className="whitespace-nowrap">{goWords}</span>
                </span>
              </GoButton>
            ) : (
              <>
                {confirmedHere.length > 0 ? (
                  <p className="flex items-center gap-1.5 font-semibold text-success">
                    <SuccessIcon className="h-5 w-5 shrink-0" />
                    {stop.orderIds.length > 1 && leftHere.length > 0
                      ? `אושרה אספקה של ${confirmedHere.length} מתוך ${stop.orderIds.length} הזמנות`
                      : "האספקה אושרה"}
                  </p>
                ) : null}
                {leftHere.map((orderId) => (
                  <OrderConfirmDialog
                    key={orderId}
                    orderId={orderId}
                    customerName={stop.name}
                    buttonClassName="h-12 w-full gap-2 text-base"
                    buttonLabel={
                      <>
                        <CheckIcon />
                        {MARK_DELIVERED_LABEL}
                        {stop.orderIds.length > 1 ? ` · הזמנה ${stop.orderIds.indexOf(orderId) + 1}` : ""}
                      </>
                    }
                    onConfirmed={() => confirmOrder(orderId)}
                  />
                ))}
                {confirmedHere.length > 0 ? (
                  <GoButton href={goHref} onGo={() => finish("delivered")} variant={leftHere.length > 0 ? "outline" : "default"}>
                    {goWords}
                    {goHref ? <WazeIcon /> : <ChevronLeftIcon />}
                  </GoButton>
                ) : (
                  <GoButton href={goHref} onGo={() => finish("skipped")} variant="outline">
                    <span>
                      לא נמסר — <span className="whitespace-nowrap">{goWords}</span>
                    </span>
                  </GoButton>
                )}
              </>
            )}
            {nextStop ? (
              <p className="text-center text-xs text-muted-foreground">
                הבאה: {nextIndex + 1} · {nextStop.name}, {nextStop.city} · <span className="whitespace-nowrap">נפתחת ב-Waze</span>
              </p>
            ) : null}
          </div>
        </Card>
      ) : (
        <Card className="space-y-4 p-5 text-center">
          <SuccessIcon className="mx-auto h-10 w-10 text-success" />
          <div className="space-y-1">
            <h2 className="text-xl font-bold">עברתם את כל העצירות</h2>
            <p className="text-sm text-muted-foreground">
              {deliveredCount} נמסרו{skippedCount > 0 ? ` · ${skippedCount} לא נמסרו — לחצו על עצירה למטה כדי לחזור אליה` : ""}
            </p>
          </div>
          {drive.end ? (
            <Button asChild variant="outline" className="h-auto min-h-11 w-full gap-2 whitespace-normal py-2">
              <a href={wazeLinkForPin(drive.end.point)} target="_blank" rel="noopener noreferrer">
                <WazeIcon />
                <span>
                  ניווט ל{drive.end.label} <span className="whitespace-nowrap">ב-Waze</span>
                </span>
              </a>
            </Button>
          ) : null}
          <Button type="button" className="w-full" onClick={onEnd}>
            סיום הנסיעה
          </Button>
        </Card>
      )}

      <Card className="p-2 sm:p-3">
        <p className="px-2 pb-1 pt-1 text-sm font-semibold">
          כל העצירות · {deliveredCount + skippedCount} מתוך {total}
        </p>
        <ol>
          {drive.stops.map((s, index) => {
            const outcome = drive.outcome[s.key];
            const current = index === drive.at;
            // A stop not delivered yet, or passed by, can be gone back to.
            const canGo = !current && outcome !== "delivered" && outcome !== "done";
            return (
              <li key={s.key}>
                <button
                  type="button"
                  disabled={!canGo}
                  onClick={() => {
                    update((d) => ({ ...d, at: index }));
                    showStop();
                  }}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-xl p-2 text-right",
                    current && "bg-secondary/10",
                    canGo && "hover:bg-muted/50"
                  )}
                >
                  <span
                    className={cn(
                      "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                      outcome === "delivered" || outcome === "done"
                        ? "bg-success text-success-foreground"
                        : outcome === "skipped"
                          ? "bg-muted text-muted-foreground"
                          : "border-2 border-white text-primary shadow"
                    )}
                    style={outcome ? undefined : { backgroundColor: cityColour(s.city) }}
                  >
                    {outcome === "delivered" || outcome === "done" ? (
                      <CheckIcon className="h-4 w-4" />
                    ) : outcome === "skipped" ? (
                      <CloseIcon className="h-4 w-4" />
                    ) : (
                      index + 1
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={cn("block break-words text-sm font-semibold", outcome && "text-muted-foreground")}>{s.name}</span>
                    <span className="block text-xs text-muted-foreground">{s.city}</span>
                  </span>
                  <span className={cn("shrink-0 text-xs", current ? "font-semibold text-secondary" : "text-muted-foreground")}>
                    {current
                      ? "עכשיו"
                      : outcome === "delivered"
                        ? "נמסר"
                        : outcome === "done"
                          ? "בוצע"
                          : outcome === "skipped"
                            ? "לא נמסר"
                            : s.arrival
                              ? clock(s.arrival)
                              : ""}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </Card>

      {stop ? (
        <Button type="button" variant="muted" className="w-full" onClick={() => (openCount > 0 ? setEnding(true) : onEnd())}>
          סיום הנסיעה
        </Button>
      ) : null}

      <ConfirmDialog
        open={ending}
        onOpenChange={setEnding}
        title="לסיים את הנסיעה?"
        description={`${openCount === 1 ? "עצירה אחת עוד לא סומנה" : `${openCount} עצירות עוד לא סומנו`}. אספקות שאושרו כבר שמורות.`}
        confirmLabel="סיום הנסיעה"
        cancelLabel="להמשיך לנסוע"
        onConfirm={() => {
          setEnding(false);
          onEnd();
        }}
      />
    </div>
  );
}
