"""Prebuilt tables are configured explicitly; collectors never execute DDL."""
from datetime import datetime
import importlib
import io
import json
from pathlib import Path
import unittest
from contextlib import redirect_stdout
from unittest.mock import Mock, patch

from scripts.utils.config import Config
from scripts.utils.model import Batch, CHINA, ConfigError, DataError, Window

ROOT = Path(__file__).resolve().parents[1]
SOURCES = ('marketing', 'qianchuan', 'pingan', 'zhongan')


class DatabaseConfigTests(unittest.TestCase):
    def config(self, source):
        return Config.load(ROOT/source/'config/example.toml')

    def test_connect_uses_configured_connection_and_tables_without_executing_sql(self):
        for source in SOURCES:
            module = importlib.import_module('scripts.'+source)
            config = self.config(source)
            config.data['mysql'].update(host='database.internal', port=3307, database='prepared', user='writer',
                                        password='configured-password')
            tables = {role: 'configured_'+role for role in module.Repository.table_roles}
            config.data['mysql']['tables'] = tables
            connection = Mock()
            with self.subTest(source=source), patch('pymysql.connect', return_value=connection) as connect, \
                    patch.dict('os.environ', {source.upper()+'_MYSQL_PASSWORD': 'unused-env-password'}):
                repo = module.Repository.connect(config)
            self.assertEqual(repo.tables, tables)
            self.assertEqual(connect.call_args.kwargs['database'], 'prepared')
            self.assertEqual(connect.call_args.kwargs['host'], 'database.internal')
            self.assertEqual(connect.call_args.kwargs['port'], 3307)
            self.assertEqual(connect.call_args.kwargs['user'], 'writer')
            self.assertEqual(connect.call_args.kwargs['password'], 'configured-password')
            self.assertNotIn('tables', connect.call_args.kwargs)
            connection.cursor.assert_not_called()
            self.assertFalse(hasattr(repo, 'init_schema'))
            self.assertFalse(hasattr(repo, 'apply_schema'))

    def test_every_write_and_failure_audit_targets_configured_tables(self):
        window = Window.parse('2026-10-20T09:00:00', '2026-10-20T10:00:00')
        context = {'advertiser_id': '123', 'time_granularity': 'TIME_GRANULARITY_HOURLY',
                   'livePlatform': 'DOUYIN', 'dyNo': 'dy', 'startDate': '2026-10-20', 'roomId': 'room'}
        for source in SOURCES:
            module = importlib.import_module('scripts.'+source)
            config = self.config(source)
            config.data['mysql']['tables'] = {role: 'custom_'+role for role in module.Repository.table_roles}
            connection, cursor = Mock(), Mock()
            connection.cursor.return_value.__enter__ = Mock(return_value=cursor)
            connection.cursor.return_value.__exit__ = Mock(return_value=False)
            if source in SOURCES[:2]:
                task = module.make_task('123')
                batch = Batch(ads=[{'dimensions': {'stat_time_hour': '2026-10-20 09:00:00',
                                                  'stat_datetime': '2026-10-20 09:00:00'},
                                   'metrics': {'_collection': {'context': context}}}])
                expected = ['DELETE FROM `custom_stats`', 'INSERT INTO `custom_stats`', 'INSERT INTO `custom_audit`']
            else:
                task = module.task.make_task({'channel': 'ch'} if source=='pingan' else {'dy_no': 'dy'})
                batch = Batch(snapshots=[{'metrics': {'_collection': {'context': context}}}],
                              orders=[{'payload': {'postId': 'order', 'orderNo': 'order', '_collection': {'context': context}}}])
                expected = ['INSERT INTO `custom_stats`', 'INSERT INTO `custom_orders`', 'INSERT INTO `custom_audit`']
            with self.subTest(source=source), patch('pymysql.connect', return_value=connection), \
                 patch('scripts.qianchuan.parameters.now', return_value=datetime(2026,10,23,tzinfo=CHINA)):
                repo = module.Repository.connect(config)
                repo.write(task, window, batch)
                repo.failure(task, window, DataError('test failure'))
            statements = [call.args[0] for call in cursor.execute.call_args_list]
            self.assertEqual(len(statements), 4)
            for statement, prefix in zip(statements, expected+['INSERT INTO `custom_audit`']):
                self.assertTrue(statement.startswith(prefix), statement)
                self.assertNotIn('CREATE TABLE', statement)

    def test_missing_extra_duplicate_or_unsafe_names_fail_before_connect(self):
        from scripts.marketing.repository import Repository
        invalid = [None, {}, {'stats':'x'}, {'stats':'x','audit':'y','orders':'z'},
                   {'stats':'same','audit':'SAME'}]
        for name in ('', 'db.table', 'table`', 'table; DROP TABLE x', 'table name', '1table', 'a'*65, None):
            invalid.append({'stats':name, 'audit':'run_log'})
        for tables in invalid:
            config = self.config('marketing')
            config.data['mysql']['tables'] = tables
            with self.subTest(tables=tables), patch('pymysql.connect') as connect:
                with self.assertRaises(ConfigError): Repository.connect(config)
                connect.assert_not_called()

    def test_password_is_literal_and_missing_or_nonstring_password_has_no_env_fallback(self):
        from scripts.marketing.repository import Repository
        config = self.config('marketing')
        for password in ('', ' #$literal\\password '):
            config.data['mysql']['password'] = password
            self.assertEqual(config.database_kwargs()['password'], password)
        for password in (None, 123, False, ['SECRET']):
            config.data['mysql']['password'] = password
            with patch('pymysql.connect') as connect, \
                 patch.dict('os.environ', {'LIVE_MYSQL_PASSWORD':'env-password'}), \
                 self.assertRaises(ConfigError) as error:
                Repository.connect(config)
            connect.assert_not_called()
            self.assertNotIn('SECRET', str(error.exception))
        config.data['mysql'].pop('password')
        with self.assertRaises(ConfigError): config.database_kwargs()

    def test_only_three_commands_remain_and_auth_needs_no_database_config(self):
        for source in SOURCES:
            cli = importlib.import_module('scripts.'+source+'.cli')
            with self.subTest(source=source), self.assertRaises(ConfigError): cli.parser().parse_args(['init-db'])
            config = self.config(source)
            config.data.pop('mysql')
            args = ['check-auth'] + (['--advertise-id','123'] if source in SOURCES[:2]
                    else ['--channel','demo'] if source=='pingan' else ['--dy-no','demo'])
            with patch.object(cli.Config, 'load', return_value=config), patch.object(cli, 'check_task', return_value={}), \
                 patch('pymysql.connect', side_effect=AssertionError('unexpected connection')), redirect_stdout(io.StringIO()) as output:
                self.assertEqual(cli.main(args), 0)
            self.assertEqual(json.loads(output.getvalue())['status'], 'session_valid')
            with self.assertRaises(ConfigError): cli.validate_collection_config(config)

    def test_collect_dry_run_requires_table_mapping_without_database_or_network(self):
        from scripts.marketing import cli
        config = self.config('marketing')
        args = ['collect', '--advertise-id', '123', '--dry-run']
        with patch.object(cli.Config, 'load', return_value=config), \
             patch('pymysql.connect', side_effect=AssertionError('database')), \
             patch('httpx.Client', side_effect=AssertionError('network')), redirect_stdout(io.StringIO()) as output:
            self.assertEqual(cli.main(args), 0)
            config.data['mysql'].pop('tables')
            self.assertEqual(cli.main(args), 2)


if __name__ == '__main__':
    unittest.main()
