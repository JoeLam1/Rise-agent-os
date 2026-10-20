import type { Metadata } from "next";
import { requireBroker } from "@/lib/auth";
import { listAudit, profilesById, displayName } from "@/lib/data/queries";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader, EmptyState } from "@/components/app/page-header";
import { formatDateTime } from "@/lib/domain/labels";

export const metadata: Metadata = { title: "Audit log" };

export default async function AuditPage({ params }: PageProps<"/o/[org]/audit">) {
  const { org: slug } = await params;
  const { supabase, org } = await requireBroker(slug);
  const entries = await listAudit(supabase, org.id, { limit: 200 });
  const people = await profilesById(supabase, entries.map((e) => e.actor_id));

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Append-only record written by the database. Entries can't be edited or deleted. Latest 200 shown."
      />
      <Card>
        <CardContent>
          {entries.length === 0 ? (
            <EmptyState>No activity yet.</EmptyState>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Who</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell>{formatDateTime(e.created_at)}</TableCell>
                    <TableCell>{e.actor_id ? displayName(people.get(e.actor_id)) : "System"}</TableCell>
                    <TableCell className="font-mono text-xs">{e.action}</TableCell>
                    <TableCell className="text-muted-foreground max-w-md truncate font-mono text-xs" title={JSON.stringify(e.metadata)}>
                      {JSON.stringify(e.metadata)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
