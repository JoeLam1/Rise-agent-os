"use client";

import { useActionState, useState } from "react";
import { changeMemberRole, removeMember } from "@/app/actions/orgs";
import { initialActionState } from "@/app/actions/state";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { FormMessage, SubmitButton } from "./form-bits";

export function MemberRoleForm({ orgSlug, membershipId, role, who }: { orgSlug: string; membershipId: string; role: string; who: string }) {
  const [state, action] = useActionState(changeMemberRole.bind(null, orgSlug, membershipId), initialActionState);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <NativeSelect name="role" defaultValue={role} aria-label={`Role for ${who}`} className="w-28">
        <option value="agent">Agent</option>
        <option value="broker">Broker</option>
        <option value="admin">Admin</option>
      </NativeSelect>
      <SubmitButton size="sm" variant="outline" pendingText="Saving…" aria-label={`Save role for ${who}`}>
        Save
      </SubmitButton>
      <FormMessage state={state} className="basis-full" />
    </form>
  );
}

export function RemoveMemberButton({ orgSlug, membershipId, who }: { orgSlug: string; membershipId: string; who: string }) {
  const [confirming, setConfirming] = useState(false);
  const [state, action] = useActionState(removeMember.bind(null, orgSlug, membershipId), initialActionState);
  if (!confirming) {
    return (
      <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(true)} aria-label={`Remove ${who}`}>
        Remove
      </Button>
    );
  }
  return (
    <form action={action} className="flex flex-wrap items-center justify-end gap-2">
      <span className="text-sm">Remove {who}? Their work stays with the brokerage.</span>
      <SubmitButton size="sm" variant="destructive" pendingText="Removing…">
        Confirm remove
      </SubmitButton>
      <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(false)}>
        Cancel
      </Button>
      <FormMessage state={state} className="basis-full" />
    </form>
  );
}
