"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createManualClient } from "@/server/actions/intake";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/sonner";

export function ManualClientForm() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [zip, setZip] = useState("");
  const [state, setState] = useState("");
  const [county, setCounty] = useState("");
  const [pending, startTransition] = useTransition();

  const submit = () => {
    const name = fullName.trim();
    if (!name) {
      toast.error("Client name is required");
      return;
    }
    if (zip.trim() && !/^\d{5}$/.test(zip.trim())) {
      toast.error("ZIP must be 5 digits");
      return;
    }
    if (state.trim() && state.trim().length !== 2) {
      toast.error("State must be a 2-letter code");
      return;
    }
    startTransition(async () => {
      const result = await createManualClient({
        client: {
          fullName: name,
          zip: zip.trim() || null,
          state: state.trim().toUpperCase() || null,
          county: county.trim() || null,
        },
      });
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
        <CardTitle>Or create a client manually</CardTitle>
        <p className="text-sm text-steel">
          No Rx Collect on hand? Start a blank client and enter medications by hand on the next
          screen.
        </p>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="manual-name">Client name</Label>
            <Input
              id="manual-name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Last, First"
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="manual-zip">ZIP</Label>
              <Input
                id="manual-zip"
                value={zip}
                onChange={(e) => setZip(e.target.value)}
                placeholder="83340"
                inputMode="numeric"
                maxLength={5}
                className="text-data"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="manual-state">State</Label>
              <Input
                id="manual-state"
                value={state}
                onChange={(e) => setState(e.target.value)}
                placeholder="ID"
                maxLength={2}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="manual-county">County</Label>
              <Input
                id="manual-county"
                value={county}
                onChange={(e) => setCounty(e.target.value)}
                placeholder="Blaine"
              />
            </div>
          </div>
          <Button type="submit" variant="secondary" disabled={pending} className={pending ? "opacity-70" : undefined}>
            {pending ? "Creating…" : "Create client"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
