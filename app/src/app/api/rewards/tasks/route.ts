import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { isAdminRequest } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET — list tasks. Admins see all; everyone else sees active only.
export async function GET(req: Request) {
  try {
    const isAdmin = await isAdminRequest(req).catch(() => false);
    const supa = supabaseServer();
    const q = supa
      .from("reward_tasks")
      .select("id,title,description,points,task_type,url,active,created_at,updated_at")
      .order("created_at", { ascending: false });
    const { data, error } = isAdmin ? await q : await q.eq("active", true);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ tasks: data || [] });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}

// POST — create. Admin only.
export async function POST(req: Request) {
  try {
    if (!(await isAdminRequest(req))) {
      return NextResponse.json({ error: "Not allowed" }, { status: 403 });
    }
    const body = await req.json().catch(() => ({}));
    const title = String(body?.title || "").trim();
    const description = body?.description ? String(body.description) : null;
    const points = Number(body?.points);
    const taskType = String(body?.taskType || body?.task_type || "social").trim();
    const url = body?.url ? String(body.url).trim() : null;
    const active = body?.active === undefined ? true : !!body.active;

    if (!title) return NextResponse.json({ error: "Missing title" }, { status: 400 });
    if (!Number.isFinite(points) || points < 0) {
      return NextResponse.json({ error: "Invalid points" }, { status: 400 });
    }

    const supa = supabaseServer();
    const { data, error } = await supa
      .from("reward_tasks")
      .insert({ title, description, points, task_type: taskType, url, active })
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ task: data });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}

// PATCH — update. Admin only.
export async function PATCH(req: Request) {
  try {
    if (!(await isAdminRequest(req))) {
      return NextResponse.json({ error: "Not allowed" }, { status: 403 });
    }
    const body = await req.json().catch(() => ({}));
    const id = String(body?.id || "").trim();
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    const patch: Record<string, any> = { updated_at: new Date().toISOString() };
    if ("title" in body)       patch.title       = String(body.title);
    if ("description" in body) patch.description = body.description == null ? null : String(body.description);
    if ("points" in body) {
      const p = Number(body.points);
      if (!Number.isFinite(p) || p < 0) {
        return NextResponse.json({ error: "Invalid points" }, { status: 400 });
      }
      patch.points = p;
    }
    if ("taskType" in body)   patch.task_type = String(body.taskType);
    if ("task_type" in body)  patch.task_type = String(body.task_type);
    if ("url" in body)        patch.url       = body.url == null ? null : String(body.url);
    if ("active" in body)     patch.active    = !!body.active;

    const supa = supabaseServer();
    const { data, error } = await supa
      .from("reward_tasks")
      .update(patch)
      .eq("id", id)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ task: data });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}

// DELETE — remove. Admin only.
export async function DELETE(req: Request) {
  try {
    if (!(await isAdminRequest(req))) {
      return NextResponse.json({ error: "Not allowed" }, { status: 403 });
    }
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
    const supa = supabaseServer();
    const { error } = await supa.from("reward_tasks").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
