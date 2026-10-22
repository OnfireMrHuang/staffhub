"""Small common CLI utilities; commands and argument sets belong to each project."""
import argparse
import json
from .model import ConfigError, timestamp
from .runtime import error_result

class Parser(argparse.ArgumentParser):
    def error(self, message):
        raise ConfigError('命令行参数无效，请使用 --help 检查必需字段和选项')


def validate_credentials(config, task):
    profile = config.credentials.get(task.credential)
    if not profile or profile.get('source') != task.source:
        raise ConfigError('凭据别名不存在或来源不匹配')


def preview(task, window):
    return {'code':0,'source':task.source,'task_id':task.task_id,'status':'planned','dry_run':True,
            'start':timestamp(window.start),'end':timestamp(window.end),
            'task':{'credential':task.credential,'account_id':task.account_id,'options':task.options}}


def run_main(execute, parser, argv, source):
    try:
        result = execute(parser.parse_args(argv))
    except KeyboardInterrupt:
        result = {'code':130,'source':source,'status':'interrupted','message':'任务已中止'}
    except Exception as error:
        result = error_result(error, source=source)
    print(json.dumps(result,ensure_ascii=False,allow_nan=False))
    return result['code']
