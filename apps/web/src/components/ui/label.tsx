"use client";

import * as LabelPrimitive from "@radix-ui/react-label";
import { cn } from "@/lib/utils";

function Label({ className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      className={cn(
        "text-sm font-semibold leading-none text-deepwater peer-disabled:cursor-not-allowed peer-disabled:text-steel",
        className,
      )}
      {...props}
    />
  );
}

export { Label };
