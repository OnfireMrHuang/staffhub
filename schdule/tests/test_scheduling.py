from copy import deepcopy
from dataclasses import replace
from datetime import datetime
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from unittest.mock import Mock, patch

from schdule import authorization, collection
from schdule.cli import main
from schdule.collectors import Collectors
from schdule.config import Settings
from schdule.errors import ScheduleError
from schdule.models import Binding
from schdule.plan import build_plan, load_fixture, load_mysql
from schdule.runtime import Run
from schdule.notify import Notifier
from scripts.utils.model import AuthError, CHINA, Window
from scripts.qianchuan.parameters import DAILY, HOURLY

ROOT=Path(__file__).resolve().parents[1]
WINDOW=Window.parse('2026-10-20T09:00:00','2026-10-20T10:00:00')


def plan():
    settings=Settings.load(ROOT/'config/preview.toml')
    adapter=Collectors(settings)
    bindings=load_fixture(ROOT/'config/plan.example.json',100)
    return build_plan(bindings,adapter),adapter


class Journal:
    def __init__(self):self.report={'code':0,'results':[]}
    def add(self,item):
        self.report['results'].append(deepcopy(item));self.report['code']=max(self.report['code'],item['code'])
    def finish(self):return self.report


class PlanTests(unittest.TestCase):
    def test_duplicates_collapse_and_ads_precede_one_backend(self):
        targets,_=plan()
        self.assertEqual(len(targets),5)
        self.assertEqual([t.binding.source for t in targets],['marketing','marketing','pingan','qianchuan','zhongan'])
        self.assertTrue(all(not hasattr(t.task,'room_id') for t in targets))

    def test_same_scope_in_other_room_is_rejected(self):
        targets,adapter=plan();binding=targets[0].binding
        with self.assertRaises(ScheduleError):build_plan([binding,replace(binding,room_id='other')],adapter)

    def test_full_and_filtered_account_scopes_are_rejected(self):
        targets,adapter=plan();binding=targets[3].binding
        with self.assertRaises(ScheduleError):
            build_plan([binding,replace(binding,options={'aweme_ids':[987]})],adapter)

    def test_qianchuan_config_and_plan_granularity_are_distinct_targets_with_one_auth(self):
        targets,adapter=plan();binding=targets[3].binding
        config=deepcopy(adapter.configs['qianchuan'])
        config.data['report']={'time_granularity':DAILY}
        adapter.configs['qianchuan']=config
        self.assertEqual(adapter.prepare(binding).task.options['time_granularity'],DAILY)
        targets=build_plan([binding,replace(binding,options={'time_granularity':HOURLY})],adapter)
        self.assertEqual(len(targets),2)
        self.assertEqual({t.task.options['time_granularity'] for t in targets},{HOURLY,DAILY})
        self.assertEqual({t.auth_key for t in targets},{'qianchuan'})
        checks=Mock();checks.check.return_value={'code':0,'status':'session_valid'}
        authorization.execute(targets,checks,Journal(),Mock())
        self.assertEqual([call.kwargs['renew'] for call in checks.check.call_args_list],[True,False])

    def test_two_distinct_policy_ranges_in_one_room_are_rejected(self):
        targets,adapter=plan();binding=targets[2].binding
        with self.assertRaises(ScheduleError):
            build_plan([binding,replace(binding,options={'channel':'other'})],adapter)

    def test_policy_cannot_carry_account_and_unknown_options_fail_before_execution(self):
        targets,adapter=plan()
        with self.assertRaises(ScheduleError):adapter.prepare(replace(targets[2].binding,advertise_id='123'))
        with self.assertRaises(Exception):adapter.prepare(replace(targets[0].binding,options={'product_id':'irrelevant'}))

    def test_json_projection_is_strict(self):
        raw={'product_id':'p','room_id':'r','source':'marketing','advertise_id':'123','options':'{}'}
        self.assertEqual(Binding.parse(raw).options,{})
        for change in ({'advertise_id':123},{'options':'[]'},{'source':'bad'},{'secret':'do-not-accept'},
                       {'credential':'default'},{'product_id':''}):
            with self.subTest(change=change),self.assertRaises(ScheduleError):Binding.parse({**raw,**change})

    def test_sql_reader_is_read_only_bounded_and_closes_before_execution(self):
        rows=[{'product_id':'p','room_id':'r','source':'marketing','advertise_id':'123','options':{}}]
        connection=Mock();cursor=Mock()
        connection.cursor.return_value.__enter__=Mock(return_value=cursor)
        connection.cursor.return_value.__exit__=Mock(return_value=False)
        cursor.fetchmany.return_value=rows
        settings=Settings(ROOT/'config/test.toml',{'plan':{'query_file':'plan.example.sql','max_rows':2},
                          'mysql':{'password':'configured-password'}})
        connect=Mock(return_value=connection)
        with patch.dict('os.environ',{'SCHDULE_MYSQL_PASSWORD':'unused-env-password'}):
            self.assertEqual(len(load_mysql(settings,connect=connect)),1)
        self.assertEqual(connect.call_args.kwargs['password'],'configured-password')
        self.assertEqual(cursor.execute.call_args_list[0].args,('SET TRANSACTION READ ONLY',))
        cursor.fetchmany.assert_called_once_with(3)
        connection.begin.assert_called_once();connection.commit.assert_called_once();connection.close.assert_called_once()

    def test_sql_failure_is_safe_and_connection_is_closed(self):
        connection=Mock();cursor=Mock()
        connection.cursor.return_value.__enter__=Mock(return_value=cursor)
        connection.cursor.return_value.__exit__=Mock(return_value=False)
        cursor.execute.side_effect=RuntimeError('mysql_password=SECRET')
        settings=Settings(ROOT/'config/test.toml',{'plan':{'query_file':'plan.example.sql'},'mysql':{'password':'SECRET'}})
        with self.assertRaises(ScheduleError) as error:load_mysql(settings,connect=Mock(return_value=connection))
        self.assertEqual(error.exception.code,5);self.assertNotIn('SECRET',str(error.exception))
        connection.close.assert_called_once()

    def test_password_is_required_from_config_without_environment_fallback(self):
        for password in (None,123,False,['SECRET']):
            settings=Settings(ROOT/'config/test.toml',{'plan':{'query_file':'plan.example.sql'},
                              'mysql':{'password':password}})
            connect=Mock()
            with patch.dict('os.environ',{'SCHDULE_MYSQL_PASSWORD':'unused'}), self.assertRaises(ScheduleError) as error:
                load_mysql(settings,connect)
            connect.assert_not_called()
            self.assertEqual(error.exception.code,2)
            self.assertNotIn('SECRET',str(error.exception))

    def test_empty_and_truncated_result_never_succeed(self):
        from schdule.plan import validate_rows
        for rows,limit in [([],1),([{},{}],1)]:
            with self.assertRaises(ScheduleError):validate_rows(rows,limit)

    def test_non_query_sql_is_rejected_without_connecting(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'bad.sql';path.write_text('DELETE FROM anything')
            settings=Settings(Path(tmp)/'c.toml',{'plan':{'query_file':'bad.sql'}})
            connect=Mock()
            with self.assertRaises(ScheduleError):load_mysql(settings,connect)
            connect.assert_not_called()


class AuthorizationTests(unittest.TestCase):
    def test_renew_once_then_check_every_account(self):
        targets,_=plan();adapter=Mock();run=Journal();notifier=Mock()
        adapter.check.return_value={'code':0,'status':'session_valid','scope_status':'verified'}
        result=authorization.execute(targets,adapter,run,notifier,threshold=1200,wait=20)
        self.assertEqual([call.kwargs['renew'] for call in adapter.check.call_args_list],[True,False,True,True,True])
        self.assertEqual([call.kwargs['threshold'] for call in adapter.check.call_args_list],[1200]*5)
        self.assertEqual(result['code'],0);notifier.send.assert_not_called()

    def test_bad_first_account_does_not_hide_other_accounts(self):
        targets,_=plan();adapter=Mock();run=Journal();notifier=Mock()
        adapter.check.side_effect=[{'code':3,'status':'failed'},*({'code':0,'status':'session_valid'} for _ in range(4))]
        notifier.send.return_value={'code':7,'status':'notification_failed'}
        result=authorization.execute(targets,adapter,run,notifier)
        self.assertEqual(adapter.check.call_count,5);notifier.send.assert_called_once()
        self.assertEqual(result['code'],7)

    def test_busy_credentials_are_deferred_without_sms(self):
        targets,_=plan();adapter=Mock();notifier=Mock()
        adapter.check.return_value={'code':6,'status':'failed'}
        result=authorization.execute(targets,adapter,Journal(),notifier)
        self.assertEqual(result['code'],6);notifier.send.assert_not_called()

    def test_adapter_delegates_threshold_without_leaking_token(self):
        targets,adapter=plan();target=targets[0]
        api=Mock();api.check_task.return_value={'access_token':'SECRET','expires_at':123,'scope_status':'verified'}
        target=replace(target,api=api)
        result=adapter.check(target,renew=True,threshold=1200)
        cfg=api.check_task.call_args.args[0]
        self.assertEqual(cfg.settings['refresh_before_seconds'],1200)
        self.assertEqual(target.config.settings['refresh_before_seconds'],1800)
        self.assertTrue(api.check_task.call_args.kwargs['renew'])
        self.assertNotIn('SECRET',json.dumps(result));self.assertNotIn('expires_at',result)

    def test_scope_unobserved_stays_explicit_and_errors_are_redacted(self):
        targets,adapter=plan();api=Mock();target=replace(targets[-1],api=api)
        api.check_task.return_value={'scope_status':'unobserved_no_live_rooms'}
        self.assertEqual(adapter.check(target)['scope_status'],'unobserved_no_live_rooms')
        api.check_task.side_effect=AuthError('Cookie=SECRET')
        result=adapter.check(target)
        self.assertEqual(result['code'],3);self.assertNotIn('SECRET',json.dumps(result))


class CollectionTests(unittest.TestCase):
    def setUp(self):
        clock=patch('scripts.qianchuan.parameters.now',return_value=datetime(2026,10,23,tzinfo=CHINA))
        clock.start();self.addCleanup(clock.stop)

    def invoke(self,policy='continue',code=4):
        targets,_=plan();adapter=Mock();notifier=Mock();journal=Journal()
        adapter.collect.side_effect=[{'code':code,'status':'failed'},*({'code':0,'status':'success','rows':1} for _ in range(8))]
        result=collection.execute(targets,adapter,journal,notifier,WINDOW,on_error=policy)
        return adapter,result

    def test_continue_runs_next_account_and_room(self):
        adapter,result=self.invoke();self.assertEqual(adapter.collect.call_count,5);self.assertEqual(result['code'],4)

    def test_skip_room_does_not_skip_next_product(self):
        adapter,result=self.invoke('skip-room')
        self.assertEqual(adapter.collect.call_count,3)
        self.assertEqual([r['status'] for r in result['results']],['failed','skipped','skipped','success','success'])

    def test_abort_and_storage_failure_stop_all_remaining(self):
        for policy,code in [('abort',4),('continue',5),('skip-room',5)]:
            adapter,result=self.invoke(policy,code)
            self.assertEqual(adapter.collect.call_count,1)
            self.assertEqual(sum(r['status']=='skipped' for r in result['results']),4)

    def test_zhongan_receives_full_days_across_midnight(self):
        targets,_=plan();target=targets[-1]
        window=Window.parse('2026-10-20T23:00:00','2026-10-21T01:00:00')
        periods=collection.windows(target,window)
        self.assertEqual([p.dates() for p in periods],[['2026-10-20'],['2026-10-21']])
        self.assertTrue(all(p.start.hour==p.end.hour==0 for p in periods))
        midnight=Window.parse('2026-10-20T23:00:00','2026-10-21T00:00:00')
        self.assertEqual(collection.windows(target,midnight)[0].dates(),['2026-10-20'])

    def test_qianchuan_daily_preview_and_journal_use_actual_full_date_window(self):
        targets,adapter=plan()
        target=adapter.prepare(replace(targets[3].binding,options={'time_granularity':DAILY}))
        period=collection.windows(target,WINDOW)[0]
        self.assertEqual(period.start.isoformat(),'2026-10-20T00:00:00+08:00')
        self.assertEqual(period.end.isoformat(),'2026-10-21T00:00:00+08:00')
        execution=Mock();execution.collect.return_value={'code':0,'status':'success','rows':1}
        result=collection.execute([target],execution,Journal(),Mock(),WINDOW)
        execution.collect.assert_called_once_with(target,period)
        self.assertEqual(result['results'][0]['start'],period.start.isoformat())
        self.assertEqual(result['results'][0]['end'],period.end.isoformat())

    def test_journal_failure_prevents_next_source(self):
        targets,_=plan();adapter=Mock();adapter.collect.return_value={'code':0,'status':'success'}
        run=Mock();run.add.side_effect=ScheduleError('disk full',5)
        with self.assertRaises(ScheduleError):collection.execute(targets,adapter,run,Mock(),WINDOW)
        adapter.collect.assert_called_once()

    def test_collector_result_is_checked_and_whitelisted(self):
        targets,adapter=plan();api=Mock();target=replace(targets[0],api=api)
        for invalid in [True,None,'0',8]:
            api.collect_task.return_value={'code':invalid,'message':'SECRET'}
            result=adapter.collect(target,WINDOW);self.assertEqual(result['code'],4);self.assertNotIn('SECRET',json.dumps(result))
        api.collect_task.return_value={'code':0,'rows':2,'token':'SECRET'}
        self.assertEqual(adapter.collect(target,WINDOW),{'code':0,'status':'success','rows':2})


class RuntimeAndCLITests(unittest.TestCase):
    def test_job_locks_are_independent_and_same_job_is_excluded(self):
        with tempfile.TemporaryDirectory() as tmp:
            with Run(tmp,'collect') as one:
                with Run(tmp,'auth') as two:two.finish()
                with self.assertRaises(ScheduleError) as error:
                    with Run(tmp,'collect'):pass
                self.assertEqual(error.exception.code,6)
                one.finish()
            with Run(tmp,'collect') as later:later.finish()

    def test_result_journal_is_private_and_survives_failure(self):
        with tempfile.TemporaryDirectory() as tmp:
            run=Run(tmp,'collect')
            with self.assertRaises(ScheduleError):
                with run:
                    run.add({'code':0,'status':'success'})
                    raise ScheduleError('safe failure',5)
            data=json.loads(run.path.read_text())
            self.assertEqual(data['code'],5);self.assertEqual(len(data['results']),1)
            self.assertEqual(run.path.stat().st_mode & 0o777,0o600)

    def test_both_preview_commands_need_neither_database_nor_network(self):
        for job in ('auth','collect'):
            with patch('pymysql.connect',side_effect=AssertionError('DB')),patch('httpx.Client',side_effect=AssertionError('network')),redirect_stdout(io.StringIO()) as output:
                code=main(job,['--config',str(ROOT/'config/preview.toml'),'--plan-file',str(ROOT/'config/plan.example.json'),'--dry-run'])
            self.assertEqual(code,0,output.getvalue());self.assertEqual(len(json.loads(output.getvalue())['tasks']),5)

    def test_offline_plan_cannot_be_used_for_real_execution(self):
        with redirect_stdout(io.StringIO()) as output:
            result=main('collect',['--config',str(ROOT/'config/preview.toml'),'--plan-file',str(ROOT/'config/plan.example.json')])
        self.assertEqual(result,2)

    def test_source_imports_do_not_depend_on_scheduler_or_old_code(self):
        program='''import sys,importlib.abc,importlib
class Block(importlib.abc.MetaPathFinder):
 def find_spec(self,fullname,path=None,target=None):
  if fullname.split('.')[0] in ('schdule','live_data','catalog','registry'):
   raise AssertionError('reverse dependency')
sys.meta_path.insert(0,Block())
for source in ('marketing','qianchuan','pingan','zhongan'):importlib.import_module('scripts.'+source+'.cli')
'''
        result=subprocess.run([sys.executable,'-c',program],cwd='/tmp',capture_output=True,text=True)
        self.assertEqual(result.returncode,0,result.stderr)


class NotificationTests(unittest.TestCase):
    def settings(self,tmp):
        return Settings(Path(tmp)/'settings.toml',{'runtime':{'directory':tmp},'sms':{
            'enabled':True,'sdk_app_id':'123','sign_name':'test','template_id':'456','phone_numbers':['+8613800000000']}})

    def test_success_enters_cooldown_and_failed_delivery_does_not(self):
        targets,_=plan()
        with tempfile.TemporaryDirectory() as tmp:
            sender=Mock(return_value={'SendStatusSet':[{'PhoneNumber':'+8613800000000','Code':'Failed'}]})
            notifier=Notifier(self.settings(tmp),sender)
            self.assertEqual(notifier.send(targets[0],'authorization_failed')['code'],7)
            sender.return_value={'SendStatusSet':[{'PhoneNumber':'+8613800000000','Code':'Ok'}]}
            self.assertEqual(notifier.send(targets[0],'authorization_failed')['status'],'notification_sent')
            self.assertEqual(notifier.send(targets[1],'authorization_failed')['status'],'notification_cooldown')
            self.assertEqual(sender.call_count,2)

    def test_missing_recipient_and_sdk_errors_are_failures_without_secret_output(self):
        targets,_=plan()
        with tempfile.TemporaryDirectory() as tmp:
            notifier=Notifier(self.settings(tmp),Mock(side_effect=RuntimeError('secret=SECRET')))
            result=notifier.send(targets[0],'authorization_failed')
            self.assertEqual(result['code'],7);self.assertNotIn('SECRET',json.dumps(result))
            notifier.sender=Mock(return_value={'SendStatusSet':[]})
            self.assertEqual(notifier.send(targets[0],'authorization_failed')['code'],7)

    def test_disabled_notifications_never_send(self):
        targets,_=plan()
        with tempfile.TemporaryDirectory() as tmp:
            sender=Mock();notifier=Notifier(Settings(Path(tmp)/'c',{}),sender)
            self.assertEqual(notifier.send(targets[0],'authorization_failed')['status'],'notification_disabled')
            sender.assert_not_called()


class EntryIntegrationTests(unittest.TestCase):
    def test_missing_table_config_stops_before_any_collector_runs(self):
        bindings=load_fixture(ROOT/'config/plan.example.json',100)
        with tempfile.TemporaryDirectory() as tmp:
            base=Settings.load(ROOT/'config/preview.toml')
            settings=Settings(base.path,{**base.data,'runtime':{'directory':tmp}})
            from scripts.utils.model import ConfigError
            with (patch('schdule.cli.Settings.load',return_value=settings),
                  patch('schdule.cli.load_mysql',return_value=bindings),
                  patch('scripts.qianchuan.cli.validate_collection_config',side_effect=ConfigError('mysql.tables 缺失')),
                  patch.object(Collectors,'collect') as collect,
                  redirect_stdout(io.StringIO()) as output):
                self.assertEqual(main('collect',[]),2)
            collect.assert_not_called()
            self.assertEqual(json.loads(output.getvalue())['code'],2)

    def test_formal_entries_load_mysql_plan_and_persist_each_result(self):
        bindings=load_fixture(ROOT/'config/plan.example.json',100)
        for job in ('auth','collect'):
            with self.subTest(job=job),tempfile.TemporaryDirectory() as tmp:
                base=Settings.load(ROOT/'config/preview.toml')
                settings=Settings(base.path,{**base.data,'runtime':{'directory':tmp}})
                with (patch('schdule.cli.Settings.load',return_value=settings),
                      patch('schdule.cli.load_mysql',return_value=bindings) as read,
                      patch.object(Collectors,'check',return_value={'code':0,'status':'session_valid','scope_status':'verified'}) as check,
                      patch.object(Collectors,'collect',return_value={'code':0,'status':'success','rows':2}) as collect,
                      redirect_stdout(io.StringIO()) as output):
                    self.assertEqual(main(job,[]),0)
                read.assert_called_once_with(settings)
                result=json.loads(output.getvalue())
                stored=json.loads((Path(tmp)/'runs'/(result['run_id']+'.json')).read_text())
                self.assertEqual(stored,result)
                self.assertEqual(result['status'],'success');self.assertEqual(len(result['results']),5)
                self.assertEqual(check.call_count,5 if job=='auth' else 0)
                self.assertEqual(collect.call_count,5 if job=='collect' else 0)

    def test_unwritable_initial_journal_prevents_even_plan_query(self):
        with tempfile.TemporaryDirectory() as tmp:
            settings=Settings(ROOT/'config/preview.toml',{'runtime':{'directory':tmp}})
            with (patch('schdule.cli.Settings.load',return_value=settings),
                  patch('schdule.runtime.atomic_json',side_effect=OSError('SECRET')),
                  patch('schdule.cli.load_mysql') as read,
                  redirect_stdout(io.StringIO()) as output):
                self.assertEqual(main('auth',[]),5)
            read.assert_not_called();self.assertNotIn('SECRET',output.getvalue())

if __name__=='__main__':unittest.main()
