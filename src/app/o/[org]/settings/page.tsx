import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/app/page-header";
import { AiReviewForm } from "@/components/forms/org-forms";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage({ params }: PageProps<"/o/[org]/settings">) {
  const { org: slug } = await params;
  const { org } = await requireAdmin(slug);

  return (
    <>
      <PageHeader title="Settings" description="Brokerage-wide settings. Only admins can change them." />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            AI contract review{" "}
            <Badge variant={org.ai_review_enabled ? "success" : "outline"}>{org.ai_review_enabled ? "On" : "Off"}</Badge>
          </CardTitle>
          <CardDescription>
            When on, new review requests for PDF documents are analyzed by an AI model against the draft New Jersey
            checklist. Other files, and every request while this is off, get the placeholder mock analysis.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm">
          <ul className="text-muted-foreground grid list-disc gap-1 pl-5">
            <li>
              The document is sent to the AI provider (Anthropic) by a server-side worker. Confirm your data
              agreement with the provider covers client documents before turning this on.
            </li>
            <li>The checklist has not yet been validated by the broker of record or New Jersey counsel.</li>
            <li>The AI never approves anything. A broker reads every document and decides.</li>
          </ul>
          <AiReviewForm orgSlug={slug} enabled={org.ai_review_enabled} />
        </CardContent>
      </Card>
    </>
  );
}
