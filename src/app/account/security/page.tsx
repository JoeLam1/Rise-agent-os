import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TotpSetup } from "./setup";
import { BackupCodes } from "./backup-codes";

export const metadata: Metadata = { title: "Account security" };

export default async function SecurityPage({ searchParams }: PageProps<"/account/security">) {
  const { reset } = await searchParams;
  const { supabase, user } = await requireUser();
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const active = (factors?.totp ?? []).length > 0;
  const remaining = active ? (((await supabase.rpc("backup_codes_remaining")).data as number | null) ?? 0) : 0;

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-xl">Two-step sign-in</CardTitle>
          <CardDescription>
            For {user.email}. Brokers and admins need it to approve reviews, manage members and change settings.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {reset === "1" && !active ? (
            <p role="status" className="text-sm">
              Your old authenticator app was removed with a backup code. Set up a new one now.
            </p>
          ) : null}
          {active ? (
            <>
              <p className="flex items-center gap-2 text-sm">
                <Badge>On</Badge> You&apos;ll be asked for a code from your authenticator app when you sign in.
              </p>
              <BackupCodes remaining={remaining} />
            </>
          ) : (
            <TotpSetup />
          )}
          <Link href="/orgs" className="text-sm underline underline-offset-4">
            Back to your brokerages
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
