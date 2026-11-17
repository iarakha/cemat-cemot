-- Label pilihan gula "Less" menjadi "Less Sugar" (grup Level Es tetap "Less"). Aman diulang; id pilihan tidak berubah.
UPDATE "option_choices" c SET "label" = 'Less Sugar'
FROM "option_groups" g
WHERE c."group_id" = g."id" AND g."name" = 'Gula' AND c."label" = 'Less'
  AND NOT EXISTS (SELECT 1 FROM "option_choices" x WHERE x."group_id" = c."group_id" AND x."label" = 'Less Sugar');
