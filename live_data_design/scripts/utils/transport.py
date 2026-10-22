import time
import httpx
from .model import AuthError, DataError

class Transport:
    def __init__(self,client=None,retries=2):
        self.client=client or httpx.Client(timeout=30,follow_redirects=False)
        self.retries=retries
    def request(self,method,url,**kwargs):
        for attempt in range(self.retries+1):
            try:
                response=self.client.request(method,url,**kwargs)
            except httpx.HTTPError as exc:
                if attempt==self.retries: raise DataError('网络请求失败，重试耗尽') from exc
                time.sleep(2**attempt); continue
            if response.status_code in (429,500,502,503,504) and attempt<self.retries:
                time.sleep(2**attempt); continue
            if response.status_code==401 or (300<=response.status_code<400 and any(x in response.headers.get('location','').lower() for x in ('login','sso'))):
                raise AuthError('登录失效，请重新授权')
            if response.status_code==403: raise DataError('来源拒绝访问：权限不足')
            if not response.is_success: raise DataError(f'来源 HTTP {response.status_code}')
            try: body=response.json()
            except ValueError as exc: raise DataError('来源未返回 JSON') from exc
            if not isinstance(body,dict): raise DataError('来源响应必须为对象')
            return body
        raise DataError('请求失败')
