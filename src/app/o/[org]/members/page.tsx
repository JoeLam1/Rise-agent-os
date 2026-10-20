import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { listMembers, listOpenInvitations, memberTwoStepStatus, displayName } from "@/lib/data/queries";
import { MemberRoleForm, RemoveMemberButton } from "@/components/forms/member-forms";
import { revokeInvitation } from "@/app/actions/orgs";
import { Button } from "@/components/ui/button";
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
  const { supabase, org, userId } = await requireAdmin(slug);
  const [members, invitations, twoStep] = await Promise.all([
    listMembers(supabase, org.id),
    listOpenInvitations(supabase, org.id),
    memberTwoStepStatus(supabase, org.id),
  ]);

  return (
    <>
      <PageHeader title="Members" description="Who can access this brokerage, and in what role." />
      <Card>
        <CardHeader>
          <CardTitle>Add or invite a member</CardTitle>
        </CardHeader>
        <CardContent>
          <AddMemberForm orgSlug={slug} />
        </CardContent>
      </Card>
      {invitations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Pending invitations</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {invitations.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell>{inv.email}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{ROLE_LABELS[inv.role as OrgRole]}</Badge>
                    </TableCell>
                    <TableCell>{formatDateTime(inv.expires_at)}</TableCell>
                    <TableCell className="text-right">
                      <form action={revokeInvitation.bind(null, slug, inv.id)}>
                        <Button type="submit" variant="outline" size="sm" aria-label={`Revoke invitation for ${inv.email}`}>
                          Revoke
                        </Button>
                      </form>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Two-step sign-in</TableHead>
                <TableHead>Added</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((m) => (
                <TableRow key={m.id}>
                  <TableCell>{displayName(m.profile)}</TableCell>
                  <TableCell>{m.profile?.email ?? "—"}</TableCell>
                  <TableCell>
                    <MemberRoleForm orgSlug={slug} membershipId={m.id} role={m.role} who={displayName(m.profile)} />
                  </TableCell>
                  <TableCell>
                    {twoStep.get(m.user_id) ? (
                      <Badge variant="secondary">On</Badge>
                    ) : (
                      <Badge variant={m.role === "agent" ? "outline" : "destructive"}>
                        {m.role === "agent" ? "Off" : "Off: can't approve or manage"}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>{formatDateTime(m.created_at)}</TableCell>
                  <TableCell className="text-right">
                    {m.user_id === userId ? (
                      <span className="text-muted-foreground text-sm">You</span>
                    ) : (
                      <RemoveMemberButton orgSlug={slug} membershipId={m.id} who={displayName(m.profile)} />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
