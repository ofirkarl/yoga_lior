// סיכום הכרטיסיות הפעילות לשורה אחת: כמה כניסות נשארו ועד מתי.
import type { Entitlement } from "./types";
import { dayKey } from "./format";

export interface Balance {
  /** null = ללא הגבלה; 0 = אין כרטיסייה פעילה */
  entries: number | null;
  /** התוקף הקרוב ביותר מבין הכרטיסיות הפעילות */
  validUntil: string | null;
  zoomOnly: boolean;
}

export function summarize(ents: Entitlement[]): Balance {
  const today = dayKey(new Date().toISOString());
  const active = ents.filter((e) => e.status === "active" && e.valid_until >= today && (e.entries_left === null || e.entries_left > 0));
  if (!active.length) return { entries: 0, validUntil: null, zoomOnly: false };
  const studio = active.filter((e) => e.mode === "studio");
  const pool = studio.length ? studio : active;
  const entries = pool.some((e) => e.entries_left === null) ? null : pool.reduce((n, e) => n + (e.entries_left ?? 0), 0);
  const validUntil = pool.map((e) => e.valid_until).sort()[0];
  return { entries, validUntil, zoomOnly: !studio.length };
}

export function balanceText(b: Balance): string {
  if (b.entries === null) return "ללא הגבלת כניסות";
  if (b.entries === 0) return "אין כניסות בכרטיסייה";
  const n = b.entries === 1 ? "כניסה אחת" : `${b.entries} כניסות`;
  return b.zoomOnly ? `${n} לזום` : n;
}
