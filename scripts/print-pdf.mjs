// Печать страницы приложения в PDF через протокол отладки headless Chrome (--print-to-pdf зависает).
// Запуск: node scripts/print-pdf.mjs <файл.html> <#адрес> <вывод.pdf>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [file, hash, out] = process.argv.slice(2);
if (!file || !out) { console.error('node scripts/print-pdf.mjs <файл.html> <#адрес> <вывод.pdf>'); process.exit(2); }
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'statkarta-print-'));
const port = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    await sleep(200);
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page'); } catch { /* ждем запуска */ }
  }
  if (!target) throw new Error('Chrome не запустился');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let seq = 0;
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    const on = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id !== id) return;
      ws.removeEventListener('message', on);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    };
    ws.addEventListener('message', on);
    ws.send(JSON.stringify({ id, method, params }));
  });
  await call('Page.enable');
  await call('Page.navigate', { url: `file://${path.resolve(file)}${hash || ''}` });
  await sleep(2500);
  const { data } = await call('Page.printToPDF', { printBackground: true, preferCSSPageSize: true });
  fs.writeFileSync(out, Buffer.from(data, 'base64'));
  console.log(`напечатано: ${out}`);
  ws.close();
} finally {
  chrome.kill();
  fs.rmSync(profile, { recursive: true, force: true });
}
