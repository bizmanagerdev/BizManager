"use client";

import dynamic from "next/dynamic";
import RoutePlannerSkeleton from "./RoutePlannerSkeleton";

// The planner is drawn in the browser only: it works from Google, so it needs
// a connection anyway, and the start and end kept on this device are read
// before its first paint instead of swapping in after it.
const RoutePlanner = dynamic(() => import("./RoutePlanner"), {
  ssr: false,
  loading: () => <RoutePlannerSkeleton />,
});

export default RoutePlanner;
