import { expect, test } from "bun:test";
import {
  cleanName,
  cleanPhone,
  generateTempPassword,
  isUsernameAccount,
  normalizeUsername,
  usernameToEmail,
} from "./logic.ts";

test("שם משתמש: מנורמל לאותיות קטנות ונבדק", () => {
  expect(normalizeUsername("  Michal.L ")).toBe("michal.l");
  expect(normalizeUsername("ab")).toBeNull();
  expect(normalizeUsername("מיכל")).toBeNull();
  expect(normalizeUsername("a b c")).toBeNull();
  expect(normalizeUsername("x".repeat(31))).toBeNull();
  expect(normalizeUsername(42)).toBeNull();
});

test("כתובת פנימית מזוהה, אימייל רגיל לא", () => {
  expect(isUsernameAccount(usernameToEmail("dana"))).toBe(true);
  expect(isUsernameAccount("dana@gmail.com")).toBe(false);
  expect(isUsernameAccount("x@users.yoga.invalid.evil.com")).toBe(false);
  expect(isUsernameAccount(null)).toBe(false);
});

test("סיסמה זמנית: אורך נכון, בלי תווים מבלבלים, לא חוזרת", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 2000; i++) {
    const p = generateTempPassword();
    expect(p).toHaveLength(12);
    expect(p).not.toMatch(/[0O1lI]/);
    seen.add(p);
  }
  expect(seen.size).toBe(2000);
});

test("שם וטלפון", () => {
  expect(cleanName("  מיכל   לוי ")).toBe("מיכל לוי");
  expect(cleanName("א")).toBeNull();
  expect(cleanPhone("050-123 4567")).toBe("0501234567");
  expect(cleanPhone("+972501234567")).toBe("+972501234567");
  expect(cleanPhone("abc")).toBeNull();
  expect(cleanPhone("")).toBeNull();
});
