// Edge Function: ליאור יוצרת משתמשת עם שם משתמש וסיסמה זמנית, או מאפסת סיסמה.
//
// אבטחה:
//   * רק מנהלת פעילה יכולה לקרוא לפונקציה. הבדיקה נעשית מול בסיס הנתונים עם
//     הטוקן של מי שקראה, לא לפי מה שהדפדפן מצהיר.
//   * מפתח service_role נמצא רק כאן, במשתני הסביבה של Supabase.
//   * הסיסמה הזמנית מוחזרת פעם אחת בלבד ולא נשמרת בשום מקום.
//   * המשתמשת חייבת להחליף אותה בכניסה הראשונה.
//
// פעולות (POST, JSON):
//   { "action": "create", "username": "michal.l", "full_name": "מיכל לוי", "phone": "0501234567" }
//   { "action": "reset_password", "user_id": "<uuid>" }

import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  cleanName,
  cleanPhone,
  generateTempPassword,
  isUsernameAccount,
  normalizeUsername,
  usernameToEmail,
} from "./logic.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// כתובת האפליקציה. בקשות מכל מקור אחר נדחות.
const APP_ORIGIN = Deno.env.get("APP_ORIGIN") ?? "https://yoga-lior.vercel.app";

function cors(origin: string | null): HeadersInit {
  return {
    "Access-Control-Allow-Origin": origin && origin === APP_ORIGIN ? origin : APP_ORIGIN,
    "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function reply(origin: string | null, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(origin), "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response(null, { headers: cors(origin) });
  if (req.method !== "POST") return reply(origin, 405, { error: "method_not_allowed" });
  if (APP_ORIGIN && origin && origin !== APP_ORIGIN) return reply(origin, 403, { error: "bad_origin" });

  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return reply(origin, 401, { error: "not_signed_in" });

  // בדיקת הרשאה עם הטוקן של המבקשת
  const asCaller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
  const { data: who } = await asCaller.auth.getUser();
  if (!who?.user) return reply(origin, 401, { error: "not_signed_in" });
  const { data: isAdmin, error: adminErr } = await asCaller.rpc("is_admin");
  if (adminErr || isAdmin !== true) return reply(origin, 403, { error: "admin_only" });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return reply(origin, 400, { error: "bad_json" });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const log = (action: string, target: string, details: Record<string, unknown>) =>
    admin.from("audit_log").insert({ actor: who.user!.id, action, target_id: target, details });

  if (body.action === "create") {
    const username = normalizeUsername(body.username);
    const fullName = cleanName(body.full_name);
    const phone = cleanPhone(body.phone);
    if (!username) return reply(origin, 400, { error: "bad_username" });
    if (!fullName) return reply(origin, 400, { error: "bad_name" });
    if (body.phone && !phone) return reply(origin, 400, { error: "bad_phone" });

    const { data: taken } = await admin.from("profiles").select("id").eq("username", username).maybeSingle();
    if (taken) return reply(origin, 409, { error: "username_taken" });

    const password = generateTempPassword();
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: usernameToEmail(username),
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (createErr || !created.user) {
      const exists = createErr?.message?.toLowerCase().includes("already");
      return reply(origin, exists ? 409 : 500, { error: exists ? "username_taken" : "create_failed" });
    }

    // הפרופיל נוצר בטריגר. משתמשת שליאור יוצרת מאושרת מיד, אבל חייבת להחליף סיסמה.
    const { error: profErr } = await admin.from("profiles").update({
      username,
      full_name: fullName,
      phone,
      status: "active",
      approved_at: new Date().toISOString(),
      must_change_password: true,
    }).eq("id", created.user.id);
    if (profErr) {
      await admin.auth.admin.deleteUser(created.user.id);
      return reply(origin, 500, { error: "create_failed" });
    }

    await log("create_username_user", created.user.id, { username });
    return reply(origin, 200, { user_id: created.user.id, username, temp_password: password });
  }

  if (body.action === "reset_password") {
    const userId = typeof body.user_id === "string" ? body.user_id : "";
    const { data: target } = await admin.auth.admin.getUserById(userId);
    if (!target?.user) return reply(origin, 404, { error: "user_not_found" });
    // משתמשות גוגל מאפסות דרך גוגל. כאן רק חשבונות שם-משתמש.
    if (!isUsernameAccount(target.user.email)) return reply(origin, 400, { error: "not_username_account" });

    const password = generateTempPassword();
    const { error: updErr } = await admin.auth.admin.updateUserById(userId, { password });
    if (updErr) return reply(origin, 500, { error: "reset_failed" });
    await admin.from("profiles").update({ must_change_password: true }).eq("id", userId);
    // ניתוק מכל המכשירים, כדי שסיסמה ישנה שדלפה לא תמשיך לעבוד
    await admin.auth.admin.signOut(userId, "global").catch(() => {});

    await log("reset_password", userId, {});
    return reply(origin, 200, { user_id: userId, temp_password: password });
  }

  return reply(origin, 400, { error: "unknown_action" });
});
