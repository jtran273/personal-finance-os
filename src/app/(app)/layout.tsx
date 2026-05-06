import { AppShell } from "@/components/shell/app-shell";
import { type ReactNode } from "react";

export default function AuthenticatedAppLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
