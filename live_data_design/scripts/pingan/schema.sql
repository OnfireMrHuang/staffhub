-- This source owns its policy facts and projections. MySQL 8.0.
CREATE TABLE IF NOT EXISTS live_policy_snapshot (
 route_id VARCHAR(128) NOT NULL,
 source_date DATE NOT NULL,
 session_hash CHAR(64) CHARACTER SET ascii NOT NULL,
 observed_hour DATETIME NOT NULL,
 session_id TEXT NOT NULL,
 product_id VARCHAR(128) NOT NULL,
 room_id VARCHAR(128) NOT NULL,
 source VARCHAR(16) NOT NULL,
 grain VARCHAR(32) NOT NULL,
 metrics JSON NOT NULL,
 observed_at DATETIME NOT NULL,
 PRIMARY KEY(route_id,source_date,session_hash,observed_hour),
 INDEX idx_snapshot_room (room_id,source_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS live_policy_order (
 route_id VARCHAR(128) NOT NULL,
 order_hash CHAR(64) CHARACTER SET ascii NOT NULL,
 order_id TEXT NOT NULL,
 session_id TEXT NOT NULL,
 source_date DATE NOT NULL,
 product_id VARCHAR(128) NOT NULL,
 room_id VARCHAR(128) NOT NULL,
 source VARCHAR(16) NOT NULL,
 payload JSON NOT NULL,
 first_seen_at DATETIME NOT NULL,
 observed_at DATETIME NOT NULL,
 PRIMARY KEY(route_id,order_hash),
 INDEX idx_orders_room (room_id,source_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- Generated from the owning source module field contract.
-- Raw JSON remains authoritative; missing/invalid/unsupported values are SQL NULL.

-- 【平安保单】统计指标表头字段
CREATE OR REPLACE VIEW v_pingan_stats AS
SELECT
  route_id,
  product_id,
  room_id,
  source,
  source_date,
  session_id,
  grain,
  observed_at,
  metrics AS raw_metrics,
  CASE WHEN JSON_TYPE(JSON_EXTRACT(metrics, '$."_collection"."context"."startDate"')) IN ('STRING','INTEGER','DOUBLE','DECIMAL') AND LENGTH(TRIM(JSON_UNQUOTE(JSON_EXTRACT(metrics, '$."_collection"."context"."startDate"')))) > 0 THEN JSON_UNQUOTE(JSON_EXTRACT(metrics, '$."_collection"."context"."startDate"')) ELSE NULL END AS `startDate`,
  NULL AS `gmvSimpleRoi`,
  NULL AS `performanceRoi`,
  NULL AS `adSpend`,
  CASE WHEN JSON_TYPE(JSON_EXTRACT(metrics, '$.summary')) = 'ARRAY' AND JSON_LENGTH(JSON_EXTRACT(metrics, '$.summary')) = 1 THEN CASE WHEN JSON_TYPE(JSON_EXTRACT(metrics, '$."summary"[0]."validPolicyCnt"')) IN ('INTEGER','DOUBLE','DECIMAL','STRING') AND REGEXP_LIKE(JSON_UNQUOTE(JSON_EXTRACT(metrics, '$."summary"[0]."validPolicyCnt"')), '^[+-]?[0-9]{1,35}([.][0-9]{1,30})?$', 'c') THEN CAST(JSON_UNQUOTE(JSON_EXTRACT(metrics, '$."summary"[0]."validPolicyCnt"')) AS DECIMAL(65,30)) ELSE NULL END ELSE NULL END AS `validPolicyCnt`,
  CASE WHEN JSON_TYPE(JSON_EXTRACT(metrics, '$.summary')) = 'ARRAY' AND JSON_LENGTH(JSON_EXTRACT(metrics, '$.summary')) = 1 THEN CASE WHEN JSON_TYPE(JSON_EXTRACT(metrics, '$."summary"[0]."annualPremium"')) IN ('INTEGER','DOUBLE','DECIMAL','STRING') AND REGEXP_LIKE(JSON_UNQUOTE(JSON_EXTRACT(metrics, '$."summary"[0]."annualPremium"')), '^[+-]?[0-9]{1,35}([.][0-9]{1,30})?$', 'c') THEN CAST(JSON_UNQUOTE(JSON_EXTRACT(metrics, '$."summary"[0]."annualPremium"')) AS DECIMAL(65,30)) ELSE NULL END ELSE NULL END AS `annualPremium`,
  CASE WHEN JSON_TYPE(JSON_EXTRACT(metrics, '$.summary')) = 'ARRAY' AND JSON_LENGTH(JSON_EXTRACT(metrics, '$.summary')) = 1 THEN CASE WHEN JSON_TYPE(JSON_EXTRACT(metrics, '$."summary"[0]."orderCnt"')) IN ('INTEGER','DOUBLE','DECIMAL','STRING') AND REGEXP_LIKE(JSON_UNQUOTE(JSON_EXTRACT(metrics, '$."summary"[0]."orderCnt"')), '^[+-]?[0-9]{1,35}([.][0-9]{1,30})?$', 'c') THEN CAST(JSON_UNQUOTE(JSON_EXTRACT(metrics, '$."summary"[0]."orderCnt"')) AS DECIMAL(65,30)) ELSE NULL END ELSE NULL END AS `orderCnt`,
  CASE WHEN JSON_TYPE(JSON_EXTRACT(metrics, '$.summary')) = 'ARRAY' AND JSON_LENGTH(JSON_EXTRACT(metrics, '$.summary')) = 1 THEN CASE WHEN JSON_TYPE(JSON_EXTRACT(metrics, '$."_collection"."derived"."calcBindCardRate"')) IN ('INTEGER','DOUBLE','DECIMAL','STRING') AND REGEXP_LIKE(JSON_UNQUOTE(JSON_EXTRACT(metrics, '$."_collection"."derived"."calcBindCardRate"')), '^[+-]?[0-9]{1,35}([.][0-9]{1,30})?$', 'c') THEN CAST(JSON_UNQUOTE(JSON_EXTRACT(metrics, '$."_collection"."derived"."calcBindCardRate"')) AS DECIMAL(65,30)) ELSE NULL END ELSE NULL END AS `calcBindCardRate`,
  CASE WHEN JSON_TYPE(JSON_EXTRACT(metrics, '$.summary')) = 'ARRAY' AND JSON_LENGTH(JSON_EXTRACT(metrics, '$.summary')) = 1 THEN CASE WHEN JSON_TYPE(JSON_EXTRACT(metrics, '$."_collection"."derived"."calcSurrenderRate"')) IN ('INTEGER','DOUBLE','DECIMAL','STRING') AND REGEXP_LIKE(JSON_UNQUOTE(JSON_EXTRACT(metrics, '$."_collection"."derived"."calcSurrenderRate"')), '^[+-]?[0-9]{1,35}([.][0-9]{1,30})?$', 'c') THEN CAST(JSON_UNQUOTE(JSON_EXTRACT(metrics, '$."_collection"."derived"."calcSurrenderRate"')) AS DECIMAL(65,30)) ELSE NULL END ELSE NULL END AS `calcSurrenderRate`,
  CASE WHEN JSON_TYPE(JSON_EXTRACT(metrics, '$.summary')) = 'ARRAY' AND JSON_LENGTH(JSON_EXTRACT(metrics, '$.summary')) = 1 THEN CASE WHEN JSON_TYPE(JSON_EXTRACT(metrics, '$."summary"[0]."undwrtPremium"')) IN ('INTEGER','DOUBLE','DECIMAL','STRING') AND REGEXP_LIKE(JSON_UNQUOTE(JSON_EXTRACT(metrics, '$."summary"[0]."undwrtPremium"')), '^[+-]?[0-9]{1,35}([.][0-9]{1,30})?$', 'c') THEN CAST(JSON_UNQUOTE(JSON_EXTRACT(metrics, '$."summary"[0]."undwrtPremium"')) AS DECIMAL(65,30)) ELSE NULL END ELSE NULL END AS `undwrtPremium`,
  CASE WHEN JSON_TYPE(JSON_EXTRACT(metrics, '$.summary')) = 'ARRAY' AND JSON_LENGTH(JSON_EXTRACT(metrics, '$.summary')) = 1 THEN CASE WHEN JSON_TYPE(JSON_EXTRACT(metrics, '$."summary"[0]."undwrtPremiumAnnual"')) IN ('INTEGER','DOUBLE','DECIMAL','STRING') AND REGEXP_LIKE(JSON_UNQUOTE(JSON_EXTRACT(metrics, '$."summary"[0]."undwrtPremiumAnnual"')), '^[+-]?[0-9]{1,35}([.][0-9]{1,30})?$', 'c') THEN CAST(JSON_UNQUOTE(JSON_EXTRACT(metrics, '$."summary"[0]."undwrtPremiumAnnual"')) AS DECIMAL(65,30)) ELSE NULL END ELSE NULL END AS `undwrtPremiumAnnual`,
  CASE WHEN JSON_TYPE(JSON_EXTRACT(metrics, '$.summary')) = 'ARRAY' AND JSON_LENGTH(JSON_EXTRACT(metrics, '$.summary')) = 1 THEN CASE WHEN JSON_TYPE(JSON_EXTRACT(metrics, '$."summary"[0]."undwrtPremiumMonthly"')) IN ('INTEGER','DOUBLE','DECIMAL','STRING') AND REGEXP_LIKE(JSON_UNQUOTE(JSON_EXTRACT(metrics, '$."summary"[0]."undwrtPremiumMonthly"')), '^[+-]?[0-9]{1,35}([.][0-9]{1,30})?$', 'c') THEN CAST(JSON_UNQUOTE(JSON_EXTRACT(metrics, '$."summary"[0]."undwrtPremiumMonthly"')) AS DECIMAL(65,30)) ELSE NULL END ELSE NULL END AS `undwrtPremiumMonthly`,
  CASE WHEN JSON_TYPE(JSON_EXTRACT(metrics, '$.summary')) = 'ARRAY' AND JSON_LENGTH(JSON_EXTRACT(metrics, '$.summary')) = 1 THEN CASE WHEN JSON_TYPE(JSON_EXTRACT(metrics, '$."_collection"."derived"."annualPolRate"')) IN ('INTEGER','DOUBLE','DECIMAL','STRING') AND REGEXP_LIKE(JSON_UNQUOTE(JSON_EXTRACT(metrics, '$."_collection"."derived"."annualPolRate"')), '^[+-]?[0-9]{1,35}([.][0-9]{1,30})?$', 'c') THEN CAST(JSON_UNQUOTE(JSON_EXTRACT(metrics, '$."_collection"."derived"."annualPolRate"')) AS DECIMAL(65,30)) ELSE NULL END ELSE NULL END AS `annualPolRate`,
  CASE WHEN JSON_TYPE(JSON_EXTRACT(metrics, '$.summary')) = 'ARRAY' AND JSON_LENGTH(JSON_EXTRACT(metrics, '$.summary')) = 1 THEN CASE WHEN JSON_TYPE(JSON_EXTRACT(metrics, '$."_collection"."derived"."multiApplicantPolRate"')) IN ('INTEGER','DOUBLE','DECIMAL','STRING') AND REGEXP_LIKE(JSON_UNQUOTE(JSON_EXTRACT(metrics, '$."_collection"."derived"."multiApplicantPolRate"')), '^[+-]?[0-9]{1,35}([.][0-9]{1,30})?$', 'c') THEN CAST(JSON_UNQUOTE(JSON_EXTRACT(metrics, '$."_collection"."derived"."multiApplicantPolRate"')) AS DECIMAL(65,30)) ELSE NULL END ELSE NULL END AS `multiApplicantPolRate`,
  CASE WHEN JSON_TYPE(JSON_EXTRACT(metrics, '$.summary')) = 'ARRAY' AND JSON_LENGTH(JSON_EXTRACT(metrics, '$.summary')) = 1 THEN CASE WHEN JSON_TYPE(JSON_EXTRACT(metrics, '$."summary"[0]."bindPolicyCnt"')) IN ('INTEGER','DOUBLE','DECIMAL','STRING') AND REGEXP_LIKE(JSON_UNQUOTE(JSON_EXTRACT(metrics, '$."summary"[0]."bindPolicyCnt"')), '^[+-]?[0-9]{1,35}([.][0-9]{1,30})?$', 'c') THEN CAST(JSON_UNQUOTE(JSON_EXTRACT(metrics, '$."summary"[0]."bindPolicyCnt"')) AS DECIMAL(65,30)) ELSE NULL END ELSE NULL END AS `bindPolicyCnt`,
  CASE WHEN JSON_TYPE(JSON_EXTRACT(metrics, '$."funnel"."ctr"')) IN ('INTEGER','DOUBLE','DECIMAL','STRING') AND REGEXP_LIKE(JSON_UNQUOTE(JSON_EXTRACT(metrics, '$."funnel"."ctr"')), '^[+-]?[0-9]{1,35}([.][0-9]{1,30})?$', 'c') THEN CAST(JSON_UNQUOTE(JSON_EXTRACT(metrics, '$."funnel"."ctr"')) AS DECIMAL(65,30)) ELSE NULL END AS `ctr`,
  CASE WHEN JSON_TYPE(JSON_EXTRACT(metrics, '$."funnel"."liveDuration60sUCountToLiveWatchUCountRate"')) IN ('INTEGER','DOUBLE','DECIMAL','STRING') AND REGEXP_LIKE(JSON_UNQUOTE(JSON_EXTRACT(metrics, '$."funnel"."liveDuration60sUCountToLiveWatchUCountRate"')), '^[+-]?[0-9]{1,35}([.][0-9]{1,30})?$', 'c') THEN CAST(JSON_UNQUOTE(JSON_EXTRACT(metrics, '$."funnel"."liveDuration60sUCountToLiveWatchUCountRate"')) AS DECIMAL(65,30)) ELSE NULL END AS `liveDuration60sUCountToLiveWatchUCountRate`,
  CASE WHEN JSON_TYPE(JSON_EXTRACT(metrics, '$."funnel"."liveComponentCtr"')) IN ('INTEGER','DOUBLE','DECIMAL','STRING') AND REGEXP_LIKE(JSON_UNQUOTE(JSON_EXTRACT(metrics, '$."funnel"."liveComponentCtr"')), '^[+-]?[0-9]{1,35}([.][0-9]{1,30})?$', 'c') THEN CAST(JSON_UNQUOTE(JSON_EXTRACT(metrics, '$."funnel"."liveComponentCtr"')) AS DECIMAL(65,30)) ELSE NULL END AS `liveComponentCtr`,
  CASE WHEN JSON_TYPE(JSON_EXTRACT(metrics, '$."funnel"."orderCommitRate"')) IN ('INTEGER','DOUBLE','DECIMAL','STRING') AND REGEXP_LIKE(JSON_UNQUOTE(JSON_EXTRACT(metrics, '$."funnel"."orderCommitRate"')), '^[+-]?[0-9]{1,35}([.][0-9]{1,30})?$', 'c') THEN CAST(JSON_UNQUOTE(JSON_EXTRACT(metrics, '$."funnel"."orderCommitRate"')) AS DECIMAL(65,30)) ELSE NULL END AS `orderCommitRate`,
  CASE WHEN JSON_TYPE(JSON_EXTRACT(metrics, '$."funnel"."policyTransRate"')) IN ('INTEGER','DOUBLE','DECIMAL','STRING') AND REGEXP_LIKE(JSON_UNQUOTE(JSON_EXTRACT(metrics, '$."funnel"."policyTransRate"')), '^[+-]?[0-9]{1,35}([.][0-9]{1,30})?$', 'c') THEN CAST(JSON_UNQUOTE(JSON_EXTRACT(metrics, '$."funnel"."policyTransRate"')) AS DECIMAL(65,30)) ELSE NULL END AS `policyTransRate`
FROM live_policy_snapshot WHERE source = 'pingan';

-- 【平安保单】订单表头字段
CREATE OR REPLACE VIEW v_pingan_orders AS
SELECT
  route_id,
  product_id,
  room_id,
  source,
  source_date,
  session_id,
  first_seen_at,
  observed_at,
  payload AS raw_payload,
  CASE WHEN JSON_TYPE(JSON_EXTRACT(payload, '$."_collection"."context"."startDate"')) IN ('STRING','INTEGER','DOUBLE','DECIMAL') AND LENGTH(TRIM(JSON_UNQUOTE(JSON_EXTRACT(payload, '$."_collection"."context"."startDate"')))) > 0 THEN JSON_UNQUOTE(JSON_EXTRACT(payload, '$."_collection"."context"."startDate"')) ELSE NULL END AS `startDate`,
  CASE WHEN JSON_TYPE(JSON_EXTRACT(payload, '$."applicant"."name"')) IN ('STRING','INTEGER','DOUBLE','DECIMAL') AND LENGTH(TRIM(JSON_UNQUOTE(JSON_EXTRACT(payload, '$."applicant"."name"')))) > 0 THEN JSON_UNQUOTE(JSON_EXTRACT(payload, '$."applicant"."name"')) ELSE NULL END AS `applicant_name`,
  CASE WHEN JSON_TYPE(JSON_EXTRACT(payload, '$."applicant"."age"')) IN ('STRING','INTEGER','DOUBLE','DECIMAL') AND LENGTH(TRIM(JSON_UNQUOTE(JSON_EXTRACT(payload, '$."applicant"."age"')))) > 0 THEN JSON_UNQUOTE(JSON_EXTRACT(payload, '$."applicant"."age"')) ELSE NULL END AS `applicant_age`,
  NULL AS `applicant_age_group`,
  CASE WHEN JSON_TYPE(JSON_EXTRACT(payload, '$."itemName"')) IN ('STRING','INTEGER','DOUBLE','DECIMAL') AND LENGTH(TRIM(JSON_UNQUOTE(JSON_EXTRACT(payload, '$."itemName"')))) > 0 THEN JSON_UNQUOTE(JSON_EXTRACT(payload, '$."itemName"')) ELSE NULL END AS `itemName`,
  CASE WHEN JSON_TYPE(JSON_EXTRACT(payload, '$."actualAmount"')) IN ('INTEGER','DOUBLE','DECIMAL','STRING') AND REGEXP_LIKE(JSON_UNQUOTE(JSON_EXTRACT(payload, '$."actualAmount"')), '^[+-]?[0-9]{1,35}([.][0-9]{1,30})?$', 'c') THEN CAST(JSON_UNQUOTE(JSON_EXTRACT(payload, '$."actualAmount"')) AS DECIMAL(65,30)) ELSE NULL END AS `actualAmount`,
  CASE WHEN JSON_TYPE(JSON_EXTRACT(payload, '$."premType"')) IN ('STRING','INTEGER','DOUBLE','DECIMAL') AND LENGTH(TRIM(JSON_UNQUOTE(JSON_EXTRACT(payload, '$."premType"')))) > 0 THEN JSON_UNQUOTE(JSON_EXTRACT(payload, '$."premType"')) ELSE NULL END AS `premType`,
  CASE WHEN JSON_TYPE(JSON_EXTRACT(payload, '$."insurantList"')) = 'NULL' THEN NULL ELSE JSON_EXTRACT(payload, '$."insurantList"') END AS `insurantList`,
  CASE WHEN JSON_TYPE(JSON_EXTRACT(payload, '$."orderStatus"')) IN ('INTEGER','DOUBLE','DECIMAL','STRING') AND REGEXP_LIKE(JSON_UNQUOTE(JSON_EXTRACT(payload, '$."orderStatus"')), '^[+-]?[0-9]{1,35}([.][0-9]{1,30})?$', 'c') THEN CAST(JSON_UNQUOTE(JSON_EXTRACT(payload, '$."orderStatus"')) AS DECIMAL(65,30)) ELSE NULL END AS `orderStatus`,
  CASE WHEN JSON_TYPE(JSON_EXTRACT(payload, '$."orderTime"')) IN ('STRING','INTEGER','DOUBLE','DECIMAL') AND LENGTH(TRIM(JSON_UNQUOTE(JSON_EXTRACT(payload, '$."orderTime"')))) > 0 THEN JSON_UNQUOTE(JSON_EXTRACT(payload, '$."orderTime"')) ELSE NULL END AS `orderTime`,
  CASE WHEN JSON_TYPE(JSON_EXTRACT(payload, '$."updatedDate"')) IN ('STRING','INTEGER','DOUBLE','DECIMAL') AND LENGTH(TRIM(JSON_UNQUOTE(JSON_EXTRACT(payload, '$."updatedDate"')))) > 0 THEN JSON_UNQUOTE(JSON_EXTRACT(payload, '$."updatedDate"')) ELSE NULL END AS `updatedDate`,
  CASE WHEN JSON_TYPE(JSON_EXTRACT(payload, '$."postId"')) IN ('STRING','INTEGER','DOUBLE','DECIMAL') AND LENGTH(TRIM(JSON_UNQUOTE(JSON_EXTRACT(payload, '$."postId"')))) > 0 THEN JSON_UNQUOTE(JSON_EXTRACT(payload, '$."postId"')) ELSE NULL END AS `postId`
FROM live_policy_order WHERE source = 'pingan';

