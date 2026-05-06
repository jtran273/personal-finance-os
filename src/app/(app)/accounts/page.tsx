import { AccountsView } from "@/components/finance/accounts/accounts-view";
import {
  listAccounts,
  listBalanceSnapshots,
  type AccountRecord,
  type BalanceSnapshotRecord,
  type FinanceSupabaseClient
} from "@/lib/db";
import { calculateAccountTotals, groupAccounts, summarizeSync } from "@/lib/finance/balances";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unable to load persisted accounts.";
}

export default async function AccountsPage() {
  let accounts: AccountRecord[] = [];
  let snapshots: BalanceSnapshotRecord[] = [];
  let dataError: string | undefined;
  let isConfigured = false;
  let isSignedIn = false;

  const supabase = await createSupabaseServerClient();
  isConfigured = Boolean(supabase);

  if (supabase) {
    const {
      data: { user },
      error
    } = await supabase.auth.getUser();

    if (error) {
      dataError = `Unable to verify Supabase session: ${error.message}`;
    }

    if (user) {
      isSignedIn = true;
      const financeClient = supabase as unknown as FinanceSupabaseClient;

      try {
        accounts = await listAccounts(financeClient, user.id);
        const accountIds = accounts.map((account) => account.id);
        snapshots = accountIds.length > 0
          ? await listBalanceSnapshots(financeClient, user.id, { accountIds, limit: 500 })
          : [];
      } catch (loadError) {
        dataError = errorMessage(loadError);
      }
    }
  }

  return (
    <AccountsView
      accounts={accounts}
      dataError={dataError}
      groups={groupAccounts(accounts)}
      isConfigured={isConfigured}
      isSignedIn={isSignedIn}
      snapshots={snapshots}
      syncSummary={summarizeSync(accounts)}
      totals={calculateAccountTotals(accounts)}
    />
  );
}
