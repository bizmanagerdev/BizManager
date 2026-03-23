export const ORDERS_GLOBAL_PROJECT_ID = "b1eac4a0-9ba5-4444-8778-ea605d09e7d7";

export function getDerivedPaymentProjectId(params: {
  targetType?: string | null;
  targetId?: string | null;
}) {
  const { targetType, targetId } = params;

  if (targetType === "project" && targetId) {
    return targetId;
  }

  if (targetType === "order") {
    return ORDERS_GLOBAL_PROJECT_ID;
  }

  return null;
}
