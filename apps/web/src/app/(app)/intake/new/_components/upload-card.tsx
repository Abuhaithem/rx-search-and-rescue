"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { FileUp, Loader2 } from "lucide-react";
import { uploadRxc } from "@/server/actions/intake";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";

export function UploadCard() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [pending, startTransition] = useTransition();

  const submit = (file: File) => {
    if (pending) return;
    if (!(file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"))) {
      toast.error("Only PDF files are accepted");
      return;
    }
    startTransition(async () => {
      const formData = new FormData();
      formData.set("file", file);
      const result = await uploadRxc(formData);
      if (result.ok) {
        router.push(`/intake/${result.data.clientId}`);
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Upload Rx Collect PDF</CardTitle>
        <p className="text-sm text-steel">
          The client&rsquo;s AgencyBloc Rx Collect form. The system reads it — medications,
          preferred pharmacy, current plan — and shows everything for review before anything is
          computed.
        </p>
      </CardHeader>
      <CardContent>
        <button
          type="button"
          disabled={pending}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const file = e.dataTransfer.files[0];
            if (file) submit(file);
          }}
          className={cn(
            "flex min-h-48 w-full flex-col items-center justify-center gap-2 rounded-card border-2 border-dashed px-6 py-10 text-center transition-colors",
            dragging ? "border-harbor bg-fog" : "border-mist bg-fog/50 hover:bg-fog",
            pending && "pointer-events-none opacity-60",
          )}
        >
          {pending ? (
            <>
              <Loader2 className="size-8 animate-spin text-steel" />
              <span className="text-sm font-semibold text-deepwater">Uploading…</span>
            </>
          ) : (
            <>
              <FileUp className="size-8 text-steel" />
              <span className="text-sm font-semibold text-deepwater">
                Drop the Rx Collect PDF here
              </span>
              <span className="text-xs text-steel">or click to browse · PDF up to 25 MB</span>
            </>
          )}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) submit(file);
            e.target.value = "";
          }}
        />
      </CardContent>
    </Card>
  );
}
