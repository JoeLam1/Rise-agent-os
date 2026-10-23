"use client";

import { useActionState } from "react";
import { addKeyDate } from "@/app/actions/transactions";
import { initialActionState } from "@/app/actions/state";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { KEY_DATE_LABELS } from "@/lib/domain/schedule";
import { Field, FormMessage, SubmitButton } from "./form-bits";

export function AddKeyDateForm({ orgSlug, transactionId }: { orgSlug: string; transactionId: string }) {
  const [state, action] = useActionState(addKeyDate.bind(null, orgSlug, transactionId), initialActionState);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-[12rem_1fr_10rem_auto] sm:items-end">
      <Field label="Date for" htmlFor="kind">
        <NativeSelect id="kind" name="kind" defaultValue="inspection">
          {Object.entries(KEY_DATE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field label="Note (required for Other)" htmlFor="label">
        <Input id="label" name="label" maxLength={120} placeholder="e.g. Radon results due" />
      </Field>
      <Field label="Due on" htmlFor="dueOn">
        <Input id="dueOn" name="dueOn" type="date" required />
      </Field>
      <SubmitButton variant="outline" pendingText="Adding…">
        Add date
      </SubmitButton>
      <FormMessage state={state} className="sm:col-span-4" />
    </form>
  );
}
