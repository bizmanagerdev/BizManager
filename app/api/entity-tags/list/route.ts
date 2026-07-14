import { NextResponse } from "next/server";
import { requireRouteAccess } from "@/lib/auth/requireRouteAccess";
import { fetchEntityTagIds, type TaggableEntityType } from "@/lib/tags";

const VALID: TaggableEntityType[] = ["task", "expense", "payment", "document", "work_session", "customer"];

// The tag ids currently attached to an entity — used to pre-fill an edit dialog.
export async function GET(request: Request) {
  const access = await requireRouteAccess({ allowedRoles: ["admin", "office", "worker"] });
  if (!access.ok) return access.response;
  const { supabase } = access.value;

  const url = new URL(request.url);
  const entityType = url.searchParams.get("entity_type") as TaggableEntityType | null;
  const entityId = url.searchParams.get("entity_id");

  if (!entityType || !VALID.includes(entityType) || !entityId) {
    return NextResponse.json({ tag_ids: [] });
  }

  const tagIds = await fetchEntityTagIds(supabase, entityType, entityId);
  return NextResponse.json({ tag_ids: tagIds });
}
