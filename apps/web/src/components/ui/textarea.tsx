import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "flex min-h-20 w-full rounded-md border border-mist bg-white px-3 py-2 text-sm text-deepwater transition-colors",
        "placeholder:text-steel/70",
        "focus-visible:border-harbor focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25",
        "disabled:cursor-not-allowed disabled:border-mist disabled:bg-fog disabled:text-steel",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
