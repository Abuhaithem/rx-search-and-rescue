import { PageHeader } from "@/components/domain/page-header";
import { ManualClientForm } from "./_components/manual-client-form";
import { UploadCard } from "./_components/upload-card";

export const dynamic = "force-dynamic";

export default function NewIntakePage() {
  return (
    <div className="space-y-6">
      <PageHeader title="New Analysis" backHref="/dashboard" />
      <div className="grid items-start gap-6 lg:grid-cols-[3fr_2fr]">
        <UploadCard />
        <ManualClientForm />
      </div>
    </div>
  );
}
