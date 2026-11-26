// Edge Function: שולחת התראות Push למנהלות הסטודיו.
//
// שתי דרכים לקרוא לה:
//   1. מהטריגר בבסיס הנתונים (pg_net), עם הכותרת x-notify-secret.
//      { "event": "new_signup", "user_id": "<uuid>" }
//   2. מהאפליקציה, כמנהלת מחוברת, כדי לבדוק שההתראות מגיעות למכשיר שלה:
//      { "event": "test" }  → נשלחת התראה רק למכשירים של מי שביקשה.
//
// verify_jwt כבוי כי הטריגר לא שולח JWT. כל קריאה מאומתת כאן: או בסוד, או בטוקן של מנהלת.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { sendPush, type Vapid } from "./webpush.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APP_ORIGIN = Deno.env.get("APP_ORIGIN") ?? "https://yoga-lior.vercel.app";

const cors = {
  "Access-Control-Allow-Origin": APP_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

interface Sub { id: string; user_id: string; endpoint: string; p256dh: string; auth: string }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return reply(405, { error: "method_not_allowed" });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return reply(400, { error: "bad_json" });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { data: cfg, error: cfgErr } = await admin.rpc("get_push_config");
  if (cfgErr || !cfg?.vapid || !cfg?.notify_secret) return reply(500, { error: "not_configured" });
  const vapid = cfg.vapid as Vapid;

  // מי קורא?
  const secret = req.headers.get("x-notify-secret");
  let targetUsers: string[];
  let payload: { title: string; body: string; url: string; tag: string };

  if (secret !== null) {
    if (!safeEqual(secret, String(cfg.notify_secret))) return reply(401, { error: "bad_secret" });
    if (body.event !== "new_signup" || typeof body.user_id !== "string") return reply(400, { error: "unknown_event" });

    const { data: p } = await admin.from("profiles").select("full_name, email, status").eq("id", body.user_id).maybeSingle();
    if (!p || p.status !== "pending") return reply(200, { sent: 0, skipped: "not_pending" });
    const who = (p.full_name || "").trim() || p.email || "מישהי חדשה";
    payload = {
      title: "בקשת הצטרפות חדשה",
      body: `${who} נרשמה לאפליקציה וממתינה לאישור שלך`,
      url: "/?tab=members",
      tag: `signup-${body.user_id}`,
    };
    const { data: admins } = await admin.from("profiles").select("id").eq("role", "admin").eq("status", "active");
    targetUsers = (admins ?? []).map((a) => a.id);
  } else {
    const auth = req.headers.get("Authorization");
    if (!auth?.startsWith("Bearer ")) return reply(401, { error: "not_signed_in" });
    const asCaller = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: auth } },
      auth: { persistSession: false },
    });
    const { data: who } = await asCaller.auth.getUser();
    if (!who?.user) return reply(401, { error: "not_signed_in" });
    const { data: isAdmin } = await asCaller.rpc("is_admin");
    if (isAdmin !== true) return reply(403, { error: "admin_only" });
    if (body.event !== "test") return reply(400, { error: "unknown_event" });
    payload = {
      title: "ההתראות פועלות",
      body: "מעכשיו תקבלי כאן הודעה על כל הרשמה חדשה.",
      url: "/",
      tag: "test",
    };
    targetUsers = [who.user.id];
  }

  if (targetUsers.length === 0) return reply(200, { sent: 0 });
  const { data: subs } = await admin
    .from("push_subscriptions")
    .select("id, user_id, endpoint, p256dh, auth")
    .in("user_id", targetUsers);
  if (!subs?.length) return reply(200, { sent: 0, devices: 0 });

  const results = await Promise.allSettled((subs as Sub[]).map((s) => sendPush(s, payload, vapid)));
  const gone: string[] = [];
  const ok: string[] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled" && r.value.gone) gone.push(subs[i].id);
    else if (r.status === "fulfilled" && r.value.status < 300) ok.push(subs[i].id);
    else console.error("push failed", r.status === "fulfilled" ? r.value.status : String(r.reason));
  });
  if (gone.length) await admin.from("push_subscriptions").delete().in("id", gone);
  if (ok.length) await admin.from("push_subscriptions").update({ last_used_at: new Date().toISOString() }).in("id", ok);

  return reply(200, { sent: ok.length, removed: gone.length, devices: subs.length });
});
