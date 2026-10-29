// Deploy as USER_DEPLOYING, access MYSELF. Never deploy this app publicly.
const SHEET_NAME = 'data';
const HEADER = ['date','weight_kg','bodyfat_pct','bmi','fitness_score','fatmass_kg','muscle_kg','skeletal_muscle_kg','visceral_fat_level'];
const MAX_ROWS = 10000;

// Run once from the editor as the spreadsheet owner, before deploying.
function configureOwner_() {
  const properties = PropertiesService.getScriptProperties();
  if (properties.getProperty('OWNER_EMAIL')) throw new Error('所有者は既に設定済みです。');
  const email = Session.getActiveUser().getEmail().toLowerCase();
  if (!email) throw new Error('所有者を確認できません。');
  properties.setProperty('OWNER_EMAIL', email);
}

function requireOwner_() {
  // An absent active identity must never fall back to the executing account.
  const active = Session.getActiveUser().getEmail().toLowerCase();
  const effective = Session.getEffectiveUser().getEmail().toLowerCase();
  const owner = PropertiesService.getScriptProperties().getProperty('OWNER_EMAIL');
  if (!owner || active !== owner || effective !== owner) throw new Error('アクセスできません。所有者のGoogleアカウントで開いてください。');
}

function doGet() {
  requireOwner_();
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('ProgressFit')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

// The former token/JSONP API is intentionally disabled, including all POSTs.
function doPost() {
  return ContentService.createTextOutput('This API has been retired. Open the private web app.');
}

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('スプレッドシートに紐づくプロジェクトで実行してください。');
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error('dataシートが見つかりません。');
  const header = sheet.getRange(1, 1, 1, HEADER.length).getValues()[0];
  if (!HEADER.every((key, i) => key === header[i])) throw new Error('シートのヘッダが一致しません。変更せず中止しました。');
  return sheet;
}

function date_(value) {
  const s = value instanceof Date ? Utilities.formatDate(value, 'Asia/Tokyo', 'yyyy-MM-dd') : String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error('日付はYYYY-MM-DD形式にしてください。');
  const date = new Date(s + 'T00:00:00Z');
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== s) throw new Error('日付が不正です。');
  return s;
}

function number_(value, key) {
  if (value === '' || value == null) return '';
  if (typeof value !== 'number' && typeof value !== 'string') throw new Error('数値が不正です。');
  const s = String(value).trim();
  if (!/^\d+(?:\.\d+)?$/.test(s)) throw new Error('数値が不正です。');
  const n = Number(s);
  if (!Number.isFinite(n) || n > 10000 || (key === 'bodyfat_pct' && n > 100)) throw new Error('数値の範囲が不正です。');
  return n;
}

function record_(row) {
  if (!Array.isArray(row) || row.length !== HEADER.length) throw new Error('列数が不正です。');
  return row.map((v, i) => i === 0 ? date_(v) : number_(v, HEADER[i]));
}

function read_(sheet) {
  const count = sheet.getLastRow() - 1;
  if (count <= 0) return [];
  if (count > MAX_ROWS) throw new Error('データ件数が上限を超えています。');
  return sheet.getRange(2, 1, count, HEADER.length).getValues()
    .filter(row => row.some(v => v !== '' && v != null))
    .map(row => { row[0] = date_(row[0]); return row; });
}

function withLock_(fn) {
  requireOwner_();
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try { return fn(sheet_()); } finally { lock.releaseLock(); }
}

function getRecords() {
  return withLock_(sheet => ({ok:true, header:HEADER, rows:read_(sheet).sort((a,b)=>a[0].localeCompare(b[0]))}));
}

function saveRecord(input) {
  return withLock_(sheet => {
    if (!input || typeof input !== 'object') throw new Error('入力が不正です。');
    const row = record_(HEADER.map(key => input[key] ?? ''));
    for (const key of ['weight_kg','bodyfat_pct','fatmass_kg','skeletal_muscle_kg','bmi']) {
      if (row[HEADER.indexOf(key)] === '') throw new Error('必須項目が不足しています。');
    }
    const oldDate = input.originalDate ? date_(input.originalDate) : row[0];
    const rows = read_(sheet);
    const oldIndex = rows.findIndex(r=>r[0] === oldDate);
    const newIndex = rows.findIndex(r=>r[0] === row[0]);
    if (oldDate !== row[0] && oldIndex < 0) throw new Error('更新元が見つかりません。再読み込みしてください。');
    if (oldDate !== row[0] && newIndex >= 0) throw new Error('変更先の日付には既に記録があります。');
    // Locate the actual sheet row even when blank rows exist.
    const dates = sheet.getLastRow() > 1 ? sheet.getRange(2,1,sheet.getLastRow()-1,1).getValues() : [];
    const index = dates.findIndex(r=>r[0] !== '' && date_(r[0]) === oldDate);
    if (index < 0 && rows.length >= MAX_ROWS) throw new Error('データ件数が上限です。');
    const target = index < 0 ? sheet.getLastRow()+1 : index+2;
    sheet.getRange(target,1).setNumberFormat('@');
    sheet.getRange(target,1,1,HEADER.length).setValues([row]);
    SpreadsheetApp.flush();
    return {ok:true};
  });
}

function deleteRecord(value) {
  return withLock_(sheet => {
    const date = date_(value);
    if (sheet.getLastRow() > 1) {
      const dates = sheet.getRange(2,1,sheet.getLastRow()-1,1).getValues();
      const i = dates.findIndex(r=>r[0] !== '' && date_(r[0]) === date);
      if (i >= 0) sheet.deleteRow(i+2);
    }
    SpreadsheetApp.flush();
    return {ok:true};
  });
}

function importRecords(csv) {
  return withLock_(sheet => {
    if (typeof csv !== 'string' || csv.length > 2*1024*1024) throw new Error('CSVは2MB以下にしてください。');
    const parsed = Utilities.parseCsv(csv.replace(/^\uFEFF/,'').trim());
    const header = parsed.shift();
    if (!header || header.length !== HEADER.length || !HEADER.every((key,i)=>key === header[i])) throw new Error('CSVヘッダが不正です。');
    if (!parsed.length || parsed.length > MAX_ROWS) throw new Error('CSVは1〜10000件にしてください。');
    const records = parsed.map(record_);
    if (new Set(records.map(row=>row[0])).size !== records.length) throw new Error('日付が重複しています。');
    // Validate before touching data, and retain a recoverable copy in this spreadsheet.
    const backup = sheet.copyTo(sheet.getParent());
    backup.setName('backup_' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd_HHmmss') + '_' + Utilities.getUuid().slice(0,8));
    const count = Math.max(sheet.getLastRow(), records.length+1);
    if (sheet.getMaxRows() < count) sheet.insertRowsAfter(sheet.getMaxRows(), count-sheet.getMaxRows());
    const values = [HEADER, ...records];
    while (values.length < count) values.push(HEADER.map(()=>''));
    sheet.getRange(2,1,count-1,1).setNumberFormat('@');
    sheet.getRange(1,1,count,HEADER.length).setValues(values);
    SpreadsheetApp.flush();
    return {ok:true, count:records.length};
  });
}
