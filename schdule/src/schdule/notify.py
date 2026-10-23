"""Tencent SMS adapter with per-source cooldown, independent of the collectors."""
from hashlib import sha256
import json
import os
import re
import time
from filelock import FileLock, Timeout
from .config import integer
from .errors import ScheduleError
from .runtime import atomic_json

LABELS={'marketing':'巨量营销','qianchuan':'巨量千川','pingan':'平安保单','zhongan':'众安保单'}
REASONS={'authorization_failed':'授权检查或恢复失败，请管理员在半小时内完成登录或重新授权',
         'collection_failed':'数据采集失败，请检查调度运行记录'}


class Notifier:
    def __init__(self,settings,sender=None):
        self.options=settings.data.get('sms',{})
        self.directory=settings.runtime_dir/'notifications'
        self.sender=sender or self._send
        self.enabled=self.options.get('enabled',False)
        if self.enabled:
            phones=self.options.get('phone_numbers',[])
            if (not isinstance(phones,list) or not 1<=len(phones)<=200
                or any(not isinstance(p,str) or not re.fullmatch(r'\+[1-9][0-9]{6,14}',p) for p in phones)
                or len(set(phones))!=len(phones)):
                raise ScheduleError('启用短信需要不重复的 E.164 号码数组')
            for key in ('sdk_app_id','sign_name','template_id'):
                value=self.options.get(key)
                if not isinstance(value,str) or not value.strip() or 'REPLACE' in value:
                    raise ScheduleError('短信应用、签名和模板必须完整配置')
            params=self.options.get('template_params',['{source}','{reason}'])
            if not isinstance(params,list) or any(not isinstance(p,str) for p in params):
                raise ScheduleError('短信模板参数必须为字符串数组')
            try:[p.format(source='',reason='') for p in params]
            except (KeyError,ValueError,IndexError) as error:raise ScheduleError('短信参数仅支持 source/reason') from error
            integer(self.options.get('cooldown_seconds',1800),'sms.cooldown_seconds')

    def _send(self,body):
        from tencentcloud.common import credential
        from tencentcloud.common.profile.client_profile import ClientProfile
        from tencentcloud.common.profile.http_profile import HttpProfile
        from tencentcloud.sms.v20210111 import sms_client,models
        credentials=credential.Credential(os.environ[self.options.get('secret_id_env','TENCENTCLOUD_SECRET_ID')],
                                         os.environ[self.options.get('secret_key_env','TENCENTCLOUD_SECRET_KEY')])
        profile=ClientProfile(httpProfile=HttpProfile(reqTimeout=20))
        client=sms_client.SmsClient(credentials,self.options.get('region','ap-guangzhou'),profile)
        request=models.SendSmsRequest()
        request.from_json_string(json.dumps(body,ensure_ascii=False))
        return json.loads(client.SendSms(request).to_json_string())

    def send(self,target,reason):
        if not self.enabled:return {'code':0,'status':'notification_disabled'}
        key=sha256(json.dumps([target.auth_key,reason,self.options['phone_numbers']],sort_keys=True).encode()).hexdigest()
        path=self.directory/(key+'.json')
        try:
            self.directory.mkdir(parents=True,exist_ok=True,mode=0o700)
            with FileLock(str(path)+'.lock',timeout=0):
                old=json.loads(path.read_text()) if path.exists() else {}
                if old.get('sent_at',0)>time.time()-self.options.get('cooldown_seconds',1800):
                    return {'code':0,'status':'notification_cooldown'}
                values={'source':LABELS[target.binding.source],'reason':REASONS[reason]}
                body={'PhoneNumberSet':self.options['phone_numbers'],'SmsSdkAppId':self.options['sdk_app_id'],
                      'SignName':self.options['sign_name'],'TemplateId':self.options['template_id'],
                      'TemplateParamSet':[p.format_map(values) for p in self.options.get('template_params',['{source}','{reason}'])]}
                response=self.sender(body)
                statuses=response.get('SendStatusSet',[])
                if (len(statuses)!=len(body['PhoneNumberSet'])
                    or {s.get('PhoneNumber') for s in statuses}!=set(body['PhoneNumberSet'])
                    or any(s.get('Code')!='Ok' for s in statuses)):
                    raise ValueError('delivery rejected')
                atomic_json(path,{'sent_at':time.time()})
                return {'code':0,'status':'notification_sent'}
        except Timeout:return {'code':7,'status':'notification_failed','message':'通知状态正在更新，下轮重试'}
        except Exception:return {'code':7,'status':'notification_failed','message':'短信发送或发送状态保存失败'}
