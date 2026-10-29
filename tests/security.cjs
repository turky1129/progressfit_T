const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const html = fs.readFileSync(require('node:path').join(__dirname, '../apps-script/Index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
new vm.Script(script); // Parse the complete application, without contacting GAS.
const sandbox = {};
vm.createContext(sandbox);
for (const [start, end] of [['function normalizeYMD', 'function fmt1'], ['function validateImportCsv', 'async function handleImportFiles']]) {
  vm.runInContext(script.slice(script.indexOf(start), script.indexOf(end)), sandbox);
}
const header = 'date,weight_kg,bodyfat_pct,bmi,fitness_score,fatmass_kg,muscle_kg,skeletal_muscle_kg,visceral_fat_level';
const row = '2024-02-29,75,20,24,,15,50,30,8';
test('dates reject markup and impossible dates; preserve ISO sheet dates', ()=>{
  for(const s of ['<img src=x onerror=alert(1)>', '2025-02-29', '2026-13-01', '2026-01-01T<script>', '=1+1']) assert.equal(sandbox.normalizeYMD(s), '');
  assert.equal(sandbox.normalizeYMD('2024-02-29T00:00:00.000Z'), '2024-02-29');
});
test('CSV accepts the exported format including BOM and CRLF', ()=>{
  assert.equal(sandbox.validateImportCsv('\uFEFF'+header+'\r\n'+row+'\r\n'), 1);
});
test('CSV rejects formulas, duplicate dates, invalid dates, headers and empty replacements', ()=>{
  for(const csv of [header, header+'\n'+row+'\n'+row, header+'\n'+row.replace('75','=1+1'), header+'\n'+row.replace('2024','2025'), header+'\n'+row.replace('75','Infinity'), 'wrong\n'+row]) assert.throws(()=>sandbox.validateImportCsv(csv));
});
test('untrusted date uses textContent and dependencies have integrity protection', ()=>{
  assert.ok(!html.includes('<div class="listDate">${r.date}'));
  assert.ok(html.includes("div.querySelector('.listDate').textContent = r.date"));
  assert.equal((html.match(/integrity="sha384-[^"]+" crossorigin="anonymous"/g)||[]).length, 2);
});
