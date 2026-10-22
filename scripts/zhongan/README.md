# 众安保单独立项目

功能、配置、全部参数和用例见 [独立规格第 6 部分](../SPEC.md)。本项目自有 [DDL](schema.sql)、[字段映射](fields.json)、[配置模板](config/example.toml)、[依赖清单](pyproject.toml) 和 uv.lock。

以下命令在本目录运行，ID/渠道为演示值，实际值从 Page 获取。

```bash
uv sync --locked
cp -n config/example.toml config/local.toml
uv run zhongan check-auth --dy-no DEMO_DY
uv run zhongan authorize --dy-no DEMO_DY --wait-seconds 1800
uv run zhongan init-db
uv run zhongan collect --dy-no DEMO_DY --dry-run
uv run zhongan collect --dy-no DEMO_DY --date 2026-10-20
```

授权需要系统 Chrome 和图形桌面。先核实模板中的认证键，再在打开的独立浏览器中完成账号登录/验证码；模板占位值不是有效认证键。

MySQL 库需事先创建；模板密码环境变量为 `ZHONGAN_MYSQL_PASSWORD`。授权检查/授权不使用 MySQL；dry-run 不访问网络。真实 collect 要求授权有效及本源表已创建。默认配置为当前工作目录的 config/local.toml，从其他目录运行请传 `--config` 绝对路径；配置内相对路径以 TOML 目录为基准。

也可使用 `uv run python -m scripts.zhongan`。不需要产品、业务直播间、主数据导入或 live_data 包。查看本源实际参数：

```bash
uv run zhongan collect --help
uv run zhongan authorize --help
```

本项目只依赖自有锁定包和本地 `../utils`；.venv、config/local.toml、private.env、runtime 不提交。发布或复制本项目时同时分发 utils，或将两者分别打包安装。
