"use client";

import { useActionState, useState } from "react";
import { redeemBackupCode, verifyTotp } from "@/app/actions/mfa";
import { Button } from "@/components/ui/button";
import { initialActionState } from "@/app/actions/state";
import { Input } from "@/components/ui/input";
import { Field, FormMessage, SubmitButton } from "@/components/forms/form-bits";

export function VerifyForm({ next }: { next?: string }) {
  const [state, action] = useActionState(verifyTotp, initialActionState);
  const [lostPhone, setLostPhone] = useState(false);
  if (lostPhone) return <BackupCodeForm onCancel={() => setLostPhone(false)} />;
  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="next" value={next ?? ""} />
      <Field label="Code" htmlFor="code">
        <Input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required autoFocus />
      </Field>
      <FormMessage state={state} />
      <SubmitButton pendingText="Checking…">Verify</SubmitButton>
      <Button type="button" variant="link" className="px-0" onClick={() => setLostPhone(true)}>
        Lost your phone? Use a backup code
      </Button>
    </form>
  );
}

function BackupCodeForm({ onCancel }: { onCancel: () => void }) {
  const [state, action] = useActionState(redeemBackupCode, initialActionState);
  return (
    <form action={action} className="grid gap-4">
      <p className="text-sm">
        A backup code removes your old authenticator app so you can set up a new one. Each code works once.
      </p>
      <Field label="Backup code" htmlFor="backupCode">
        <Input id="backupCode" name="backupCode" autoComplete="off" required autoFocus />
      </Field>
      <FormMessage state={state} />
      <SubmitButton pendingText="Checking…">Use backup code</SubmitButton>
      <Button type="button" variant="link" className="px-0" onClick={onCancel}>
        Back to the authenticator code
      </Button>
    </form>
  );
}
