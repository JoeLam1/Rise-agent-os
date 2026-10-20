"use client";

import { useActionState, useState } from "react";
import { signIn, signUp } from "@/app/actions/auth";
import { initialActionState } from "@/app/actions/state";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, SubmitButton } from "@/components/forms/form-bits";

export function AuthForms({ next }: { next?: string }) {
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [signInState, signInAction] = useActionState(signIn, initialActionState);
  const [signUpState, signUpAction] = useActionState(signUp, initialActionState);

  return mode === "sign-in" ? (
    <form action={signInAction} className="grid gap-4">
      <input type="hidden" name="next" value={next ?? ""} />
      <Field label="Email" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </Field>
      <Field label="Password" htmlFor="password">
        <Input id="password" name="password" type="password" autoComplete="current-password" required minLength={8} />
      </Field>
      <FormMessage state={signInState} />
      <SubmitButton pendingText="Signing in…">Sign in</SubmitButton>
      <Button type="button" variant="link" onClick={() => setMode("sign-up")}>
        New here? Create an account
      </Button>
    </form>
  ) : (
    <form action={signUpAction} className="grid gap-4">
      <Field label="Full name" htmlFor="fullName">
        <Input id="fullName" name="fullName" autoComplete="name" required maxLength={120} />
      </Field>
      <Field label="Email" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </Field>
      <Field label="Password" htmlFor="password" hint="At least 8 characters.">
        <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} />
      </Field>
      <FormMessage state={signUpState} />
      <SubmitButton pendingText="Creating account…">Create account</SubmitButton>
      <Button type="button" variant="link" onClick={() => setMode("sign-in")}>
        Already have an account? Sign in
      </Button>
    </form>
  );
}
