/**
 * Process-wide cap on concurrent LLM extraction calls. Queue concurrency and
 * per-job page parallelism MULTIPLY (4 jobs × 3 pages = 12 calls); this
 * semaphore keeps the true total bounded regardless of how many jobs run,
 * so rate limits and pacing stay predictable. LLM_MAX_CONCURRENT_CALLS
 * (default 8) sizes it.
 */
import type { ExtractionProvider } from "./extraction/types";

export class Semaphore {
  private inFlight = 0;
  private readonly waiters: (() => void)[] = [];

  constructor(private readonly limit: number) {}

  async acquire(): Promise<() => void> {
    while (this.inFlight >= this.limit) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    this.inFlight += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.inFlight -= 1;
      this.waiters.shift()?.();
    };
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

const DEFAULT_LLM_CAP = 8;

function llmCallCap(): number {
  const raw = Number(process.env.LLM_MAX_CONCURRENT_CALLS);
  return Number.isInteger(raw) && raw >= 1 && raw <= 64 ? raw : DEFAULT_LLM_CAP;
}

// One semaphore per worker process, sized from env on first use.
let globalSemaphore: Semaphore | undefined;

function llmSemaphore(): Semaphore {
  globalSemaphore ??= new Semaphore(llmCallCap());
  return globalSemaphore;
}

/**
 * Every provider method funnels through the shared semaphore. Metadata
 * fields pass through untouched — only the API-calling methods wait.
 */
export function limitExtractionProvider(provider: ExtractionProvider): ExtractionProvider {
  const limited =
    <A extends unknown[], R>(fn: (...args: A) => Promise<R>) =>
    (...args: A): Promise<R> =>
      llmSemaphore().run(() => fn(...args));

  return {
    providerName: provider.providerName,
    model: provider.model,
    escalationModel: provider.escalationModel,
    maxContextPages: provider.maxContextPages,
    extractRxc: limited(provider.extractRxc.bind(provider)),
    extractFormularyPage: limited(provider.extractFormularyPage.bind(provider)),
    extractQuantityLimitPage: limited(provider.extractQuantityLimitPage.bind(provider)),
    extractFormularyLegend: limited(provider.extractFormularyLegend.bind(provider)),
    extractFormularyPlanNames: limited(provider.extractFormularyPlanNames.bind(provider)),
    extractSummaryOfBenefits: limited(provider.extractSummaryOfBenefits.bind(provider)),
    extractPharmacyDirectoryRows: limited(provider.extractPharmacyDirectoryRows.bind(provider)),
    extractPharmacyRosterRows: limited(provider.extractPharmacyRosterRows.bind(provider)),
    resolvePharmacyCandidate: limited(provider.resolvePharmacyCandidate.bind(provider)),
    resolveDrugNames: limited(provider.resolveDrugNames.bind(provider)),
    groupPharmacyBrands: limited(provider.groupPharmacyBrands.bind(provider)),
  };
}
