import Link from "next/link";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="text-muted-foreground text-sm">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function StatCard({ label, value, href }: { label: string; value: number | string; href?: string }) {
  const body = (
    <div className="bg-card rounded-xl border p-4 shadow-sm">
      <p className="text-muted-foreground text-sm">{label}</p>
      <p className="mt-1 text-3xl font-semibold tabular-nums">{value}</p>
    </div>
  );
  return href ? (
    <Link href={href} className="hover:ring-ring/40 block rounded-xl transition hover:ring-2">
      {body}
    </Link>
  ) : (
    body
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return <p className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">{children}</p>;
}
