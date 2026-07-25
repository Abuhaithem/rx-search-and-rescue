# Server Action & Data Contracts

Frontend imports ONLY these actions/queries (backend agent implements them;
screen agents code against the signatures). All actions return
`ActionResult<T> = { ok: true; data: T } | { ok: false; error: string }`.
Files under `apps/web/src/server/`.

## queries/ (server-component reads)

- `getWorkQueue(filters?: { status?: AnalysisStatus; planYear?: number; search?: string })`
  → rows: { analysisId, clientName, agentName, planYear, plansCompared, status, updatedAt }
- `getIntake(clientId)` → client + medications + pharmacies(+match) + policies + sourcePdfUrl
- `getAvailablePlans(clientId, planYear)` → plan cards: { plan, carrierName, premiumCents,
  rxDeductibleCents, formularyStatus: "active"|"missing"|"stale", pharmacyStatus: NetworkStatus|null,
  tierCostsComplete: boolean, isCurrent: boolean }
- `getComparison(analysisId, channelOverride?)` → { client, plans: PlanSummary+meta,
  grid: CellResult+medication rows, pricingPharmacy, channel } (runs engine over DB rows)
- `getReportModel(analysisId)` → ReportModel (generated + overrides applied)
- `getFormularies(planYear)` → admin list + stats
- `getFormularyReviewRows(formularyId)` → needs-review entries (page, readings)
- `getPlanCatalog(planYear)` → plans + tier-cost completeness
- `getProfile()` → { id, fullName, role }

## actions/ (mutations; every one writes audit_events)

intake.ts
- `uploadRxc(formData)` — store PDF, create client shell, enqueue rxc-intake job → { clientId }
- `confirmIntake(clientId, payload)` — zod-validated edits to client fields/meds/pharmacy/policies;
  sets confirmed flags; creates analysis (status new) → { analysisId }
- `createManualClient(payload)` → { clientId }

analysis.ts
- `selectPlans(analysisId, planIds, planYear)` — validates availability + tier-cost completeness
- `runComparison(analysisId)` — engine over DB rows, persists analysis_results, status → in_review
- `setPricingChannel(analysisId, channelOverride | null)`
- `saveOverride(analysisId, path, value)` / `clearOverride(analysisId, path)`
- `approveAnalysis(analysisId)` — role check, status → approved, renders .docx to Storage → { reportPath }
- `markDelivered(analysisId)`

admin.ts (role: admin|manager)
- `uploadFormulary(formData: carrier, planYear, label, pdf)` — enqueue ingest → { formularyId }
- `resolveReviewRow(entryId, decision)` — pick reading A/B or manual row
- `activateFormulary(formularyId)` — gate: zero unresolved review rows
- `upsertPlan(payload)` / `upsertTierCosts(planId, rows)` / `setServiceAreas(planId, areas)`
- `attachPharmacyDirectory(planId, formData)` — enqueue pharmacy-directory job
- `setPlanPharmacyStatus(planId, pharmacyId, status)` — agent-source override

auth.ts
- `signIn(email, password)` / `signOut()`

## Realtime

Status chips subscribe to `analyses` / `ingestion_jobs` row changes via
Supabase Realtime (client-side, anon key, RLS-safe reference tables only —
PHI-bearing live updates poll via router.refresh() on an interval instead).
