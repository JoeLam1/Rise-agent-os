import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PasswordForm } from "./form";

export const metadata: Metadata = { title: "Set password" };

export default async function PasswordPage() {
  const { user } = await requireUser();
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">Set your password</CardTitle>
          <CardDescription>For {user.email}. Use at least 8 characters.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <PasswordForm />
          <Link href="/orgs" className="text-sm underline underline-offset-4">
            Continue to your brokerages
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
