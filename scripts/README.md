# 四类独立采集项目

完整需求见 [SPEC.md](SPEC.md)：先定义六张数据汇 DDL，再按类型说明配置、参数、授权检查、授权、收集和用例。

| 类型 | 独立项目 | DDL |
| --- | --- | --- |
| 巨量营销 | [marketing/README.md](marketing/README.md) | [marketing/schema.sql](marketing/schema.sql) |
| 巨量千川 | [qianchuan/README.md](qianchuan/README.md) | [qianchuan/schema.sql](qianchuan/schema.sql) |
| 平安保单 | [pingan/README.md](pingan/README.md) | [pingan/schema.sql](pingan/schema.sql) |
| 众安保单 | [zhongan/README.md](zhongan/README.md) | [zhongan/schema.sql](zhongan/schema.sql) |

每个项目维护自己的 pyproject.toml、uv.lock、config 和 .venv。进入所需类型目录运行 `uv sync --locked`，只安装本类型及通用 utils。来源包不导入 live_data、catalog，也不读取产品或业务直播间目录。utils 是声明的本地依赖，随来源一起分发。

不要将各类型的凭据、浏览器状态或虚拟环境合并。需要批量调度时，再使用 [编排项目](../live_data_design/README.md)。
