import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AuthForms } from "./forms";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next, error } = await searchParams;
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">RISE Agent OS</CardTitle>
          <CardDescription>Sign in to your brokerage workspace.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {error === "link" ? (
            <p role="alert" className="text-destructive text-sm">
              That link is invalid or has expired. Sign in, or ask for a new link.
            </p>
          ) : null}
          <AuthForms next={typeof next === "string" ? next : undefined} />
        </CardContent>
      </Card>
    </main>
  );
}
