"use client";

import { useActionState } from "react";
import { verifyTotp } from "@/app/actions/mfa";
import { initialActionState } from "@/app/actions/state";
import { Input } from "@/components/ui/input";
import { Field, FormMessage, SubmitButton } from "@/components/forms/form-bits";

export function VerifyForm({ next }: { next?: string }) {
  const [state, action] = useActionState(verifyTotp, initialActionState);
  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="next" value={next ?? ""} />
      <Field label="Code" htmlFor="code">
        <Input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required autoFocus />
      </Field>
      <FormMessage state={state} />
      <SubmitButton pendingText="Checking…">Verify</SubmitButton>
    </form>
  );
}
