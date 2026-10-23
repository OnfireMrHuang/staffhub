"""Execute repository transactions against SQLite; MySQL DDL is checked separately."""
import importlib
from datetime import datetime
import sqlite3
import unittest
from unittest.mock import patch

import httpx

from scripts.qianchuan.models import ReportBatch
from scripts.utils.model import Batch, CHINA, ConfigError, DataError, StorageError, Window
from scripts.utils.transport import Transport


class Connection:
    def __init__(self, source):
        self.tables = {'stats': source+'_stats', 'audit': 'collector_run'}
        self.db = sqlite3.connect(':memory:')
        definition = importlib.import_module(f'scripts.{source}.contracts').contract()
        columns = ','.join('`'+field['name']+'` TEXT' for field in definition['fields'])
        hour = 'stat_time_hour' if source == 'marketing' else 'stat_datetime'
        keys = f'advertiser_id,{hour}' + (',time_granularity,aweme_id' if source == 'qianchuan' else '')
        self.db.execute(f'CREATE TABLE {source}_stats ({columns},observed_at TEXT,UNIQUE({keys}))')
        self.db.execute('CREATE TABLE collector_run (run_id,task_id,source,window_start,window_end,status,exit_code,row_count,message)')
        self.fail_audit = False

    def begin(self): self.db.execute('BEGIN')
    def commit(self): self.db.commit()
    def rollback(self): self.db.rollback()
    def cursor(self): return self
    def __enter__(self): return self
    def __exit__(self, *args): pass

    def execute(self, sql, params):
        if self.fail_audit and sql.startswith('INSERT INTO `collector_run`'):
            raise RuntimeError('synthetic audit failure')
        self.db.execute(sql.replace('%s', '?'), params)


class StatsStorageTests(unittest.TestCase):
    def setUp(self):
        clock = patch('scripts.qianchuan.parameters.now', return_value=datetime(2026, 10, 23, tzinfo=CHINA))
        clock.start()
        self.addCleanup(clock.stop)
        self.window = Window.parse('2026-10-20T09:00:00', '2026-10-20T10:00:00')

    def batch(self, source, account='123', anchor='', name='first', hour='09', grain='TIME_GRANULARITY_HOURLY'):
        instant = f'2026-10-20 {hour}:00:00'
        dimensions = {'stat_time_hour': instant, 'stat_datetime': instant}
        metrics = {'_collection': {'context': {
            'advertiser_id': account, 'account_name': name, 'aweme_id': anchor, 'time_granularity': grain}}}
        rows = [{'dimensions': dimensions, 'metrics': metrics}]
        return Batch(ads=rows) if source == 'marketing' else ReportBatch(ads=rows, aweme_id=anchor)

    def test_marketing_replaces_account_hours_across_versions(self):
        from scripts.marketing import Repository, make_task
        connection = Connection('marketing')
        self.addCleanup(connection.db.close)
        repo = Repository(connection, connection.tables)
        for account in ('123', '456'):
            repo.write(make_task(account), self.window, self.batch('marketing', account))
        later = Window.parse('2026-10-20T10:00:00', '2026-10-20T11:00:00')
        repo.write(make_task('123'), later, self.batch('marketing', hour='10'))
        task = make_task('123', {'version': 'legacy'})
        repo.write(task, self.window, self.batch('marketing', name='updated'))
        self.assertEqual(connection.db.execute('SELECT COUNT(*) FROM marketing_stats').fetchone()[0], 3)
        self.assertEqual(connection.db.execute("SELECT account_name FROM marketing_stats WHERE advertiser_id='123' AND stat_time_hour='2026-10-20 09:00:00'").fetchone()[0], 'updated')
        repo.write(task, self.window, Batch())
        self.assertEqual(connection.db.execute('SELECT COUNT(*) FROM marketing_stats').fetchone()[0], 2)

    def test_qianchuan_repeated_and_empty_results_use_business_id(self):
        from scripts.qianchuan import Repository, make_task
        connection = Connection('qianchuan')
        self.addCleanup(connection.db.close)
        repo = Repository(connection, connection.tables)
        for anchor in ('', '987', '654'):
            task = make_task('123', {'aweme_ids': [anchor]} if anchor else {})
            repo.write(task, self.window, self.batch('qianchuan', anchor=anchor))
        alias = make_task('123', {'aweme_ids': [987]})
        repo.write(alias, self.window, self.batch('qianchuan', anchor='987', name='updated'))
        self.assertEqual(connection.db.execute('SELECT aweme_id,account_name FROM qianchuan_stats ORDER BY aweme_id').fetchall(),
                         [('', 'first'), ('654', 'first'), ('987', 'updated')])
        repo.write(alias, self.window, ReportBatch(aweme_id='987'))
        self.assertEqual(connection.db.execute('SELECT aweme_id FROM qianchuan_stats ORDER BY aweme_id').fetchall(), [('',), ('654',)])

    def test_audit_failure_rolls_back_replacement_for_both_ad_tables(self):
        for source in ('marketing', 'qianchuan'):
            module = importlib.import_module('scripts.'+source)
            connection = Connection(source)
            self.addCleanup(connection.db.close)
            repo, task = module.Repository(connection, connection.tables), module.make_task('123')
            repo.write(task, self.window, self.batch(source))
            connection.fail_audit = True
            with self.assertRaises(StorageError):
                repo.write(task, self.window, self.batch(source, name='replacement'))
            self.assertEqual(connection.db.execute(f'SELECT account_name FROM {source}_stats').fetchall(), [('first',)])
            self.assertEqual(connection.db.execute('SELECT COUNT(*) FROM collector_run').fetchone()[0], 1)

    def test_qianchuan_daily_and_hourly_at_midnight_never_replace_each_other(self):
        from scripts.qianchuan import Repository, make_task
        from scripts.qianchuan.parameters import DAILY, HOURLY
        connection = Connection('qianchuan')
        self.addCleanup(connection.db.close)
        repo = Repository(connection, connection.tables)
        midnight = Window.parse('2026-10-20T00:00:00', '2026-10-20T01:00:00')
        hourly = make_task('123')
        daily = make_task('123', {'time_granularity': DAILY})
        repo.write(hourly, midnight, self.batch('qianchuan', hour='00'))
        repo.write(daily, self.window, self.batch('qianchuan', hour='00', grain=DAILY))
        self.assertEqual(connection.db.execute('SELECT COUNT(*) FROM qianchuan_stats').fetchone()[0], 2)
        for invalid in (self.batch('qianchuan', hour='00'), self.batch('qianchuan', hour='09', grain=DAILY)):
            with self.assertRaises(DataError): repo.write(daily, self.window, invalid)
        connection.fail_audit = True
        with self.assertRaises(StorageError): repo.write(daily, self.window, ReportBatch())
        self.assertEqual(connection.db.execute('SELECT COUNT(*) FROM qianchuan_stats').fetchone()[0], 2)
        connection.fail_audit = False
        repo.write(daily, self.window, ReportBatch())
        self.assertEqual(connection.db.execute('SELECT time_granularity FROM qianchuan_stats').fetchall(), [(HOURLY,)])
        repo.write(daily, self.window, self.batch('qianchuan', hour='00', grain=DAILY))
        repo.write(hourly, midnight, ReportBatch())
        self.assertEqual(connection.db.execute('SELECT time_granularity FROM qianchuan_stats').fetchall(), [(DAILY,)])

    def test_bad_identity_or_duplicate_hour_does_not_delete_old_data(self):
        for source in ('marketing', 'qianchuan'):
            module = importlib.import_module('scripts.'+source)
            connection = Connection(source)
            self.addCleanup(connection.db.close)
            repo, task = module.Repository(connection, connection.tables), module.make_task('123')
            repo.write(task, self.window, self.batch(source))
            duplicate = self.batch(source)
            duplicate.ads *= 2
            for invalid in (self.batch(source, account='456'), self.batch(source, hour='10'), duplicate):
                with self.assertRaises(DataError): repo.write(task, self.window, invalid)
            self.assertEqual(connection.db.execute(f'SELECT account_name FROM {source}_stats').fetchall(), [('first',)])

    def test_qianchuan_resolves_identity_even_when_no_rows_return(self):
        from scripts.qianchuan import Collector, Repository, make_task
        task = make_task('123', {'aweme_ids': [987]})
        response = {'code': 0, 'data': {'list': [], 'page_info': {'total_page': 0, 'total_number': 0}}}
        transport = Transport(httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(200, json=response))), retries=0)
        self.addCleanup(transport.client.close)
        batch = Collector(transport).collect(task, self.window, {'access_token': 'test'})
        self.assertEqual((batch.aweme_id, batch.count), ('987', 0))
        connection = Connection('qianchuan')
        self.addCleanup(connection.db.close)
        repo = Repository(connection, connection.tables)
        with self.assertRaises(DataError): repo.write(task, self.window, Batch())
        with self.assertRaises(DataError):
            repo.write(make_task('123', {'aweme_ids': [654]}), self.window, batch)

    def test_marketing_rejects_anchor_filters_in_cli_and_python(self):
        from scripts.marketing import make_task
        from scripts.marketing.cli import parser
        for options in ({'aweme_id': 'display'}, {'aweme_ids': [987]}, {'account_scope': False}):
            with self.assertRaises(ConfigError): make_task('123', options)
        with self.assertRaises(ConfigError):
            parser().parse_args(['collect', '--advertise-id', '123', '--aweme-id', 'display'])


if __name__ == '__main__':
    unittest.main()
