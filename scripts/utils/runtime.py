"""Source-neutral collection lifecycle with explicitly constructed components."""
from .model import DataError, LiveError, StorageError


def error_result(error, route=None, source=None):
    known = isinstance(error, LiveError)
    result = {'code': error.code if known else 4, 'source': route.source if route else source,
              'task_id': route.task_id if route else None,
              'status': 'failed',
              'message': str(error) if known else '采集遇到非预期错误，请检查来源适配器及运行环境'}
    if not known:
        result['error_type'] = type(error).__name__
    return result


class CollectionService:
    def __init__(self, repository, auth, collector):
        self.repository, self.auth, self.collector = repository, auth, collector

    def execute(self, route, window):
        try:
            with self.repository.lock(self.repository.lock_name(route)):
                try:
                    state = self.auth.ensure(route)
                    batch = self.collector.collect(route, window, state)
                    self.repository.write(route, window, batch)
                    result = {'code': 0, 'source': route.source, 'task_id': route.task_id,
                              'status': 'success', 'rows': batch.count}
                except Exception as error:
                    result = error_result(error, route)
                    if not isinstance(error, StorageError):
                        audit_error = error if isinstance(error, LiveError) else DataError(result['message'])
                        try:
                            self.repository.failure(route, window, audit_error)
                        except Exception as failure:
                            result = {**error_result(StorageError('无法记录失败状态，任务终止'), route),
                                      'audit_error': True, 'original_code': result['code'],
                                      'error_type': type(failure).__name__}
            return result
        except Exception as error:
            return error_result(error, route)
