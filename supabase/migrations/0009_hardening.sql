-- הקשחה לפי בדיקת האבטחה של Supabase: נתיב חיפוש קבוע לפונקציה שחסר לה
alter function norm_phone(text) set search_path = public;
