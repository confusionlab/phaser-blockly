import { Component, type ErrorInfo, type ReactNode } from 'react';
import { PricingTable } from '@clerk/clerk-react';
import { useQuery } from 'convex/react';
import { Link } from 'react-router-dom';
import { api } from '@convex-generated/api';
import { Button } from '@/components/ui/button';

function formatPeriodEnd(periodEndsAt?: number): string {
  if (!periodEndsAt) {
    return 'Monthly reset';
  }
  return new Date(periodEndsAt).toLocaleString();
}

function parseConfiguredPlanIds(rawValue: string | undefined): string[] {
  if (!rawValue) {
    return [];
  }
  return rawValue
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

function isBillingDisabledError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return message.includes('cannot_render_billing_disabled')
    || message.includes('component cannot be rendered when billing is disabled');
}

class PricingTableErrorBoundary extends Component<{ children: ReactNode }, { error: unknown | null }> {
  state: { error: unknown | null } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  componentDidCatch(_error: unknown, _errorInfo: ErrorInfo) {}

  render() {
    if (this.state.error) {
      const billingDisabled = isBillingDisabledError(this.state.error);
      return (
        <div className="rounded-md border bg-background p-4 text-sm">
          <div className="font-medium">
            {billingDisabled ? 'Clerk billing is not enabled for this instance yet.' : 'Unable to load pricing table.'}
          </div>
          <p className="mt-2 text-muted-foreground">
            {billingDisabled
              ? 'Enable billing in Clerk Dashboard to use the hosted PricingTable component.'
              : 'Try refreshing the page. If the issue persists, check Clerk billing configuration.'}
          </p>
        </div>
      );
    }

    return this.props.children;
  }
}

export function BillingPage() {
  const walletSummary = useQuery(api.billing.getWalletSummary);
  const configuredPlanIds = parseConfiguredPlanIds(import.meta.env.VITE_CLERK_BILLING_PLAN_IDS);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-8">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Billing & Credits</h1>
          <p className="text-sm text-muted-foreground">
            Managed assistant usage is charged from account credits.
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link to="/">Back to editor</Link>
        </Button>
      </div>

      <div className="rounded-lg border bg-card p-4">
        {walletSummary === undefined ? (
          <p className="text-sm text-muted-foreground">Loading wallet...</p>
        ) : (
          <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <div className="text-muted-foreground">Current plan</div>
              <div className="font-medium capitalize">{walletSummary.planSlug}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Subscription status</div>
              <div className="font-medium">{walletSummary.subscriptionStatus}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Remaining credits</div>
              <div className="font-medium">{walletSummary.balanceCredits}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Period end</div>
              <div className="font-medium">{formatPeriodEnd(walletSummary.periodEndsAt)}</div>
            </div>
          </div>
        )}
      </div>

      {configuredPlanIds.length > 0 ? (
        <div className="text-xs text-muted-foreground">
          Configured plan IDs: {configuredPlanIds.join(', ')}
        </div>
      ) : (
        <div className="text-xs text-amber-700">
          No `VITE_CLERK_BILLING_PLAN_IDS` configured yet. Update env with Clerk dashboard plan IDs.
        </div>
      )}

      <div className="rounded-lg border bg-card p-4">
        <h2 className="mb-3 text-lg font-semibold">Plans</h2>
        <PricingTableErrorBoundary>
          <PricingTable />
        </PricingTableErrorBoundary>
      </div>
    </div>
  );
}
