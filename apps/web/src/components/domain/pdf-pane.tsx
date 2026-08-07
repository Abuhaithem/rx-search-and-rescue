import { ExternalLink, FileText } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Left pane of Intake Review (screen 2): the source Rx Collect document beside
 * the extracted data. Renders the real PDF in a fixed-height frame (the browser's
 * native viewer handles scroll/zoom/paging) so the agent can check provenance
 * against what was extracted.
 */

interface PdfPaneProps {
  /** Signed URL of the uploaded PDF; empty string when there is no source document. */
  src: string;
  /** e.g. "Marilyn Healy — AgencyBloc RxC.pdf" */
  sourceLabel?: string;
  className?: string;
}

function PdfPane({ src, sourceLabel, className }: PdfPaneProps) {
  const hasPdf = src.trim().length > 0;

  return (
    <div className={cn("flex flex-col overflow-hidden bg-fog", className)}>
      <div className="flex items-center gap-2 border-b border-mist/70 bg-white px-3 py-2">
        <FileText className="size-4 shrink-0 text-steel" />
        <span
          className="min-w-0 flex-1 truncate text-xs font-semibold text-deepwater"
          title={sourceLabel}
        >
          {sourceLabel ?? "Source document"}
        </span>
        {hasPdf ? (
          <a
            href={src}
            target="_blank"
            rel="noopener noreferrer"
            title="Open in a new tab"
            aria-label="Open the source PDF in a new tab"
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-steel transition-colors hover:bg-fog hover:text-deepwater focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ExternalLink className="size-3.5" />
            Open
          </a>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 p-2">
        {hasPdf ? (
          <iframe
            src={`${src}#toolbar=1&navpanes=0&view=FitH`}
            title={sourceLabel ?? "Source PDF"}
            className="h-full w-full rounded-md border border-mist bg-white"
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 rounded-md border border-dashed border-mist/80 bg-white px-4 text-center">
            <FileText className="size-8 text-mist" />
            <span className="text-xs font-medium text-steel">No source PDF</span>
            <span className="max-w-[24ch] text-[11px] text-steel/80">
              This client was started manually, so there is nothing to preview.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export { PdfPane, type PdfPaneProps };
