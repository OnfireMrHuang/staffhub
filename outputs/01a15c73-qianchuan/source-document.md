支持获取直播整体数据

基于全部流量的情况(包括自然+营销),分析抖音号及直播间在竞价投放中的整体数据表现。直客账户支持查看官方抖音号下同主体全部投放账户的数据表现。

# 请求地址

[https://api.oceanengine.com/open\_api/v1.0/qianchuan/report/live/get/](https://api.oceanengine.com/open_api/v1.0/qianchuan/report/live/get/)

# 请求方法

GET

# Header

字段

类型

描述

Access-Token 必填

string

授权access\_token，可以通过 [【获取Access token】](https://open.oceanengine.com/labels/7/docs/1696710505596940) 接口获取

# 请求参数

字段

类型

描述

advertiser\_id 必填

number

客户id

aweme\_id 必填

number

抖音号ID

start\_time 必填

string

直播开始时间，格式 `2021-04-05 00:00:00` ，开播时间在筛选日期内的直播间，会被统计

end\_time 必填

string

直播结束时间，格式 `2021-04-05 23:59:59`，开始时间同一天的23:59:59

即：查询的是一天0点～24点的直播数据

fields 必填

string\[\]

需要查询的消耗指标，具体可参考返回值

stats\_authority

string

需要查询的投放账户维度，直客账户支持查看官方抖音号下同主体全部投放账户的数据表现

1. 同主体账户： `QUALIFICATION`，仅直客账户支持
2. 当前账户： `CURRENT`，默认

# 请求示例

Python

Java

Php

Curl

# 应答字段

字段

类型

描述

code

number

返回码,详见 [【附录-返回码】](https://open.oceanengine.com/labels/7/docs/1696710760866831))

message

string

返回信息,详见 [【附录-返回码】](https://open.oceanengine.com/labels/7/docs/1696710760866831))

data

object

返回数据，金额相关指标的单位为「 **千分之一分**」

stat\_cost

float

消耗

cpm\_platform

float

平均千次展现费用

click\_cnt

number

营销点击次数

ctr

float

营销点击率

total\_live\_pay\_order\_gpm

float

GPM

luban\_live\_pay\_order\_gpm

float

营销GPM

cpc\_platform

float

营销点击单价

ecp\_convert\_rate

float

转化率

ecp\_convert\_cnt

number

转化数

ecp\_cpa\_platform

float

转化成本

live\_pay\_order\_gmv\_alias

float

累计成交金额

luban\_live\_pay\_order\_gmv

float

营销成交金额

live\_pay\_order\_gmv\_roi

float

整体ROI，仅支持直客客户的官方/自运营抖音号

ad\_live\_prepay\_and\_pay\_order\_gmv\_roi

float

营销ROI

live\_create\_order\_count\_alias

number

整体下单数

live\_create\_order\_rate

float

整体下单率，仅支持直客客户的官方/自运营抖音号

luban\_live\_order\_count

number

营销下单数

ad\_live\_create\_order\_rate

float

营销下单率

live\_pay\_order\_count\_alias

number

整体成单数

live\_pay\_order\_rate

float

整体成单率，仅支持直客客户的官方/自运营抖音号

luban\_live\_pay\_order\_count

number

营销成单数

ad\_live\_pay\_order\_rate

float

营销成单率

live\_pay\_order\_gmv\_avg

float

直播间平均成单金额

ad\_live\_pay\_order\_gmv\_avg

float

营销平均成单金额

luban\_live\_prepay\_order\_count

number

营销预售订单数

luban\_live\_prepay\_order\_gmv

float

营销预售订单金额

live\_prepay\_order\_count\_alias

float

整体预售订单数

live\_prepay\_order\_gmv\_alias

float

整体预售订单金额

live\_order\_pay\_coupon\_amount

float

成交智能优惠券金额

total\_live\_watch\_cnt

number

直播间观看人次

total\_live\_follow\_cnt

number

新增粉丝数

live\_watch\_one\_minute\_count

number

营销引导超1分钟观看人数

total\_live\_fans\_club\_join\_cnt

number

直播间新加团人数

live\_click\_cart\_count\_alias

number

直播间查看购物车次数

live\_click\_product\_count\_alias

number

直播间商品点击次数

total\_live\_comment\_cnt

number

直播间评论次数

total\_live\_share\_cnt

number

直播间分享次数

total\_live\_gift\_cnt

number

直播间打赏次数

total\_live\_gift\_amount

float

直播间音浪收入

request\_id

string

请求的日志id，唯一标识一个请求

# 应答示例