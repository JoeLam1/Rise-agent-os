"use client";

import { useActionState } from "react";
import { decideReview, withdrawReview } from "@/app/actions/reviews";
import { initialActionState } from "@/app/actions/state";
import { Textarea } from "@/components/ui/textarea";
import { Field, FormMessage, SubmitButton } from "./form-bits";

export function DecisionForm({ orgSlug, reviewId }: { orgSlug: string; reviewId: string }) {
  const [state, action] = useActionState(decideReview.bind(null, orgSlug, reviewId), initialActionState);
  return (
    <form action={action} className="grid gap-4">
      <Field
        label="Decision note"
        htmlFor="note"
        hint="Required when requesting changes or rejecting. Saved to the audit log."
      >
        <Textarea id="note" name="note" maxLength={2000} />
      </Field>
      <p className="text-muted-foreground text-xs">
        Your decision must be based on your own review of the document. Any analysis on this page is a draft aid, not a finding.
      </p>
      <FormMessage state={state} />
      <div className="flex flex-wrap gap-2">
        <SubmitButton name="decision" value="approved" pendingText="Saving…">
          Approve
        </SubmitButton>
        <SubmitButton name="decision" value="changes_requested" variant="outline" pendingText="Saving…">
          Request changes
        </SubmitButton>
        <SubmitButton name="decision" value="rejected" variant="destructive" pendingText="Saving…">
          Reject
        </SubmitButton>
      </div>
    </form>
  );
}

export function WithdrawForm({ orgSlug, reviewId }: { orgSlug: string; reviewId: string }) {
  const [state, action] = useActionState(withdrawReview.bind(null, orgSlug, reviewId), initialActionState);
  return (
    <form action={action} className="flex items-center gap-2">
      <SubmitButton variant="ghost" size="sm" pendingText="Withdrawing…">
        Withdraw review
      </SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}
