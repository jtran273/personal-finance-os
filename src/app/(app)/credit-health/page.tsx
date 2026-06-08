import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function CreditHealthPage() {
  redirect("/dashboard#card-actions");
}
