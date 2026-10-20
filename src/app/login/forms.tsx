"use client";

import { useActionState, useState } from "react";
import { requestPasswordReset, signIn, signUp } from "@/app/actions/auth";
import { initialActionState } from "@/app/actions/state";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, SubmitButton } from "@/components/forms/form-bits";

export function AuthForms({ next }: { next?: string }) {
  const [mode, setMode] = useState<"sign-in" | "sign-up" | "forgot">("sign-in");
  const [signInState, signInAction] = useActionState(signIn, initialActionState);
  const [signUpState, signUpAction] = useActionState(signUp, initialActionState);
  const [resetState, resetAction] = useActionState(requestPasswordReset, initialActionState);

  if (mode === "forgot") {
    return (
      <form action={resetAction} className="grid gap-4">
        <Field label="Email" htmlFor="email" hint="We'll email you a link to choose a new password.">
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </Field>
        <FormMessage state={resetState} />
        <SubmitButton pendingText="Sending…">Send reset link</SubmitButton>
        <Button type="button" variant="link" onClick={() => setMode("sign-in")}>
          Back to sign in
        </Button>
      </form>
    );
  }

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
      <Button type="button" variant="link" onClick={() => setMode("forgot")}>
        Forgot your password?
      </Button>
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
