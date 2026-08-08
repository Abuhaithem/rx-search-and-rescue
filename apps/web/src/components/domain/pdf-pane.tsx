"use client";

import { useState } from "react";
import { ExternalLink, FileText, Maximize2 } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * Left pane of Intake Review (screen 2): the source Rx Collect document beside
 * the extracted data. Renders the real PDF inline (native viewer) and an
 * "Expand" action that opens it full-size in a dialog so the agent can check it
 * against the extracted rows without leaving the page.
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
  const [expanded, setExpanded] = useState(false);
  const label = sourceLabel ?? "Source document";
  const viewerSrc = `${src}#toolbar=1&navpanes=0&view=FitH`;

  return (
    <div className={cn("flex flex-col overflow-hidden bg-fog", className)}>
      <div className="flex items-center gap-1 border-b border-mist/70 bg-white px-3 py-2">
        <FileText className="size-4 shrink-0 text-steel" />
        <span
          className="min-w-0 flex-1 truncate text-xs font-semibold text-deepwater"
          title={label}
        >
          {label}
        </span>
        {hasPdf ? (
          <>
            <button
              type="button"
              onClick={() => setExpanded(true)}
              title="Open full size"
              aria-label="Open the PDF full size"
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-steel transition-colors hover:bg-fog hover:text-deepwater focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Maximize2 className="size-3.5" />
              Expand
            </button>
            <a
              href={src}
              target="_blank"
              rel="noopener noreferrer"
              title="Open in a new tab"
              aria-label="Open the PDF in a new tab"
              className="inline-flex items-center rounded-md p-1 text-steel transition-colors hover:bg-fog hover:text-deepwater focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ExternalLink className="size-3.5" />
            </a>
          </>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 p-2">
        {hasPdf ? (
          <iframe
            src={viewerSrc}
            title={label}
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

      {hasPdf ? (
        <Dialog open={expanded} onOpenChange={setExpanded}>
          <DialogContent className="flex h-[92vh] w-[96vw] max-w-[1100px] flex-col gap-0 overflow-hidden p-0">
            <DialogTitle className="flex items-center gap-2 border-b border-mist/60 px-4 py-3 pr-12 text-sm font-semibold">
              <FileText className="size-4 shrink-0 text-steel" />
              <span className="truncate">{label}</span>
            </DialogTitle>
            <iframe src={viewerSrc} title={label} className="min-h-0 flex-1 bg-white" />
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

export { PdfPane, type PdfPaneProps };
