"use client";

import { useActionState } from "react";
import { createOrganization, addMember, setAiReview, setTimeZone } from "@/app/actions/orgs";
import { TIME_ZONE_CHOICES } from "@/lib/domain/schedule";
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
      <Field label="Email" htmlFor="email" hint="No account yet? We'll email them an invitation.">
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

export function TimeZoneForm({ orgSlug, timeZone }: { orgSlug: string; timeZone: string }) {
  const [state, action] = useActionState(setTimeZone.bind(null, orgSlug), initialActionState);
  const choices = TIME_ZONE_CHOICES.some((z) => z.value === timeZone)
    ? TIME_ZONE_CHOICES
    : [{ value: timeZone, label: timeZone }, ...TIME_ZONE_CHOICES];
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-[minmax(0,20rem)_max-content] sm:items-end">
      <Field label="Time zone" htmlFor="time_zone">
        <NativeSelect id="time_zone" name="time_zone" defaultValue={timeZone}>
          {choices.map((z) => (
            <option key={z.value} value={z.value}>
              {z.label}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <SubmitButton pendingText="Saving…">Save time zone</SubmitButton>
      <FormMessage state={state} className="sm:col-span-2" />
    </form>
  );
}
