import { NextResponse } from "next/server";
import { createSupabaseRouteClient } from "@/lib/supabase/route";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      project_id?: string;
      customer_id?: string;
      subject?: string;
      description?: string;
      due_date?: string | null;
      assigned_user_id?: string | null;
      priority?: string | null;
      status?: string | null;
    };

    const projectId = typeof body.project_id === "string" ? body.project_id : "";
    const customerId =
      typeof body.customer_id === "string" ? body.customer_id : null;
    const subject =
      typeof body.subject === "string" ? body.subject.trim() : "";
    const description =
      typeof body.description === "string" ? body.description.trim() : null;
    const dueDate =
      typeof body.due_date === "string" ? body.due_date : body.due_date ?? null;
    const assignedUserId =
      typeof body.assigned_user_id === "string"
        ? body.assigned_user_id
        : body.assigned_user_id ?? null;
    const priority =
      typeof body.priority === "string" ? body.priority : body.priority ?? null;
    const status =
      typeof body.status === "string" ? body.status : body.status ?? null;

    if (
      !projectId ||
      !customerId ||
      !subject ||
      !dueDate ||
      !assignedUserId ||
      !priority ||
      !status
    ) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    const supabase = await createSupabaseRouteClient();

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError) {
      return NextResponse.json({ error: userError.message }, { status: 400 });
    }
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data, error } = await supabase
      .from("tasks")
      .insert({
        project_id: projectId,
        customer_id: customerId,
        assigned_user_id: assignedUserId,
        subject,
        description,
        due_date: dueDate,
        priority,
        status,
      })
      .select("*")
      .maybeSingle();

    if (error) {
      if (process.env.NODE_ENV !== "production") {
        const { data: profile, error: profileError } = await supabase
          .from("users")
          .select("id,email,role,active,system_access")
          .eq("id", user.id)
          .maybeSingle();

        let functionRole: unknown = null;
        let functionRoleError: string | null = null;
        try {
          const { data: roleData, error: roleError } = await supabase.rpc(
            "current_user_role"
          );
          if (roleError) functionRoleError = roleError.message;
          functionRole = roleData ?? null;
        } catch (e: any) {
          functionRoleError = e?.message ?? "rpc failed";
        }

        return NextResponse.json(
          {
            error: error.message,
            debug: {
              user_id: user.id,
              profile: profile ?? null,
              profile_error: profileError?.message ?? null,
              current_user_role: functionRole,
              current_user_role_error: functionRoleError,
            },
          },
          { status: 400 }
        );
      }

      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ task: data });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}
