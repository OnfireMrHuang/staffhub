"""Connection, transactions, locks and audit records shared by repositories."""
from contextlib import contextmanager
import hashlib
import json
from pathlib import Path
import uuid

from .model import BusyError, ConfigError, LiveError, StorageError, timestamp


def encode(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, allow_nan=False, separators=(',', ':'))


def digest(value):
    return hashlib.sha256(encode(value).encode()).hexdigest()


class Database:
    def __init__(self, connection):
        self.connection = connection

    @classmethod
    def connect(cls, config):
        import pymysql
        try:
            return cls(pymysql.connect(**config.database_kwargs()))
        except pymysql.Error as exc:
            raise StorageError('MySQL 连接失败，请检查地址、数据库和权限') from exc

    def close(self): self.connection.close()

    @contextmanager
    def transaction(self):
        """Atomic repository writes, preserving classified errors and hiding SQL details."""
        try:
            self.connection.begin()
            with self.connection.cursor() as cursor:
                yield cursor
            self.connection.commit()
        except Exception as error:
            try:
                self.connection.rollback()
            except Exception as exc:
                raise StorageError('MySQL 事务回滚失败，请关闭连接并检查数据库状态') from exc
            if isinstance(error, LiveError):
                raise
            raise StorageError('数据入库失败，本任务事务已回滚') from error

    @contextmanager
    def lock(self, name='scheduler'):
        if not isinstance(name, str) or not name:
            raise ConfigError('任务锁名称不能为空')
        lock_name = 'live_data:' + hashlib.sha256(name.encode()).hexdigest()[:54]
        acquired = False
        try:
            with self.connection.cursor() as cursor:
                cursor.execute('SELECT GET_LOCK(%s, 0)', (lock_name,))
                acquired = cursor.fetchone()[0] == 1
            self.connection.commit()
            if not acquired:
                raise BusyError('相同范围已有任务运行')
        except (BusyError, StorageError):
            raise
        except Exception as exc:
            raise StorageError('MySQL 任务锁或连接异常') from exc
        try:
            yield
        finally:
            if acquired:
                try:
                    with self.connection.cursor() as cursor:
                        cursor.execute('SELECT RELEASE_LOCK(%s)', (lock_name,))
                except Exception as exc:
                    raise StorageError('MySQL 释放任务锁失败，关闭连接后锁自动释放') from exc

    def init_schema_files(self, *paths):
        """Execute only the DDL files supplied by the owning repository."""
        try:
            with self.connection.cursor() as cursor:
                for path in paths:
                    # Repository-owned schemas use whole-line -- comments. Remove
                    # these before splitting so punctuation in prose is never SQL.
                    sql = '\n'.join(line for line in Path(path).read_text().splitlines()
                                    if not line.lstrip().startswith('--'))
                    for statement in sql.split(';'):
                        if statement.strip():
                            cursor.execute(statement.strip())
            self.connection.commit()
        except Exception as exc:
            try:
                self.connection.rollback()
            except Exception as rollback_error:
                raise StorageError('MySQL 建表失败且连接回滚异常；部分对象可能已创建，请检查数据库状态') from rollback_error
            raise StorageError('建表失败；已创建的表保留，可修复后重跑') from exc

    def apply_schema(self, path):
        return self.init_schema_files(path)

    def audit(self, cursor, route, window, code, count, message):
        cursor.execute(
            'INSERT INTO collector_run (run_id,task_id,source,window_start,window_end,status,exit_code,row_count,message) '
            'VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)',
            (str(uuid.uuid4()), route.task_id, route.source, timestamp(window.start), timestamp(window.end),
             'success' if code == 0 else 'failed', code, count, message))

    def failure(self, route, window, error):
        try:
            with self.transaction() as cursor:
                self.audit(cursor, route, window, error.code, 0, str(error)[:512])
        except Exception as exc:
            raise StorageError('无法记录失败状态，任务终止') from exc
