const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require('node:path').join(__dirname,'../apps-script/Code.gs'),'utf8');
const header = ['date','weight_kg','bodyfat_pct','bmi','fitness_score','fatmass_kg','muscle_kg','skeletal_muscle_kg','visceral_fat_level'];
function setup() {
  const properties = {PF_PASSWORD:'0123'}; // Test-only PIN; not a production credential.
  const crypto=require('node:crypto');
  let values = [header.slice(), ['2026-10-01',75,20,24,'',15,50,30,8]];
  let writes = 0, backups = 0;
  const sheet = {
    getLastRow:()=>values.length, getMaxRows:()=>1000, getParent:()=>({}),
    getRange:(r,c,n=1,m=1)=>({
      getValues:()=>Array.from({length:n},(_,i)=>Array.from({length:m},(_,j)=>values[r+i-1]?.[c+j-1] ?? '')),
      setNumberFormat:()=>{},
      setValues:rows=>{ writes++; rows.forEach((row,i)=>{values[r+i-1] ??= []; row.forEach((v,j)=>values[r+i-1][c+j-1]=v);}); }
    }),
    deleteRow:r=>{writes++; values.splice(r-1,1);},
    copyTo:()=>{backups++; return {setName:()=>{}};}
  };
  const context = vm.createContext({
    PropertiesService:{getScriptProperties:()=>({getProperty:k=>properties[k] || null,setProperty:(k,v)=>{properties[k]=v;},deleteProperty:k=>{delete properties[k];}})},
    SpreadsheetApp:{getActiveSpreadsheet:()=>({getSheetByName:()=>sheet}), flush:()=>{}},
    LockService:{getScriptLock:()=>({waitLock:()=>{},releaseLock:()=>{}})},
    Utilities:{parseCsv:s=>s.split('\n').map(x=>x.split(',')),formatDate:()=> '20261029_200000',getUuid:()=>crypto.randomUUID(),DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},computeDigest:(_,s)=>crypto.createHash('sha256').update(s).digest(),base64EncodeWebSafe:b=>Buffer.from(b).toString('base64url')},
    ContentService:{createTextOutput:s=>s}
  });
  vm.runInContext(source,context);
  const token=context.login(properties.PF_PASSWORD,true).token;
  return {context, token, properties, values:()=>values, writes:()=>writes, backups:()=>backups};
}
const record = {date:'2026-10-02', originalDate:'2026-10-01',weight_kg:74,bodyfat_pct:20,bmi:24,fatmass_kg:15,skeletal_muscle_kg:30};
test('every data method rejects missing, forged, expired and password-revoked sessions before writes',()=>{
  for(const kind of ['missing','forged','expired','changed']) {
    const s=setup(); let token=s.token;
    if(kind==='missing') token=undefined;
    if(kind==='forged') token='x'.repeat(72);
    if(kind==='expired') {const sessions=JSON.parse(s.properties.PF_SESSIONS);sessions[0].expires=0;s.properties.PF_SESSIONS=JSON.stringify(sessions);}
    if(kind==='changed') s.properties.PF_PASSWORD='a-new-password-123';
    for(const fn of [()=>s.context.getRecords(token),()=>s.context.saveRecord(token,record),()=>s.context.deleteRecord(token,'2026-10-01'),()=>s.context.importRecords(token,'x')]) assert.throws(fn,/AUTH_REQUIRED/);
    assert.equal(s.writes(),0); assert.equal(s.backups(),0);
  }
});
test('password failures are limited, sessions expire, and logout revokes access',()=>{
  const s=setup();
  for(let i=0;i<5;i++) assert.throws(()=>s.context.login('wrong',true),/違います/);
  assert.throws(()=>s.context.login(s.properties.PF_PASSWORD,true),/15分/);
  delete s.properties.PF_ATTEMPTS;
  const before=Date.now(), session=s.context.login(s.properties.PF_PASSWORD,false);
  assert.ok(session.expires>=before+12*60*60*1000 && session.expires<=Date.now()+12*60*60*1000);
  s.context.logout(session.token);assert.throws(()=>s.context.getRecords(session.token),/AUTH_REQUIRED/);
  delete s.properties.PF_PASSWORD;assert.throws(()=>s.context.login('anything',true),/未設定/);
});
test('four-digit PIN preserves leading zero and remembered login lasts exactly 160 days',()=>{
  const s=setup();
  assert.throws(()=>s.context.login('123',true),/違います/);
  const before=Date.now();
  const session=s.context.login('0123',true);
  const duration=160*24*60*60*1000;
  assert.ok(session.expires>=before+duration && session.expires<=Date.now()+duration);
  const sessions=JSON.parse(s.properties.PF_SESSIONS);
  sessions[sessions.length-1].expires=Date.now()-1;
  s.properties.PF_SESSIONS=JSON.stringify(sessions);
  assert.throws(()=>s.context.getRecords(session.token),/AUTH_REQUIRED/);
});
test('deletion and overwrite back up data before mutation; backup failure prevents writes',()=>{
  const s=setup();s.context.deleteRecord(s.token,'2026-10-01');assert.equal(s.backups(),1);assert.equal(s.values().length,1);
  const t=setup();t.context.saveRecord(t.token,record);assert.equal(t.backups(),1);
  const u=setup();u.context.backup_=()=>{throw new Error('backup unavailable');};
  assert.throws(()=>u.context.deleteRecord(u.token,'2026-10-01'),/backup unavailable/);assert.equal(u.writes(),0);
});
test('changing a date updates the existing row with one data write',()=>{
  const s=setup(); s.context.saveRecord(s.token,record);
  assert.equal(s.values().length,2); assert.equal(s.values()[1][0],'2026-10-02'); assert.equal(s.writes(),1);
});
test('invalid numbers, formulas, impossible dates and date collisions cannot write',()=>{
  for(const change of [{weight_kg:'=IMPORTXML("https://example.test","x")'},{bodyfat_pct:101},{date:'2026-02-30'},{weight_kg:Infinity}]){
    const s=setup(); assert.throws(()=>s.context.saveRecord(s.token,{...record,...change})); assert.equal(s.writes(),0);
  }
  const s=setup(); s.values().push(['2026-10-02',74,20,24,'',15,50,30,8]);
  assert.throws(()=>s.context.saveRecord(s.token,record),/既に記録/); assert.equal(s.writes(),0);
});
test('invalid imports preserve data; valid import makes a backup before replacement',()=>{
  for(const row of ['2026-10-02,=1+1,20,24,,15,50,30,8','2026-02-30,75,20,24,,15,50,30,8']) {
    const s=setup(); assert.throws(()=>s.context.importRecords(s.token,header.join(',')+'\n'+row)); assert.equal(s.writes(),0); assert.equal(s.backups(),0);
  }
  const s=setup(); s.context.importRecords(s.token,header.join(',')+'\n2026-10-02,74,20,24,,15,50,30,8');
  assert.equal(s.backups(),1); assert.equal(s.writes(),1); assert.equal(s.values()[1][0],'2026-10-02');
});
test('retired POST cannot read or mutate data',()=>{
  const s=setup(''); assert.match(s.context.doPost({parameter:{action:'delete'}}),/retired/); assert.equal(s.writes(),0);
});
test('published sources do not embed legacy credentials or JSONP',()=>{
  const html = fs.readFileSync(require('node:path').join(__dirname,'../apps-script/Index.html'),'utf8');
  assert.doesNotMatch(html,/SHEET_TOKEN|APP_PASSWORD|jsonpGet|mode:'no-cors'/);
  const entry = fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
  assert.doesNotMatch(entry,/SHEET_TOKEN|APP_PASSWORD/);
});
