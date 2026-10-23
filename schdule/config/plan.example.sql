-- Projection contract only. This empty SELECT deliberately cannot schedule production work.
-- Replace with a SELECT/JOIN over your synchronized original tables; keep these aliases.
-- Exclude disabled bindings in SQL. Use UNION ALL for account and backend projections,
-- not a wide account x backend join. options must be a JSON object or object text.
SELECT
  CAST(NULL AS CHAR(128)) AS product_id,
  CAST(NULL AS CHAR(128)) AS room_id,
  CAST(NULL AS CHAR(16)) AS source,
  CAST(NULL AS CHAR(128)) AS advertise_id,
  JSON_OBJECT() AS options
WHERE 1 = 0;
