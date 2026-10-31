// Integration HTTP test. Run ONLY against isolated API test DB; never live data.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { scryptSync } from "node:crypto";
import postgres from "postgres";

const base = process.env.API_BASE_URL ?? "http://localhost:3211";
const url = process.env.DATABASE_URL!;
assert.match(new URL(url).pathname, /^\/cemat_cemot_api_test_/);
const sql = postgres(url);
let cookie = "";
let tests = 0;
async function call(path: string, status: number, body?: unknown, admin = false, method?: string) {
  const form = body instanceof FormData;
  const r = await fetch(base + path, { method: method ?? (body === undefined ? "GET" : "POST"), headers: {
    ...(body !== undefined && !form ? { "Content-Type": "application/json" } : {}),
    ...(admin ? { Cookie: cookie } : {}),
  }, body: body === undefined ? undefined : form ? body : JSON.stringify(body) });
  assert.equal(r.status, status, `${path}: expected ${status}, got ${r.status} ${r.ok ? "" : await r.text()}`);
  tests++;
  return r;
}
async function main() {
  const salt = randomBytes(16), password = randomBytes(20).toString("hex");
  const hash = `scrypt$${salt.toString("hex")}$${scryptSync(password, salt, 64).toString("hex")}`;
  await sql`insert into admin_users (username,email,password_hash) values ('test-admin','test@example.invalid',${hash})`;
  await sql`update store_settings set open_at='00:00',close_at='23:59',checkout_cutoff_min=0,admin_wa='6281234567890',status='OPEN'`;
  await sql`insert into partner_companies (name) values ('Test Partner')`;
  const [partner] = await sql`select id from partner_companies limit 1`;
  const login = await call('/api/admin/session',200,{username:'test-admin',password});
  cookie = login.headers.get('set-cookie')!.split(';')[0];
  await call('/api/admin/session',200,undefined,true);
  await call('/api/admin/data/partners',401);
  const created = await (await call('/api/admin/data/partners',201,{name:'Test partner CRUD',phone:'',website:'',isActive:true},true)).json();
  assert.equal(created.phone,null);
  await call(`/api/admin/data/partners/${created.id}`,200,{name:'Updated partner',phone:'081234567890',website:'https://example.invalid',isActive:false},true,'PUT');
  await call(`/api/admin/data/partners/${created.id}`,204,{confirm:true},true,'DELETE');
  const catalog = await (await call('/api/catalog',200)).json();
  const brand = catalog.brands[0], item = brand.items[0];
  const choices = item.options.flatMap((g: { required: boolean; choices: { id: string; isDefault: boolean }[] }) => g.required ? [g.choices.find(c=>c.isDefault)!.id] : []);
  const [outlet] = await sql`insert into outlets (brand_id,name,address,lat,lng) values (${brand.id},'Test Outlet','Test Address',-6.2,106.8) returning id`;
  const payload = { idempotencyKey: randomUUID(), brandSlug:brand.slug,outletId:outlet.id,customer:{name:'Test Buyer',phone:'081234567890'},items:[{menuItemId:item.id,qty:1,choiceIds:choices}],expectedTotal:item.normalPrice+5000 };
  await call('/api/checkout',409,{...payload,expectedTotal:1});
  const responses = await Promise.all([0, 1].map(() => fetch(base+'/api/checkout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})));
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 201]);
  const first = await responses[0].json(), second = await responses[1].json();
  tests += 2;
  assert.equal(first.token,second.token);
  assert.equal((await sql`select count(*)::int n from orders`)[0].n,1);
  const token = first.token;
  const [order] = await sql`select id,order_code from orders where tracking_token=${token}`;
  const tracking = await (await call(`/api/pesanan/${token}`,200)).json();
  assert.equal(tracking.totals.uniqueCode,0);
  assert.ok(tracking.phases.PENDING_PAYMENT);
  const sharp = (await import('sharp')).default;
  const image = await sharp({create:{width:1,height:1,channels:3,background:'#ffffff'}}).png().toBuffer();
  const form = () => { const f = new FormData(); f.set('file',new Blob([image],{type:'image/png'}),'proof.png'); return f; };
  const bad = new FormData();bad.set('file',new Blob(['not an image']),'bad.png');
  await call(`/api/pesanan/${token}/proof`,415,bad);
  await call(`/api/pesanan/${token}/proof`,204,form());
  await call(`/api/pesanan/${token}/files/payment-proof`,200);
  await call(`/api/admin/orders/${order.id}/confirm-payment`,409,{paidAmount:payload.expectedTotal,partnerCompanyId:partner.id,partnerAmount:10000},true);
  await call(`/api/admin/orders/${order.id}/start-verification`,200,{},true);
  await call(`/api/pesanan/${token}/proof`,409,form());
  await call(`/api/admin/orders/${order.id}/confirm-payment`,200,{paidAmount:payload.expectedTotal,partnerCompanyId:partner.id,partnerAmount:10000},true);
  await call(`/api/admin/orders/${order.id}/start-processing`,200,{},true);
  const ready = form();ready.set('queueNumber','A047');
  await call(`/api/admin/orders/${order.id}/mark-ready`,200,ready,true);
  const view = await (await call(`/api/pesanan/${token}`,200)).json();
  assert.equal(view.status,'READY');assert.equal(view.queueNumber,'A047');
  await call(`/api/pesanan/${token}/files/order-proof`,200);
  await call(`/api/admin/orders/${order.id}/mark-done`,200,{},true);
  await call('/api/customer/orders',401);
  await call('/api/customer/otp/request',503,{challenge:'opaque'});
  await call('/api/admin/session',204,undefined,true,'DELETE');
  await call('/api/admin/session',401,undefined,true);
  console.log(`api flow passed: ${tests} HTTP assertions, persisted DONE, parallel checkout idempotency`);
}
main().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>sql.end());
