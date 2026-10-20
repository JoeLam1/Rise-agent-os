"use client";

import { useActionState } from "react";
import { confirmTotpEnrollment, startTotpEnrollment, type EnrollState } from "@/app/actions/mfa";
import { initialActionState } from "@/app/actions/state";
import { Input } from "@/components/ui/input";
import { Field, FormMessage, SubmitButton } from "@/components/forms/form-bits";

export function TotpSetup() {
  const [enroll, startAction] = useActionState(startTotpEnrollment, {} as EnrollState);

  if (!enroll.factorId) {
    return (
      <form action={startAction} className="grid gap-3">
        <p className="text-sm">
          You&apos;ll need an authenticator app on your phone, such as Google Authenticator, Microsoft Authenticator or 1Password.
        </p>
        <FormMessage state={enroll} />
        <div>
          <SubmitButton pendingText="Preparing…">Set up two-step sign-in</SubmitButton>
        </div>
      </form>
    );
  }
  return <ConfirmStep factorId={enroll.factorId} qrCode={enroll.qrCode!} secret={enroll.secret!} />;
}

function ConfirmStep({ factorId, qrCode, secret }: { factorId: string; qrCode: string; secret: string }) {
  const [state, action] = useActionState(confirmTotpEnrollment.bind(null, factorId), initialActionState);
  if (state.message) return <FormMessage state={state} />;
  return (
    <form action={action} className="grid gap-4">
      <p className="text-sm">Scan this QR code with your authenticator app, then enter the 6-digit code it shows.</p>
      {/* eslint-disable-next-line @next/next/no-img-element -- data URI from Supabase Auth */}
      <img src={qrCode.startsWith("data:") ? qrCode : `data:image/svg+xml;utf-8,${qrCode}`} alt="QR code for your authenticator app" className="size-48 rounded-md border bg-white p-2" />
      <p className="text-muted-foreground text-xs">
        Can&apos;t scan it? Enter this setup key instead: <code data-testid="totp-secret" className="text-foreground break-all">{secret}</code>
      </p>
      <Field label="Code" htmlFor="code">
        <Input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required />
      </Field>
      <FormMessage state={state} />
      <SubmitButton pendingText="Checking…">Turn on two-step sign-in</SubmitButton>
    </form>
  );
}
