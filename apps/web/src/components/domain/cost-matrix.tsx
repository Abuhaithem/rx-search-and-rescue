import type { ComparisonData } from "@/server/queries/comparison";
import { formatUsd } from "@/components/domain/format";
import { Card } from "@/components/ui/card";
import { Table, TBody, TCell, TH, THead, TRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

/**
 * The comparison centerpiece: estimated monthly cost at each of the client's
 * pharmacies, per plan. Pharmacies are rows, plans are columns; the cheapest
 * plan for each pharmacy is highlighted (Fog surface — never the rescue
 * accent, which is reserved for the completing action). Coverage colors are
 * not used here: cost is not coverage.
 */
export function CostMatrix({
  rows,
  plans,
  controls,
}: {
  rows: ComparisonData["costMatrix"];
  plans: ComparisonData["plans"];
  controls?: React.ReactNode;
}) {
  if (rows.length === 0) return null;

  const anyAssumed = rows.some((r) => r.cells.some((c) => c.assumed));
  const anyCoinsurance = rows.some((r) => r.cells.some((c) => c.hasCoinsurance));

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-mist/60 px-4 py-3">
        <div>
          <h2 className="font-display text-lg text-deepwater">Estimated monthly cost by pharmacy</h2>
          <p className="text-xs text-steel">
            What the client pays at each pharmacy on each plan. Highlighted = the cheapest plan for
            that pharmacy.
          </p>
        </div>
        {controls}
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
          {rows.map((row) => (
            <TRow key={row.key} className="hover:bg-transparent">
              <TCell>
                <div className="font-semibold text-deepwater">{row.label}</div>
                {row.kind === "mail" ? (
                  <div className="text-xs text-steel">Plan mail benefit</div>
                ) : null}
              </TCell>
              {row.cells.map((cell) => (
                <TCell
                  key={cell.planId}
                  className={cn("text-center align-middle", cell.cheapest && "bg-fog")}
                >
                  {cell.unavailable ? (
                    <span className="text-sm italic text-steel">Out of network</span>
                  ) : (
                    <div className="inline-flex flex-col items-center gap-0.5">
                      <span
                        className={cn(
                          "text-data text-sm",
                          cell.cheapest ? "font-bold text-deepwater" : "text-ink",
                        )}
                      >
                        {cell.estMonthlyCents === null
                          ? cell.hasCoinsurance
                            ? "See coinsurance"
                            : "—"
                          : `${formatUsd(cell.estMonthlyCents)}/mo`}
                        {cell.estMonthlyCents !== null && cell.isPartial ? "*" : ""}
                      </span>
                      <span className="text-[11px] text-steel">
                        {cell.channelLabel}
                        {cell.cheapest ? " · Best" : ""}
                        {cell.assumed ? (
                          <span className="text-restricted"> · assumed</span>
                        ) : null}
                      </span>
                    </div>
                  )}
                </TCell>
              ))}
            </TRow>
          ))}
        </TBody>
      </Table>

      <div className="space-y-1 border-t border-mist/60 px-4 py-3 text-xs text-steel">
        {anyAssumed ? (
          <p>
            <span className="font-semibold text-restricted">Assumed</span> — the pharmacy&rsquo;s
            network status on that plan isn&rsquo;t on file yet; it defaults to standard retail.
            Confirm before delivering.
          </p>
        ) : null}
        {anyCoinsurance ? (
          <p>
            &ldquo;See coinsurance&rdquo; plans charge a percentage — the dollar total depends on the
            drug&rsquo;s price.
          </p>
        ) : null}
        <p>* Estimate excludes drugs with no listed copay at that pharmacy.</p>
      </div>
    </Card>
  );
}
