// הקוד שליאור מדביקה ב-Google Apps Script. רץ בחשבון שלה ושומר גיבוי שבועי בדרייב שלה.

export const BACKUP_URL = "https://bkfccrwkhookobbvrabo.supabase.co/functions/v1/backup-export";

export function backupScript(token: string): string {
  return `// גיבוי שבועי · יוגה עם ליאור
// רץ פעם בשבוע ושומר קובץ גיבוי בתיקייה "גיבויים · יוגה עם ליאור" בדרייב.
// להפעלה: לבחור למעלה את הפונקציה setup וללחוץ "הפעלה" (Run). פעם אחת בלבד.

const BACKUP_URL = '${BACKUP_URL}';
const BACKUP_TOKEN = '${token}'; // סודי. לא לשתף את הקוד הזה.
const FOLDER_NAME = 'גיבויים · יוגה עם ליאור';
const KEEP = 26; // כמה גיבויים לשמור (חצי שנה). הישנים עוברים לפח.

function backup() {
  const res = UrlFetchApp.fetch(BACKUP_URL, {
    method: 'post',
    headers: { 'x-backup-token': BACKUP_TOKEN },
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) {
    throw new Error('הגיבוי נכשל (' + res.getResponseCode() + '). אם החלפת מפתח באפליקציה, צריך להדביק את הקוד החדש.');
  }
  const folder = getFolder_();
  const day = Utilities.formatDate(new Date(), 'Asia/Jerusalem', 'yyyy-MM-dd');
  folder.createFile('גיבוי ' + day + '.json', res.getContentText('UTF-8'), 'application/json');
  prune_(folder);
}

function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('backup').timeBased().onWeekDay(ScriptApp.WeekDay.SATURDAY).atHour(22).create();
  backup();
}

function getFolder_() {
  const it = DriveApp.getFoldersByName(FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(FOLDER_NAME);
}

function prune_(folder) {
  const files = [];
  const it = folder.getFiles();
  while (it.hasNext()) files.push(it.next());
  files.sort(function (a, b) { return b.getDateCreated() - a.getDateCreated(); });
  files.slice(KEEP).forEach(function (f) { f.setTrashed(true); });
}
`;
}
