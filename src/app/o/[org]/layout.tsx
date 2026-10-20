import Link from "next/link";
import { requireOrg } from "@/lib/auth";
import { signOut } from "@/app/actions/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ROLE_LABELS } from "@/lib/domain/labels";
import { dashboardPath, isBrokerOrAdmin } from "@/lib/domain/roles";

export default async function OrgLayout({ children, params }: LayoutProps<"/o/[org]">) {
  const { org: slug } = await params;
  const { org, role, email } = await requireOrg(slug);
  const base = `/o/${org.slug}`;

  const nav = [
    { href: dashboardPath(org.slug, role), label: "Dashboard" },
    { href: `${base}/transactions`, label: "Transactions" },
    { href: `${base}/queues/pre-signature`, label: "Pre-signature" },
    { href: `${base}/queues/post-execution`, label: "Post-execution" },
    ...(isBrokerOrAdmin(role) ? [{ href: `${base}/audit`, label: "Audit log" }] : []),
    ...(role === "admin" ? [{ href: `${base}/members`, label: "Members" }] : []),
  ];

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="bg-card border-b">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/orgs?new=1" className="font-semibold">
            {org.name}
          </Link>
          <nav className="flex flex-wrap gap-1 text-sm">
            {nav.map((item) => (
              <Link key={item.href} href={item.href} className="hover:bg-accent rounded-md px-2 py-1">
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="text-muted-foreground hidden sm:inline">{email}</span>
            <Badge variant="secondary">{ROLE_LABELS[role]}</Badge>
            <form action={signOut}>
              <Button variant="ghost" size="sm">
                Sign out
              </Button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto grid w-full max-w-6xl flex-1 content-start gap-6 px-4 py-6">{children}</main>
    </div>
  );
}
