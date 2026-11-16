ALTER TABLE "orders" DROP CONSTRAINT "orders_ready_chk";--> statement-breakpoint
-- Preserve historical events and enum READY; normalize only current orders.
-- Old PROCESSING without evidence returns to PAID so admin can complete A06.
WITH legacy AS (
  SELECT id, status AS old_status,
    CASE WHEN status = 'READY' THEN 'PROCESSING'::order_status ELSE 'PAID'::order_status END AS new_status
  FROM orders
  WHERE status = 'READY' OR (status = 'PROCESSING' AND
    (nullif(btrim(queue_number), '') IS NULL OR nullif(btrim(order_proof_path), '') IS NULL))
), changed AS (
  UPDATE orders o SET status = l.new_status FROM legacy l WHERE o.id = l.id
  RETURNING o.id, l.old_status, l.new_status
)
INSERT INTO order_events (order_id, from_status, to_status, type, actor, note)
SELECT id, old_status, new_status, 'LEGACY_FLOW_MIGRATED', 'system',
  'Penyesuaian flow UI: bukti dan nomor antrean wajib saat mulai diproses.' FROM changed;
--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_processing_proof_chk" CHECK ("orders"."status" <> 'READY' AND ("orders"."status" NOT IN ('PROCESSING', 'DONE') OR (nullif(btrim("orders"."queue_number"), '') IS NOT NULL AND nullif(btrim("orders"."order_proof_path"), '') IS NOT NULL)));
