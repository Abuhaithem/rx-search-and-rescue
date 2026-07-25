"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, FileText } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Left pane of Intake Review (screen 2): the source document beside the
 * extracted data. v1 renders a placeholder page box + page nav; the page
 * number is announced so provenance ("sourcePage") lines up with what the
 * agent sees.
 */

interface PdfPaneProps {
  /** URL of the uploaded PDF (unused by the v1 placeholder, kept for the real viewer). */
  src: string;
  /** e.g. "Barb Bentley _ AgencyBloc RxC.pdf" */
  sourceLabel?: string;
  pageCount?: number;
  initialPage?: number;
  /** Notified when the agent pages through the document. */
  onPageChange?: (page: number) => void;
  className?: string;
}

function PdfPane({
  src,
  sourceLabel,
  pageCount = 1,
  initialPage = 1,
  onPageChange,
  className,
}: PdfPaneProps) {
  const [page, setPage] = useState(() => Math.min(Math.max(initialPage, 1), pageCount));

  const goTo = (next: number) => {
    const clamped = Math.min(Math.max(next, 1), pageCount);
    setPage(clamped);
    onPageChange?.(clamped);
  };

  return (
    <div className={cn("flex h-full flex-col gap-3 bg-fog p-4", className)}>
      {sourceLabel ? (
        <div className="truncate text-center text-xs text-steel" title={sourceLabel}>
          Source: {sourceLabel}
        </div>
      ) : null}

      {/* v1 placeholder page — swap for a real renderer of `src` later */}
      <div
        data-src={src}
        className="flex min-h-64 flex-1 flex-col items-center justify-center gap-2 rounded-card border border-mist bg-white shadow-card"
      >
        <FileText className="size-8 text-mist" />
        <span className="text-xs text-steel">PDF preview</span>
      </div>

      <div className="flex items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => goTo(page - 1)}
          disabled={page <= 1}
          aria-label="Previous page"
          className="rounded-md p-1 text-steel transition-colors hover:bg-white hover:text-deepwater focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
        >
          <ChevronLeft className="size-4" />
        </button>
        <span className="text-data text-xs text-steel">
          Page {page} of {pageCount}
        </span>
        <button
          type="button"
          onClick={() => goTo(page + 1)}
          disabled={page >= pageCount}
          aria-label="Next page"
          className="rounded-md p-1 text-steel transition-colors hover:bg-white hover:text-deepwater focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>
    </div>
  );
}

export { PdfPane, type PdfPaneProps };
