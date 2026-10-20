"use client";

import { useActionState } from "react";
import { createOrganization, addMember, setAiReview } from "@/app/actions/orgs";
import { initialActionState } from "@/app/actions/state";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Field, FormMessage, SubmitButton } from "./form-bits";

export function CreateOrgForm() {
  const [state, action] = useActionState(createOrganization, initialActionState);
  return (
    <form action={action} className="grid gap-4">
      <Field label="Brokerage name" htmlFor="name">
        <Input id="name" name="name" required placeholder="Example Realty" />
      </Field>
      <Field label="URL name" htmlFor="slug" hint="Lowercase letters, numbers and dashes. Used in links.">
        <Input id="slug" name="slug" required pattern="[a-z0-9][a-z0-9\-]{1,61}[a-z0-9]" placeholder="example-realty" />
      </Field>
      <FormMessage state={state} />
      <SubmitButton pendingText="Creating…">Create brokerage</SubmitButton>
    </form>
  );
}

export function AddMemberForm({ orgSlug }: { orgSlug: string }) {
  const [state, action] = useActionState(addMember.bind(null, orgSlug), initialActionState);
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-[1fr_10rem_auto] sm:items-end">
      <Field label="Email" htmlFor="email">
        <Input id="email" name="email" type="email" required placeholder="agent@example.com" />
      </Field>
      <Field label="Role" htmlFor="role">
        <NativeSelect id="role" name="role" defaultValue="agent">
          <option value="agent">Agent</option>
          <option value="broker">Broker</option>
          <option value="admin">Admin</option>
        </NativeSelect>
      </Field>
      <SubmitButton pendingText="Adding…">Add member</SubmitButton>
      <FormMessage state={state} className="sm:col-span-3" />
    </form>
  );
}

export function AiReviewForm({ orgSlug, enabled }: { orgSlug: string; enabled: boolean }) {
  const [state, action] = useActionState(setAiReview.bind(null, orgSlug), initialActionState);
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="enabled" value={enabled ? "false" : "true"} />
      <div>
        <SubmitButton pendingText="Saving…" variant={enabled ? "outline" : "default"}>
          {enabled ? "Turn off AI review" : "Turn on AI review"}
        </SubmitButton>
      </div>
      <FormMessage state={state} />
    </form>
  );
}
