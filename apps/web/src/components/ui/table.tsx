import { cn } from "@/lib/utils";

/**
 * Density per DESIGN_SYSTEM layout: ~44px rows, 12px cell padding, fog header
 * row with eyebrow column labels, mist dividers, hover fog.
 */

function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn("w-full caption-bottom text-sm text-deepwater", className)} {...props} />
    </div>
  );
}

function THead({ className, ...props }: React.ComponentProps<"thead">) {
  return <thead className={cn("bg-fog [&_tr]:border-b [&_tr]:border-mist", className)} {...props} />;
}

function TBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return <tbody className={cn("[&_tr:last-child]:border-0", className)} {...props} />;
}

function TRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      className={cn("h-12 border-b border-mist/55 transition-colors hover:bg-fog/70", className)}
      {...props}
    />
  );
}

/** Header cell — eyebrow-style column label. Use inside THead. */
function TH({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      className={cn("h-11 px-4 text-left align-middle text-eyebrow first:pl-5 last:pr-5", className)}
      {...props}
    />
  );
}

function TCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td className={cn("px-4 py-3 align-middle first:pl-5 last:pr-5", className)} {...props} />
  );
}

export { Table, THead, TBody, TRow, TH, TCell };
