"use client";

import { ErrorState } from "@/components/states/app-states";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorState message={error.message} onReset={reset} />;
}
