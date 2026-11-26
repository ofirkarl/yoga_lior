import type { Member } from "../lib/types";

/* ---------- פענוח שורות מודבקות (מאקסל, מגוגל שיטס או מהמחברת) ---------- */
export type Parsed = { ok: true; row: { full_name: string; email: string | null; phone: string | null; entries_left: number; valid_until: string } }
            | { ok: false; line: string; reason: string };

function parseDate(s: string): string | null {
  const t = s.trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = t.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/); // יום/חודש/שנה, כמו בישראל
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    const mm = Number(m[2]), dd = Number(m[1]);
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
    return `${y}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  }
  return null;
}

export function parseBalances(text: string): Parsed[] {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((line): Parsed => {
    const f = line.split(/\t|,|;/).map((x) => x.trim()).filter((x) => x !== "");
    if (f.length < 4) return { ok: false, line, reason: "צריך 4 עמודות: שם, אימייל או טלפון, כניסות, תוקף" };
    const [name, contact, entriesRaw, dateRaw] = f;
    const entries = Number(entriesRaw);
    const date = parseDate(dateRaw);
    if (name.length < 2) return { ok: false, line, reason: "חסר שם" };
    if (!Number.isInteger(entries) || entries < 1 || entries > 100) return { ok: false, line, reason: "מספר הכניסות לא תקין" };
    if (!date) return { ok: false, line, reason: "התאריך לא מובן. כותבים כמו 15/01/2027" };
    const isEmail = contact.includes("@");
    if (!isEmail && contact.replace(/\D/g, "").length < 9) return { ok: false, line, reason: "צריך אימייל או טלפון" };
    return { ok: true, row: { full_name: name, email: isEmail ? contact.toLowerCase() : null, phone: isEmail ? null : contact, entries_left: entries, valid_until: date } };
  });
}


/* ---------- גיבוי: קובץ CSV שנפתח באקסל ובגוגל שיטס ---------- */
export function membersCsv(members: Member[]): string {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    // מונע הרצת נוסחאות כשהקובץ נפתח באקסל
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const status: Record<string, string> = { active: "פעילה", pending: "ממתינה", blocked: "חסומה" };
  const rows = [["שם", "טלפון", "אימייל", "שם משתמש", "סטטוס", "כרטיסייה", "כניסות שנשארו", "מתוך", "בתוקף מ", "בתוקף עד", "מצב כרטיסייה"]];
  for (const m of members) {
    const cards = m.entitlements.length ? m.entitlements : [null];
    for (const c of cards)
      rows.push([m.full_name, m.phone ?? "", m.email ?? "", m.username ?? "", status[m.status] ?? m.status,
        c?.title ?? "", c?.entries_left ?? "", c?.entries_total ?? "", c?.valid_from ?? "", c?.valid_until ?? "", c?.status ?? ""].map(String));
  }
  return "﻿" + rows.map((r) => r.map(esc).join(",")).join("\r\n");
}

export function downloadCsv(name: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
