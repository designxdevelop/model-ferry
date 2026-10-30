import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';

async function fixture(t) {
  const socket = net.createServer();
  socket.listen(0,'127.0.0.1');
  await once(socket,'listening');
  const port = socket.address().port;
  await new Promise(resolve=>socket.close(resolve));
  const child = fork(new URL('../test-support/server-child.mjs',import.meta.url), {env:{...process.env,TEST_PORT:String(port)},silent:true});
  t.after(()=>child.kill());
  await new Promise((resolve,reject)=>{child.stdout.on('data',data=>{if(String(data).includes('listening'))resolve()});child.once('error',reject)});
  const base = `http://127.0.0.1:${port}`;
  const post = (route,body,token='test',session='one') => fetch(base+route,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json','x-session-id':session},body:JSON.stringify(body),signal:AbortSignal.timeout(4000)});
  const chat = (messages, session) => post('/v1/chat/completions',{model:'test',messages,tools:[{name:'read',parameters:{type:'object'}}]},'test',session);
  const start = async (session='one') => {
    const envPromise = once(child,'message');
    const response = chat([{role:'user',content:'read two files'}],session);
    const [{env}] = await envPromise;
    const capture = args => post('/internal/tool-capture',{captureId:env.MODELFERRY_CAPTURE_ID,name:'read',arguments:args},env.MODELFERRY_CALLBACK_TOKEN);
    const wait = callId => post('/internal/tool-wait',{captureId:env.MODELFERRY_CAPTURE_ID,callId},env.MODELFERRY_CALLBACK_TOKEN);
    return {response,capture,wait};
  };
  return {child,chat,start};
}
const result = (id,content) => [{role:'assistant',tool_calls:[{id,type:'function',function:{name:'read',arguments:'{}'}}]},{role:'tool',tool_call_id:id,content}];

test('server isolates sequential calls, late waiters and rejects overlap', async t=>{
  const f = await fixture(t);
  const run = await f.start();
  const a = await (await run.capture({path:'A'})).json();
  assert.equal((await run.capture({path:'overlap'})).status,409);
  const first = await (await run.response).json();
  assert.equal(first.choices[0].message.tool_calls[0].id,a.callId);
  const continuationA = f.chat(result(a.callId,'OUTPUT_A'));
  // Capture B after A has resolved, while A's MCP wait has deliberately not arrived.
  let b;
  for(let i=0;i<30;i++) {
    const response = await run.capture({path:'B'});
    if(response.status===200){b=await response.json();break;}
    assert.equal(response.status,409);
    await new Promise(resolve=>setTimeout(resolve,5));
  }
  assert.ok(b);
  assert.notEqual(a.callId,b.callId);
  const second = await (await continuationA).json();
  assert.equal(second.choices[0].message.tool_calls[0].id,b.callId);
  assert.deepEqual(await (await run.wait(a.callId)).json(),{content:'OUTPUT_A',isError:false});
  const waitingB = run.wait(b.callId);
  const final = f.chat(result(b.callId,'OUTPUT_B'));
  assert.deepEqual(await (await waitingB).json(),{content:'OUTPUT_B',isError:false});
  f.child.send('finish');
  assert.equal((await final).status,200);
  assert.equal((await run.capture({path:'expired'})).status,404);
});

for (const mode of ['reset','timeout','eviction']) test(`server cleans captures after continuation and ${mode}`,async t=>{
  const f = await fixture(t);
  const run = await f.start();
  const {callId} = await (await run.capture({path:'A'})).json();
  await run.response;
  const continuing = f.chat(result(callId,'OUTPUT_A'));
  assert.equal((await run.wait(callId)).status,200);
  if(mode==='timeout') {
    assert.equal((await continuing).status,504);
  } else {
    const next = await f.start(mode==='eviction'?'two':'one');
    f.child.send('finish');
    await next.response;
    await continuing;
  }
  assert.equal((await run.capture({path:'leaked'})).status,404);
  assert.equal((await run.wait(callId)).status,404);
});

test('server expires an abandoned tool hop and rejects its blocked waiter', async t=>{
  const f = await fixture(t);
  const run = await f.start();
  const {callId} = await (await run.capture({path:'abandoned'})).json();
  await run.response;
  assert.equal((await run.wait(callId)).status,504);
  assert.equal((await run.capture({path:'expired'})).status,404);
  assert.equal((await run.wait(callId)).status,404);
});
