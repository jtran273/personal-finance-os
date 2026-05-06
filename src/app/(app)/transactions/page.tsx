import {
  normalizeTransactionFilters,
  parseTransactionFilters,
  toTransactionListFilters,
  type TransactionSearchParams
} from "@/components/finance/transactions/filters";
import { TransactionsView } from "@/components/finance/transactions/transactions-view";
import {
  listAccounts,
  listCategories,
  listTransactions,
  type AccountRecord,
  type CategoryRecord,
  type FinanceSupabaseClient,
  type TransactionRecord
} from "@/lib/db";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface TransactionsPageProps {
  searchParams?: Promise<TransactionSearchParams>;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unable to load persisted transactions.";
}

export default async function TransactionsPage({ searchParams }: TransactionsPageProps) {
  const params = searchParams ? await searchParams : {};
  let filters = parseTransactionFilters(params);
  let accounts: AccountRecord[] = [];
  let categories: CategoryRecord[] = [];
  let transactions: TransactionRecord[] = [];
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
        [accounts, categories] = await Promise.all([
          listAccounts(financeClient, user.id),
          listCategories(financeClient, user.id)
        ]);
        filters = normalizeTransactionFilters(filters, accounts, categories);
        transactions = await listTransactions(financeClient, user.id, toTransactionListFilters(filters));
      } catch (loadError) {
        dataError = errorMessage(loadError);
      }
    }
  }

  return (
    <TransactionsView
      accounts={accounts}
      categories={categories}
      dataError={dataError}
      filters={filters}
      isConfigured={isConfigured}
      isSignedIn={isSignedIn}
      transactions={transactions}
    />
  );
}
