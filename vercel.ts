import type { VercelConfig } from "@vercel/config/v1";

export const config: VercelConfig = {
  crons: [
    { path: "/api/cron/gmail-sync", schedule: "0 8 * * *" },
    { path: "/api/cron/scrape-bids", schedule: "0 2 * * *" },
    { path: "/api/cron/token-health", schedule: "0 9 * * *" },
  ],
  functions: {
    "app/api/cron/scrape-bids/route.ts": { maxDuration: 300 },
    "app/api/admin/scrape-bids/route.ts": { maxDuration: 300 },
  },
};

export default config;
