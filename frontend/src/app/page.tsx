"use client";

import { useEffect, useState } from "react";

type Status = "checking" | "connected" | "unavailable";

export default function Home() {
  const [status, setStatus] = useState<Status>("checking");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/health/", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Backend unavailable");
        const data = await response.json();
        setStatus(data.status === "ok" ? "connected" : "unavailable");
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus("unavailable");
      });
    return () => controller.abort();
  }, []);

  return (
    <main>
      <p className="eyebrow">MCP CANADA</p>
      <h1>Ready to build.</h1>
      <p>Next.js + React on the frontend. Django + Python on the backend.</p>
      <section aria-live="polite">
        <h2>Backend connection</h2>
        <p>{status === "checking" ? "Checking…" : status === "connected" ? "Connected to Django." : "Backend unavailable. Start Django on port 8000, then refresh."}</p>
        <code>GET /api/health/</code>
      </section>
      <p className="note">No database configured.</p>
    </main>
  );
}
