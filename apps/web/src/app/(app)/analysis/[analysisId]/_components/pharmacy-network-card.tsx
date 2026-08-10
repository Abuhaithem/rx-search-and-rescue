import { NetworkStatusChip } from "@/components/domain/network-status-chip";
import { Table, TBody, TCell, TH, THead, TRow } from "@/components/ui/table";
import type {
  ComparisonPlanColumn,
  PharmacyNetworkRow,
} from "@/server/queries/comparison";

interface PharmacyNetworkCardProps {
  pharmacies: PharmacyNetworkRow[];
  plans: ComparisonPlanColumn[];
}

/**
 * The pharmacy × plan network grid: same column order as the summary strip
 * and cost matrix, coverage-meaning chips only. Answers "can the client keep
 * their pharmacy on this plan?" at a glance.
 */
export function PharmacyNetworkCard({ pharmacies, plans }: PharmacyNetworkCardProps) {
  if (pharmacies.length === 0) return null;

  return (
    <div className="rounded-card border border-mist/60 bg-white shadow-card">
      <div className="space-y-0.5 border-b border-mist/55 px-4 py-3">
        <h2 className="font-display text-lg text-deepwater">Pharmacy network by plan</h2>
        <p className="text-xs text-steel">
          Whether the client keeps their pharmacy on each plan — and at which copay level.
        </p>
      </div>
      <Table>
        <THead>
          <tr>
            <TH>Pharmacy</TH>
            {plans.map((planColumn) => (
              <TH key={planColumn.plan.id} className="text-center">
                {planColumn.plan.name}
                {planColumn.isCurrent ? " (current)" : ""}
              </TH>
            ))}
          </tr>
        </THead>
        <TBody>
          {pharmacies.map((pharmacy) => (
            <TRow key={pharmacy.pharmacyId} className="hover:bg-transparent">
              <TCell>
                <div className="text-sm font-medium text-deepwater">{pharmacy.pharmacyName}</div>
                {pharmacy.city ? (
                  <div className="text-xs text-steel">{pharmacy.city}</div>
                ) : null}
              </TCell>
              {plans.map((planColumn) => (
                <TCell key={planColumn.plan.id} className="text-center">
                  <NetworkStatusChip
                    status={pharmacy.statusByPlan[planColumn.plan.id] ?? null}
                  />
                </TCell>
              ))}
            </TRow>
          ))}
        </TBody>
      </Table>
      <p className="border-t border-mist/55 px-4 py-2.5 text-xs text-steel">
        <span className="font-semibold text-covered">Preferred</span> = lowest copays ·{" "}
        <span className="font-semibold text-restricted">Standard</span> = in network, higher copays ·{" "}
        <span className="font-semibold text-steel">Assumed standard</span> = no record on file for
        this pharmacy — verify against the plan&apos;s directory before presenting.
      </p>
    </div>
  );
}
