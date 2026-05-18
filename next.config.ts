import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfjs-dist (used by pdf-parse) ships its own workers and resolves them
  // via relative paths at runtime. Letting Turbopack bundle it mangles those
  // paths so the fake-worker setup can't find pdf.worker.mjs. Externalizing
  // it on the server side keeps Node's require resolution intact.
  serverExternalPackages: ["pdf-parse", "pdfjs-dist"],
};

export default nextConfig;
