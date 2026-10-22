"""Public operational codes; never publish raw driver or API exception text."""
from scripts.utils.model import LiveError

class ScheduleError(Exception):
    def __init__(self, message, code=2):
        super().__init__(message)
        self.code = code


def failure(error):
    if isinstance(error, ScheduleError):
        return {'code': error.code, 'status': 'failed', 'message': str(error)}
    if isinstance(error, LiveError):
        code = error.code
    else:
        code = 4
    messages = {2:'采集器配置或查询范围无效', 3:'授权缺失、即将过期或目标权限不足',
                4:'来源接口或数据校验失败', 5:'存储或审计失败', 6:'任务或凭据正在使用',
                7:'通知发送失败'}
    return {'code':code, 'status':'failed', 'message':messages.get(code, '任务执行失败')}
