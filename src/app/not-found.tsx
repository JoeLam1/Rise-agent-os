import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-xl font-semibold">Not found</h1>
      <p className="text-muted-foreground text-sm">This page doesn&apos;t exist, or you don&apos;t have access to it.</p>
      <Link href="/orgs" className="text-sm underline">
        Back to your brokerages
      </Link>
    </main>
  );
}
