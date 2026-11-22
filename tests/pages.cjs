const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
new vm.Script(script);
const transport=script.slice(script.indexOf("let sessionToken='';"),script.indexOf('async function postToGAS'));
test('Pages restores session on startup and sends token in POST body only',async()=>{
  let request;
  const context=vm.createContext({localStorage:{getItem:()=> 'saved-session'},AbortController,setTimeout,clearTimeout,fetch:async(url,options)=>{request={url,options};return {ok:true,json:async()=>({ok:true,rows:[]})};}});
  vm.runInContext(transport,context);
  await context.gasCall('read');
  assert.ok(!request.url.includes('saved-session'));
  assert.equal(request.options.method,'POST');
  assert.equal(request.options.credentials,'omit');
  assert.equal(JSON.parse(request.options.body).token,'saved-session');
  assert.ok(!html.includes('location.replace'));
  assert.ok(!html.includes('google.script.run'));
});
test('network errors keep remembered session; explicit expiry removes it',async()=>{
  let removed=false;
  const nodes={modalAuthBg:{style:{}},loginError:{},sessionLoading:{style:{}},loginForm:{style:{}}};
  const context=vm.createContext({$:id=>nodes[id],localStorage:{getItem:()=> 'saved-session',removeItem:()=>removed=true},AbortController,setTimeout,clearTimeout,fetch:async()=>{throw Error('offline');}});
  vm.runInContext(transport,context);
  await assert.rejects(context.gasCall('read'),/offline/);assert.equal(removed,false);
  context.fetch=async()=>({ok:true,json:async()=>({ok:false,error:'AUTH_REQUIRED: expired'})});
  await assert.rejects(context.gasCall('read'),/AUTH_REQUIRED/);assert.equal(removed,true);
});