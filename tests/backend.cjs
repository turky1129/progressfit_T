const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require('node:path').join(__dirname,'../apps-script/Code.gs'),'utf8');
const header = ['date','weight_kg','bodyfat_pct','bmi','fitness_score','fatmass_kg','muscle_kg','skeletal_muscle_kg','visceral_fat_level'];
function setup(active='owner@example.test', owner='owner@example.test') {
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
    Session:{getActiveUser:()=>({getEmail:()=>active}), getEffectiveUser:()=>({getEmail:()=> 'owner@example.test'})},
    PropertiesService:{getScriptProperties:()=>({getProperty:()=>owner})},
    SpreadsheetApp:{getActiveSpreadsheet:()=>({getSheetByName:()=>sheet}), flush:()=>{}},
    LockService:{getScriptLock:()=>({waitLock:()=>{},releaseLock:()=>{}})},
    Utilities:{parseCsv:s=>s.split('\n').map(x=>x.split(',')),formatDate:()=> '20261029_200000',getUuid:()=> '12345678-abcd'},
    ContentService:{createTextOutput:s=>s}
  });
  vm.runInContext(source,context);
  return {context, values:()=>values, writes:()=>writes, backups:()=>backups};
}
const record = {date:'2026-10-02', originalDate:'2026-10-01',weight_kg:74,bodyfat_pct:20,bmi:24,fatmass_kg:15,skeletal_muscle_kg:30};
test('all data methods reject anonymous users, other users and unset owner before writes',()=>{
  for(const [active,owner] of [['','owner@example.test'],['other@example.test','owner@example.test'],['owner@example.test',null]]){
    const s=setup(active,owner);
    for(const fn of [()=>s.context.getRecords(),()=>s.context.saveRecord(record),()=>s.context.deleteRecord('2026-10-01'),()=>s.context.importRecords('x')]) assert.throws(fn,/アクセス/);
    assert.equal(s.writes(),0);
  }
});
test('changing a date updates the existing row with one data write',()=>{
  const s=setup(); s.context.saveRecord(record);
  assert.equal(s.values().length,2); assert.equal(s.values()[1][0],'2026-10-02'); assert.equal(s.writes(),1);
});
test('invalid numbers, formulas, impossible dates and date collisions cannot write',()=>{
  for(const change of [{weight_kg:'=IMPORTXML("https://example.test","x")'},{bodyfat_pct:101},{date:'2026-02-30'},{weight_kg:Infinity}]){
    const s=setup(); assert.throws(()=>s.context.saveRecord({...record,...change})); assert.equal(s.writes(),0);
  }
  const s=setup(); s.values().push(['2026-10-02',74,20,24,'',15,50,30,8]);
  assert.throws(()=>s.context.saveRecord(record),/既に記録/); assert.equal(s.writes(),0);
});
test('invalid imports preserve data; valid import makes a backup before replacement',()=>{
  for(const row of ['2026-10-02,=1+1,20,24,,15,50,30,8','2026-02-30,75,20,24,,15,50,30,8']) {
    const s=setup(); assert.throws(()=>s.context.importRecords(header.join(',')+'\n'+row)); assert.equal(s.writes(),0); assert.equal(s.backups(),0);
  }
  const s=setup(); s.context.importRecords(header.join(',')+'\n2026-10-02,74,20,24,,15,50,30,8');
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
