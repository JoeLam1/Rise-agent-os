import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { signOut } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { VerifyForm } from "./form";

export const metadata: Metadata = { title: "Two-step sign-in" };

export default async function VerifyPage({ searchParams }: PageProps<"/login/verify">) {
  const { next } = await searchParams;
  const { supabase, user } = await requireUser();
  const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (!data || data.nextLevel !== "aal2" || data.currentLevel === "aal2") redirect("/orgs");

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">Two-step sign-in</CardTitle>
          <CardDescription>Enter the 6-digit code from the authenticator app on your phone for {user.email}.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <VerifyForm next={typeof next === "string" ? next : undefined} />
          <form action={signOut}>
            <Button variant="link" className="px-0">
              Use a different account
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
