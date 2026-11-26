-- נתוני פתיחה: המחירון והמערכת השבועית כפי שליאור מסרה בשאלון

insert into products (name, kind, mode, price_ils, entries, validity_days, once_per_user, sort_order) values
  ('שיעור ניסיון',               'trial',  'studio',  60,  1,   7, true,  10),
  ('שיעור בודד',                 'single', 'studio',  90,  1,   7, false, 20),
  ('כרטיסייה 5 כניסות – 6 שבועות',  'punch',  'studio', 375,  5,  42, false, 30),
  ('כרטיסייה 5 כניסות – 12 שבועות', 'punch',  'studio', 425,  5,  84, false, 40),
  ('כרטיסייה 10 כניסות – 6 שבועות', 'punch',  'studio', 650, 10,  42, false, 50),
  ('כרטיסייה 10 כניסות – 12 שבועות','punch',  'studio', 700, 10,  84, false, 60),
  ('שיעור זום בודד',             'single', 'zoom',    40,  1,   7, false, 70),
  ('כרטיסיית זום 4 כניסות',      'punch',  'zoom',   140,  4,  60, false, 80);

-- weekday: 0 = ראשון ... 5 = שישי
insert into class_templates (title, weekday, start_time) values
  ('רמה 1',      0, '18:30'),
  ('מתחילים',    1, '09:30'),
  ('רמה 2',      2, '18:30'),
  ('תרגול רך',   4, '07:30'),
  ('רמה 1',      4, '09:00'),
  ('כל הרמות',   5, '09:30');
