// Edge Function: מחזירה גיבוי מלא של נתוני הסטודיו כקובץ JSON.
// נקראת פעם בשבוע מסקריפט Apps Script שרץ בחשבון הגוגל של ליאור ושומר את הקובץ בדרייב שלה.
//
// אימות: הכותרת x-backup-token חייבת להתאים למפתח ששמור ב-Vault.
// ליאור יכולה להחליף את המפתח מהאפליקציה, ואז סקריפט ישן מפסיק לעבוד מיד.
// verify_jwt כבוי כי הסקריפט לא מחובר כמשתמשת.

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// כל הטבלאות שמחזיקות מידע של הסטודיו. סודות (Vault) ומנויי התראות לא נכללים.
const TABLES = [
  "settings", "profiles", "health_declarations", "products", "payments", "entitlements",
  "class_templates", "class_sessions", "session_private", "bookings", "imported_balances",
  "admin_allowlist", "audit_log",
] as const;
const PAGE = 1000;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { data: token } = await admin.rpc("get_backup_token");
  const given = req.headers.get("x-backup-token") ?? "";
  if (!token || !safeEqual(given, String(token))) {
    await admin.from("audit_log").insert({ action: "backup_denied", details: { ip: req.headers.get("x-forwarded-for") ?? null } });
    return json(401, { error: "bad_token" });
  }

  const tables: Record<string, unknown[]> = {};
  const counts: Record<string, number> = {};
  for (const t of TABLES) {
    const rows: unknown[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await admin.from(t).select("*").range(from, from + PAGE - 1);
      if (error) return json(500, { error: "export_failed", table: t });
      rows.push(...(data ?? []));
      if (!data || data.length < PAGE) break;
    }
    tables[t] = rows;
    counts[t] = rows.length;
  }

  await admin.from("audit_log").insert({ action: "backup_export", details: { counts } });

  return json(200, {
    app: "יוגה עם ליאור",
    format: 1,
    created_at: new Date().toISOString(),
    counts,
    tables,
  });
});
