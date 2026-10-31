// Pemeriksaan DB nyata. Semua fixture dibuat dalam transaksi yang selalu di-rollback.
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
const rollback = new Error("rollback check fixtures");

async function main() {
  const [settings] = await sql`SELECT status, admin_wa, use_unique_code FROM store_settings WHERE id = 1`;
  assert(settings, "store_settings belum diisi");
  assert(settings.admin_wa, "admin_wa belum dikonfigurasi");
  assert.equal(settings.use_unique_code, false, "QRIS baru tidak memakai kode unik nominal");
  if (process.argv.includes("--ready")) {
    const [ready] = await sql`SELECT
      EXISTS (SELECT 1 FROM admin_users) AS admin,
      EXISTS (SELECT 1 FROM partner_companies WHERE is_active) AS partner,
      EXISTS (SELECT 1 FROM payment_accounts WHERE type = 'QRIS_STATIC' AND is_active AND provider NOT ILIKE '%DEV%' AND account_name NOT ILIKE '%DEV%') AS merchant`;
    const missing = Object.entries(ready).filter(([, ok]) => !ok).map(([key]) => key);
    assert.equal(missing.length, 0, `Belum siap operasional: ${missing.join(", ")}`);
  }
  const accounts = await sql`SELECT qris_image_path FROM payment_accounts WHERE type = 'QRIS_STATIC' AND is_active`;
  assert(accounts.length, "QRIS aktif belum dikonfigurasi");
  const uploadDir = path.resolve(process.env.UPLOAD_DIR ?? ".uploads");
  for (const account of accounts) {
    assert.equal(typeof account.qris_image_path, "string");
    const file = path.resolve(uploadDir, account.qris_image_path);
    assert(file.startsWith(uploadDir + path.sep), "Path QRIS di luar UPLOAD_DIR");
    await access(file);
  }

  let checks = 0;
  try {
    await sql.begin(async (tx) => {
      const reject = async (query: string, code: string, constraint?: string) => {
        await assert.rejects(tx.savepoint(async (sp) => { await sp.unsafe(query); }), (error: unknown) => {
          assert(error instanceof postgres.PostgresError);
          assert.equal(error.code, code);
          if (constraint) assert.equal(error.constraint_name, constraint);
          return true;
        });
        checks++;
      };
      const [brand] = await tx`INSERT INTO brands (slug, name, accent_color) VALUES (gen_random_uuid()::text, 'DB check', '#000000') RETURNING id`;
      const [outlet] = await tx`INSERT INTO outlets (brand_id, name, lat, lng) VALUES (${brand.id}, 'DB check', 0, 0) RETURNING id, is_active`;
      assert.equal(outlet.is_active, true, "outlet harus aktif secara default");
      await tx`UPDATE outlets SET is_active = false WHERE id = ${outlet.id}`;
      const [inactiveOutlet] = await tx`SELECT is_active FROM outlets WHERE id = ${outlet.id}`;
      assert.equal(inactiveOutlet.is_active, false, "outlet bisa dinonaktifkan");
      await tx`UPDATE outlets SET is_active = true WHERE id = ${outlet.id}`;
      const [activeOutlet] = await tx`SELECT is_active FROM outlets WHERE id = ${outlet.id}`;
      assert.equal(activeOutlet.is_active, true, "outlet bisa diaktifkan kembali");
      checks += 3;
      const [menu] = await tx`INSERT INTO menu_items (brand_id, name, category, normal_price) VALUES (${brand.id}, 'DB check', 'check', 20000) RETURNING id`;
      const [partner] = await tx`INSERT INTO partner_companies (name, phone, website) VALUES ('DB check', '6281234567890', 'https://example.com') RETURNING id`;
      const [order] = await tx`INSERT INTO orders (tracking_token, order_code, customer_name, customer_phone, outlet_id, subtotal, service_fee, total, expires_at) VALUES (gen_random_uuid()::text, gen_random_uuid()::text, 'DB check', '6281234567890', ${outlet.id}, 20000, 5000, 25000, now() + interval '30 minutes') RETURNING id`;
      await tx`INSERT INTO order_items (order_id, menu_item_id, name_snapshot, unit_price, qty) VALUES (${order.id}, ${menu.id}, 'DB check', 20000, 1)`;
      const [payment] = await tx`INSERT INTO payments (order_id, expected_amount) VALUES (${order.id}, 25000) RETURNING id`;

      // Master pilihan: satu default per grup per menu, group_id harus cocok dengan pilihan, max_select >= 1.
      const [grp] = await tx`INSERT INTO option_groups (name) VALUES (${"DB check " + crypto.randomUUID()}) RETURNING id`;
      const [other] = await tx`INSERT INTO option_groups (name) VALUES (${"DB check " + crypto.randomUUID()}) RETURNING id`;
      const [c1, c2] = await tx`INSERT INTO option_choices (group_id, label) VALUES (${grp.id}, 'A'), (${grp.id}, 'B') RETURNING id`;
      await tx`INSERT INTO menu_item_choices (menu_item_id, choice_id, group_id, price_delta, is_default) VALUES (${menu.id}, ${c1.id}, ${grp.id}, -500, true)`;
      checks++;
      await reject(`INSERT INTO menu_item_choices (menu_item_id, choice_id, group_id, is_default) VALUES ('${menu.id}', '${c2.id}', '${grp.id}', true)`, "23505", "menu_item_choices_one_default_uq");
      await reject(`INSERT INTO menu_item_choices (menu_item_id, choice_id, group_id) VALUES ('${menu.id}', '${c2.id}', '${other.id}')`, "23503", "menu_item_choices_choice_group_fk");
      await reject(`INSERT INTO menu_item_choices (menu_item_id, choice_id, group_id) VALUES ('${menu.id}', '${c1.id}', '${grp.id}')`, "23505", "menu_item_choices_menu_item_id_choice_id_pk");
      await reject(`INSERT INTO option_choices (group_id, label) VALUES ('${grp.id}', 'A')`, "23505", "option_choices_group_label_uq");
      await reject(`UPDATE option_groups SET max_select = 0 WHERE id = '${grp.id}'`, "23514", "option_groups_max_select_chk");
      await reject(`INSERT INTO promo_prices (menu_item_id, promo_price) VALUES ('${menu.id}', 0)`, "23514", "promo_prices_price_chk");
      await reject("UPDATE store_settings SET status = 'INVALID'", "22P02");
      for (const status of ["OPEN", "CLOSED", "BREAK", "PRAYER", "LEAVE"]) {
        await tx`UPDATE store_settings SET status = ${status} WHERE id = 1`;
        checks++;
      }
      await reject(`UPDATE orders SET total = 1 WHERE id = '${order.id}'`, "23514", "orders_total_chk");
      await reject(`UPDATE orders SET unique_code = 100, total = 25100 WHERE id = '${order.id}'`, "23514", "orders_unique_code_chk");
      await reject(`UPDATE orders SET status = 'READY' WHERE id = '${order.id}'`, "23514", "orders_ready_chk");
      await reject(`UPDATE order_items SET qty = 0 WHERE order_id = '${order.id}'`, "23514", "order_items_qty_chk");
      await reject(`DELETE FROM menu_items WHERE id = '${menu.id}'`, "23503");
      await reject(`INSERT INTO payments (order_id, expected_amount) VALUES ('${order.id}', 25000)`, "23505", "payments_active_order_uq");
      await reject(`UPDATE payments SET status = 'VERIFIED', partner_amount = 20000 WHERE id = '${payment.id}'`, "23514", "payments_verified_partner_chk");
      await reject(`UPDATE payments SET status = 'VERIFIED', partner_company_id = '${partner.id}' WHERE id = '${payment.id}'`, "23514", "payments_verified_partner_chk");
      await reject(`UPDATE payments SET partner_amount = -1 WHERE id = '${payment.id}'`, "23514", "payments_partner_amount_chk");
      await reject(`UPDATE payments SET partner_company_id = '${crypto.randomUUID()}' WHERE id = '${payment.id}'`, "23503");
      await reject(`UPDATE partner_companies SET phone = '081234567890' WHERE id = '${partner.id}'`, "23514", "partner_companies_phone_chk");
      await tx`INSERT INTO partner_companies (name) VALUES ('DB check tanpa phone/website')`; // hanya nama wajib
      checks++;
      await reject(`INSERT INTO partner_companies (name) VALUES (NULL)`, "23502");
      await reject(`UPDATE partner_companies SET website = 'example.com' WHERE id = '${partner.id}'`, "23514", "partner_companies_website_chk");
      await tx`UPDATE payments SET status = 'VERIFIED', paid_amount = 25000, partner_company_id = ${partner.id}, partner_amount = 20000 WHERE id = ${payment.id}`;
      const [verified] = await tx`SELECT paid_amount, partner_amount FROM payments WHERE id = ${payment.id}`;
      assert.equal(verified.paid_amount, 25000);
      assert.equal(verified.partner_amount, 20000);
      checks++;
      await reject(`DELETE FROM partner_companies WHERE id = '${partner.id}'`, "23503");
      await tx`UPDATE orders SET status = 'READY', queue_number = 'A047', proof_image_path = 'check/proof.png' WHERE id = ${order.id}`;
      checks++;
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
  console.log(`DB check ok: ${checks} checks, fixtures rolled back; config + QRIS file accessible`);
  const counts = await sql`SELECT 'outlets' AS entity, count(*)::int FROM outlets UNION ALL SELECT 'partner_companies', count(*)::int FROM partner_companies UNION ALL SELECT 'admin_users', count(*)::int FROM admin_users`;
  for (const row of counts) console.log(`${row.entity}: ${row.count}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof assert.AssertionError ? error.message : "DB check gagal. Periksa koneksi, konfigurasi, dan constraint DB.");
  process.exitCode = 1;
}).finally(() => sql.end());
