import hashlib
import json
import os
import time
from filelock import FileLock, Timeout
from scripts.utils.auth import private_json, read_state
from scripts.utils.model import AlertError

LABELS={'marketing':'巨量营销','qianchuan':'巨量千川','pingan':'平安保单','zhongan':'众安保单'}
MESSAGES={'auth_required':'授权失败，请在半小时内完成登录或重新授权','collection_failed':'数据采集失败，请检查任务日志','permission_denied':'来源权限或响应异常，请检查配置'}

class Notifier:
    def __init__(self,config,sender=None):
        self.config=config; self.settings=config.data.get('sms',{}); self.sender=sender or self._send_sdk
    def _send_sdk(self,body):
        try:
            from tencentcloud.common import credential
            from tencentcloud.common.profile.client_profile import ClientProfile
            from tencentcloud.common.profile.http_profile import HttpProfile
            from tencentcloud.sms.v20210111 import sms_client,models
            sid=os.environ[self.settings.get('secret_id_env','TENCENTCLOUD_SECRET_ID')]
            secret=os.environ[self.settings.get('secret_key_env','TENCENTCLOUD_SECRET_KEY')]
            http=HttpProfile(); http.reqTimeout=20
            profile=ClientProfile(httpProfile=http)
            client=sms_client.SmsClient(credential.Credential(sid,secret),self.settings.get('region','ap-guangzhou'),profile)
            req=models.SendSmsRequest(); req.from_json_string(json.dumps(body,ensure_ascii=False))
            return json.loads(client.SendSms(req).to_json_string())
        except Exception as exc:
            # SDK exceptions may include request details. Keep only safe operational text.
            raise AlertError('腾讯云短信请求失败，请检查凭据、签名和模板') from exc
    def send(self,source,credential_name,error):
        if not self.settings.get('enabled',False): return 'disabled'
        phones=self.settings.get('phone_numbers',[])
        if not phones or len(phones)>200 or len(set(phones))!=len(phones): raise AlertError('短信收件号码配置无效')
        key=hashlib.sha256(json.dumps([source,credential_name,error,phones],ensure_ascii=False).encode()).hexdigest()
        path=self.config.state_dir/'alerts'/(key+'.json'); path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
        try:
            with FileLock(str(path)+'.lock',timeout=0):
                old=read_state(path)
                if old.get('sent_at',0)>time.time()-self.config.settings.get('alert_cooldown_seconds',1800): return 'cooldown'
                values={'source':LABELS[source],'credential':credential_name,'error':MESSAGES.get(error,'任务失败'),'minutes':'30'}
                try: params=[str(x).format_map(values) for x in self.settings.get('template_params',['{source}','{error}'])]
                except (KeyError,ValueError) as exc: raise AlertError('短信模板参数仅支持 source/credential/error/minutes') from exc
                body={'PhoneNumberSet':phones,'SmsSdkAppId':str(self.settings.get('sdk_app_id','')),'SignName':self.settings.get('sign_name',''),'TemplateId':str(self.settings.get('template_id','')),'TemplateParamSet':params}
                result=self.sender(body)
                statuses=result.get('SendStatusSet',[])
                if len(statuses)!=len(phones) or {s.get('PhoneNumber') for s in statuses}!=set(phones) or any(s.get('Code')!='Ok' for s in statuses):
                    raise AlertError('腾讯云短信至少一个收件号码发送失败')
                private_json(path,{'sent_at':time.time()})
                return 'sent'
        except Timeout as exc: raise AlertError('告警状态正在更新，请下轮重试') from exc
