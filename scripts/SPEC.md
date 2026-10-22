# 四类独立采集脚本规格 v2

版本：2026-10-22。本文是四类采集脚本的独立规格；主规格只引用本文。首先定义数据汇 MySQL DDL，然后定义目录与依赖边界，再按来源分别定义配置、参数、功能、用例及验收。

依据：[第一期直播数据管理 Page](https://chatgpt.com/space/page_1b6e05dc95ec81918416244f056f2cd4)、Page 指定的本地工作簿 `schdule/data/第一期试点直播间产品.xlsx` 和用户补充。本版按本地工作簿快照核对六张字段字典，共 266 个字段；未声称在线飞书内容与快照始终一致。真实账户、应用密钥、登录密码和手机号不复制到文档。

## 1. 数据汇 MySQL DDL

### 1.1 表与粒度

以下六张表属于来源脚本，DDL 在本版明确；产品、业务直播间、账户绑定等主数据表仍属待定设计，不能成为脚本建表或采集的前置条件。

| 类型 | MySQL 表 | 汇表字段数 | 一行含义 | 幂等边界 |
| --- | --- | ---: | --- | --- |
| 巨量营销 | `marketing_hourly` | 42 | 一个账户/可选主播范围、一个来源小时与维度组合 | 范围摘要＋来源小时＋维度摘要 |
| 巨量千川 | `qianchuan_hourly` | 111 | 一个账户/可选主播范围、一个来源小时与维度组合 | 范围摘要＋来源小时＋维度摘要 |
| 平安保单 | `pingan_stats` | 20 | 一个渠道、统计日期在实际观察小时的累计快照 | channel＋startDate＋observed_hour |
| 平安保单 | `pingan_orders` | 12 | 一个渠道下 postId 对应的最新订单记录 | channel＋postId |
| 众安保单 | `zhongan_stats` | 49 | 一个平台、dyNo、来源场次、统计日期在观察小时的累计快照 | livePlatform＋dyNo＋roomId＋startDate＋observed_hour |
| 众安保单 | `zhongan_orders` | 32 | 一个平台、dyNo 下 orderNo 对应的最新订单记录 | livePlatform＋dyNo＋orderNo |

字段来源：[营销](https://meimeiwangluo.feishu.cn/sheets/Chk0sVIOIh8OyjtOyiHceWxKnnb?sheet=LLrZfS)、[千川](https://meimeiwangluo.feishu.cn/sheets/Chk0sVIOIh8OyjtOyiHceWxKnnb?sheet=nagTnM)、[平安统计](https://meimeiwangluo.feishu.cn/sheets/Chk0sVIOIh8OyjtOyiHceWxKnnb?sheet=Odg2IZ)、[平安订单](https://meimeiwangluo.feishu.cn/sheets/Chk0sVIOIh8OyjtOyiHceWxKnnb?sheet=CdhaN0)、[众安统计](https://meimeiwangluo.feishu.cn/sheets/Chk0sVIOIh8OyjtOyiHceWxKnnb?sheet=wxKX4N)、[众安订单](https://meimeiwangluo.feishu.cn/sheets/Chk0sVIOIh8OyjtOyiHceWxKnnb?sheet=svfN0A)。每列保留原英文名、中文注释和原始顺序；技术列追加在末尾。

### 1.2 类型、空值与写入约定

- 目标 MySQL 8.0.16+，InnoDB、utf8mb4_bin、DYNAMIC 行格式。数据库由部署方先创建；以下 SQL 可按来源独立执行。建表能力依据 [MySQL CREATE TABLE](https://dev.mysql.com/doc/refman/8.0/en/create-table.html)。
- 账户、订单、场次等 ID 使用字符串，避免丢失大整数精度；订单/场次原 ID 保留前导零，广告正整数 ID 规范化去除前导零。CLI 中用户术语 `advertise_id` 写为 `--advertise-id`；请求和汇表保留原字段 `advertiser_id`，两者是同一个账户 ID。
- 金额、比率等已确认数值使用 DECIMAL(65,30)，来源明确为 integer 的计数使用 BIGINT；仅标明 number 的指标保留 DECIMAL。数值保留来源单位，不把元和分混用，不用二进制浮点作为金额存储。缺失、非规范或超精度数值投影为 NULL，原值仍在 raw_payload；BIGINT 非整数/溢出和必需键缺失使整个批次失败。
- 来源未明确类型的字段和数组使用独立 JSON 列；这仍然是逐字段物理列，不是把整张汇表塞进一个 JSON。原始响应额外保存在 raw_payload，供核对和后续映射。JSON 能力依据 [MySQL JSON](https://dev.mysql.com/doc/refman/8.0/en/json.html)。
- 时间统一按 Asia/Shanghai 写 DATETIME，不依赖服务器自动时区转换。来源小时/日期与 observed_at 分开；保单回补只能保存本次实际观察的累计值，不能伪造历史小时状态。
- 平安三项固定展示字段 gmvSimpleRoi/performanceRoi/adSpend 写 `-`；四项本地派生率按百分比字符串保留两位小数。漏斗百分率按字段表显示百分号，缺失为 `/`；原始缺失及精确派生值保留在 raw_payload。其他缺失默认 NULL，不用 0 补齐。
- `scope_key` 是来源、账户及实际查询条件的 SHA-256，不包含产品、业务直播间或凭据别名；scope_json 记录查询条件。账户全量与主播筛选是不同范围，查询时必须选择一个范围，不能把重叠范围相加。批量调度负责拒绝重叠归属。
- 广告仅在全部分页完整且字段校验通过后，在一个事务中按 scope_key 删除指定小时区间并插入完整新结果；允许成功空结果清空该范围旧值。失败回滚，保留旧数据。
- 保单按唯一键 upsert；订单保留首次 first_seen_at，更新 observed_at 和字段；同观察小时快照更新，新观察小时追加。无场次、响应结构异常、分页不全属于失败，不覆盖已有快照。
- 表之间不建立产品/业务直播间外键。众安 `roomId` 是接口要求的来源场次 ID；千川 `room_name` 是固定汇表展示列，均不等于内部业务 `room_id` 参数。

`fields.json` 记录每列的来源工作表、行号、映射路径、支持状态、SQL 类型与空值规则；`schema.sql` 是可执行定义。下面 SQL 与各来源文件保持一致。

### 1.3 巨量营销 DDL

执行文件：[marketing/schema.sql](marketing/schema.sql)。

```sql
-- MySQL 8.0.16+; source-owned typed data tables. No business-directory foreign keys.

CREATE TABLE IF NOT EXISTS `marketing_hourly` (
  `stat_time_hour` DATETIME NOT NULL COMMENT '时间-小时；来源汇表字段',
  `stat_time_day` DATE NULL COMMENT '时间-天；来源汇表字段',
  `stat_time_month` CHAR(7) NULL COMMENT '时间-月；来源汇表字段',
  `advertiser_id` VARCHAR(128) NOT NULL COMMENT '账户ID；来源汇表字段',
  `account_name` VARCHAR(512) NULL COMMENT '账户名称；来源汇表字段',
  `account_type` VARCHAR(512) NULL COMMENT '账户类型；来源汇表字段',
  `stat_platform` VARCHAR(512) NULL COMMENT '统计平台；来源汇表字段',
  `stat_cost` DECIMAL(65,30) NULL COMMENT '消耗(元)；来源汇表字段',
  `show_cnt` DECIMAL(65,30) NULL COMMENT '展示数；来源汇表字段',
  `cpm_platform` DECIMAL(65,30) NULL COMMENT '平均千次展现费用(元)；来源汇表字段',
  `click_cnt` DECIMAL(65,30) NULL COMMENT '点击数；来源汇表字段',
  `ctr` DECIMAL(65,30) NULL COMMENT '点击率；来源汇表字段',
  `cpc_platform` DECIMAL(65,30) NULL COMMENT '平均点击单价(元)；来源汇表字段',
  `attribution_convert_cnt` DECIMAL(65,30) NULL COMMENT '转化数(计费时间)；来源汇表字段',
  `attribution_convert_cost` DECIMAL(65,30) NULL COMMENT '转化成本(计费时间)；来源汇表字段',
  `attribution_conversion_rate` DECIMAL(65,30) NULL COMMENT '转化率(计费时间)；来源汇表字段',
  `convert_cnt` DECIMAL(65,30) NULL COMMENT '转化数；来源汇表字段',
  `conversion_cost` DECIMAL(65,30) NULL COMMENT '平均转化成本(元)；来源汇表字段',
  `conversion_rate` DECIMAL(65,30) NULL COMMENT '转化率；来源汇表字段',
  `form` DECIMAL(65,30) NULL COMMENT '表单提交；来源汇表字段',
  `form_submit` DECIMAL(65,30) NULL COMMENT '附加创意表单提交；来源汇表字段',
  `consult_effective` DECIMAL(65,30) NULL COMMENT '有效咨询；来源汇表字段',
  `attribution_form` DECIMAL(65,30) NULL COMMENT '表单提交(计费时间)；来源汇表字段',
  `form_and_submit_count` DECIMAL(65,30) NULL COMMENT '表单提交数(包含附加创意表单数)；来源汇表字段',
  `form_and_submit_cost` DECIMAL(65,30) NULL COMMENT '表单提交成本(包含附加创意表单数)；来源汇表字段',
  `premium_payment_count` DECIMAL(65,30) NULL COMMENT '保险支付数；来源汇表字段',
  `premium_payment_cost` DECIMAL(65,30) NULL COMMENT '保险支付成本(元)；来源汇表字段',
  `stat_insurance_payment_pay_amount` DECIMAL(65,30) NULL COMMENT '保费成交金额；来源汇表字段',
  `stat_insurance_payment_roi` DECIMAL(65,30) NULL COMMENT '保费成交ROI；来源汇表字段',
  `attribution_insurance_payment_pay_amount` DECIMAL(65,30) NULL COMMENT '保费成交金额（计费时间）；来源汇表字段',
  `attribution_insurance_payment_roi` DECIMAL(65,30) NULL COMMENT '保费成交ROI（计费时间）；来源汇表字段',
  `luban_live_enter_cnt` DECIMAL(65,30) NULL COMMENT '直播间观看数；来源汇表字段',
  `live_watch_one_minute_count` DECIMAL(65,30) NULL COMMENT '直播间超过1分钟观看数；来源汇表字段',
  `luban_live_follow_cnt` DECIMAL(65,30) NULL COMMENT '直播间关注数；来源汇表字段',
  `luban_live_share_cnt` DECIMAL(65,30) NULL COMMENT '直播间分享数；来源汇表字段',
  `luban_live_comment_cnt` DECIMAL(65,30) NULL COMMENT '直播间评论数；来源汇表字段',
  `live_component_click_count` DECIMAL(65,30) NULL COMMENT '组件点击数；来源汇表字段',
  `live_component_click_cost` DECIMAL(65,30) NULL COMMENT '组件点击成本；来源汇表字段',
  `live_component_click_rate` DECIMAL(65,30) NULL COMMENT '组件点击率；来源汇表字段',
  `deep_convert_cnt` DECIMAL(65,30) NULL COMMENT '深度转化数；来源汇表字段',
  `deep_convert_cost` DECIMAL(65,30) NULL COMMENT '深度转化成本(元)；来源汇表字段',
  `deep_convert_rate` DECIMAL(65,30) NULL COMMENT '深度转化率；来源汇表字段',
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `scope_key` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '来源查询范围摘要，不含产品/业务直播间',
  `scope_json` JSON NOT NULL,
  `dimension_key` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `observed_at` DATETIME(6) NOT NULL COMMENT '北京时间实际采集时刻',
  `raw_payload` JSON NOT NULL COMMENT '保留原始响应及采集上下文',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_scope_hour_dimension` (`scope_key`,`stat_time_hour`,`dimension_key`),
  KEY `idx_account_hour` (`advertiser_id`,`stat_time_hour`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC;
```

### 1.4 巨量千川 DDL

执行文件：[qianchuan/schema.sql](qianchuan/schema.sql)。

```sql
-- MySQL 8.0.16+; source-owned typed data tables. No business-directory foreign keys.

CREATE TABLE IF NOT EXISTS `qianchuan_hourly` (
  `stat_datetime` DATETIME NOT NULL COMMENT '数据起始时间；来源汇表字段',
  `stat_time_day` DATE NULL COMMENT '统计日期；来源汇表字段',
  `stat_time_hour` DATETIME NULL COMMENT '统计小时；来源汇表字段',
  `start_date` DATE NULL COMMENT '查询开始日期；来源汇表字段',
  `end_date` DATE NULL COMMENT '查询结束日期；来源汇表字段',
  `time_granularity` VARCHAR(512) NULL COMMENT '时间粒度；来源汇表字段',
  `advertiser_id` VARCHAR(128) NOT NULL COMMENT '账户ID；来源汇表字段',
  `account_name` VARCHAR(512) NULL COMMENT '账户名称；来源汇表字段',
  `account_type` VARCHAR(512) NULL COMMENT '账户类型；来源汇表字段',
  `stat_platform` VARCHAR(512) NULL COMMENT '统计平台；来源汇表字段',
  `stats_authority` VARCHAR(512) NULL COMMENT '投放账户查询范围；来源汇表字段',
  `aweme_id` VARCHAR(128) NULL COMMENT '抖音号内部ID；来源汇表字段',
  `aweme_show_id` VARCHAR(128) NULL COMMENT '手机端可见抖音号；来源汇表字段',
  `aweme_nick_name` VARCHAR(512) NULL COMMENT '抖音昵称；来源汇表字段',
  `room_name` VARCHAR(512) NULL COMMENT '业务直播间名称；来源汇表字段',
  `stat_cost` DECIMAL(65,30) NULL COMMENT '消耗；来源汇表字段',
  `show_cnt` DECIMAL(65,30) NULL COMMENT '展示次数；来源汇表字段',
  `ctr` DECIMAL(65,30) NULL COMMENT '点击率；来源汇表字段',
  `cpm_platform` DECIMAL(65,30) NULL COMMENT '平均千次展示费用；来源汇表字段',
  `click_cnt` DECIMAL(65,30) NULL COMMENT '点击次数；来源汇表字段',
  `pay_order_count` DECIMAL(65,30) NULL COMMENT '直接成交订单数；来源汇表字段',
  `create_order_amount` DECIMAL(65,30) NULL COMMENT '直接下单金额；来源汇表字段',
  `create_order_count` DECIMAL(65,30) NULL COMMENT '直接下单订单数；来源汇表字段',
  `pay_order_amount` DECIMAL(65,30) NULL COMMENT '直接成交金额；来源汇表字段',
  `create_order_roi` DECIMAL(65,30) NULL COMMENT '直接下单roi；来源汇表字段',
  `dy_follow` DECIMAL(65,30) NULL COMMENT '新增粉丝数；来源汇表字段',
  `prepay_and_pay_order_roi` DECIMAL(65,30) NULL COMMENT '直接支付roi；来源汇表字段',
  `prepay_order_count` DECIMAL(65,30) NULL COMMENT '直接预售订单数；来源汇表字段',
  `prepay_order_amount` DECIMAL(65,30) NULL COMMENT '直接预售金额；来源汇表字段',
  `total_play` DECIMAL(65,30) NULL COMMENT '播放数；来源汇表字段',
  `play_duration_3s` DECIMAL(65,30) NULL COMMENT '3s播放数；来源汇表字段',
  `play_25_feed_break` DECIMAL(65,30) NULL COMMENT '25%进度播放数；来源汇表字段',
  `play_50_feed_break` DECIMAL(65,30) NULL COMMENT '50%进度播放数；来源汇表字段',
  `play_75_feed_break` DECIMAL(65,30) NULL COMMENT '75%进度播放数；来源汇表字段',
  `play_over` DECIMAL(65,30) NULL COMMENT '播放完成数；来源汇表字段',
  `play_over_rate` DECIMAL(65,30) NULL COMMENT '完播率；来源汇表字段',
  `convert_cnt` DECIMAL(65,30) NULL COMMENT '转化次数 （即将下线）；来源汇表字段',
  `convert_cost` DECIMAL(65,30) NULL COMMENT '转化成本（即将下线）；来源汇表字段',
  `convert_rate` DECIMAL(65,30) NULL COMMENT '转化率（即将下线）；来源汇表字段',
  `luban_live_click_product_cnt` DECIMAL(65,30) NULL COMMENT '直播间商品点击次数；来源汇表字段',
  `luban_live_enter_cnt` DECIMAL(65,30) NULL COMMENT '直播间观看人次；来源汇表字段',
  `cpc_platform` DECIMAL(65,30) NULL COMMENT '平均点击单价；来源汇表字段',
  `deep_convert_cnt` DECIMAL(65,30) NULL COMMENT '深度转化次数；来源汇表字段',
  `deep_convert_cost` DECIMAL(65,30) NULL COMMENT '深度转化成本；来源汇表字段',
  `deep_convert_rate` DECIMAL(65,30) NULL COMMENT '深度转化率；来源汇表字段',
  `attribution_convert_cnt` DECIMAL(65,30) NULL COMMENT '转化数（计费时间）；来源汇表字段',
  `attribution_convert_rate` DECIMAL(65,30) NULL COMMENT '转化率（计费时间）；来源汇表字段',
  `attribution_convert_cost` DECIMAL(65,30) NULL COMMENT '转化成本（计费时间）；来源汇表字段',
  `attribution_deep_convert_cnt` DECIMAL(65,30) NULL COMMENT '深度转化次数（计费时间）；来源汇表字段',
  `attribution_deep_convert_cost` DECIMAL(65,30) NULL COMMENT '深度转化成本（计费时间）；来源汇表字段',
  `attribution_deep_convert_rate` DECIMAL(65,30) NULL COMMENT '深度转化率（计费时间）；来源汇表字段',
  `all_order_create_roi_7days` DECIMAL(65,30) NULL COMMENT '7日总下单ROI；来源汇表字段',
  `all_order_pay_roi_7days` DECIMAL(65,30) NULL COMMENT '7日总支付ROI；来源汇表字段',
  `all_order_pay_gmv_7days` DECIMAL(65,30) NULL COMMENT '7日总成交金额；来源汇表字段',
  `all_order_pay_count_7days` DECIMAL(65,30) NULL COMMENT '7日总成交订单；来源汇表字段',
  `pay_order_cost_per_order` DECIMAL(65,30) NULL COMMENT '直接成交客单价；来源汇表字段',
  `create_order_coupon_amount` DECIMAL(65,30) NULL COMMENT '下单智能优惠券金额；来源汇表字段',
  `pay_order_coupon_amount` DECIMAL(65,30) NULL COMMENT '成交智能优惠券金额；来源汇表字段',
  `indirect_order_create_count_7days` DECIMAL(65,30) NULL COMMENT '间接下单订单数；来源汇表字段',
  `indirect_order_create_gmv_7days` DECIMAL(65,30) NULL COMMENT '间接下单金额；来源汇表字段',
  `indirect_order_pay_count_7days` DECIMAL(65,30) NULL COMMENT '间接成交订单数；来源汇表字段',
  `indirect_order_pay_gmv_7days` DECIMAL(65,30) NULL COMMENT '间接成交金额；来源汇表字段',
  `indirect_order_prepay_count_7days` DECIMAL(65,30) NULL COMMENT '间接预售订单数；来源汇表字段',
  `indirect_order_prepay_gmv_7days` DECIMAL(65,30) NULL COMMENT '间接预售金额；来源汇表字段',
  `qianchuan_first_order_cnt` DECIMAL(65,30) NULL COMMENT '店铺首单新客人数；来源汇表字段',
  `qianchuan_first_order_rate` DECIMAL(65,30) NULL COMMENT '店铺首单新客订单占比；来源汇表字段',
  `qianchuan_first_order_convert_cost` DECIMAL(65,30) NULL COMMENT '店铺首单新客转化成本；来源汇表字段',
  `qianchuan_first_order_direct_pay_gmv` DECIMAL(65,30) NULL COMMENT '店铺首单新客直接成交金额；来源汇表字段',
  `qianchuan_first_order_direct_pay_order_roi` DECIMAL(65,30) NULL COMMENT '店铺首单新客直接支付ROI；来源汇表字段',
  `qianchuan_first_order_ltv30` DECIMAL(65,30) NULL COMMENT '店铺首单新客30天累计成交金额；来源汇表字段',
  `qianchuan_first_order_roi30` DECIMAL(65,30) NULL COMMENT '店铺首单新客30天累计支付ROI；来源汇表字段',
  `live_pay_order_cost_per_order` DECIMAL(65,30) NULL COMMENT '成交客单价；来源汇表字段',
  `qianchuan_brand_first_order_rate` DECIMAL(65,30) NULL COMMENT '品牌首单新客订单占比；来源汇表字段',
  `qianchuan_brand_first_order_convert_cost` DECIMAL(65,30) NULL COMMENT '品牌首单新客转化成本；来源汇表字段',
  `qianchuan_brand_first_order_ltv30` DECIMAL(65,30) NULL COMMENT '品牌首单新客30天累计成交金额；来源汇表字段',
  `qianchuan_brand_first_order_direct_pay_order_roi` DECIMAL(65,30) NULL COMMENT '品牌首单新客直接支付roi；来源汇表字段',
  `qianchuan_brand_first_order_roi30` DECIMAL(65,30) NULL COMMENT '品牌首单新客30天累计支付roi；来源汇表字段',
  `qianchuan_brand_first_order_cnt` DECIMAL(65,30) NULL COMMENT '品牌首单新客数；来源汇表字段',
  `qianchuan_brand_first_order_direct_pay_gmv` DECIMAL(65,30) NULL COMMENT '品牌首单新客直接成交金额；来源汇表字段',
  `qianchuan_author_first_order_rate` DECIMAL(65,30) NULL COMMENT '抖音号首单新客订单占比；来源汇表字段',
  `qianchuan_author_first_order_roi30` DECIMAL(65,30) NULL COMMENT '抖音号首单新客30天累计支付roi；来源汇表字段',
  `qianchuan_author_first_order_cnt` DECIMAL(65,30) NULL COMMENT '抖音号首单新客数；来源汇表字段',
  `qianchuan_author_first_order_convert_cost` DECIMAL(65,30) NULL COMMENT '抖音号首单新客转化成本；来源汇表字段',
  `qianchuan_author_first_order_direct_pay_gmv` DECIMAL(65,30) NULL COMMENT '抖音号首单新客直接成交金额；来源汇表字段',
  `qianchuan_author_first_order_direct_pay_order_roi` DECIMAL(65,30) NULL COMMENT '抖音号首单新客直接支付roi；来源汇表字段',
  `qianchuan_author_first_order_ltv30` DECIMAL(65,30) NULL COMMENT '抖音号首单新客30天累计成交金额；来源汇表字段',
  `ad_all_order_gmv_settle_rate_7d` DECIMAL(65,30) NULL COMMENT '直接成交金额结算率(7天)；来源汇表字段',
  `ad_all_order_gmv_settle_rate_14d` DECIMAL(65,30) NULL COMMENT '直接成交金额结算率(14天)；来源汇表字段',
  `unfinished_estimate_order_gmv` DECIMAL(65,30) NULL COMMENT '未完结直接预售订单预估金额；来源汇表字段',
  `indirect_order_unfinished_estimate_gmv_7days` DECIMAL(65,30) NULL COMMENT '未完结间接预售订单预估金额；来源汇表字段',
  `ad_all_order_settle_amount_7d` DECIMAL(65,30) NULL COMMENT '直接结算金额(7天)；来源汇表字段',
  `ad_all_order_settle_count_7d` DECIMAL(65,30) NULL COMMENT '直接结算订单数(7天)；来源汇表字段',
  `ad_all_order_count_settle_rate_7d` DECIMAL(65,30) NULL COMMENT '直接订单结算率(7天)；来源汇表字段',
  `ad_all_order_settle_roi_7d` DECIMAL(65,30) NULL COMMENT '直接结算ROI(7天)；来源汇表字段',
  `ad_all_order_settle_cost_7d` DECIMAL(65,30) NULL COMMENT '直接结算成本(7天)；来源汇表字段',
  `all_order_refund_count_7d` DECIMAL(65,30) NULL COMMENT '直接退款订单数(7天)；来源汇表字段',
  `all_order_refund_amount_7d` DECIMAL(65,30) NULL COMMENT '直接退款金额(7天)；来源汇表字段',
  `ad_order_gmv_refund_rate_7d` DECIMAL(65,30) NULL COMMENT '直接退款率(7天)；来源汇表字段',
  `ad_order_refund_rate_7d` DECIMAL(65,30) NULL COMMENT '直接订单数退货率(7天)；来源汇表字段',
  `ad_all_order_settle_amount_14d` DECIMAL(65,30) NULL COMMENT '直接结算金额(14天)；来源汇表字段',
  `ad_all_order_settle_count_14d` DECIMAL(65,30) NULL COMMENT '直接结算订单数(14天)；来源汇表字段',
  `ad_all_order_count_settle_rate_14d` DECIMAL(65,30) NULL COMMENT '直接订单结算率(14天)；来源汇表字段',
  `ad_all_order_settle_roi_14d` DECIMAL(65,30) NULL COMMENT '直接结算ROI(14天)；来源汇表字段',
  `ad_all_order_settle_cost_14d` DECIMAL(65,30) NULL COMMENT '直接结算成本(14天)；来源汇表字段',
  `all_order_refund_count_14d` DECIMAL(65,30) NULL COMMENT '直接退款订单数(14天)；来源汇表字段',
  `all_order_refund_amount_14d` DECIMAL(65,30) NULL COMMENT '直接退款金额(14天)；来源汇表字段',
  `ad_order_gmv_refund_rate_14d` DECIMAL(65,30) NULL COMMENT '直接退款率(14天)；来源汇表字段',
  `ad_order_refund_rate_14d` DECIMAL(65,30) NULL COMMENT '直接订单数退货率(14天)；来源汇表字段',
  `ecp_convert_cnt` DECIMAL(65,30) NULL COMMENT '转化数；来源汇表字段',
  `ecp_convert_rate` DECIMAL(65,30) NULL COMMENT '转化率；来源汇表字段',
  `ecp_cpa_platform` DECIMAL(65,30) NULL COMMENT '转化成本；来源汇表字段',
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `scope_key` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '来源查询范围摘要，不含产品/业务直播间',
  `scope_json` JSON NOT NULL,
  `dimension_key` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `observed_at` DATETIME(6) NOT NULL COMMENT '北京时间实际采集时刻',
  `raw_payload` JSON NOT NULL COMMENT '保留原始响应及采集上下文',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_scope_hour_dimension` (`scope_key`,`stat_datetime`,`dimension_key`),
  KEY `idx_account_hour` (`advertiser_id`,`stat_datetime`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC;
```

### 1.5 平安保单 DDL

执行文件：[pingan/schema.sql](pingan/schema.sql)。

```sql
-- MySQL 8.0.16+; source-owned typed data tables. No business-directory foreign keys.

CREATE TABLE IF NOT EXISTS `pingan_stats` (
  `startDate` DATE NOT NULL COMMENT '统计日期；来源汇表字段',
  `gmvSimpleRoi` VARCHAR(512) NULL COMMENT 'GMV简易ROI；来源汇表字段',
  `performanceRoi` VARCHAR(512) NULL COMMENT '业绩ROI；来源汇表字段',
  `adSpend` VARCHAR(512) NULL COMMENT '投放消耗(元)；来源汇表字段',
  `validPolicyCnt` BIGINT NULL COMMENT '保单数（件）；来源汇表字段',
  `annualPremium` DECIMAL(65,30) NULL COMMENT '年化保费（元）；来源汇表字段',
  `orderCnt` BIGINT NULL COMMENT '订单数（件）；来源汇表字段',
  `calcBindCardRate` VARCHAR(64) NULL COMMENT '绑卡率（%）；来源汇表字段',
  `calcSurrenderRate` VARCHAR(64) NULL COMMENT '保单退保率（%）；来源汇表字段',
  `undwrtPremium` DECIMAL(65,30) NULL COMMENT '当日投保保费（元）；来源汇表字段',
  `undwrtPremiumAnnual` DECIMAL(65,30) NULL COMMENT '当日投保保费-年缴（元）；来源汇表字段',
  `undwrtPremiumMonthly` DECIMAL(65,30) NULL COMMENT '当日投保保费-月缴（元）；来源汇表字段',
  `annualPolRate` VARCHAR(64) NULL COMMENT '年缴单占比（%）；来源汇表字段',
  `multiApplicantPolRate` VARCHAR(64) NULL COMMENT '多人单占比（%）；来源汇表字段',
  `bindPolicyCnt` BIGINT NULL COMMENT '绑卡保单数（件）；来源汇表字段',
  `ctr` VARCHAR(64) NULL COMMENT '外层点击率；来源汇表字段',
  `liveDuration60sUCountToLiveWatchUCountRate` VARCHAR(64) NULL COMMENT '超一分钟观看率；来源汇表字段',
  `liveComponentCtr` VARCHAR(64) NULL COMMENT '组件点击率；来源汇表字段',
  `orderCommitRate` VARCHAR(64) NULL COMMENT '订单提交率；来源汇表字段',
  `policyTransRate` VARCHAR(64) NULL COMMENT '保单转化率；来源汇表字段',
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `channel` VARCHAR(128) NOT NULL COMMENT 'merchantChannel' ,
  `observed_hour` DATETIME NOT NULL COMMENT '实际观察时刻所属小时，非历史回补小时',
  `observed_at` DATETIME(6) NOT NULL COMMENT '北京时间实际采集时刻',
  `raw_payload` JSON NOT NULL COMMENT '保留原始响应及采集上下文',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_channel_day_observation` (`channel`,`startDate`,`observed_hour`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC;

CREATE TABLE IF NOT EXISTS `pingan_orders` (
  `startDate` DATE NULL COMMENT '统计日期；来源汇表字段',
  `applicant_name` VARCHAR(512) NULL COMMENT '投保人；来源汇表字段',
  `applicant_age` VARCHAR(512) NULL COMMENT '投保人年龄；来源汇表字段',
  `applicant_age_group` VARCHAR(512) NULL COMMENT '投保人年龄组；来源汇表字段',
  `itemName` VARCHAR(512) NULL COMMENT '产品；来源汇表字段',
  `actualAmount` DECIMAL(65,30) NULL COMMENT '保费；来源汇表字段',
  `premType` VARCHAR(512) NULL COMMENT '缴费方式；来源汇表字段',
  `insurantList` JSON NULL COMMENT '被保人；来源汇表字段',
  `orderStatus` BIGINT NULL COMMENT '订单状态；来源汇表字段',
  `orderTime` VARCHAR(512) NULL COMMENT '下单时间；来源汇表字段',
  `updatedDate` VARCHAR(512) NULL COMMENT '更新时间；来源汇表字段',
  `postId` VARCHAR(128) NOT NULL COMMENT '接口标识（postId）；来源汇表字段',
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `channel` VARCHAR(128) NOT NULL COMMENT 'merchantChannel' ,
  `first_seen_at` DATETIME(6) NOT NULL,
  `observed_at` DATETIME(6) NOT NULL COMMENT '北京时间实际采集时刻',
  `raw_payload` JSON NOT NULL COMMENT '保留原始响应及采集上下文',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_channel_order` (`channel`,`postId`),
  KEY `idx_channel_date` (`channel`,`startDate`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC;
```

### 1.6 众安保单 DDL

执行文件：[zhongan/schema.sql](zhongan/schema.sql)。

```sql
-- MySQL 8.0.16+; source-owned typed data tables. No business-directory foreign keys.

CREATE TABLE IF NOT EXISTS `zhongan_stats` (
  `livePlatform` VARCHAR(128) NOT NULL COMMENT '直播平台；来源汇表字段',
  `dyNo` VARCHAR(128) NOT NULL COMMENT '直播间号码；来源汇表字段',
  `anchorNick` VARCHAR(512) NULL COMMENT '直播间名称；来源汇表字段',
  `agentLiveName` VARCHAR(512) NULL COMMENT '所属机构；来源汇表字段',
  `startDate` DATE NOT NULL COMMENT '统计日期；来源汇表字段',
  `roomId` VARCHAR(128) NOT NULL COMMENT '直播场次ID；来源汇表字段',
  `startTime` VARCHAR(512) NULL COMMENT '开播时间；来源汇表字段',
  `collectedAt` VARCHAR(512) NULL COMMENT '采集时间（北京时间）；来源汇表字段',
  `cost` DECIMAL(65,30) NULL COMMENT '消耗；来源汇表字段',
  `policyCnt` DECIMAL(65,30) NULL COMMENT '保单数；来源汇表字段',
  `orderCnt` DECIMAL(65,30) NULL COMMENT '订单数；来源汇表字段',
  `distinctOrder` DECIMAL(65,30) NULL COMMENT '去重订单数；来源汇表字段',
  `policyRate` DECIMAL(65,30) NULL COMMENT '保单率；来源汇表字段',
  `annualPremiumRate` DECIMAL(65,30) NULL COMMENT '年缴比；来源汇表字段',
  `multipleRate` DECIMAL(65,30) NULL COMMENT '投/被多单比；来源汇表字段',
  `totalPremium` DECIMAL(65,30) NULL COMMENT '总保费；来源汇表字段',
  `totalAmount` DECIMAL(65,30) NULL COMMENT '总金额；来源汇表字段',
  `liveLandingUV` DECIMAL(65,30) NULL COMMENT '落地页UV；来源汇表字段',
  `roi` JSON NULL COMMENT 'ROI；来源类型待确认，保留JSON',
  `policyCost` DECIMAL(65,30) NULL COMMENT '保单成本；来源汇表字段',
  `premiumAvg` JSON NULL COMMENT '平均保费；来源类型待确认，保留JSON',
  `emptyCostRate` DECIMAL(65,30) NULL COMMENT '空耗率；来源汇表字段',
  `roomCreateTime` VARCHAR(512) NULL COMMENT '场次创建时间；来源汇表字段',
  `roomFinishTime` VARCHAR(512) NULL COMMENT '场次结束时间；来源汇表字段',
  `mayAmount` JSON NULL COMMENT 'mayAmount；来源类型待确认，保留JSON',
  `adLiveEstimatedRoi` JSON NULL COMMENT '预估ROI；来源类型待确认，保留JSON',
  `adInfoList` JSON NULL COMMENT '广告信息（JSON）；来源类型待确认，保留JSON',
  `otp` DECIMAL(65,30) NULL COMMENT 'OTP；来源汇表字段',
  `mainRoi` JSON NULL COMMENT '主险ROI；来源类型待确认，保留JSON',
  `notMainRoi` JSON NULL COMMENT '非主险ROI；来源类型待确认，保留JSON',
  `lumpSumPaymentRate` JSON NULL COMMENT 'lumpSumPaymentRate；来源类型待确认，保留JSON',
  `lumpSumPaidRate` JSON NULL COMMENT 'lumpSumPaidRate；来源类型待确认，保留JSON',
  `wlPaidRate` JSON NULL COMMENT 'wlPaidRate；来源类型待确认，保留JSON',
  `packageRate` DECIMAL(65,30) NULL COMMENT '套餐率；来源汇表字段',
  `adLiveFunnelPlot` JSON NULL COMMENT '漏斗数据（JSON）；来源类型待确认，保留JSON',
  `showCnt` DECIMAL(65,30) NULL COMMENT '曝光次数；来源汇表字段',
  `liveWatchCount` DECIMAL(65,30) NULL COMMENT '直播观看次数；来源汇表字段',
  `liveCardIconComponentClickCount` DECIMAL(65,30) NULL COMMENT '直播组件点击次数；来源汇表字段',
  `upgradeRate` DECIMAL(65,30) NULL COMMENT '升级率；来源汇表字段',
  `cancelZeroCnt` DECIMAL(65,30) NULL COMMENT '零元退保数；来源汇表字段',
  `cancelZeroRate` DECIMAL(65,30) NULL COMMENT '零元退保率；来源汇表字段',
  `firstYearRecyclingMain` JSON NULL COMMENT 'firstYearRecyclingMain；来源类型待确认，保留JSON',
  `uvValue` JSON NULL COMMENT 'UV价值；来源类型待确认，保留JSON',
  `averageOrderValue` JSON NULL COMMENT '平均订单金额；来源类型待确认，保留JSON',
  `averageInsuranceNum` JSON NULL COMMENT '平均投保件数；来源类型待确认，保留JSON',
  `sixtyPolicyPercentage` JSON NULL COMMENT 'sixtyPolicyPercentage；来源类型待确认，保留JSON',
  `timeSharingConsumption` JSON NULL COMMENT '分时消耗；来源类型待确认，保留JSON',
  `inboundCnt` DECIMAL(65,30) NULL COMMENT 'inboundCnt；来源汇表字段',
  `inboundSpeakRate` DECIMAL(65,30) NULL COMMENT 'inboundSpeakRate；来源汇表字段',
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `observed_hour` DATETIME NOT NULL COMMENT '实际观察时刻所属小时，非历史回补小时',
  `observed_at` DATETIME(6) NOT NULL COMMENT '北京时间实际采集时刻',
  `raw_payload` JSON NOT NULL COMMENT '保留原始响应及采集上下文',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_platform_dy_session_observation` (`livePlatform`,`dyNo`,`roomId`,`startDate`,`observed_hour`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC;

CREATE TABLE IF NOT EXISTS `zhongan_orders` (
  `livePlatform` VARCHAR(128) NOT NULL COMMENT '直播平台；来源汇表字段',
  `dyNo` VARCHAR(128) NOT NULL COMMENT '直播间号码；来源汇表字段',
  `anchorNick` VARCHAR(512) NULL COMMENT '直播间名称；来源汇表字段',
  `agentLiveName` VARCHAR(512) NULL COMMENT '所属机构；来源汇表字段',
  `startDate` DATE NULL COMMENT '统计日期；来源汇表字段',
  `roomId` VARCHAR(128) NULL COMMENT '直播场次ID；来源汇表字段',
  `startTime` VARCHAR(512) NULL COMMENT '开播时间；来源汇表字段',
  `collectedAt` VARCHAR(512) NULL COMMENT '采集时间（北京时间）；来源汇表字段',
  `orderNo` VARCHAR(128) NOT NULL COMMENT '订单号；来源汇表字段',
  `productName` VARCHAR(512) NULL COMMENT '产品名称；来源汇表字段',
  `bizDate` VARCHAR(512) NULL COMMENT '订单日期；来源汇表字段',
  `bizTime` VARCHAR(512) NULL COMMENT '订单时间；来源汇表字段',
  `orderAmount` DECIMAL(65,30) NULL COMMENT '订单金额；来源汇表字段',
  `orderStatus` VARCHAR(512) NULL COMMENT '订单状态码；来源汇表字段',
  `holderInfo.name` VARCHAR(512) NULL COMMENT '投保人姓名；来源汇表字段',
  `holderInfo.age` VARCHAR(512) NULL COMMENT '投保人年龄区间；来源汇表字段',
  `payMethod` VARCHAR(512) NULL COMMENT '缴费方式；来源汇表字段',
  `holderInfo.hasSi` JSON NULL COMMENT '投保人社保标记；来源类型待确认，保留JSON',
  `holderInfo.relation` JSON NULL COMMENT '投保人关系标记；来源类型待确认，保留JSON',
  `holderInfo.uwStatus` JSON NULL COMMENT '投保人核保状态码；来源类型待确认，保留JSON',
  `insuredInfoList` JSON NULL COMMENT '被保人信息（JSON）；来源汇表字段',
  `paymentMethod` JSON NULL COMMENT '支付方式码；来源类型待确认，保留JSON',
  `orderCnt` DECIMAL(65,30) NULL COMMENT '订单数；来源汇表字段',
  `paidCnt` DECIMAL(65,30) NULL COMMENT '支付次数；来源汇表字段',
  `upgradeFlag` VARCHAR(512) NULL COMMENT '升级标记；来源汇表字段',
  `accountId` JSON NULL COMMENT '账户ID；来源类型待确认，保留JSON',
  `nextPage` DECIMAL(65,30) NULL COMMENT '分页游标；来源汇表字段',
  `orderDetailList` JSON NULL COMMENT '关联订单明细（JSON）；来源汇表字段',
  `moreDetailFlag` VARCHAR(512) NULL COMMENT '更多明细标记；来源汇表字段',
  `media` JSON NULL COMMENT '媒体标记；来源类型待确认，保留JSON',
  `payBlockInfo` JSON NULL COMMENT '支付阻断信息；来源类型待确认，保留JSON',
  `hasSendReachSms` JSON NULL COMMENT '触达短信发送标记；来源类型待确认，保留JSON',
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `first_seen_at` DATETIME(6) NOT NULL,
  `observed_at` DATETIME(6) NOT NULL COMMENT '北京时间实际采集时刻',
  `raw_payload` JSON NOT NULL COMMENT '保留原始响应及采集上下文',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_platform_dy_order` (`livePlatform`,`dyNo`,`orderNo`),
  KEY `idx_platform_dy_date` (`livePlatform`,`dyNo`,`startDate`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin ROW_FORMAT=DYNAMIC;
```

## 2. 根目录项目结构与所有权

```text
staffhub/
├── scripts/
│   ├── SPEC.md                  # 本独立规格
│   ├── marketing/               # 巨量营销，独立项目
│   ├── qianchuan/               # 巨量千川，独立项目
│   ├── pingan/                  # 平安保单，独立项目
│   ├── zhongan/                 # 众安保单，独立项目
│   ├── utils/                   # 声明为依赖的通用 Python 包
│   └── tests/                   # 跨项目安装/边界验证
└── schdule/
    ├── SPEC.md                  # 调度规格，仅引用本规格
    ├── src/schdule/             # 授权调度、采集调度及计划/通知适配
    ├── config/                  # 调度配置与 MySQL 查询投影
    └── data/                    # 原始 Excel 输入资料，私有且不提交
```

每个来源目录都自行维护以下内容，各自提供 CLI：

| 文件 | 本类型的职责 |
| --- | --- |
| `pyproject.toml`、`uv.lock`、`.venv/` | 独立依赖声明、版本锁定和环境；.venv 不提交 |
| `config/example.toml`、私有 `config/local.toml` | 本类型配置模板和部署值；私有配置不提交 |
| `README.md`、`__main__.py`、`cli.py` | 安装、独立命令、参数解析与执行组装 |
| `task.py` | 仅本类型实际使用的查询参数、规范化和范围规则 |
| `auth.py` | 本平台授权探测、授权恢复、会话提取 |
| `collector.py` | 本平台端点、分页、完整性校验、采集与清洗 |
| `contracts.py`、`fields.json` | 本平台字段映射、派生字段与类型 |
| `repository.py`、`schema.sql` | 本平台建表、锁范围、SQL、事务和幂等规则 |
| `runtime/` | 凭据缓存和浏览器状态；权限受限，不提交 |

`utils` 只提供参数错误处理、时间、HTTP 重试、凭据原子文件、OAuth/浏览器授权生命周期、MySQL 连接/事务/锁、字段值转换及共享巨量协议辅助。来源模块自行选择和组合这些能力；utils 不导入任何来源模块、schdule。通用审计表 `collector_run` 的 DDL 在 [utils/audit.sql](utils/audit.sql)，不属于上述 266 个汇表字段。

依赖方向：`schdule → 来源公开接口 → utils`。每来源使用 PEP 420 的 `scripts.<type>` 包，各自 pyproject 声明本地 `../utils` 依赖。安装不依赖 PYTHONPATH、工作目录碰巧可导入或仓库 `tools/`；共享巨量协议辅助已放在 utils/oceanengine。打包部署需同时提供所需来源目录和 utils，或分别构建并安装对应发行包。不同来源可用不同 .venv、不同 MySQL 库和不同运行用户。

### 2.1 统一的功能名称与执行结果

所有类型均实现以下三个核心功能，并提供独立建表命令：

| 功能 | 命令 | 行为 |
| --- | --- | --- |
| 授权检查 | `check-auth` | 读取已有会话、检查期限并访问本源探测接口；不自动登录/刷新；不连接 MySQL |
| 授权 | `authorize` | 广告交换/刷新 token；保单打开本源浏览器登录流程、提取会话并探测；不连接 MySQL |
| 数据收集 | `collect` | 校验参数→目标范围锁→检查授权→完整采集→清洗投影→本源事务写入→返回状态 |
| 初始化 | `init-db` | 创建本源数据汇及 collector_run；不需要业务查询参数，不发业务请求 |

`collect --dry-run` 只验证配置结构、查询参数和时间，输出安全任务计划；不探测授权、不连接 MySQL、不访问平台，不能用它证明授权有效。

终端最后输出一条 JSON，退出码相同。成功采集示例：

```json
{"code":0,"source":"marketing","task_id":"task-<scope-sha256>","status":"success","rows":24}
```

| 退出码 | 含义 | 调用方处理 |
| --- | --- | --- |
| 0 | 本次命令成功 | 授权命令还须查看 scope_status；无场次不等于已验证目标权限 |
| 2 | 配置、参数或时间错误 | 修正后重试 |
| 3 | 缺少/过期授权或认证失败 | 执行本类型 authorize |
| 4 | 接口、分页、范围或数据结构错误 | 旧数据保留，检查来源响应 |
| 5 | 存储或审计失败 | 停止继续写入，排查数据库 |
| 6 | 范围锁/凭据锁被占用 | 延后重试，不启动重复任务 |
| 130 | 人工中止 | 由调用方决定重试 |

脚本不发送短信。调度器读取安全结果后决定通知，短信错误码 7 属于调度通知层。

### 2.2 参数和配置的划分

参数只描述本次调用需要的查询对象、时间和运行模式；长期应用/登录身份、数据库和网络设置属于本类型配置。未知或已删除参数返回 2。

| Page 信息 | 本版归属 |
| --- | --- |
| 账户 ID | 营销/千川 `--advertise-id`；入库字段仍为 advertiser_id |
| 账户平台 | 调用方选择营销/千川模块；营销报表版本由 --version 选择 |
| 账户名称/类型 | 本类型 accounts 表，可选，仅用于固定输出列 |
| 应用 app_id、secret、授权链接/码 | 私有应用配置；AUTH_CODE 是授权链接实际返回的临时码 |
| 平安看板链接 merchantChannel | 平安 --channel |
| 众安看板链接 dyNo/livePlatform | 众安 --dy-no / --platform |
| 看板账号、密码、手机号 | 本类型私有登录资料；操作者在浏览器输入，不作为 CLI 参数 |
| 产品、业务直播间和关系表格式 | 调度计划/调用方使用；不进入来源脚本参数或 Task |
| 腾讯云短信配置 | 调度通知层 |

删除旧参数 `--product-id`、`--room-id`、`--app-id`、`--task-file`、`--metrics`。不暴露重复的 `--account-scope`：未选主播时即账户全量。授权应用 ID 由配置提供；固定汇表指标不可用自定义 metrics 缩减。广告不暴露无用途的浏览器等待参数；众安不暴露上游未使用的小时起止参数。

## 3. 巨量营销

### 3.1 目标、数据汇和依赖

目录 [marketing/](marketing/)，发行包 `live-collector-marketing`，命令 `marketing`，Python 3.11+。依赖本目录锁定的 HTTP、MySQL 和 utils 包，不安装浏览器或短信 SDK。只采集指定投放账户，可选择一个实际主播查询范围；产品和业务直播间不参与身份、请求或写入。

输出 [marketing_hourly](marketing/schema.sql)，42 列；字段映射见 [fields.json](marketing/fields.json)。根据 smart/legacy 查询可用字段元数据，再请求对应契约指标；不支持必需字段时失败，不静默降级为部分汇表。

### 3.2 配置

复制 [配置模板](marketing/config/example.toml) 为本目录 `config/local.toml`。Page 的应用信息分配到 credentials；真实值通过环境或私有 env_file 提供。

| 配置 | 必需性 / 默认 | 作用 |
| --- | --- | --- |
| credentials.default.source | 固定 marketing | 防止误用其他类型凭据 |
| credentials.default.env_prefix | 默认模板 MARKETING_ | 隔离本应用环境变量 |
| credentials.default.env_file | 可选，相对 TOML | 私有 env 文件；进程环境优先 |
| credentials.default.app_id | 可选绑定校验 | 如填写，必须与私有 APP_ID 相同；不作为 CLI 参数 |
| MARKETING_APP_ID / MARKETING_APP_SECRET | 授权需要 | 应用身份与密钥 |
| MARKETING_AUTH_CODE | 首次或重新交换需要 | 来源授权链接返回的新授权码；后续优先使用刷新 token |
| accounts."账户ID".account_name / account_type | 可选 | 仅填固定展示列；缺失为 NULL |
| mysql.* | init-db / 非 dry-run collect 使用 | host/port/database/user/password_env；模板密码环境为 MARKETING_MYSQL_PASSWORD |
| settings.state_dir | ../runtime | 私有缓存目录，相对 TOML |
| settings.timeout_seconds / max_pages | 30 / 10000 | HTTP 超时和完整分页上限 |
| settings.refresh_before_seconds | 1800 | 授权维护接口使用的提前刷新阈值 |

### 3.3 参数

| 参数 | 适用命令 | 必需 / 默认 | 实际用途 |
| --- | --- | --- | --- |
| --config | 全部 | config/local.toml | 选择此项目配置文件 |
| --credential | check-auth / authorize / collect | default | 选择本应用别名 |
| --advertise-id | check-auth / authorize / collect | 必填，正整数文本 | 实际账户权限探测、报表查询及输出 |
| --version | check-auth / authorize / collect | smart；可选 legacy | 选择营销数据主题与权限探测方式 |
| --aweme-id | collect | 可选 | 实际抖音显示号筛选；省略为账户全量 |
| --start / --end | collect | 成对可选，默认上一完整小时 | 北京时间整小时半开区间，最多 7 天，结束不晚于当前整点 |
| --dry-run | collect | false | 只输出计划 |

### 3.4 功能与用例

在 `scripts/marketing/` 运行；下面 ID 为演示值，实际值从 Page 应用/账户资料取得。

```bash
uv sync --locked
cp -n config/example.toml config/local.toml
uv run marketing check-auth --advertise-id 123
uv run marketing authorize --advertise-id 123
uv run marketing init-db
uv run marketing collect --advertise-id 123 --dry-run
uv run marketing collect --advertise-id 123 --version smart \
  --start 2026-10-20T09:00:00 --end 2026-10-20T10:00:00
```

| 用例 | 预期 |
| --- | --- |
| 已授权账户检查 | 实际探测成功返回 session_valid；token 存在但账户无权限不能报成功 |
| 首次/过期授权 | 交换或刷新，原子保存轮换 token，再验证账户权限 |
| 指定小时收集 | 校验完整分页总数、来源小时及维度；整个范围替换与成功审计同事务 |
| 同参数重复收集 | 更新该范围小时结果，不新增重复统计 |
| 后页失败、字段缺失或授权失效 | 非零退出；保留已有数据；返回可定位的安全错误 |
| 缺省账户元数据 | 数据仍可采集，名称/类型列为 NULL，不要求产品或房间 |

## 4. 巨量千川

### 4.1 目标、数据汇和依赖

目录 [qianchuan/](qianchuan/)，发行包 `live-collector-qianchuan`，命令 `qianchuan`，独立 pyproject/uv.lock/.venv。输出 [qianchuan_hourly](qianchuan/schema.sql)，111 列；字段定义见 [fields.json](qianchuan/fields.json)。按账户查询千川小时报表，平台接口按日请求，本源根据 stat_datetime 裁剪回指定小时范围。

### 4.2 配置

使用 [千川配置模板](qianchuan/config/example.toml)，不共用营销应用身份。

| 配置 | 必需性 / 默认 | 用途 |
| --- | --- | --- |
| credentials.default.source / env_prefix | qianchuan / QIANCHUAN_ | 独立应用和缓存身份 |
| QIANCHUAN_APP_ID / APP_SECRET / AUTH_CODE | 首次授权需要，后续刷新不需要新码 | 与营销相同的 OAuth 生命周期，使用千川应用值 |
| credentials.default.env_file / app_id | 可选 | 私有配置文件与应用绑定校验 |
| accounts."账户ID".account_name / account_type | 可选 | 固定汇表展示列 |
| accounts."账户ID".room_name | 可选 | 固定汇表已有展示列；不是查询范围或业务 room_id |
| mysql.* / password_env | 入库需要；QIANCHUAN_MYSQL_PASSWORD | 千川自己的数据库配置 |
| settings.state_dir / timeout_seconds / max_pages / refresh_before_seconds | ../runtime / 30 / 10000 / 1800 | 本项目运行与维护设置 |

`aweme_nick_name` 原表虽有列，但现有数据源映射未确认；保留该物理列为 NULL，不提供无实际用途的同名配置。更换映射需在本源 contracts/fields 中实施。

### 4.3 参数

| 参数 | 适用命令 | 必需 / 默认 | 实际用途 |
| --- | --- | --- | --- |
| --config / --credential | 全部 / 除 init-db | config/local.toml / default | 本项目配置及千川凭据 |
| --advertise-id | check-auth / authorize / collect | 必填 | 千川账户权限探测、查询和输出 |
| --aweme-id | collect | 可选 | 手机端抖音显示号；查询映射后使用内部 ID，不猜测 ID 类型 |
| --start / --end | collect | 成对可选，默认上一完整小时 | 整小时半开区间；跨日拆请求；最多 7 天 |
| --dry-run | collect | false | 离线计划校验 |

千川没有营销版本参数。调用方若已有已验证内部主播 ID，可通过 Python task.make_task 的 `options.aweme_ids=[id]` 使用；与显示号互斥，只接受一个 ID。普通 CLI 只保留显示号入口。

### 4.4 功能与用例

在 `scripts/qianchuan/` 执行：

```bash
uv sync --locked
cp -n config/example.toml config/local.toml
uv run qianchuan check-auth --advertise-id 456
uv run qianchuan authorize --advertise-id 456
uv run qianchuan init-db
uv run qianchuan collect --advertise-id 456 --dry-run
uv run qianchuan collect --advertise-id 456 \
  --start 2026-10-19T23:00:00 --end 2026-10-20T01:00:00
```

| 用例 | 预期 |
| --- | --- |
| 检查/授权指定账户 | 使用千川应用探测，禁止用营销缓存通过检查 |
| 跨零点采集两小时 | 分别请求两天，只存 23:00 与 00:00 两个小时 |
| 指定主播显示号 | 唯一解析为内部 ID 后筛选；不唯一或不存在则失败 |
| 重复页、总数改变或总数缺失 | 任务失败，不提交不完整数据 |
| 同窗口重跑 | 只替换相同账户及范围，不影响其他账户/主播 |

## 5. 平安保单

### 5.1 目标、数据汇和依赖

目录 [pingan/](pingan/)，发行包 `live-collector-pingan`，命令 `pingan`。本类型安装 Playwright 和 HTTP/MySQL/utils，独立维护登录提取、后台接口、两表写入。输出 [pingan_stats、pingan_orders](pingan/schema.sql)，共 32 列；映射见 [fields.json](pingan/fields.json)。

唯一必需业务查询对象是看板 `merchantChannel`，以 --channel 提供。数据已经包含来源产品名 itemName 时直接保留；不增加内部产品 ID 参数，不按投放账户复制保单数据。

### 5.2 配置

使用 [平安配置模板](pingan/config/example.toml)。

| 配置 | 必需性 / 默认 | 用途 |
| --- | --- | --- |
| credentials.default.source | pingan | 限制本类型 |
| browser_channel | chrome | 系统 Chrome，可见桌面登录；每凭据独立浏览器目录 |
| token_storage | cookie（可选 localStorage） | 实际认证 token 的存放位置 |
| token_key | 接入时核实，必须替换模板占位 | 只读取实际认证键，不能使用任意 Cookie |
| 私有账号、密码、登录手机号 | Page 可获取；人工登录使用 | 不放 CLI，也不宣称脚本自动填密码或验证码 |
| mysql.* / password_env | 入库需要；PINGAN_MYSQL_PASSWORD | 本项目数据库配置 |
| settings.state_dir / timeout_seconds / max_pages / refresh_before_seconds | ../runtime / 30 / 10000 / 1800 | 私有状态、HTTP、分页与授权维护 |

不同平安登录身份分配不同 credential；共享一个别名会共享浏览器会话。首次创建新 profile 不会自动导入日常 Chrome 登录态。

### 5.3 参数

| 参数 | 适用命令 | 必需 / 默认 | 实际用途 |
| --- | --- | --- | --- |
| --config / --credential | 全部 / 除 init-db | config/local.toml / default | 平安配置和登录身份 |
| --channel | check-auth / authorize / collect | 必填 | merchantChannel/merchantChannelCode 与 advertPlat 查询范围 |
| --start / --end | collect | 成对可选，默认上一完整小时 | 订单更新时间窗口及当日漏斗截止时间；最多 7 天 |
| --wait-seconds | authorize | 15；1–1800 秒 | 管理员登录等待预算 |
| --dry-run | collect | false | 离线验证 |

时间不是可删除的占位参数：订单按 `[start,end)` 查询更新时间，接口 toTime 使用 end−1 秒；统计汇总查询对应日期，漏斗从当日零点累计至窗口末端。累计统计与窗口内订单条数没有强制相等关系。

### 5.4 功能与用例

在 `scripts/pingan/` 执行：

```bash
uv sync --locked
cp -n config/example.toml config/local.toml
uv run pingan check-auth --channel DEMO_CHANNEL
uv run pingan authorize --channel DEMO_CHANNEL --wait-seconds 1800
uv run pingan init-db
uv run pingan collect --channel DEMO_CHANNEL --dry-run
uv run pingan collect --channel DEMO_CHANNEL \
  --start 2026-10-20T09:00:00 --end 2026-10-20T10:00:00
```

| 用例 | 预期 |
| --- | --- |
| 授权检查 | 使用已有 token 探测目标渠道看板，不连接 MySQL |
| 未登录执行 authorize | 打开对应渠道登录页；人工完成登录，提取指定认证键并验证；超时返回授权失败 |
| 收集完整窗口 | 查询标题、日期汇总、累计漏斗与全部订单页；两张表和成功审计同事务 |
| 同订单状态变化 | 依据 channel＋postId 更新，保留 first_seen_at |
| 分母为零/字段缺失 | 派生比率为 NULL，不制造 0% 或无穷值 |
| 汇总返回多行且无法确定聚合语义 | 该汇总映射列为 NULL，保留原始多行；不随意求和 |
| 订单总数不符或写入失败 | 全批回滚，不只提交统计表 |

`postId` 是已确认的接口记录标识，不将其未经验证地命名为“保单号”。投保人年龄组 applicant_age_group 的接口映射仍未确认，物理列保留 NULL；insurantList 原样保留 JSON 数组。

## 6. 众安保单

### 6.1 目标、数据汇和依赖

目录 [zhongan/](zhongan/)，发行包 `live-collector-zhongan`，命令 `zhongan`；独立维护浏览器登录、场次枚举、游标分页及两表写入。输出 [zhongan_stats、zhongan_orders](zhongan/schema.sql)，共 81 列；映射见 [fields.json](zhongan/fields.json)。

查询对象是后台的 dyNo 和 livePlatform。来源 roomId 由接口枚举实际场次取得，调用方无须输入业务产品或业务直播间。

### 6.2 配置

使用 [众安配置模板](zhongan/config/example.toml)。

| 配置 | 必需性 / 默认 | 用途 |
| --- | --- | --- |
| credentials.default.source | zhongan | 限制本类型 |
| browser_channel | chrome | 独立持久浏览器会话 |
| auth_cookie_names | 接入时核实，非空数组 | 必须齐全的认证 Cookie 名称，不使用追踪 Cookie 判断登录 |
| 私有账号、密码、手机号 | Page 资料；人工登录 | 不传 CLI，不在日志打印 |
| mysql.* / password_env | 入库需要；ZHONGAN_MYSQL_PASSWORD | 本类型 MySQL 配置 |
| settings.state_dir / timeout_seconds / max_pages / refresh_before_seconds | ../runtime / 30 / 10000 / 1800 | 私有状态、请求、游标上限、授权维护 |

只发送与目标域、路径及有效期匹配的 Cookie，读取接口需要的本站 localStorage 请求头。没有明确有效期时不能凭 Cookie 存在认定会话有效，必须实际探测。

### 6.3 参数

| 参数 | 适用命令 | 必需 / 默认 | 实际用途 |
| --- | --- | --- | --- |
| --config / --credential | 全部 / 除 init-db | config/local.toml / default | 众安配置与登录身份 |
| --dy-no | check-auth / authorize / collect | 必填，文本 | 查询/验证目标 dyNo |
| --platform | check-auth / authorize / collect | DOUYIN | livePlatform 请求值 |
| --date | collect | 北京时间今天，YYYY-MM-DD，不可为未来 | 接口实际使用的查询日期 |
| --wait-seconds | authorize | 15；1–1800 秒 | 浏览器授权等待预算 |
| --dry-run | collect | false | 离线验证 |

众安接口不按小时截取订单或看板，故不提供 --start/--end。每小时调度可以反复收集同一日期，记录当时观察快照；历史日期用 --date 单日回补。

### 6.4 功能与用例

在 `scripts/zhongan/` 执行：

```bash
uv sync --locked
cp -n config/example.toml config/local.toml
uv run zhongan check-auth --dy-no DEMO_DY
uv run zhongan authorize --dy-no DEMO_DY --wait-seconds 1800
uv run zhongan init-db
uv run zhongan collect --dy-no DEMO_DY --date 2026-10-20 --dry-run
uv run zhongan collect --dy-no DEMO_DY --platform DOUYIN --date 2026-10-20
```

| 用例 | 预期 |
| --- | --- |
| 检查会话和范围 | 请求当前日期可见直播列表；目标可见才标记 verified |
| 当前没有任何直播 | 可返回 session_valid，但 scope_status=unobserved_no_live_rooms；调用方不得当作目标权限已验证 |
| authorize | 打开后台，等待人工登录，提取要求的全部认证键并执行探测 |
| 一天包含当前和历史场次 | 枚举所有 roomId，分别采集累计看板和完整订单游标 |
| 日期无目标或无场次 | 采集返回非零，不用空结果覆盖已有累计快照 |
| 同 orderNo 重跑 | 同 platform/dyNo 下更新；不因订单出现在不同抓取轮次新增重复行 |
| 重复/缺失游标或跨场次订单归属冲突 | 全批失败，不提交部分场次 |
| 来源尚未确认类型 | 对应列保持 JSON，原值可追溯，不猜单位、不强制转换 |

## 7. 调度接入、维护与迁移

### 7.1 公开调用接口

独立终端入口为 `<类型> <命令>` 或 `python -m scripts.<类型> <命令>`。来源目录内运行时默认 config/local.toml；从其他目录调用须显式提供配置绝对路径。TOML 内 env_file/state_dir 的相对路径以 TOML 所在目录为基准。

Python 调用由本源公开模块提供：

```python
from scripts.marketing.task import make_task
from scripts.marketing.cli import collect_task, check_task
from scripts.utils.config import Config
from scripts.utils.model import Window

config = Config.load('/absolute/path/scripts/marketing/config/local.toml')
task = make_task('default', '123')
check_task(config, task)                       # 授权检查
check_task(config, task, renew=True)           # 距到期阈值内维护
window = Window.parse('2026-10-20T09:00:00', '2026-10-20T10:00:00')
result = collect_task(config, task, window)
```

Task 仅含 task_id/source/credential/account_id/options；account_id 只供广告使用，保单留空。调度保留自己的产品/房间计划身份，再转为来源 Task；计划归属变化不会制造同源事实副本。主数据中应用绑定转换为凭据配置校验，不能把 app_id 作为多余采集参数。

授权维护独立于 collect，默认提前 1800 秒检查刷新；OAuth 轮换成功先保存新 token，再探测账户权限。会话有效期未知的后台按实际探测/浏览器恢复处理。文件状态按凭据加锁，原子写入，敏感缓存权限为 0600。部署需要共享同一凭据状态或保持单节点维护，不能让多份 refresh token 缓存竞争刷新。

### 7.2 迁移边界

- 根目录 scripts 是独立项目集合；调度位于 schdule，读取已同步 MySQL 的关联查询投影。
- 旧产品/房间参数、JSON 任务文件及旧共享事实表接口停止作为新脚本协议。主规格和操作文档统一引用本文。
- init-db 只创建新表，不自动删除旧表、不自动从 live_ad_hourly/live_policy_snapshot/live_policy_order 回填；CREATE IF NOT EXISTS 不负责升级已经存在的同名异构表。迁移旧数据需单独制定映射并验证范围去重。
- 尚未确认的字段映射明确留空或 JSON；列定义不因此删减。映射完成应升级本类型字段契约和测试，维护对应 schema 迁移。
- 本版的离线检查不代表已经完成生产授权、真实平台字段覆盖或 MySQL 执行验收。

## 8. 验收清单与证据

1. 六张源汇表逐列覆盖 266 个原字典字段，列名/顺序一致；来源未知字段不丢弃，原始 JSON 可追溯。
2. 四个目录分别从自己的 uv.lock 安装，在各自 .venv 执行入口；移除/阻断 schdule 导入仍能 dry-run。
3. 每个类型的 check-auth、authorize、collect 独立可调用；auth/dry-run 不要求 MySQL；init-db 不要求业务查询参数。
4. 营销只传 advertise_id 即可生成账户任务；传 product-id/room-id 等无用途参数明确报错。千川、平安、众安只接受本节列明的 CLI 参数。
5. 授权缺失/到期、应用不匹配、Cookie 缺少、分页缺页/重复、数量变化、字段不支持都不能报告采集成功。
6. 重跑不重复，同源范围串行；失败事务回滚；来源时间与观察时间分开；订单首次时间不被更新覆盖。
7. 主规格只维护整体业务关系和调度，不复制本规格中的 DDL、参数或平台内部流程。

本地验证和仍需真实环境验证的事项见 [VERIFICATION.md](../schdule/VERIFICATION.md)。
