#!/usr/bin/env node
// Host-side automation only. Never imported by the application bundle.
const fs = require('node:fs');
const WebSocket = require('ws');

const base = process.env.QA_METRO_URL || 'http://127.0.0.1:8081';

async function targets() {
  const response = await fetch(`${base}/json/list`);
  if (!response.ok) throw new Error(`Inspector HTTP ${response.status}`);
  return response.json();
}

async function evaluate(target, script, timeout = 45000, args = {}) {
  const available = await targets();
  const selected = available.find(page => page.id === target) || available.find(page =>
    `${page.title} ${page.description} ${page.deviceName}`.includes(target));
  if (!selected) throw new Error('No matching running application inspector target');
  const socket = new WebSocket(selected.webSocketDebuggerUrl, { origin: new URL(base).origin });
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  let id = 0;
  const pending = new Map();
  socket.on('close', () => {
    for (const operation of pending.values()) {
      clearTimeout(operation.timer);
      operation.reject(new Error('Inspector connection closed'));
    }
    pending.clear();
  });
  socket.on('message', bytes => {
    const message = JSON.parse(String(bytes));
    const operation = pending.get(message.id);
    if (!operation) return;
    pending.delete(message.id);
    clearTimeout(operation.timer);
    if (message.error) operation.reject(new Error(JSON.stringify(message.error)));
    else operation.resolve(message.result);
  });
  const request = (method, params = {}) => new Promise((resolve, reject) => {
    const requestId = ++id;
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`Timed out: ${method}`)); }, timeout);
    pending.set(requestId, { resolve, reject, timer });
    socket.send(JSON.stringify({ id: requestId, method, params }));
  });
  try {
    await request('Runtime.enable');
    const expression = `(async () => {
      const qaArgs = ${JSON.stringify(args)};
      const qaRequire = (suffix) => {
        const matches = Array.from(globalThis.__r.getModules()).filter(([, module]) =>
          module.verboseName === suffix || module.verboseName?.endsWith('/' + suffix));
        if (matches.length !== 1) throw new Error('Expected one loaded module: ' + suffix + ', found ' + matches.length);
        return globalThis.__r(matches[0][0]);
      };
      ${script}
    })()`;
    // React Native installs a Promise polyfill which Hermes CDP does not treat
    // as a native promise for awaitPromise. Poll a host-owned result slot.
    const key = `__locationQaCdp_${process.pid}_${Date.now()}`;
    const run = `void (${expression}).then(value => { globalThis[${JSON.stringify(key)}] = { done: true, value }; },
      error => { globalThis[${JSON.stringify(key)}] = { done: true, error: String(error?.stack || error) }; })`;
    const initial = await request('Runtime.evaluate', { expression: run, returnByValue: true });
    if (initial.exceptionDetails) throw new Error(initial.exceptionDetails.exception?.description || initial.exceptionDetails.text);
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const answer = await request('Runtime.evaluate', { expression: `globalThis[${JSON.stringify(key)}]`, returnByValue: true });
      const value = answer.result?.value;
      if (value?.done) {
        await request('Runtime.evaluate', { expression: `delete globalThis[${JSON.stringify(key)}]` });
        if (value.error) throw new Error(value.error);
        return value.value;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Application evaluation did not complete before its deadline');
  } finally {
    for (const operation of pending.values()) clearTimeout(operation.timer);
    socket.close();
  }
}

async function main() {
  const [, , command, target, file, argsFile] = process.argv;
  if (command === 'targets') {
    const pages = await targets();
    process.stdout.write(JSON.stringify(pages, null, 2) + '\n');
    return;
  }
  if (command !== 'eval' || !target || !file) throw new Error('Usage: cdp.cjs targets | eval TARGET SCRIPT.js');
  const result = await evaluate(target, fs.readFileSync(file, 'utf8'), 45000,
    argsFile ? JSON.parse(fs.readFileSync(argsFile, 'utf8')) : {});
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

module.exports = { targets, evaluate };
if (require.main === module) main().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
