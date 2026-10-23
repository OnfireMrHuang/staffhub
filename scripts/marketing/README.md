# 巨量营销独立项目

功能、配置、全部参数和用例见 [独立规格第 3 部分](../SPEC.md)。本项目自有 [DDL](schema.sql)、[字段映射](fields.json)、[配置模板](config/example.toml)、[依赖清单](pyproject.toml) 和 uv.lock。

以下命令在本目录运行，ID/渠道为演示值，实际值从 Page 获取。

```bash
uv sync --locked
cp -n config/example.toml config/local.toml
uv run marketing check-auth --advertise-id 123
uv run marketing authorize --advertise-id 123
uv run marketing collect --advertise-id 123 --dry-run
uv run marketing collect --advertise-id 123 --start 2026-10-20T09:00:00 --end 2026-10-20T10:00:00
```

私有环境使用 `MARKETING_APP_ID`、`MARKETING_APP_SECRET`；首次授权另需 `MARKETING_AUTH_CODE`。可配置 auth.env_file，进程环境优先。

MySQL 库、数据汇表和审计表需事先创建；密码直接填写在配置文件的 `mysql.password` 中。授权检查/授权不使用 MySQL；dry-run 不访问网络。在 `[mysql.tables]` 配置 stats、audit 对应的实际表名，采集脚本不执行建表。dry-run 会校验表名映射；真实 collect 要求授权有效且表结构符合 DDL。默认配置为当前工作目录的 config/local.toml，从其他目录运行请传 `--config` 绝对路径；配置内相对路径以 TOML 目录为基准。

也可使用 `uv run python -m scripts.marketing`。不需要产品、业务直播间、主数据导入或 schdule 包。查看本源实际参数：

```bash
uv run marketing collect --help
uv run marketing authorize --help
```

本项目只依赖自有锁定包和本地 `../utils`；.venv、config/local.toml、private.env、runtime 不提交。发布或复制本项目时同时分发 utils，或将两者分别打包安装。

本类型只使用一套 `[auth]` 授权。状态缓存为 `state_dir/marketing/auth.json`，不使用 credential 参数或别名。
