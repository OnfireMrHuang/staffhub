-- MySQL 8.0: connect to the target database before executing. No DROP statements.
-- Mirrors of three source worksheets, not a physical routing abstraction.
CREATE TABLE IF NOT EXISTS live_source_app (
 row_key CHAR(64) CHARACTER SET ascii PRIMARY KEY,
 app_id VARCHAR(128) NOT NULL,
 source VARCHAR(16) NOT NULL,
 enabled BOOLEAN NOT NULL,
 record_json JSON NOT NULL,
 synced_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS live_source_account (
 row_key CHAR(64) CHARACTER SET ascii PRIMARY KEY,
 product_id VARCHAR(128) NOT NULL,
 room_id VARCHAR(128) NOT NULL,
 app_key CHAR(64) CHARACTER SET ascii NOT NULL,
 enabled BOOLEAN NOT NULL,
 record_json JSON NOT NULL,
 synced_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 INDEX idx_source_account_app (app_key),
 INDEX idx_source_account_room (product_id,room_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS live_source_backend (
 row_key CHAR(64) CHARACTER SET ascii PRIMARY KEY,
 product_id VARCHAR(128) NOT NULL,
 room_id VARCHAR(128) NOT NULL,
 enabled BOOLEAN NOT NULL,
 record_json JSON NOT NULL,
 synced_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 INDEX idx_source_backend_room (product_id,room_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
-- Normalized business catalog. Source mirrors are traceability only.
CREATE TABLE IF NOT EXISTS live_product (
 product_id VARCHAR(128) PRIMARY KEY,
 name VARCHAR(128) NOT NULL,
 enabled BOOLEAN NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS live_room (
 room_id VARCHAR(128) PRIMARY KEY,
 product_id VARCHAR(128) NOT NULL,
 name VARCHAR(128) NOT NULL,
 enabled BOOLEAN NOT NULL,
 CONSTRAINT fk_room_product FOREIGN KEY (product_id) REFERENCES live_product(product_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS live_ad_platform (
 platform_id CHAR(64) CHARACTER SET ascii PRIMARY KEY,
 source VARCHAR(16) NOT NULL,
 version VARCHAR(16) NOT NULL,
 UNIQUE KEY uq_ad_platform (source,version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS live_policy_platform (
 platform_id CHAR(64) CHARACTER SET ascii PRIMARY KEY,
 source VARCHAR(16) NOT NULL,
 UNIQUE KEY uq_policy_platform (source)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS live_oauth_application (
 app_key CHAR(64) CHARACTER SET ascii PRIMARY KEY,
 app_id VARCHAR(128) NOT NULL,
 source VARCHAR(16) NOT NULL,
 credential VARCHAR(128) NOT NULL,
 enabled BOOLEAN NOT NULL,
 UNIQUE KEY uq_oauth_app (source,app_id),
 UNIQUE KEY uq_oauth_alias (credential)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS live_ad_account (
 account_key CHAR(64) CHARACTER SET ascii PRIMARY KEY,
 advertiser_id VARCHAR(128) NOT NULL,
 name VARCHAR(128) NOT NULL,
 account_type VARCHAR(128) NOT NULL,
 platform_id CHAR(64) CHARACTER SET ascii NOT NULL,
 app_key CHAR(64) CHARACTER SET ascii NOT NULL,
 enabled BOOLEAN NOT NULL,
 CONSTRAINT fk_account_platform FOREIGN KEY (platform_id) REFERENCES live_ad_platform(platform_id),
 CONSTRAINT fk_account_app FOREIGN KEY (app_key) REFERENCES live_oauth_application(app_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS live_room_ad_account (
 room_id VARCHAR(128) NOT NULL,
 account_key CHAR(64) CHARACTER SET ascii NOT NULL,
 scope_json JSON NOT NULL,
 enabled BOOLEAN NOT NULL,
 PRIMARY KEY (room_id,account_key),
 CONSTRAINT fk_binding_room FOREIGN KEY (room_id) REFERENCES live_room(room_id),
 CONSTRAINT fk_binding_account FOREIGN KEY (account_key) REFERENCES live_ad_account(account_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS live_room_policy_backend (
 room_id VARCHAR(128) PRIMARY KEY,
 platform_id CHAR(64) CHARACTER SET ascii NOT NULL,
 selector VARCHAR(128) NOT NULL,
 platform VARCHAR(128) NOT NULL,
 credential VARCHAR(128) NOT NULL,
 enabled BOOLEAN NOT NULL,
 CONSTRAINT fk_backend_room FOREIGN KEY (room_id) REFERENCES live_room(room_id),
 CONSTRAINT fk_backend_platform FOREIGN KEY (platform_id) REFERENCES live_policy_platform(platform_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE OR REPLACE VIEW v_live_ad_task AS
 SELECT p.product_id,r.room_id,ap.source,oa.credential,a.advertiser_id,b.scope_json,
        ap.version,oa.app_id,a.name AS account_name,a.account_type,r.name AS room_name
 FROM live_product p
 JOIN live_room r ON r.product_id=p.product_id
 JOIN live_room_ad_account b ON b.room_id=r.room_id
 JOIN live_ad_account a ON a.account_key=b.account_key
 JOIN live_ad_platform ap ON ap.platform_id=a.platform_id
 JOIN live_oauth_application oa ON oa.app_key=a.app_key AND oa.source=ap.source
 WHERE p.enabled=1 AND r.enabled=1 AND b.enabled=1 AND a.enabled=1 AND oa.enabled=1;

CREATE OR REPLACE VIEW v_live_policy_task AS
 SELECT p.product_id,r.room_id,pp.source,b.credential,b.selector,b.platform,r.name AS room_name
 FROM live_product p
 JOIN live_room r ON r.product_id=p.product_id
 JOIN live_room_policy_backend b ON b.room_id=r.room_id
 JOIN live_policy_platform pp ON pp.platform_id=b.platform_id
 WHERE p.enabled=1 AND r.enabled=1 AND b.enabled=1;

CREATE OR REPLACE VIEW v_live_room_sources AS
 SELECT p.product_id,p.name AS product_name,r.room_id,r.name AS room_name,
        a.account_key,a.advertiser_id,a.name AS account_name,a.account_type,
        ap.source AS ad_source,ap.version AS ad_version,oa.app_id,
        pp.source AS policy_source,pb.selector AS policy_selector,pb.platform AS policy_platform,
        ab.scope_json,p.enabled AS product_enabled,r.enabled AS room_enabled,
        ab.enabled AS ad_binding_enabled,pb.enabled AS policy_binding_enabled
 FROM live_product p
 JOIN live_room r ON r.product_id=p.product_id
 LEFT JOIN live_room_ad_account ab ON ab.room_id=r.room_id
 LEFT JOIN live_ad_account a ON a.account_key=ab.account_key
 LEFT JOIN live_ad_platform ap ON ap.platform_id=a.platform_id
 LEFT JOIN live_oauth_application oa ON oa.app_key=a.app_key
 LEFT JOIN live_room_policy_backend pb ON pb.room_id=r.room_id
 LEFT JOIN live_policy_platform pp ON pp.platform_id=pb.platform_id;
