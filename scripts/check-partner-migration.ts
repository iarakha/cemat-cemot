// Exercise 0019 backfill against populated rows, only inside isolated API DB; always rollback.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import postgres from "postgres";

assert.match(new URL(process.env.DATABASE_URL!).pathname, /^\/cemat_cemot_api_test_/);
const sql = postgres(process.env.DATABASE_URL!);
const rollback = new Error("rollback fixture");
async function main() {
try {
  await sql.begin(async tx => {
    const [brand] = await tx`select id from brands limit 1`;
    const [outlet] = await tx`insert into outlets (brand_id,name,lat,lng) values (${brand.id},'Migration fixture',0,0) returning id`;
    const [partner] = await tx`insert into partner_companies (name,is_active) values ('Legacy inactive partner',false) returning id`;
    const [paid] = await tx`insert into orders (tracking_token,order_code,customer_name,customer_phone,outlet_id,status,subtotal,service_fee,total,expires_at,paid_at,queue_number,order_proof_path) values (gen_random_uuid()::text,gen_random_uuid()::text,'Fixture','6281234567890',${outlet.id},'PROCESSING',20000,0,20000,now(),now(),'OLD-1','order-proofs/legacy.jpg') returning id`;
    await tx`insert into orders (tracking_token,order_code,customer_name,customer_phone,outlet_id,subtotal,service_fee,total,expires_at) values (gen_random_uuid()::text,gen_random_uuid()::text,'Unpaid','6281234567890',${outlet.id},20000,0,20000,now())`;
    await tx`insert into payments (order_id,expected_amount,paid_amount,status,partner_company_id,partner_amount,verified_at) values (${paid.id},20000,20000,'VERIFIED',${partner.id},15000,now())`;
    const beforeOrders = await tx`select * from orders order by id`;
    const beforePayments = await tx`select * from payments order by id`;
    const migration = await readFile('drizzle/0019_partner_attempts.sql', 'utf8');
    await tx`drop table fulfillment_attempts`; // empty test table only; transaction restores it
    for (const statement of migration.split('--> statement-breakpoint')) await tx.unsafe(statement);
    assert.deepEqual(await tx`select * from orders order by id`, beforeOrders);
    assert.deepEqual(await tx`select * from payments order by id`, beforePayments);
    const attempts = await tx`select * from fulfillment_attempts`;
    assert.equal(attempts.length,1);
    assert.equal(attempts[0].partner_name,'Legacy inactive partner');
    assert.equal(attempts[0].partner_amount,15000);
    assert.equal(attempts[0].order_id,paid.id);
    const rejects = async (query: string, code: string) => {
      await assert.rejects(tx.savepoint(sp => sp.unsafe(query)), e => (e as {code?:string}).code === code);
    };
    await rejects(`update fulfillment_attempts set closed_at=now()`, '23514');
    await rejects(`update fulfillment_attempts set partner_amount=-1`, '23514');
    await rejects(`insert into fulfillment_attempts (order_id,sequence,partner_company_id,partner_name) values ('${paid.id}',2,'${partner.id}','Duplicate current')`, '23505');
    await rejects(`delete from partner_companies where id='${partner.id}'`, '23503');
    throw rollback;
  });
} catch (e) {
  if (e !== rollback) throw e;
} finally { await sql.end(); }
console.log('partner migration: populated backfill preserves orders/payments; constraints passed (rolled back)');
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
