import { expect, test } from "bun:test";
import { membersCsv, parseBalances } from "./migrationLogic";

test("פענוח שורות מאקסל ומהמחברת", () => {
  const r = parseBalances("דנה כהן\tDana@Gmail.com\t3\t15/01/2027\nנועה, 052-765-4321, 6, 1.2.27\nיעל, 054, 2, 01/01/2027\nבלי תאריך, a@b.co, 2, מחר\n\n");
  expect(r).toHaveLength(4);
  expect(r[0]).toEqual({ ok: true, row: { full_name: "דנה כהן", email: "dana@gmail.com", phone: null, entries_left: 3, valid_until: "2027-01-15" } });
  expect(r[1]).toEqual({ ok: true, row: { full_name: "נועה", email: null, phone: "052-765-4321", entries_left: 6, valid_until: "2027-02-01" } });
  expect(r[2].ok).toBe(false);
  expect(r[3].ok).toBe(false);
});

test("גיבוי CSV: עברית, פסיקים ונוסחאות", () => {
  const csv = membersCsv([{
    id: "1", full_name: "כהן, דנה", phone: "=HYPERLINK(1)", email: null, username: null, role: "trainee", status: "active",
    must_change_password: false, created_at: "", entitlements: [],
  }]);
  expect(csv.startsWith("﻿")).toBe(true);
  expect(csv).toContain('"כהן, דנה"');
  expect(csv).toContain("'=HYPERLINK(1)");
});
