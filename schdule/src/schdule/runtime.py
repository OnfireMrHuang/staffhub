"""Separate job locks and durable, secret-free execution journals."""
from datetime import datetime
from pathlib import Path
import json
import os
import tempfile
import uuid
from zoneinfo import ZoneInfo
from filelock import FileLock, Timeout
from .errors import ScheduleError, failure


def instant():return datetime.now(ZoneInfo('Asia/Shanghai')).isoformat(timespec='seconds')


def atomic_json(path,value):
    path=Path(path)
    path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    fd,name=tempfile.mkstemp(dir=path.parent)
    try:
        with os.fdopen(fd,'w',encoding='utf-8') as stream:
            json.dump(value,stream,ensure_ascii=False,allow_nan=False)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name,path)
    finally:
        if os.path.exists(name):os.unlink(name)


class Run:
    def __init__(self,directory,job):
        self.directory=Path(directory)
        self.report={'run_id':uuid.uuid4().hex,'job':job,'started_at':instant(),'status':'running','code':0,'results':[]}
        self.path=self.directory/'runs'/(self.report['run_id']+'.json')
        self.lock=FileLock(str(self.directory/(job+'.lock')),timeout=0)

    def publish(self):
        try:atomic_json(self.path,self.report)
        except Exception as error:raise ScheduleError('调度日志不可写，停止执行后续任务',5) from error

    def __enter__(self):
        try:
            self.directory.mkdir(parents=True,exist_ok=True,mode=0o700)
            self.lock.acquire()
        except Timeout as error:raise ScheduleError('同类调度正在运行，本轮未执行',6) from error
        except OSError as error:raise ScheduleError('调度运行目录不可写',5) from error
        try:self.publish()
        except BaseException:
            self.lock.release()
            raise
        return self

    def add(self,result):
        self.report['results'].append(result)
        self.report['code']=max(self.report['code'],result['code'])
        self.publish()

    def finish(self):
        self.report['status']='failed' if self.report['code'] else 'success'
        self.report['finished_at']=instant()
        self.publish()
        return self.report

    def __exit__(self,kind,error,trace):
        try:
            if error is not None:
                result={'code':130,'message':'执行被中止'} if isinstance(error,KeyboardInterrupt) else failure(error)
                self.report.update(status='failed',code=result['code'],message=result['message'],finished_at=instant())
                self.publish()
        finally:self.lock.release()
