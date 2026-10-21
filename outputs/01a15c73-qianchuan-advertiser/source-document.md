此接口用于获取投放账户数据。

**注意：账户报表不再返回字段"marketing\_goal"**

### 请求地址

[https://ad.oceanengine.com/open\_api/v1.0/qianchuan/report/advertiser/get/](https://ad.oceanengine.com/open_api/v1.0/qianchuan/report/advertiser/get/)

### 请求方法

GET

### 请求头

字段

类型

描述

Access-Token

必填

string

授权access\_token，可以通过【 [获取Access token](https://open.oceanengine.com/labels/7/docs/1696710505596940)】接口获取

### 请求参数

字段

类型

描述

advertiser\_id

必填

number

客户id

start\_date

必填

string

开始时间，格式 `2021-04-05`，开始时间不得早于 `今日-180` 天

end\_date

必填

string

结束时间，格式 `2021-04-05`，

若不传time\_granularity，则时间跨度不能超过180天

若传time\_granularity为 `TIME_GRANULARITY_DAILY` 天维度，则时间跨度不能超过 `30` 天

若传time\_granularity为 `TIME_GRANULARITY_HOURLY` 小时纬度，则时间跨度不能超过 `7` 天

fields

必填

string\[\]

需要查询的消耗指标，见返回参数

filtering

必填

object

过滤条件

marketing\_goal

必填

string

营销目标，允许值：

- `ALL`：全部
- `VIDEO_PROM_GOODS`：商品投放
- `LIVE_PROM_GOODS`：直播投放

order\_platform

string

下单平台，允许值：

- `ALL`：全部
- `QIANCHUAN`： 千川pc（默认）
- `ECP_AWEME`：小店随心推

marketing\_scene

string

营销类型，允许值：

- `ALL`：全部
- `FEED`： 通投
- `SEARCH `：搜索
- `SHOPPING_MALL`：商城

注意：当下单平台为“小店随心推”时，不支持

smart\_bid\_type

string

投放场景（投放方式），允许值：

- `SMART_BID_CUSTOM`：控成本投放
- `SMART_BID_CONSERVATIVE`： 放量投放

注意：当下单平台为“小店随心推”或营销场景为“搜索”时，不支持

status

string

按计划状态过滤，不传入即默认返回“全部（包含已删除）”，其他规则详见 [【附录-计划查询状态】](https://open.oceanengine.com/labels/12/docs/1697577930691592)（暂不支持“系统暂停”和“在投计划配额超限”）

注意：当下单平台为“小店随心推”时，不支持

aweme\_ids

number\[\]

按抖音id过滤，即关联的抖音号

campaign\_scene

string

营销场景，默认查全部，可选值

- `DAILY_SALE`：日常销售
- `NEW_CUSTOMER_TRANSFORMATION`：新客转化
- `LIVE_HEAT`：直播间加热
- `PLANT_GRASS`：人群种草
- `PRODUCT_HEAT`：商品加热
- `NEW_PRODUCT_BOOST`：新品起量

注意：当下单平台为“小店随心推”时，不支持

time\_granularity

string

时间粒度 ，如果不传，返回查询日期内的聚合数据

允许值:

- `TIME_GRANULARITY_DAILY` (按天维度),会返回每天的数据
- `TIME_GRANULARITY_HOURLY` (按小时维度)，会返回每小时维度的数据

order\_field

string

排序字段，允许值参考数据指标，见返回字段，默认不传为 `stat_cost`

order\_type

string

排序方式，允许值：

- `ASC` 升序（默认）
- `DESC` 降序

page

number

页码，默认为 `1`

page\_size

number

页面大小，默认为 `10`，取值范围： `1-500`

### 请求示例

Python

Java

Php

Curl

### 应答字段

字段

类型

描述

code

number

返回码,详见 [【附录-返回码】](https://open.oceanengine.com/labels/7/docs/1696710760866831)

message

string

返回信息,详见 [【附录-返回码】](https://open.oceanengine.com/labels/7/docs/1696710760866831)

data

json

json返回值

list

object\[\]

返回数据

advertiser\_id

number

客户id

stat\_datetime

string

数据起始时间，当time\_granularity有入參时返回，格式为： `yyyy-MM-dd HH:mm:ss`

stat\_cost

float

消耗

show\_cnt

float

展示次数

ctr

float

点击率

cpm\_platform

float

平均千次展示费用

click\_cnt

float

点击次数

pay\_order\_count

float

直接成交订单数

create\_order\_amount

float

直接下单金额

create\_order\_count

float

直接下单订单数

pay\_order\_amount

float

直接成交金额

create\_order\_roi

float

直接下单roi

dy\_follow

float

新增粉丝数

prepay\_and\_pay\_order\_roi

float

直接支付roi

prepay\_order\_count

float

直接预售订单数

prepay\_order\_amount

float

直接预售金额

total\_play

float

播放数

play\_duration\_3s

float

3s播放数

play\_25\_feed\_break

float

25%进度播放数

play\_50\_feed\_break

float

50%进度播放数

play\_75\_feed\_break

float

75%进度播放数

play\_over

float

播放完成数

play\_over\_rate

float

完播率

convert\_cnt

float

转化次数 （即将下线）

convert\_cost

float

转化成本（即将下线）

convert\_rate

float

转化率（即将下线）

luban\_live\_click\_product\_cnt

float

直播间商品点击次数

luban\_live\_enter\_cnt

float

直播间观看人次

cpc\_platform

float

平均点击单价

deep\_convert\_cnt

float

深度转化次数

deep\_convert\_cost

float

深度转化成本

deep\_convert\_rate

float

深度转化率

attribution\_convert\_cnt

float

转化数（计费时间）

attribution\_convert\_rate

float

转化率（计费时间）

attribution\_convert\_cost

float

转化成本（计费时间）

attribution\_deep\_convert\_cnt

float

深度转化次数（计费时间）

attribution\_deep\_convert\_cost

float

深度转化成本（计费时间）

attribution\_deep\_convert\_rate

float

深度转化率（计费时间）

all\_order\_create\_roi\_7days

float

7日总下单ROI

all\_order\_pay\_roi\_7days

float

7日总支付ROI

all\_order\_pay\_gmv\_7days

float

7日总成交金额

all\_order\_pay\_count\_7days

float

7日总成交订单

pay\_order\_cost\_per\_order

float

直接成交客单价

create\_order\_coupon\_amount

float

下单智能优惠券金额

pay\_order\_coupon\_amount

float

成交智能优惠券金额

indirect\_order\_create\_count\_7days

float

间接下单订单数

indirect\_order\_create\_gmv\_7days

float

间接下单金额

indirect\_order\_pay\_count\_7days

float

间接成交订单数

indirect\_order\_pay\_gmv\_7days

float

间接成交金额

indirect\_order\_prepay\_count\_7days

float

间接预售订单数

indirect\_order\_prepay\_gmv\_7days

float

间接预售金额

qianchuan\_first\_order\_cnt

float

店铺首单新客人数

qianchuan\_first\_order\_rate

float

店铺首单新客订单占比

qianchuan\_first\_order\_convert\_cost

float

店铺首单新客转化成本

qianchuan\_first\_order\_direct\_pay\_gmv

float

店铺首单新客直接成交金额

qianchuan\_first\_order\_direct\_pay\_order\_roi

float

店铺首单新客直接支付ROI

qianchuan\_first\_order\_ltv30

float

店铺首单新客30天累计成交金额

qianchuan\_first\_order\_roi30

float

店铺首单新客30天累计支付ROI

live\_pay\_order\_cost\_per\_order

float

成交客单价

qianchuan\_brand\_first\_order\_rate

float

品牌首单新客订单占比

qianchuan\_brand\_first\_order\_convert\_cost

float

品牌首单新客转化成本

qianchuan\_brand\_first\_order\_ltv30

float

品牌首单新客30天累计成交金额

qianchuan\_brand\_first\_order\_direct\_pay\_order\_roi

float

品牌首单新客直接支付roi

qianchuan\_brand\_first\_order\_roi30

float

品牌首单新客30天累计支付roi

qianchuan\_brand\_first\_order\_cnt

float

品牌首单新客数

qianchuan\_brand\_first\_order\_direct\_pay\_gmv

float

品牌首单新客直接成交金额

qianchuan\_author\_first\_order\_rate

float

抖音号首单新客订单占比

qianchuan\_author\_first\_order\_roi30

float

抖音号首单新客30天累计支付roi

qianchuan\_author\_first\_order\_cnt

float

抖音号首单新客数

qianchuan\_author\_first\_order\_convert\_cost

float

抖音号首单新客转化成本

qianchuan\_author\_first\_order\_direct\_pay\_gmv

float

抖音号首单新客直接成交金额

qianchuan\_author\_first\_order\_direct\_pay\_order\_roi

float

抖音号首单新客直接支付roi

qianchuan\_author\_first\_order\_ltv30

float

抖音号首单新客30天累计成交金额

ad\_all\_order\_gmv\_settle\_rate\_7d

float

直接成交金额结算率(7天)

ad\_all\_order\_gmv\_settle\_rate\_14d

float

直接成交金额结算率(14天)

unfinished\_estimate\_order\_gmv

number

未完结直接预售订单预估金额

indirect\_order\_unfinished\_estimate\_gmv\_7days

number

未完结间接预售订单预估金额

ad\_all\_order\_settle\_amount\_7d

float

直接结算金额(7天)

ad\_all\_order\_settle\_count\_7d

float

直接结算订单数(7天)

ad\_all\_order\_count\_settle\_rate\_7d

float

直接订单结算率(7天)

ad\_all\_order\_settle\_roi\_7d

float

直接结算ROI(7天)

ad\_all\_order\_settle\_cost\_7d

float

直接结算成本(7天)

all\_order\_refund\_count\_7d

float

直接退款订单数(7天)

all\_order\_refund\_amount\_7d

float

直接退款金额(7天)

ad\_order\_gmv\_refund\_rate\_7d

float

直接退款率(7天)

ad\_order\_refund\_rate\_7d

float

直接订单数退货率(7天)

ad\_all\_order\_settle\_amount\_14d

float

直接结算金额(14天)

ad\_all\_order\_settle\_count\_14d

float

直接结算订单数(14天)

ad\_all\_order\_count\_settle\_rate\_14d

float

直接订单结算率(14天)

ad\_all\_order\_settle\_roi\_14d

float

直接结算ROI(14天)

ad\_all\_order\_settle\_cost\_14d

float

直接结算成本(14天)

all\_order\_refund\_count\_14d

float

直接退款订单数(14天)

all\_order\_refund\_amount\_14d

float

直接退款金额(14天)

ad\_order\_gmv\_refund\_rate\_14d

float

直接退款率(14天)

ad\_order\_refund\_rate\_14d

float

直接订单数退货率(14天)

ecp\_convert\_cnt

float

转化数

ecp\_convert\_rate

float

转化率

ecp\_cpa\_platform

float

转化成本

page\_info

object

分页信息

page

number

页码

page\_size

number

页面大小

total\_number

number

总数

total\_page

number

总页数

request\_id

string

请求日志id

### 应答示例