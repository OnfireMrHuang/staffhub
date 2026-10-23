"""Connection, transactions, locks and audit records shared by repositories."""
from contextlib import contextmanager
import hashlib
import json
import uuid

from .config import validate_tables
from .model import BusyError, ConfigError, LiveError, StorageError, timestamp


def encode(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, allow_nan=False, separators=(',', ':'))


def digest(value):
    return hashlib.sha256(encode(value).encode()).hexdigest()


class Database:
    table_roles = ('audit',)

    def __init__(self, connection, tables):
        self.tables = validate_tables(tables, self.table_roles)
        self.connection = connection

    @classmethod
    def configured_tables(cls, config):
        return config.database_tables(cls.table_roles)

    def table(self, role):
        return '`' + self.tables[role] + '`'

    @classmethod
    def connect(cls, config):
        import pymysql
        tables = cls.configured_tables(config)
        try:
            return cls(pymysql.connect(**config.database_kwargs()), tables)
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

    def audit(self, cursor, route, window, code, count, message):
        cursor.execute(
            'INSERT INTO ' + self.table('audit') + ' (run_id,task_id,source,window_start,window_end,status,exit_code,row_count,message) '
            'VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)',
            (str(uuid.uuid4()), route.task_id, route.source, timestamp(window.start), timestamp(window.end),
             'success' if code == 0 else 'failed', code, count, message))

    def failure(self, route, window, error):
        try:
            with self.transaction() as cursor:
                self.audit(cursor, route, window, error.code, 0, str(error)[:512])
        except Exception as exc:
            raise StorageError('无法记录失败状态，任务终止') from exc
