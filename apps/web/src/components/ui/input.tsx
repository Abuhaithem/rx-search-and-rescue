import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      className={cn(
        "flex h-9 w-full rounded-md border border-mist bg-white px-3 py-1 text-sm text-deepwater transition-colors",
        "placeholder:text-steel/70",
        "focus-visible:border-harbor focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25",
        "disabled:cursor-not-allowed disabled:border-mist disabled:bg-fog disabled:text-steel",
        "file:border-0 file:bg-transparent file:text-sm file:font-semibold file:text-deepwater",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
