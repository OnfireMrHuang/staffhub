import { useState } from 'react';
import { ArrowRight, Eye, EyeOff, LockKeyhole, UserRound, Wallet, Network, Check } from 'lucide-react';
import { useHub } from '../store';
import { Badge, Button, Modal } from '../components';
import { DEMO_ADMIN_USERNAME, DEMO_PASSWORD } from '../auth';

export default function Login(){
 const s=useHub();
 const [username,setUsername]=useState(''),[password,setPassword]=useState(''),[visible,setVisible]=useState(false),[error,setError]=useState('');
 const [platform,setPlatform]=useState(''),[identity,setIdentity]=useState(s.employees[0]?.id??''),[ssoError,setSsoError]=useState(''),[help,setHelp]=useState(false);
 const submit=()=>{setError('');try{s.loginPassword(username,password)}catch(e){setError(e instanceof Error?e.message:'登录未完成，请重试')}};
 const openSso=(name:string)=>{setPlatform(name);setSsoError('');setIdentity(s.employees.find(e=>e.id.toLowerCase()===username.trim().toLowerCase())?.id??s.employees[0]?.id??'')};
 return <div className="login-page">
  <aside className="login-story"><div className="brand"><span className="brand-mark">m<span/></span><div><strong>美魅网</strong><small>员工工作台</small></div></div><div className="login-story-body"><span className="login-eyebrow">MEIMEI STAFFHUB</span><h1>让每一份付出，<br/>都有清晰的依据。</h1><p>连接员工、运营数据与薪酬核算，<br/>把每个月的繁琐工作变得井然有序。</p><div className="login-flow">{[{icon:UserRound,title:'员工基础',detail:'统一档案与部门信息'},{icon:Network,title:'工作统计',detail:'从运营数据到可核对的依据'},{icon:Wallet,title:'月度薪资',detail:'规则计算，明细清晰'}].map(({icon:Icon,title,detail},i)=><div key={title}><span className="login-flow-icon"><Icon size={20}/></span><div><strong>{title}</strong><small>{detail}</small></div><span className="login-flow-step">0{i+1}</span></div>)}</div></div><div className="login-story-foot"><Check size={15}/>美魅网络 · 公司内部工作空间</div></aside>
  <main className="login-main"><div className="login-form-card"><div className="login-heading"><Badge tone="gray">DEMO</Badge><h2>欢迎回到工作台</h2><p>使用你的账号和密码登录</p></div>
   <form onSubmit={e=>{e.preventDefault();submit()}} className="password-login-form">
    <label htmlFor="login-username">用户名<div className="login-input"><UserRound size={17}/><input id="login-username" name="username" autoComplete="username" placeholder="请输入用户名" value={username} onChange={e=>{setUsername(e.target.value);setError('')}} required/></div></label>
    <label htmlFor="login-password">密码<div className="login-input"><LockKeyhole size={17}/><input id="login-password" name="password" type={visible?'text':'password'} autoComplete="current-password" placeholder="请输入密码" value={password} onChange={e=>{setPassword(e.target.value);setError('')}} required/><button type="button" className="icon-button" aria-label={visible?'隐藏密码':'显示密码'} aria-pressed={visible} onClick={()=>setVisible(!visible)}>{visible?<EyeOff size={17}/>:<Eye size={17}/>}</button></div></label>
    <div className="login-help-row"><span>公司内部账号</span><button type="button" className="text-button" onClick={()=>setHelp(true)}>忘记密码？</button></div>
    {error&&<p className="login-error" role="alert">{error}</p>}
    <Button variant="primary" type="submit" className="login-submit">登录工作台<ArrowRight size={17}/></Button>
   </form>
   <div className="login-divider"><span>辅助单点登录</span></div><div className="login-platforms">{['企业微信','钉钉','飞书'].map(name=><button key={name} onClick={()=>openSso(name)}><span className={`platform-symbol platform-${name}`}>{name.slice(0,1)}</span>{name}</button>)}</div><p className="login-sso-note">已绑定平台身份的员工也可使用单点登录</p>
   <div className="login-demo-account"><div><strong>汇报演示账号</strong><button className="text-button" onClick={()=>{setUsername(DEMO_ADMIN_USERNAME);setPassword(DEMO_PASSWORD);setError('')}}>填入管理员账号</button></div><p>管理员 <code>{DEMO_ADMIN_USERNAME}</code> · 员工 <code>{s.employees[0]?.id}</code></p><p>演示密码 <code>{DEMO_PASSWORD}</code></p><small>以上为公开演示口令；正式管理员密码由服务端环境变量提供。</small></div>
  </div><footer className="login-footer">MEIMEI STAFFHUB · 让工作与回报清晰可见</footer></main>
  <Modal open={!!platform} onOpenChange={open=>{if(!open)setPlatform('')}} title={`${platform}辅助登录`} description="模拟平台授权后的身份匹配，不连接实际平台。请选择要模拟的平台身份。"><label>演示员工身份<select value={identity} onChange={e=>{setIdentity(e.target.value);setSsoError('')}}>{s.employees.map(e=><option value={e.id} key={e.id}>{e.name} · {e.id}{e.identities.includes(platform)?' · 已绑定':' · 未绑定'}</option>)}</select></label>{ssoError&&<p className="login-error" role="alert">{ssoError}</p>}<div className="dialog-foot"><Button onClick={()=>setPlatform('')}>返回账号登录</Button><Button variant="primary" onClick={()=>{try{s.loginSso(platform,identity)}catch(e){setSsoError(e instanceof Error?e.message:'登录未完成')}}}>模拟授权登录</Button></div></Modal>
  <Modal open={help} onOpenChange={setHelp} title="找回账号或重置密码" description="请联系 HR 核对员工账号并重置密码。"><p>正式系统中，员工重置密码后需要在下次账号密码登录时修改密码。系统管理员密码始终以服务端环境变量 STAFFHUB_ADMIN_PASSWORD 为准，由运维更新。</p><p className="caption">本 DEMO 使用页面展示的公开演示口令，不实现正式密码重置。</p><div className="dialog-foot"><Button variant="primary" onClick={()=>setHelp(false)}>知道了</Button></div></Modal>
 </div>;
}
