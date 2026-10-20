"use client";

import { useActionState } from "react";
import { createBackupCodes, type BackupCodesState } from "@/app/actions/mfa";
import { FormMessage, SubmitButton } from "@/components/forms/form-bits";

export function BackupCodes({ remaining }: { remaining: number }) {
  const [state, action] = useActionState(createBackupCodes, {} as BackupCodesState);

  if (state.codes) {
    return (
      <div className="grid gap-3">
        <p className="text-sm font-medium">Save these backup codes somewhere safe now. They won&apos;t be shown again.</p>
        <ul data-testid="backup-codes" className="bg-muted grid grid-cols-2 gap-1 rounded-md p-3 font-mono text-sm">
          {state.codes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <p className="text-muted-foreground text-xs">
          Each code works once. If you lose your phone, sign in with your password and use a code to set up a new
          authenticator app. Any older codes no longer work.
        </p>
      </div>
    );
  }
  return (
    <form action={action} className="grid gap-3">
      <p className="text-sm">
        {remaining > 0
          ? `You have ${remaining} unused backup code${remaining === 1 ? "" : "s"}.`
          : "You have no backup codes. Without them, a lost phone means asking your brokerage's support contact to reset your two-step sign-in."}
      </p>
      <FormMessage state={state} />
      <div>
        <SubmitButton variant="outline" pendingText="Creating…">
          {remaining > 0 ? "Replace backup codes" : "Create backup codes"}
        </SubmitButton>
      </div>
    </form>
  );
}
