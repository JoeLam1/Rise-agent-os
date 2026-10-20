"use client";

import { useActionState } from "react";
import { updatePassword } from "@/app/actions/auth";
import { initialActionState } from "@/app/actions/state";
import { Input } from "@/components/ui/input";
import { Field, FormMessage, SubmitButton } from "@/components/forms/form-bits";

export function PasswordForm() {
  const [state, action] = useActionState(updatePassword, initialActionState);
  return (
    <form action={action} className="grid gap-4">
      <Field label="New password" htmlFor="password">
        <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} />
      </Field>
      <Field label="Confirm password" htmlFor="confirm">
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required minLength={8} />
      </Field>
      <FormMessage state={state} />
      <SubmitButton pendingText="Saving…">Save password</SubmitButton>
    </form>
  );
}
