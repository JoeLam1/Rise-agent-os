"use client";

import { useActionState } from "react";
import { uploadDocument } from "@/app/actions/documents";
import { requestReview } from "@/app/actions/reviews";
import { initialActionState } from "@/app/actions/state";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { DOCUMENT_KIND_LABELS } from "@/lib/domain/labels";
import { Field, FormMessage, SubmitButton } from "./form-bits";

const ACCEPT = ".pdf,.docx,.doc,.png,.jpg,.jpeg,application/pdf";

export function NewDocumentForm({ orgSlug, transactionId }: { orgSlug: string; transactionId: string }) {
  const [state, action] = useActionState(uploadDocument.bind(null, orgSlug, transactionId), initialActionState);
  return (
    <form action={action} className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Title" htmlFor="title">
          <Input id="title" name="title" required maxLength={200} placeholder="Purchase agreement" />
        </Field>
        <Field label="Type" htmlFor="kind">
          <NativeSelect id="kind" name="kind" defaultValue="purchase_agreement">
            {Object.entries(DOCUMENT_KIND_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      <Field label="File" htmlFor="file" hint="PDF, Word, PNG or JPEG, up to 10 MB. Stored privately.">
        <Input id="file" name="file" type="file" required accept={ACCEPT} />
      </Field>
      <FormMessage state={state} />
      <div>
        <SubmitButton pendingText="Uploading…">Upload document</SubmitButton>
      </div>
    </form>
  );
}

export function NewVersionForm({
  orgSlug,
  transactionId,
  documentId,
}: {
  orgSlug: string;
  transactionId: string;
  documentId: string;
}) {
  const [state, action] = useActionState(uploadDocument.bind(null, orgSlug, transactionId), initialActionState);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="documentId" value={documentId} />
      <label htmlFor={`file-${documentId}`} className="sr-only">
        New version file
      </label>
      <Input id={`file-${documentId}`} name="file" type="file" required accept={ACCEPT} className="max-w-72" />
      <SubmitButton variant="outline" size="sm" pendingText="Uploading…">
        Upload new version
      </SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}

export function RequestReviewForm({
  orgSlug,
  transactionId,
  versionId,
}: {
  orgSlug: string;
  transactionId: string;
  versionId: string;
}) {
  const [state, action] = useActionState(requestReview.bind(null, orgSlug, transactionId), initialActionState);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="versionId" value={versionId} />
      <SubmitButton name="reviewType" value="pre_signature" variant="secondary" size="sm" pendingText="Submitting…">
        Request pre-signature review
      </SubmitButton>
      <SubmitButton name="reviewType" value="post_execution" variant="secondary" size="sm" pendingText="Submitting…">
        Request post-execution review
      </SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}
