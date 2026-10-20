import { redirect } from "next/navigation";
import { requireOrg } from "@/lib/auth";
import { dashboardPath } from "@/lib/domain/roles";

export default async function OrgHome({ params }: PageProps<"/o/[org]">) {
  const { org: slug } = await params;
  const { org, role } = await requireOrg(slug);
  redirect(dashboardPath(org.slug, role));
}
