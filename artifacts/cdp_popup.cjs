const WebSocket = require('../node_modules/ws');

const ws = new WebSocket(process.env.AUDIT_CDP_URL);
ws.on('error', (error) => console.error('ws error:', error.message));
let nextId = 1;
const pending = new Map();

ws.on('message', (raw) => {
  const message = JSON.parse(raw.toString());
  if (!message.id) return;
  const done = pending.get(message.id);
  if (!done) return;
  pending.delete(message.id);
  if (message.error) done.reject(new Error(message.error.message));
  else done.resolve(message.result);
});

function send(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    setTimeout(() => {
      if (pending.has(id)) { pending.delete(id); reject(new Error(`${method} timeout`)); }
    }, 6000);
  });
}

async function run() {
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
    setTimeout(() => reject(new Error('websocket open timeout')), 6000);
  });
  console.log('connected');
  const targets = await send('Target.getTargets');
  const pages = targets.targetInfos.filter((t) => t.type === 'page');
  console.log(pages.map((t) => ({ id: t.targetId, title: t.title, host: (() => {
    try { return new URL(t.url).host; } catch { return ''; }
  })() })));
  const popup = pages.find((t) => t.url.startsWith('https://www.tiktok.com/v2/auth/authorize/'));
  if (!popup) return;
  const attached = await send('Target.attachToTarget', { targetId: popup.targetId, flatten: true });
  const sessionId = attached.sessionId;
  const command = process.argv[2] || 'inspect';
  if (command === 'inspect') {
    const result = await send('Runtime.evaluate', { expression: "Array.from(document.querySelectorAll('button,[role=button],a')).map((e)=>({tag:e.tagName,text:e.innerText?.trim().slice(0,120),aria:e.getAttribute('aria-label')})).filter((e)=>e.text||e.aria)", returnByValue: true }, sessionId);
    console.log(result.result.value);
  } else if (command === 'expand') {
    const result = await send('Runtime.evaluate', { expression: "(()=>{const e=Array.from(document.querySelectorAll('button,[role=button],div')).find((x)=>x.textContent?.trim()==='aime.angkorgate already has some access'); if(!e)return 'not found'; e.click(); return 'clicked';})()", returnByValue: true }, sessionId);
    console.log(result.result.value);
  } else if (command === 'continue') {
    const result = await send('Runtime.evaluate', { expression: "(()=>{const e=Array.from(document.querySelectorAll('button')).find((x)=>x.innerText?.trim()==='Continue'); if(!e)return 'not found'; e.click(); return 'clicked';})()", returnByValue: true }, sessionId);
    console.log(result.result.value);
  }
  await send('Target.detachFromTarget', { sessionId });
}

run().then(() => ws.close()).catch((error) => { console.error(error.message); ws.close(); process.exitCode = 1; });
