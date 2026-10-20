import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AuthForms } from "./forms";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">RISE Agent OS</CardTitle>
          <CardDescription>Sign in to your brokerage workspace.</CardDescription>
        </CardHeader>
        <CardContent>
          <AuthForms next={typeof next === "string" ? next : undefined} />
        </CardContent>
      </Card>
    </main>
  );
}
