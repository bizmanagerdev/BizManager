"use client";

import type { ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type Props = {
  title: string;
  description: string;
  children: ReactNode;
  footer?: ReactNode;
};

export function AuthScreen({ title, description, children, footer }: Props) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute right-[8%] top-16 h-48 w-48 rounded-full bg-destructive/18 blur-3xl" />
        <div className="absolute bottom-12 left-[10%] h-56 w-56 rounded-full bg-primary/18 blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/25">
            <span className="text-lg font-black">H</span>
          </div>
          <div className="text-right">
            <p className="rounded-full border border-border/80 bg-white/85 px-3 py-1 text-xs font-bold uppercase tracking-[0.28em] text-primary shadow-sm">
              BIZH
            </p>
          </div>
        </div>

        <Card className="brand-frame surface-panel border-white/60 shadow-elevated">
          <CardHeader className="space-y-2">
            <CardTitle className="text-3xl">{title}</CardTitle>
            <CardDescription className="text-sm leading-6">{description}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">{children}</CardContent>
        </Card>

        {footer ? (
          <div className="mt-4 text-center text-sm text-muted-foreground">{footer}</div>
        ) : null}
      </div>
    </div>
  );
}
