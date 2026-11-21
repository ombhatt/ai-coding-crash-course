// Analytics vocabulary shared by the analytics service and the page. Lives
// here, not in the service, because the page uses these values in the browser
// and importing a value from the service would pull the database into the
// client bundle.

export const ANALYTICS_RANGES = ["7d", "30d", "90d", "all"] as const;
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];
