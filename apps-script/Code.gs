// Execute as the owner; access ANYONE_ANONYMOUS only after PF_PASSWORD is configured.
const SHEET_NAME = 'data';
const HEADER = ['date','weight_kg','bodyfat_pct','bmi','fitness_score','fatmass_kg','muscle_kg','skeletal_muscle_kg','visceral_fat_level'];
const MAX_ROWS = 10000;

// Set PF_PASSWORD in Script Properties, never in source or the browser.
const SESSION_MS = 160 * 24 * 60 * 60 * 1000;
function hash_(value) {
  return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8));
}
function equal_(a,b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff=0; for(let i=0;i<a.length;i++) diff |= a.charCodeAt(i)^b.charCodeAt(i);
  return diff === 0;
}
function password_() {
  const password=PropertiesService.getScriptProperties().getProperty('PF_PASSWORD');
  if (!password || password.length < 4 || password.length > 256) throw new Error('パスワードが未設定です。4〜256文字で設定してください。');
  return password;
}
function sessions_() {
  const p=PropertiesService.getScriptProperties();
  const version=hash_(password_());
  return JSON.parse(p.getProperty('PF_SESSIONS') || '[]').filter(s=>s.expires>Date.now() && s.version===version);
}
function login(password,remember) {
  const lock=LockService.getScriptLock(); lock.waitLock(15000);
  try {
    const p=PropertiesService.getScriptProperties();
    const configured=password_();
    const now=Date.now();
    let attempts=JSON.parse(p.getProperty('PF_ATTEMPTS') || '{"count":0,"until":0}');
    if(now>=attempts.until) attempts={count:0,until:now+15*60*1000};
    if(attempts.count>=5) throw new Error('試行回数が多いため、15分ほど待ってください。');
    if(typeof password!=='string' || password.length>256 || !equal_(hash_(password),hash_(configured))) {
      attempts.count++; p.setProperty('PF_ATTEMPTS',JSON.stringify(attempts));
      throw new Error('パスワードが違います。');
    }
    p.deleteProperty('PF_ATTEMPTS');
    const token=Utilities.getUuid()+Utilities.getUuid();
    const expires=now+(remember===true ? SESSION_MS : 12*60*60*1000);
    const sessions=sessions_().slice(-9);
    sessions.push({hash:hash_(token),expires,version:hash_(configured)});
    p.setProperty('PF_SESSIONS',JSON.stringify(sessions));
    return {ok:true,token,expires};
  } finally { lock.releaseLock(); }
}
function requireSession_(token) {
  if(typeof token!=='string' || token.length!==72 || !sessions_().some(s=>equal_(s.hash,hash_(token))))
    throw new Error('AUTH_REQUIRED: パスワードを入力してください。');
}
function logout(token) {
  const lock=LockService.getScriptLock(); lock.waitLock(15000);
  try {
    requireSession_(token);
    PropertiesService.getScriptProperties().setProperty('PF_SESSIONS',JSON.stringify(sessions_().filter(s=>!equal_(s.hash,hash_(token)))));
    return {ok:true};
  } finally {lock.releaseLock();}
}

function doGet() {
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

function withLock_(token, fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try { requireSession_(token); return fn(sheet_()); } finally { lock.releaseLock(); }
}

function getRecords(token) {
  return withLock_(token, sheet => ({ok:true, header:HEADER, rows:read_(sheet).sort((a,b)=>a[0].localeCompare(b[0]))}));
}

function saveRecord(token, input) {
  return withLock_(token, sheet => {
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
    if (index >= 0) backup_(sheet);
    const target = index < 0 ? sheet.getLastRow()+1 : index+2;
    sheet.getRange(target,1).setNumberFormat('@');
    sheet.getRange(target,1,1,HEADER.length).setValues([row]);
    SpreadsheetApp.flush();
    return {ok:true};
  });
}

function deleteRecord(token, value) {
  return withLock_(token, sheet => {
    const date = date_(value);
    if (sheet.getLastRow() > 1) {
      const dates = sheet.getRange(2,1,sheet.getLastRow()-1,1).getValues();
      const i = dates.findIndex(r=>r[0] !== '' && date_(r[0]) === date);
      if (i >= 0) { backup_(sheet); sheet.deleteRow(i+2); }
    }
    SpreadsheetApp.flush();
    return {ok:true};
  });
}

function importRecords(token, csv) {
  return withLock_(token, sheet => {
    if (typeof csv !== 'string' || csv.length > 2*1024*1024) throw new Error('CSVは2MB以下にしてください。');
    const parsed = Utilities.parseCsv(csv.replace(/^\uFEFF/,'').trim());
    const header = parsed.shift();
    if (!header || header.length !== HEADER.length || !HEADER.every((key,i)=>key === header[i])) throw new Error('CSVヘッダが不正です。');
    if (!parsed.length || parsed.length > MAX_ROWS) throw new Error('CSVは1〜10000件にしてください。');
    const records = parsed.map(record_);
    if (new Set(records.map(row=>row[0])).size !== records.length) throw new Error('日付が重複しています。');
    // Validate before touching data, and retain a recoverable copy in this spreadsheet.
    backup_(sheet);
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

function backup_(sheet) {
  const backup=sheet.copyTo(sheet.getParent());
  backup.setName('backup_'+Utilities.formatDate(new Date(),'Asia/Tokyo','yyyyMMdd_HHmmss')+'_'+Utilities.getUuid().slice(0,8));
}
