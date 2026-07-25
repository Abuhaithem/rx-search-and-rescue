"use client";

import { Toaster as SonnerToaster, toast } from "sonner";

/** Brand-styled sonner toaster. Mount once in the root layout. */
function Toaster(props: React.ComponentProps<typeof SonnerToaster>) {
  return (
    <SonnerToaster
      position="bottom-right"
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "flex w-full items-center gap-3 rounded-card border border-mist bg-white p-4 font-sans text-sm text-deepwater shadow-card",
          title: "font-semibold",
          description: "text-steel",
          actionButton:
            "shrink-0 rounded-md bg-deepwater px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-harbor",
          cancelButton:
            "shrink-0 rounded-md border border-mist bg-white px-3 py-1.5 text-[13px] font-semibold text-deepwater hover:bg-fog",
          success: "[&_[data-icon]]:text-covered",
          warning: "[&_[data-icon]]:text-restricted",
          error: "[&_[data-icon]]:text-notcovered",
        },
      }}
      {...props}
    />
  );
}

export { Toaster, toast };
