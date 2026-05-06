"use client";

import { BASE_DATE, ledgerData } from "@/components/ledger/data";
import { LedgerProvider, ledgerRouteHref, type LedgerRoute, useLedger } from "@/components/ledger/ledger-app";
import {
  Home,
  Inbox,
  Landmark,
  List,
  Repeat,
  Search,
  Settings,
  Sparkles,
  type LucideIcon
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode } from "react";

type RouteMeta = {
  eyebrow: string;
  icon: LucideIcon;
  label: string;
  title: string;
};

const routeMeta: Record<LedgerRoute, RouteMeta> = {
  dashboard: {
    eyebrow: BASE_DATE.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }),
    icon: Home,
    label: "Dashboard",
    title: "Dashboard"
  },
  transactions: {
    eyebrow: "All accounts",
    icon: List,
    label: "Transactions",
    title: "Transactions"
  },
  review: {
    eyebrow: "Items needing your attention",
    icon: Inbox,
    label: "Review",
    title: "Review queue"
  },
  recurring: {
    eyebrow: "Subscriptions and fixed costs",
    icon: Repeat,
    label: "Recurring",
    title: "Recurring"
  },
  accounts: {
    eyebrow: "Connected institutions",
    icon: Landmark,
    label: "Accounts",
    title: "Accounts"
  },
  settings: {
    eyebrow: "Workspace and access",
    icon: Settings,
    label: "Settings",
    title: "Settings"
  }
};

const navigation: LedgerRoute[] = ["dashboard", "transactions", "review", "recurring", "accounts", "settings"];

function currentRoute(pathname: string): LedgerRoute {
  const match = navigation.find((route) => pathname === ledgerRouteHref[route] || pathname.startsWith(`${ledgerRouteHref[route]}/`));
  return match ?? "dashboard";
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <LedgerProvider>
      <AppFrame>{children}</AppFrame>
    </LedgerProvider>
  );
}

function AppFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const route = currentRoute(pathname);
  const { reviewItems } = useLedger();

  return (
    <div className="ledger-app">
      <aside className="sidebar">
        <Link className="brand" href={ledgerRouteHref.dashboard} aria-label="Ledger dashboard">
          <div className="brand-mark">L</div>
          <div className="brand-name">Ledger</div>
          <div className="brand-sub">Personal</div>
        </Link>

        <nav className="nav" aria-label="Main navigation">
          {navigation.map((item) => {
            const Icon = routeMeta[item].icon;
            const active = route === item;
            return (
              <Link
                key={item}
                aria-current={active ? "page" : undefined}
                className={`nav-item ${active ? "active" : ""}`}
                href={ledgerRouteHref[item]}
              >
                <Icon size={16} aria-hidden />
                <span>{routeMeta[item].label}</span>
                {item === "review" && reviewItems.length > 0 ? <span className="nav-badge">{reviewItems.length}</span> : null}
              </Link>
            );
          })}
        </nav>

        <div className="sidebar-foot">
          <div className="ai-card">
            <div className="ai-card-head">
              <Sparkles size={14} aria-hidden />
              <span>AI suggestions</span>
            </div>
            <div className="ai-card-body">{reviewItems.length} transactions have suggested labels awaiting review.</div>
            <Link className="ai-card-link" href={ledgerRouteHref.review}>Open review queue</Link>
          </div>
          <Link className="user-row" href={ledgerRouteHref.settings}>
            <div className="avatar">J</div>
            <div className="user-meta">
              <div className="user-name">James</div>
              <div className="user-sub">{ledgerData.accounts.length} accounts - synced 2m ago</div>
            </div>
            <Settings size={15} aria-hidden />
          </Link>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <div className="topbar-eyebrow">{routeMeta[route].eyebrow}</div>
            <h1 className="topbar-title">{routeMeta[route].title}</h1>
          </div>
          <div className="topbar-actions">
            <label className="search" aria-label="Search">
              <Search size={14} aria-hidden />
              <input placeholder="Search transactions, merchants, categories..." />
              <kbd>Cmd K</kbd>
            </label>
          </div>
        </header>
        <div className="page">{children}</div>
      </main>
    </div>
  );
}
