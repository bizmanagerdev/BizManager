import { parseProjectsFilters } from "@/app/(app)/projects/projectsFilters";
import { localDataPageOn } from "./config";
import type { LocalCardKind, LocalCardViewer } from "./dashboard-local";
import type { ResultSpec } from "./local-results";

/**
 * The usual view of each page this person gets from the device — what
 * opening it from the menu shows — to keep ready in the background
 * (warmResults), so even the first visit has nothing to wait for. The landing
 * page first. The filters are the ones each page passes for its plain URL.
 */
export function usualPageViews(viewer: LocalCardViewer): ResultSpec[] {
  const person = { id: viewer.userId, role: viewer.role };
  const views: ResultSpec[] = [];
  const add = (kind: LocalCardKind, filters?: unknown) => views.push({ kind, viewer, filters });

  if (localDataPageOn("dashboard", person)) {
    add("todaySchedule");
    add("todayAlerts");
    add("myTasks");
    if (viewer.locale !== "ar") add("deliveries");
    add("attendanceQueue");
    add("properties");
  }
  if (localDataPageOn("tasks", person)) {
    add("tasksBoard", { q: "", priority: "", domain: "", linkedId: "", scope: "mine" });
  }
  if (localDataPageOn("projects", person)) {
    add("projectsList", { ...parseProjectsFilters(() => null), q: "" });
    add("projectsExtras", { customerId: null });
  }
  if (localDataPageOn("sales", person)) {
    add("salesOrders", { tab: "orders", customerId: null, q: "", paymentStatus: "", invoice: "" });
    add("salesCounts", { customerId: null, paymentStatus: "" });
  }
  return views;
}
