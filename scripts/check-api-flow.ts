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
let buyerCookie = "";
let tests = 0;
async function call(path: string, status: number, body?: unknown, admin = false, method?: string) {
  const form = body instanceof FormData;
  const r = await fetch(base + path, { method: method ?? (body === undefined ? "GET" : "POST"), headers: {
    ...(body !== undefined && !form ? { "Content-Type": "application/json" } : {}),
    ...(admin ? { Cookie: cookie } : buyerCookie ? { Cookie: buyerCookie } : {}),
  }, body: body === undefined ? undefined : form ? body : JSON.stringify(body) });
  assert.equal(r.status, status, `${path}: expected ${status}, got ${r.status} ${r.ok ? "" : await r.clone().text()}`);
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
  const created = await (await call('/api/admin/data/partners',201,{name:'Test partner CRUD',phone:'',website:'',notes:'minimal pembelian 2 item',isActive:true},true)).json();
  assert.equal(created.phone,null);assert.equal(created.notes,'minimal pembelian 2 item');
  const plist = await (await call('/api/admin/data/partners',200,undefined,true)).json();
  assert.equal(plist.total,2);assert.equal(plist.items.length,2);assert.equal(plist.limit,50);
  await call(`/api/admin/data/partners/${created.id}`,200,{name:'Updated partner',phone:'081234567890',website:'https://example.invalid',isActive:false},true,'PUT');
  await call(`/api/admin/data/partners/${created.id}`,204,{confirm:true},true,'DELETE');
  const catalog = await (await call('/api/catalog',200)).json();
  const brand = catalog.brands[0], item = brand.items[0];
  const choices = item.options.flatMap((g: { required: boolean; choices: { id: string; isDefault: boolean }[] }) => g.required ? [g.choices.find(c=>c.isDefault)!.id] : []);
  const [outlet] = await sql`insert into outlets (brand_id,name,address,lat,lng) values (${brand.id},'Test Outlet','Test Address',-6.2,106.8) returning id`;
  const cart = { brandSlug:brand.slug,outletId:outlet.id,items:[{menuItemId:item.id,qty:1,choiceIds:choices}] };
  const customer = {name:'Test Buyer',phone:'081234567890'};
  const total = item.normalPrice+5000;
  const idem = randomUUID();
  const checkoutBody = (expectedTotal = total) => ({ ...cart, idempotencyKey: idem, customer, expectedTotal });
  await call('/api/cart',404);
  const missingItems = await call('/api/checkout',400,{idempotencyKey:idem,brandSlug:brand.slug,outletId:outlet.id,customer,expectedTotal:total});
  buyerCookie = missingItems.headers.get('set-cookie')!.split(';')[0];
  await call('/api/checkout',400,{...checkoutBody(),items:[]});
  await call('/api/checkout',400,{...checkoutBody(),items:[{menuItemId:item.id,qty:99,choiceIds:choices}]});
  await call('/api/checkout',409,checkoutBody(1));
  const responses = await Promise.all([0, 1].map(() => fetch(base+'/api/checkout',{method:'POST',headers:{'Content-Type':'application/json',Cookie:buyerCookie},body:JSON.stringify(checkoutBody())})));
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 201]);
  const first = await responses[0].json(), second = await responses[1].json();
  tests += 2;
  assert.equal(first.token,second.token);
  assert.equal((await sql`select count(*)::int n from orders`)[0].n,1);
  // Riwayat tanpa login: cookie perangkat yang sama melihat pesanan; perangkat lain kosong.
  const hist = await (await call('/api/customer/orders',200)).json();
  assert.equal(hist.orders.length,1);assert.equal(hist.orders[0].token,first.token);
  const other = await fetch(base+'/api/customer/orders');assert.equal(other.status,200);tests++;
  assert.equal((await other.json()).orders.length,0);
  const token = first.token;
  const [order] = await sql`select id,order_code from orders where tracking_token=${token}`;
  const tracking = await (await call(`/api/pesanan/${token}`,200)).json();
  assert.equal(tracking.paymentAccounts.length,1);
  assert.equal(tracking.paymentAccounts[0].id,(await sql`select payment_account_id from payments where order_id=${order.id}`)[0].payment_account_id);
  const [boundAccount] = await sql`select id from payment_accounts where id=${tracking.paymentAccounts[0].id}`;
  await sql`update payment_accounts set is_active=false where id=${boundAccount.id}`;
  const qris = await fetch(base + tracking.paymentAccounts[0].qrisUrl);
  assert.equal(qris.status,200);tests++;
  assert.equal((await fetch(`${base}/api/qris/${boundAccount.id}`)).status,404);tests++;
  await sql`update payment_accounts set is_active=true where id=${boundAccount.id}`;
  assert.equal(tracking.paymentAccounts[0].qrisUrl.includes('?token='),true);
  assert.equal(tracking.totals.uniqueCode,0);
  assert.ok(tracking.phases.PENDING_PAYMENT);
  const sharp = (await import('sharp')).default;
  const image = await sharp({create:{width:1,height:1,channels:3,background:'#ffffff'}}).png().toBuffer();
  const form = () => { const f = new FormData(); f.set('file',new Blob([image],{type:'image/png'}),'proof.png'); return f; };
  const bad = new FormData();bad.set('file',new Blob(['not an image']),'bad.png');
  await call(`/api/pesanan/${token}/proof`,415,bad);
  await call(`/api/pesanan/${token}/proof`,204,form());
  await call(`/api/pesanan/${token}/files/payment-proof`,200);
  await call(`/api/admin/orders/${order.id}/confirm-payment`,409,{paidAmount:total,partnerCompanyId:partner.id,partnerAmount:10000},true);
  await call(`/api/admin/orders/${order.id}/start-verification`,200,{},true);
  await call(`/api/pesanan/${token}/proof`,409,form());
  await call(`/api/admin/orders/${order.id}/confirm-payment`,200,{paidAmount:total,partnerCompanyId:partner.id,partnerAmount:10000},true);
  const early = form();early.set('queueNumber','A047');
  await call(`/api/admin/orders/${order.id}/order-proof`,409,early,true); // masih PAID
  await call(`/api/admin/orders/${order.id}/mark-done`,409,{},true);
  await call(`/api/admin/orders/${order.id}/start-processing`,400,{},true);
  const noPhoto = new FormData(); noPhoto.set('queueNumber','A047');
  await call(`/api/admin/orders/${order.id}/start-processing`,400,noPhoto,true);
  const noNumber = form();
  await call(`/api/admin/orders/${order.id}/start-processing`,400,noNumber,true);
  const invalidImage = new FormData(); invalidImage.set('queueNumber','A047'); invalidImage.set('file',new Blob(['invalid']),'bad.png');
  await call(`/api/admin/orders/${order.id}/start-processing`,415,invalidImage,true);
  const listed = (await (await call('/api/admin/orders?q=0812345',200,undefined,true)).json()).orders.find((o: {id:string}) => o.id===order.id);
  assert.equal(listed.customerName,'Test Buyer');assert.equal(listed.customerPhone,'6281234567890');assert.equal(listed.queueNumber,null);assert.equal(listed.hasOrderProof,false);
  const processing = form();processing.set('queueNumber','A047');
  await call(`/api/admin/orders/${order.id}/start-processing`,200,processing,true);
  await call(`/api/admin/orders/${order.id}/start-processing`,200,processing,true);
  await call(`/api/admin/orders/${order.id}/mark-ready`,404,{},true);
  const detail = await (await call(`/api/admin/orders/${order.id}`,200,undefined,true)).json();
  assert.equal(detail.order.orderProof.exists,true);assert.equal(detail.payments.some((p: {hasProof:boolean}) => p.hasProof),true);
  assert.equal((await sql`select count(*)::int n from payments where order_id=${order.id} and proof_image_path is not null`)[0].n,1); // bukti bayar tidak tertimpa
  const swap = form();await call(`/api/admin/orders/${order.id}/order-proof`,200,swap,true);
  const lst = (await (await call('/api/admin/orders?q=A047',200,undefined,true)).json()).orders;assert.equal(lst.length,1);
  const view = await (await call(`/api/pesanan/${token}`,200)).json();
  assert.equal(view.status,'PROCESSING');assert.equal(view.queueNumber,'A047');
  assert.equal(view.progress.label,'Diproses');
  assert.deepEqual(view.progress.steps.map((s: {checked:boolean})=>s.checked),[true,true,true,true,false]);
  await call(`/api/pesanan/${token}/files/order-proof`,200);
  // Partner retry: archive privately, keep original payment, reject stale tabs and duplicate requests.
  const [replacement] = await sql`insert into partner_companies (name) values ('Replacement Partner') returning id`;
  const [inactive] = await sql`insert into partner_companies (name,is_active) values ('Inactive Partner',false) returning id`;
  const [original] = await sql`select * from orders where id=${order.id}`;
  const originalPayments = await sql`select * from payments where order_id=${order.id} order by id`;
  const currentAttempt = async () => (await sql`select * from fulfillment_attempts where order_id=${order.id} and closed_at is null`)[0];
  const initialAttempt = await currentAttempt();
  const retryBody = {attemptId:initialAttempt.id,partnerCompanyId:replacement.id,reason:'Partner membatalkan'};
  const retryPath = `/api/admin/orders/${order.id}/retry-partner`;
  await call(retryPath,401,retryBody);
  await call(retryPath,400,{...retryBody,reason:' '},true);
  await call(retryPath,400,{partnerCompanyId:replacement.id,reason:'Gagal'},true);
  await call(retryPath,422,{...retryBody,partnerCompanyId:partner.id},true);
  await call(retryPath,422,{...retryBody,partnerCompanyId:inactive.id},true);
  await call(retryPath,422,{...retryBody,partnerCompanyId:randomUUID()},true);
  assert.equal((await currentAttempt()).id,initialAttempt.id);
  // Force failure at final audit insert: the archive/new attempt/status must all roll back.
  await sql`create function reject_retry_test() returns trigger language plpgsql as $$ begin if NEW.type = 'PARTNER_RETRY' then raise exception 'forced retry rollback'; end if; return NEW; end $$`;
  await sql`create trigger reject_retry_test before insert on order_events for each row execute function reject_retry_test()`;
  try { await call(retryPath,500,retryBody,true); }
  finally { await sql`drop trigger reject_retry_test on order_events`; await sql`drop function reject_retry_test()`; }
  assert.deepEqual((await sql`select * from orders where id=${order.id}`)[0],original);
  assert.equal((await currentAttempt()).id,initialAttempt.id);
  assert.equal((await sql`select count(*)::int n from fulfillment_attempts where order_id=${order.id}`)[0].n,1);
  const retries = await Promise.all([0,1].map(() => fetch(base+retryPath,{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(retryBody)})));
  assert.deepEqual(retries.map(r=>r.status).sort(),[200,409]); tests+=2;
  const retryView = await (await call(`/api/pesanan/${token}`,200)).json();
  assert.equal(retryView.status,'PAID');assert.equal(retryView.queueNumber,null);assert.equal(retryView.hasOrderProof,false);
  assert.equal(retryView.fulfillment.waitingForRetry,true);assert.match(retryView.fulfillment.message,/tidak perlu bayar lagi/);
  assert.equal(retryView.phases.PROCESSING,undefined);assert.equal(retryView.phases.PAID,view.phases.PAID);
  assert.equal(retryView.payment.status,'VERIFIED');assert.deepEqual(retryView.totals,view.totals);
  for (const key of ['paid_at','expires_at','tracking_token','order_code','outlet_id','total']) {
    assert.deepEqual((await sql`select * from orders where id=${order.id}`)[0][key],original[key]);
  }
  assert.deepEqual(await sql`select * from payments where order_id=${order.id} order by id`,originalPayments);
  const archived = (await sql`select * from fulfillment_attempts where id=${initialAttempt.id}`)[0];
  assert.equal(archived.queue_number,'A047');assert.equal(archived.order_proof_path,original.order_proof_path);
  assert.equal(archived.partner_amount,10000);assert.equal(archived.outcome,'FAILED');assert.ok(archived.closed_by);
  await call(`/api/admin/files/attempt-proof/${initialAttempt.id}`,401);
  await call(`/api/admin/files/attempt-proof/${initialAttempt.id}`,200,undefined,true);
  await call(`/api/pesanan/${token}/files/attempt-proof`,404);
  await call(`/api/pesanan/${token}/files/order-proof`,404);
  const retryDetail = await (await call(`/api/admin/orders/${order.id}`,200,undefined,true)).json();
  assert.equal(retryDetail.attempts.length,2);assert.equal(JSON.stringify(retryDetail).includes(original.order_proof_path),false);
  const secondAttempt = await currentAttempt();
  await call(`/api/admin/orders/${order.id}/revert-confirmation`,409,{attemptId:secondAttempt.id,note:'Do not undo payment'},true);
  await call(`/api/admin/orders/${order.id}/start-processing`,409,processing,true); // old client without attemptId
  const newProof = form();newProof.set('queueNumber','B048');newProof.set('attemptId',initialAttempt.id);
  await call(`/api/admin/orders/${order.id}/start-processing`,409,newProof,true);
  newProof.set('attemptId',secondAttempt.id);
  await call(`/api/admin/orders/${order.id}/start-processing`,200,newProof,true);
  for (const action of ['mark-done','fail','retry-partner']) {
    await call(`/api/admin/orders/${order.id}/${action}`,409,{...retryBody,reason:'stale'},true);
  }
  await call(retryPath,200,{attemptId:secondAttempt.id,partnerCompanyId:partner.id,reason:'Partner pengganti gagal'},true);
  const thirdAttempt = await currentAttempt();
  assert.equal(thirdAttempt.sequence,3);assert.equal(thirdAttempt.partner_amount,null);
  const newest = form();newest.set('queueNumber','C049');newest.set('attemptId',thirdAttempt.id);
  await call(`/api/admin/orders/${order.id}/start-processing`,200,newest,true);
  const latestView = await (await call(`/api/pesanan/${token}`,200)).json();
  assert.equal(latestView.queueNumber,'C049');assert.equal(latestView.fulfillment.waitingForRetry,false);
  assert.ok(new Date(latestView.phases.PROCESSING) > new Date(view.phases.PROCESSING));
  const replaceLatest = form();replaceLatest.set('attemptId',thirdAttempt.id);
  await call(`/api/admin/orders/${order.id}/order-proof`,200,replaceLatest,true);
  await call(`/api/admin/files/attempt-proof/${initialAttempt.id}`,200,undefined,true);
  await call(`/api/admin/files/attempt-proof/${secondAttempt.id}`,200,undefined,true);
  await call(`/api/admin/orders/${order.id}/mark-done`,200,{attemptId:thirdAttempt.id},true);
  await call(retryPath,409,{attemptId:thirdAttempt.id,partnerCompanyId:replacement.id,reason:'Final'},true);
  const done = await (await call(`/api/pesanan/${token}`,200)).json();
  assert.equal(done.status,'DONE');
  const selfRefund = await call(`/api/pesanan/${token}/refund-account`,403,{method:'BANK',provider:'Test Bank',accountNo:'1234567890',accountName:'Test Buyer'});
  const selfRefundError = await selfRefund.json();
  assert.equal(selfRefundError.error.code,'SELF_SERVICE_REFUND_DISABLED');
  assert.match(selfRefundError.error.message,/WhatsApp/);
  assert.equal((await sql`select refund_account_no from orders where id=${order.id}`)[0].refund_account_no,null);
  assert.deepEqual(done.progress.steps.map((s: {checked:boolean})=>s.checked),[true,true,true,true,true]);
  await call(`/api/admin/orders/${order.id}/mark-done`,200,{attemptId:thirdAttempt.id},true);
  // total/count list admin + dashboard
  const all = await (await call('/api/admin/orders',200,undefined,true)).json();
  assert.equal(all.total,1);assert.equal(all.counts.ALL,1);assert.equal(all.counts.DONE,1);
  const none = await (await call('/api/admin/orders?status=PAID',200,undefined,true)).json();
  assert.equal(none.total,0);assert.equal(none.orders.length,0);assert.equal(none.counts.DONE,1);
  const dash = await (await call('/api/admin/dashboard?range=7d',200,undefined,true)).json();
  assert.equal(dash.done,1);assert.equal(dash.paidCount,1);assert.equal(dash.revenue,total);
  await call('/api/admin/dashboard?range=year',400,undefined,true);
  await call('/api/admin/dashboard',401);
  const mu = await (await call('/api/admin/data/menu?limit=2',200,undefined,true)).json();
  assert.equal(mu.items.length,2);assert.ok(mu.total>=2);assert.equal(Object.values(mu.byBrand as Record<string,number>).reduce((a,b)=>a+b,0),mu.total);
  // jadwal per hari: hari ini Jakarta libur -> checkout ditolak, /api/store closedToday
  const settings = await (await call('/api/admin/data/settings',200,undefined,true)).json();
  const wd = new Date(Date.now()+7*3600e3).getUTCDay();
  const sched = (row: object) => ({...settings,autoSchedule:true,openAt:'08:00',closeAt:'21:00',schedule:[{day:wd,...row}]});
  const put = (b: object) => call('/api/admin/data/settings',200,b,true);
  await call('/api/admin/data/settings',400,sched({openAt:'10:00',closeAt:'09:00'}),true);
  await put(sched({isClosed:true}));
  const store = await (await call('/api/store',200)).json();
  assert.equal(store.status,'CLOSED');assert.equal(store.closedToday,true);
  assert.equal((await (await call('/api/admin/data/settings',200,undefined,true)).json()).schedule.length,1);
  await put({...settings,autoSchedule:false,schedule:[]});
  assert.equal((await (await call('/api/store',200)).json()).status,'OPEN');
  await call('/api/customer/otp/request',503,{challenge:'opaque'});
  // Isolated admin refund record path; private account fields stay out of customer tracking and action response.
  await sql`update orders set status='REFUND_REQUESTED' where id=${order.id}`;
  await call(`/api/admin/orders/${order.id}/set-refund-account`,401,{method:'BANK',provider:'Test Bank',accountNo:'9876543210',accountName:'Test Buyer'});
  const recorded = await call(`/api/admin/orders/${order.id}/set-refund-account`,200,{method:'BANK',provider:'Test Bank',accountNo:'9876543210',accountName:'Test Buyer'},true);
  const recordedBody = await recorded.json();
  assert.equal(JSON.stringify(recordedBody).includes('9876543210'),false);
  const customerView = await (await call(`/api/pesanan/${token}`,200)).json();
  assert.equal(JSON.stringify(customerView).includes('9876543210'),false);
  await call(`/api/admin/orders/${order.id}/mark-refunded`,200,{note:'Refund processed'},true);
  assert.equal((await sql`select status from orders where id=${order.id}`)[0].status,'REFUNDED');
  await call(retryPath,409,{attemptId:thirdAttempt.id,partnerCompanyId:replacement.id,reason:'Refund final'},true);
  // Real refund branch after partner failure (no forced status), plus unchanged cron expiry.
  const refundToken = (await (await call('/api/checkout',201,{...checkoutBody(),idempotencyKey:randomUUID()})).json()).token;
  const [refundOrder] = await sql`select id from orders where tracking_token=${refundToken}`;
  await call(`/api/pesanan/${refundToken}/proof`,204,form());
  await call(`/api/admin/orders/${refundOrder.id}/start-verification`,200,{},true);
  await call(`/api/admin/orders/${refundOrder.id}/confirm-payment`,200,{paidAmount:total,partnerCompanyId:partner.id,partnerAmount:10000},true);
  const refundProof = form();refundProof.set('queueNumber','REF-1');
  await call(`/api/admin/orders/${refundOrder.id}/start-processing`,200,refundProof,true);
  const [refundAttempt] = await sql`select id from fulfillment_attempts where order_id=${refundOrder.id} and closed_at is null`;
  await call(`/api/admin/orders/${refundOrder.id}/fail`,200,{attemptId:refundAttempt.id,reason:'Tidak bisa dilanjutkan'},true);
  await call(`/api/admin/files/attempt-proof/${refundAttempt.id}`,200,undefined,true);
  assert.equal((await sql`select status from payments where order_id=${refundOrder.id}`)[0].status,'VERIFIED');
  await call(`/api/pesanan/${refundToken}/files/order-proof`,404);
  assert.equal((await (await call(`/api/pesanan/${refundToken}`,200)).json()).queueNumber,null);
  await call(`/api/admin/orders/${refundOrder.id}/retry-partner`,409,{attemptId:refundAttempt.id,partnerCompanyId:replacement.id,reason:'Final refund'},true);
  await call(`/api/admin/orders/${refundOrder.id}/set-refund-account`,200,{method:'BANK',provider:'Test Bank',accountNo:'9876543210',accountName:'Test Buyer'},true);
  await call(`/api/admin/orders/${refundOrder.id}/mark-refunded`,200,{note:'Manual refund'},true);
  const expireToken = (await (await call('/api/checkout',201,{...checkoutBody(),idempotencyKey:randomUUID()})).json()).token;
  await sql`update orders set expires_at=now()-interval '1 second' where tracking_token=${expireToken}`;
  await call(`/api/pesanan/${expireToken}/proof`,410,form());
  const expiryResponse = await fetch(base+'/api/cron/expire-orders',{method:'POST',headers:{Authorization:`Bearer ${process.env.CRON_SECRET}`}});
  assert.equal(expiryResponse.status,200);tests++;
  assert.equal((await sql`select status from orders where tracking_token=${expireToken}`)[0].status,'CANCELLED');
  assert.equal((await sql`select status from payments where order_id=(select id from orders where tracking_token=${expireToken})`)[0].status,'EXPIRED');
  // Impor massal menu (RND 16.2): preview, commit atomik, token terikat berkas, idempotensi.
  const imp = async (path: string, status: number, csv: string | Uint8Array, extra: Record<string, string> = {}, admin = true) => {
    const fd = new FormData();
    fd.set('file', new File([csv as BlobPart], 'menu.csv', { type: 'text/csv' }));
    for (const [k, v] of Object.entries(extra)) fd.set(k, v);
    return call(path, status, fd, admin);
  };
  const H = 'brand,nama,kategori,harga_app,harga_titip,addons,tersedia\n';
  const slug = brand.slug, existingName = item.name;
  const [opt] = await sql`insert into option_groups (name,required,max_select) values ('Topping Impor',false,2) returning id,name`;
  await sql`insert into option_choices (group_id,label) values (${opt.id},'Boba'),(${opt.id},'Jelly')`;
  const [req] = await sql`select g.name, (select label from option_choices c where c.group_id=g.id order by sort_order,label limit 1) label from option_groups g where g.required and (select count(*) from option_choices c where c.group_id=g.id)>1 limit 1`;
  const csv = H + `${slug},Impor Baru A,Kopi,30000,24000,${opt.name}|${req.name}=${req.label},true\n${slug},Rusak Default,Kopi,10000,,${req.name},\n${slug},Impor Baru B,Roti,15000,,,false\n${slug},${existingName},Ubah Kategori,${item.normalPrice},,,\n${slug},Rusak Harga,Kopi,10000,20000,,\nmerek-ngawur,Rusak Brand,Kopi,10000,,,\n${slug},Rusak Grup,Kopi,10000,,GrupTakAda,\n${slug},=cmd,Kopi,10000,,,\n`;
  await call('/api/admin/menu-import/template', 401, undefined, false);
  assert.ok((await (await call('/api/admin/menu-import/template', 200, undefined, true)).text()).startsWith('brand,nama,kategori,harga_app'));
  await imp('/api/admin/menu-import/preview', 401, csv, {}, false);
  await imp('/api/admin/menu-import/preview', 400, H);
  await imp('/api/admin/menu-import/preview', 400, 'nama,kategori\nA,B\n');
  const before = (await sql`select count(*)::int n from menu_items`)[0].n;
  const pv = await (await imp('/api/admin/menu-import/preview', 200, csv)).json();
  assert.deepEqual(pv.summary, { read: 8, ready: 3, errors: 5, created: 2, updated: 1 });
  assert.equal(pv.rows.find((r: { row: number }) => r.row === 2).action, 'create');
  assert.equal(pv.rows.find((r: { row: number }) => r.row === 5).action, 'update');
  assert.match(JSON.stringify(pv.rows.find((r: { row: number }) => r.row === 3).errors), /Default grup wajib/);
  assert.equal((await sql`select count(*)::int n from menu_items`)[0].n, before); // preview tidak menulis
  await imp('/api/admin/menu-import/commit', 400, csv, { token: 'bukan-token' });
  await imp('/api/admin/menu-import/commit', 400, csv + `${slug},Tambahan,Kopi,1000,,,\n`, { token: pv.token }); // berkas lain, token lama
  await imp('/api/admin/menu-import/commit', 401, csv, { token: pv.token, skipErrors: 'true' }, false);
  await imp('/api/admin/menu-import/commit', 409, csv, { token: pv.token }); // ada galat tanpa konfirmasi
  assert.equal((await sql`select count(*)::int n from menu_items`)[0].n, before); // tidak ada impor sebagian
  const importDone = await (await imp('/api/admin/menu-import/commit', 200, csv, { token: pv.token, skipErrors: 'true' })).json();
  assert.deepEqual(importDone, { read: 8, ready: 3, errors: 5, created: 2, updated: 1, skipped: 5 });
  assert.equal((await sql`select count(*)::int n from menu_items`)[0].n, before + 2);
  const [a] = await sql`select m.id,m.is_available,p.promo_price,(select count(*)::int from menu_item_choices c where c.menu_item_id=m.id) links from menu_items m left join promo_prices p on p.menu_item_id=m.id where m.name='Impor Baru A'`;
  assert.equal(a.promo_price, 24000); assert.equal(a.is_available, true); assert.ok(a.links >= 3);
  assert.equal((await sql`select is_available from menu_items where name='Impor Baru B'`)[0].is_available, false);
  assert.equal((await sql`select category from menu_items where id=${item.id}`)[0].category, 'Ubah Kategori');
  assert.equal((await sql`select count(*)::int n from menu_items where name in ('Rusak Harga','Rusak Brand','Rusak Grup','=cmd','Rusak Default')`)[0].n, 0);
  await imp('/api/admin/menu-import/commit', 409, csv, { token: pv.token, skipErrors: 'true' }); // replay tidak menggandakan
  assert.equal((await sql`select count(*)::int n from menu_items`)[0].n, before + 2);
  // Atomik: baris ke-2 valid menurut parser tetapi melanggar constraint DB; seluruh batch rollback.
  await sql`create function menu_import_boom() returns trigger language plpgsql as $f$ begin if new.name='Boom Impor' then raise exception 'boom' using errcode='23514'; end if; return new; end $f$`;
  await sql`create trigger menu_import_boom before insert on menu_items for each row execute function menu_import_boom()`;
  const csv2 = H + `${slug},Aman Impor,Kopi,5000,,,\n${slug},Boom Impor,Kopi,5000,,,\n`;
  const pv2 = await (await imp('/api/admin/menu-import/preview', 200, csv2)).json();
  await imp('/api/admin/menu-import/commit', 409, csv2, { token: pv2.token });
  assert.equal((await sql`select count(*)::int n from menu_items where name in ('Aman Impor','Boom Impor')`)[0].n, 0);
  await sql`drop trigger menu_import_boom on menu_items`;
  await sql`drop function menu_import_boom()`;
  await call('/api/admin/session',204,undefined,true,'DELETE');
  await call('/api/admin/session',401,undefined,true);
  console.log(`api flow passed: ${tests} HTTP assertions, persisted DONE, parallel checkout idempotency`);
}
main().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>sql.end());
