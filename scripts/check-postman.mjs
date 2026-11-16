// Native checks: no dependencies, no credentials, no mutations.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { Script } from 'node:vm';
import path from 'node:path';

const collection = JSON.parse(await readFile('postman/Cemat-Cemot.postman_collection.json', 'utf8'));
const environment = JSON.parse(await readFile('postman/Local.postman_environment.json', 'utf8'));
assert.equal(collection.info.schema, 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json');
const vars = new Map(environment.values.map(v => [v.key, v.value]));
const requests = collection.item.flatMap(f => f.item);
assert.equal(new Set(environment.values.map(v => v.key)).size, environment.values.length);
assert.equal(vars.get('allow_mutations'), 'false');
for (const key of ['admin_password', 'cron_secret', 'new_password', 'tracking_token', 'otp_code']) assert.equal(vars.get(key), '');
const resolve = s => s.replace(/{{([^}]+)}}/g, (_, key) => {
  assert.ok(vars.has(key), `Undefined variable ${key}`);
  return vars.get(key);
});
for (const item of requests) {
  assert.ok(item.name && item.request.method);
  resolve(item.request.url);
  for (const e of item.event ?? []) new Script(e.script.exec.join('\n'));
  const body = item.request.body;
  if (body?.mode === 'raw') {
    resolve(body.raw);
    const filled = body.raw.replace(/{{([^}]+)}}/g, (match, key, offset, text) => {
      if (text[offset - 1] === '"') return 'example';
      return key === 'choice_ids' ? '[]' : '1';
    });
    JSON.parse(filled);
    assert.equal(item.request.header.find(h => h.key === 'Content-Type')?.value, 'application/json');
  }
  if (body?.mode === 'formdata') assert.ok(!item.request.header.some(h => h.key.toLowerCase() === 'content-type'));
  for (const field of body?.formdata ?? []) if (field.value) resolve(field.value);
  const auth = item.request.auth;
  for (const field of auth?.bearer ?? []) resolve(field.value);
  if (!['GET', 'HEAD'].includes(item.request.method) && !item.request.url.includes('/session') && !/\/(lookup|otp\/request|otp\/verify)$/.test(item.request.url)) {
    assert.ok(item.event.some(e => e.listen === 'prerequest' && e.script.exec.join('\n').includes('allow_mutations')), `Mutation missing guard: ${item.name}`);
  }
}

async function routes(dir) {
  const all = [];
  for (const d of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) all.push(...await routes(p));
    else if (d.name === 'route.ts') all.push(p);
  }
  return all;
}
const files = await routes('src/app/api');
let methods = 0;
for (const file of files) {
  const pathname = '/' + file.replace(/^src\/app\//, '').replace(/\/route.ts$/, '');
  const pattern = '^' + pathname.split('/').map(s => s.startsWith('[') ? '[^/]+' : s).join('/') + '$';
  const code = await readFile(file, 'utf8');
  for (const [, method] of code.matchAll(/export const (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*=(?!\s*methodNotAllowed)/g)) { // 405 stub tidak perlu request Postman
    methods++;
    assert.ok(requests.some(item => item.request.method === method && new RegExp(pattern).test(item.request.url.replace('{{base_url}}', '').split('?')[0])), `Not covered: ${method} ${pathname}`);
  }
}
console.log(`Postman artifacts valid: ${collection.item.length} folders, ${requests.length} requests; ${files.length} route files / ${methods} method contracts covered; scripts compile; secrets blank.`);

if (process.argv.includes('--live')) {
  // Execute actual Postman test scripts for five GETs with native assertions; never login or mutate DB.
  let passed = 0;
  for (const item of collection.item[0].item.slice(0, 5)) {
    assert.equal(item.request.method, 'GET');
    const response = await fetch(resolve(item.request.url));
    const data = await response.json();
    const expect = value => ({ to: { be: { oneOf: list => { assert.ok(list.includes(value)); passed++; }, at: { most: max => { assert.ok(value <= max); passed++; } } }, eql: expected => { assert.deepEqual(value, expected); passed++; } } });
    const pm = {
      response: { code: response.status, json: () => data },
      environment: { get: key => vars.get(key), set: (key, value) => vars.set(key, String(value)) },
      test: (_name, fn) => fn(), expect,
    };
    for (const e of item.event.filter(e => e.listen === 'test')) new Script(e.script.exec.join('\n')).runInNewContext({ pm }, { timeout: 1000 });
  }
  assert.ok(vars.get('menu_item_id') && vars.get('outlet_id') && vars.get('expected_total'));
  console.log(`Live read-only collection scripts passed: 5 requests, ${passed} assertions; catalog/default choices/outlet/total captured. No mutations.`);
}
