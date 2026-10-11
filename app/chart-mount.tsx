"use client";

import dynamic from "next/dynamic";

const ChartApp = dynamic(() => import("../src/main"), {
  ssr: false,
  loading: () => (
    <main className="app-loading" role="status" aria-live="polite">
      Loading the chart workspace…
    </main>
  ),
});

export default function ChartMount() {
  return <ChartApp />;
}
