import { SettingsView } from "@/components/finance/settings/settings-view";
import { getFinanceServerContext } from "@/lib/demo/server";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  let dataError: string | undefined;
  let isConfigured = false;
  let isSignedIn = false;

  const context = await getFinanceServerContext();
  isConfigured = context.isConfigured;
  isSignedIn = context.isSignedIn;
  dataError = context.dataError;

  return (
    <SettingsView
      dataError={dataError}
      isConfigured={isConfigured}
      isSignedIn={isSignedIn}
    />
  );
}
