import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { listMembers, displayName } from "@/lib/data/queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/app/page-header";
import { AddMemberForm } from "@/components/forms/org-forms";
import { ROLE_LABELS, formatDateTime } from "@/lib/domain/labels";
import type { OrgRole } from "@/lib/domain/types";

export const metadata: Metadata = { title: "Members" };

export default async function MembersPage({ params }: PageProps<"/o/[org]/members">) {
  const { org: slug } = await params;
  const { supabase, org } = await requireAdmin(slug);
  const members = await listMembers(supabase, org.id);

  return (
    <>
      <PageHeader title="Members" description="Who can access this brokerage, and in what role." />
      <Card>
        <CardHeader>
          <CardTitle>Add a member</CardTitle>
        </CardHeader>
        <CardContent>
          <AddMemberForm orgSlug={slug} />
        </CardContent>
      </Card>
      <Card>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Added</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((m) => (
                <TableRow key={m.id}>
                  <TableCell>{displayName(m.profile)}</TableCell>
                  <TableCell>{m.profile?.email ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{ROLE_LABELS[m.role as OrgRole]}</Badge>
                  </TableCell>
                  <TableCell>{formatDateTime(m.created_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
