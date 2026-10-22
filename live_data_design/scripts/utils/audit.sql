CREATE TABLE IF NOT EXISTS live_run (
 run_id CHAR(36) CHARACTER SET ascii PRIMARY KEY,
 route_id VARCHAR(128) NOT NULL,
 source VARCHAR(16) NOT NULL,
 window_start DATETIME NOT NULL,
 window_end DATETIME NOT NULL,
 status VARCHAR(16) NOT NULL,
 exit_code INT NOT NULL,
 row_count INT NOT NULL,
 message VARCHAR(512) NOT NULL,
 finished_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 INDEX idx_run_route (route_id,finished_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
