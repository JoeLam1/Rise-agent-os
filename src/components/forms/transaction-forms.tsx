"use client";

import { useActionState } from "react";
import { createTransaction, updateTransactionStatus } from "@/app/actions/transactions";
import { initialActionState } from "@/app/actions/state";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { SIDE_LABELS, STATUS_LABELS } from "@/lib/domain/labels";
import type { TransactionStatus } from "@/lib/domain/types";
import { Field, FormMessage, SubmitButton } from "./form-bits";

export function NewTransactionForm({
  orgSlug,
  agents,
}: {
  orgSlug: string;
  /** Present only for brokers/admins, who may assign another agent. */
  agents?: { id: string; name: string }[];
}) {
  const [state, action] = useActionState(createTransaction.bind(null, orgSlug), initialActionState);
  return (
    <form action={action} className="grid gap-4">
      <Field label="Property address" htmlFor="propertyAddress">
        <Input id="propertyAddress" name="propertyAddress" required maxLength={300} placeholder="Street address" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="City" htmlFor="propertyCity">
          <Input id="propertyCity" name="propertyCity" maxLength={120} />
        </Field>
        <Field label="Representing" htmlFor="side">
          <NativeSelect id="side" name="side" defaultValue="buyer">
            {Object.entries(SIDE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Expected close date" htmlFor="expectedCloseDate">
          <Input id="expectedCloseDate" name="expectedCloseDate" type="date" />
        </Field>
        {agents ? (
          <Field label="Agent" htmlFor="agentId">
            <NativeSelect id="agentId" name="agentId" defaultValue="">
              <option value="">Me</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
        ) : null}
      </div>
      <Field label="Notes" htmlFor="notes" hint="Don't paste client personal data here during the pilot.">
        <Textarea id="notes" name="notes" maxLength={2000} />
      </Field>
      <FormMessage state={state} />
      <div>
        <SubmitButton pendingText="Creating…">Create transaction</SubmitButton>
      </div>
    </form>
  );
}

export function StatusForm({
  orgSlug,
  transactionId,
  status,
}: {
  orgSlug: string;
  transactionId: string;
  status: TransactionStatus;
}) {
  const [state, action] = useActionState(updateTransactionStatus.bind(null, orgSlug, transactionId), initialActionState);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <label htmlFor="status" className="sr-only">
        Status
      </label>
      <NativeSelect id="status" name="status" defaultValue={status} className="w-44">
        {Object.entries(STATUS_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </NativeSelect>
      <SubmitButton variant="outline" size="sm" pendingText="Saving…">
        Update status
      </SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}
