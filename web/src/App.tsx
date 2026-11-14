import React,{useCallback,useEffect,useMemo,useState,type FormEvent,type ReactNode} from 'react';
import {api,setCsrf,roleNames,pages,type Person,type Row,addDays,monday,startDay,dateRU,timeRU,toCash,usd,parseForm} from './api';
import {Logo,Brand,Button,Heading,Card,Metric,Status,Empty,Table,Field,Area,SelectField,ModalShell,Progress} from './UI';

type Theme='neon'|'dark'|'light';type Currency='USD'|'RUB';
type Dialog={kind:string;row?:Row}|null;
type SaveFn=(url:string,method:string,payload?:unknown,close?:boolean)=>Promise<any>;
const iconMap:Record<string,string>={dashboard:'▦',shifts:'▣',reports:'▤',analytics:'▥',users:'♙',teams:'♧',kpis:'◎',leaves:'◷',training:'▧',notifications:'♢',balances:'▱',payouts:'↧',fines:'⚑',settings:'⚙',audit:'◫'};
const navGroups=[['Работа','dashboard','shifts','reports','analytics','users','teams','kpis','leaves','training','notifications'],['Финансы','balances','payouts','fines'],['Система','settings','audit']];
const teamsAccess=(r:string)=>['owner','admin','teamlead','coach'].includes(r);
const manager=(r:string)=>['owner','admin'].includes(r);
const canCreateShift=(r:string)=>['owner','admin','teamlead','operator','trial'].includes(r);
const canCreateReport=canCreateShift;
const ownerOnly=(role:string)=>role==='owner';
const fmt=(row:Row,field:string)=>String(row[field]??'—');
const personOpts=(people:Person[],roles:string[]|null=null,empty='Не назначен')=>[
 {value:'',label:empty},...people.filter(p=>!roles||roles.includes(p.role)).map(p=>({value:p.id,label:`${p.nickname?'@'+p.nickname+' · ':''}${p.name}`}))];
const hasPage=(key:string,role:string)=>{
 if(key==='audit')return role==='owner';
 if(key==='analytics')return role!=='model';
 if(['users','teams'].includes(key))return teamsAccess(role);
 if(key==='training')return role!=='model';
 return true;
};
function Auth({onLogin,theme,setTheme}:{onLogin:(user:Person,csrf:string,config:Row)=>void;theme:Theme;setTheme:(x:Theme)=>void}){
 const [mode,setMode]=useState<'login'|'register'>('login');const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [notice,setNotice]=useState('');
 const submit=async(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();setBusy(true);setError('');setNotice('');const data=parseForm(e.currentTarget);
  try{const r=await api(mode==='login'?'login':'register','POST',data);if(mode==='login'){
    const s=await api('session');setCsrf(s.csrf);onLogin(s.user,s.csrf,s.config)
   }else{setNotice(r.message);setMode('login')}
  }catch(err:any){setError(err.message)}finally{setBusy(false)}};
 return <div className="auth"><section className="auth-left"><Brand large/><div><h1>Личный<br/>кабинет<span className="dot">.</span></h1><p>Команда, смены, отчёты и финансы — в едином пространстве Finesse.</p></div><div className="auth-foot">● Ваше пространство для работы</div></section>
  <section className="auth-right"><div className="auth-theme" role="group" aria-label="Выбор оформления">{(['neon','dark','light'] as Theme[]).map(t=><Button key={t} variant={theme===t?'active':''} onClick={()=>setTheme(t)}>{({neon:'Розовая',dark:'Тёмная',light:'Светлая'} as Record<Theme,string>)[t]}</Button>)}</div>
  <div className="auth-body"><div className="eyebrow">Finesse · Studio CRM</div><h2>{mode==='login'?'Вход':'Регистрация'}</h2><p className="hint">{mode==='login'?'Введите данные аккаунта':'Новые аккаунты одобряются администратором'}</p>
  <form onSubmit={submit}>{mode==='register'&&<><Field name="name" label="Имя" required/><Field name="nickname" label="Никнейм (необязательно)"/></>}
  <Field name="email" label="Email" type="email" required placeholder="you@agency.com"/>
  <Field name="password" label="Пароль" type="password" required placeholder="Минимум 12 символов" min={undefined}/>
  {error&&<div className="alert" role="alert" style={{color:'var(--bad)'}}>{error}</div>}{notice&&<div className="alert" role="status">{notice}</div>}
  <button className="btn main auth-submit" type="submit" disabled={busy}>{busy?'Обработка…':mode==='login'?'Войти':'Отправить заявку'}</button></form>
  <div className="auth-switch">{mode==='login'?'Нет аккаунта? ':'Уже зарегистрированы? '}<button onClick={()=>{setMode(mode==='login'?'register':'login');setError('');setNotice('')}}>{mode==='login'?'Регистрация':'Войти'}</button></div>
  <p className="note">Доступ защищён. Регистрация не требует кода из электронной почты.</p></div>
  </section></div>;
}
function ModelPicker({onChange,selectedId}:{onChange:(x:string)=>void;selectedId?:string}){
 const [term,setTerm]=useState('');const [found,setFound]=useState<Person[]>([]);const [picked,setPicked]=useState<Person|null>(null);
 useEffect(()=>{if(term.trim().length<2){setFound([]);return}let cancelled=false;const timer=setTimeout(()=>{api<{items:Person[]}>(`users?q=${encodeURIComponent(term)}&role=model`).then(r=>{if(!cancelled)setFound(r.items)}).catch(()=>{if(!cancelled)setFound([])})},220);return()=>{cancelled=true;clearTimeout(timer)}},[term]);
 useEffect(()=>{onChange(selectedId||'')},[selectedId]);
 return <div className="field span2"><label>Модель · поиск по email или никнейму</label><div className="suggest-wrap"><input className="input" placeholder="Начните вводить email или никнейм (от 2 символов)" value={picked?`${picked.nickname?'@'+picked.nickname+' · ':''}${picked.name} (${picked.email})`:term} onChange={e=>{setPicked(null);setTerm(e.target.value);onChange('')}} aria-label="Поиск модели" autoComplete="off"/>
  {!picked&&term.length>=2&&<div className="suggestions">{found.length?found.map(p=><button key={p.id} type="button" onClick={()=>{setPicked(p);onChange(p.id);setFound([])}}>{p.name}<span>{p.nickname?'@'+p.nickname+' · ':''}{p.email}</span></button>):<div className="hint" style={{padding:12}}>Модель не найдена</div>}</div>}</div>
  <small className="hint">Выберите найденную модель из списка. Просто ввести текст недостаточно.</small></div>;
}
function ReportAmounts({config,initial}:{config:Row;initial?:Row[]}){
 const [amounts,setAmounts]=useState(Array.from({length:5},(_,i)=>String(Number(initial?.[i]?.amount_cents||0)/100)));
 const total=Math.round(amounts.reduce((a,b)=>a+(Number(b)||0),0)*100)/100;
 return <><div className="span2 amount-list">{amounts.map((x,i)=><div className="amount-field" key={i}><span>{config['slot_'+(i+1)]||`Площадка ${i+1}`}</span><label className="amount-money"><input className="input" name={`amount_${i+1}`} type="number" min="0" step="0.01" required value={x} onChange={e=>setAmounts(s=>s.map((y,j)=>j===i?e.target.value:y))}/><span>USD</span></label></div>)}</div>
  <div className="span2 summary"><span>Общий заработок за смену</span><strong>${total.toFixed(2)}</strong></div></>;
}
function DialogView({dialog,onClose,onDone,user,config,request,allPeople,allShifts}:{dialog:Dialog;onClose:()=>void;onDone:()=>void;user:Person;config:Row;request:SaveFn;allPeople:Person[];allShifts:Row[]}){
 const [modelId,setModelId]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 const kind=dialog?.kind||'',item=dialog?.row||{},isManager=manager(user.role),isOperator=['operator','trial'].includes(user.role);
 const titleMap:Record<string,string>={shift:'Новая смена',chat:'Чат смены',report:'Новый отчёт',reportReview:'Проверка отчёта',reportEdit:'Исправить отчёт',team:item.id?'Редактировать команду':'Новая команда',user:'Профиль сотрудника',kpi:'Назначить KPI',leave:'Заявка на отгул',leaveReview:'Проверка отгула',training:'Новое учебное задание',trainingSubmit:'Сдать задание',trainingReview:'Проверить задание',fine:'Назначить штраф',fineAppeal:'Оспорить штраф',fineReview:'Решение по штрафу',payout:'Заявка на выплату',payoutReview:'Рассмотреть выплату'};
 const [messages,setMessages]=useState<Row[]>([]);
 useEffect(()=>{if(kind==='chat'&&item.id){api<{items:Row[]}>(`shifts/${item.id}/messages`).then(r=>setMessages(r.items)).catch(()=>setMessages([]))}},[kind,item.id]);
 if(!dialog)return null;
 const submit=async(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();setError('');setBusy(true);const data=parseForm(e.currentTarget);
  try{
   let path='',method='POST',payload:Row={...data};
   if(kind==='shift'){path='shifts';payload.model_id=modelId;if(isOperator)delete payload.operator_id}
   else if(kind==='report'){path='reports';payload={...data,model_id:modelId,shift_id:data.shift_id||null,amounts:Array.from({length:5},(_,i)=>data['amount_'+(i+1)]||0)};if(isOperator)delete payload.operator_id}
   else if(kind==='reportEdit'){path=`reports/${item.id}`;method='PATCH';payload={notes:data.notes,amounts:Array.from({length:5},(_,i)=>data['amount_'+(i+1)]||0)}}
   else if(kind==='reportReview'){path=`reports/${item.id}/review`;payload={decision:data.decision,note:data.note}}
   else if(kind==='team'){path=item.id?`teams/${item.id}`:'teams';method=item.id?'PATCH':'POST';payload={name:data.name,lead_id:data.lead_id||null,coach_id:data.coach_id||null}}
   else if(kind==='user'){path=`users/${item.id}`;method='PATCH';payload={name:data.name,nickname:data.nickname||null,role:data.role,team_id:data.team_id||null,approved:data.approved==='1',active:data.active==='1',trial_start:data.trial_start||null,trial_end:data.trial_end||null}}
   else if(kind==='kpi'){path='kpis';payload={...data,target_shifts:Number(data.target_shifts),target_hours:Number(data.target_hours)}}
   else if(kind==='leave'){path='leaves'}
   else if(kind==='leaveReview'){path=`leaves/${item.id}/review`;payload={status:data.status,note:data.note}}
   else if(kind==='training'){path='training'}
   else if(kind==='trainingSubmit'){path=`training/${item.id}/submit`;payload={submission:data.submission}}
   else if(kind==='trainingReview'){path=`training/${item.id}/review`;payload={status:data.status,feedback:data.feedback}}
   else if(kind==='fine'){path='fines'}
   else if(kind==='fineAppeal'){path=`fines/${item.id}/appeal`;payload={message:data.message}}
   else if(kind==='fineReview'){path=`fines/${item.id}/review`;payload={status:data.status,note:data.note}}
   else if(kind==='payout'){path='payouts'}
   else if(kind==='payoutReview'){path=`payouts/${item.id}/review`;payload={status:data.status,note:data.note}}
   else if(kind==='chat'){path=`shifts/${item.id}/messages`;payload={message:data.message}}
   if(!path)throw new Error('Неподдерживаемая форма');
   await request(path,method,payload,kind!=='chat');
   if(kind==='chat'){const next=await api<{items:Row[]}>(`shifts/${item.id}/messages`);setMessages(next.items);e.currentTarget.reset()}
   else onDone();
  }catch(err:any){setError(err.message)}finally{setBusy(false)}
 };
 const labelRow=(key:string,def:string)=>String(item[key]||def);
 const selectOptions=(name:string,roles?:string[])=> <SelectField name={name} label={name==='operator_id'?'Оператор':name==='user_id'?'Сотрудник':'Стажёр'} options={personOpts(allPeople,roles,'Выберите сотрудника')} required/>;
 const simpleForm=(children:ReactNode)=><form onSubmit={submit}><div className="formgrid">{children}</div><div className="form-footer"><Button onClick={onClose}>Отмена</Button><Button type="submit" variant="primary" disabled={busy}>{busy?'Сохранение…':'Сохранить'}</Button></div></form>;
 const fieldDate=(name:string,label:string,value=startDay())=><Field name={name} label={label} type="date" defaultValue={value} required/>;
 const formBody=()=>{
 switch(kind){
 case 'shift': return simpleForm(<>{!isOperator&&selectOptions('operator_id',['operator','trial'])}<ModelPicker onChange={setModelId}/>{fieldDate('work_date','Дата смены')}<Field name="start_time" label="Начало" type="time" defaultValue="11:00" required/><Field name="end_time" label="Окончание" type="time" defaultValue="17:00" required/></>);
 case 'report': return simpleForm(<>{!isOperator&&selectOptions('operator_id',['operator','trial'])}<ModelPicker onChange={setModelId}/><SelectField name="shift_id" label="Связанная смена" options={[{value:'',label:'Без привязки'},...allShifts.map(s=>({value:s.id,label:`${dateRU(s.work_date)} ${s.start_time}–${s.end_time} · ${s.model_name}`}))]}/>{fieldDate('work_date','Дата')}<Field name="start_time" label="Начало" type="time" defaultValue="11:00" required/><Field name="end_time" label="Окончание" type="time" defaultValue="17:00" required/><ReportAmounts config={config}/><div className="span2"><Area name="notes" label="Комментарий"/></div></>);
 case 'reportEdit':return simpleForm(<><ReportAmounts config={config} initial={item.platforms}/><div className="span2"><Area name="notes" label="Комментарий" defaultValue={item.notes||''}/></div></>);
 case 'reportReview':return simpleForm(<><div className="span2 alert">Отчёт за {dateRU(item.work_date)} · сумма {usd(item.total_cents||0)}</div><SelectField name="decision" label="Решение" options={[{value:'approved',label:'Подтвердить и начислить'},{value:'changes_requested',label:'Вернуть на исправление'},{value:'rejected',label:'Отклонить'}]}/><div className="span2"><Area name="note" label="Комментарий (для отказа обязателен)"/></div></>);
 case 'team':return simpleForm(<><Field name="name" label="Название команды" defaultValue={item.name||''} required/><SelectField name="lead_id" label="Тимлид" options={personOpts(allPeople,['teamlead'])} defaultValue={item.lead_id||''}/><SelectField name="coach_id" label="Коуч" options={personOpts(allPeople,['coach'])} defaultValue={item.coach_id||''}/></>);
 case 'user':return simpleForm(<><Field name="name" label="Имя" defaultValue={item.name} required/><Field name="nickname" label="Никнейм" defaultValue={item.nickname||''}/><SelectField name="role" label="Роль" options={Object.entries(roleNames).filter(([key])=>user.role==='owner'||key!=='owner').map(([value,label])=>({value,label}))} defaultValue={item.role}/><SelectField name="team_id" label="Команда" options={[{value:'',label:'Нет команды'},...(item.availableTeams||[]).map((t:Row)=>({value:t.id,label:t.name}))]} defaultValue={item.team_id||''}/><SelectField name="approved" label="Доступ" options={[{value:'1',label:'Одобрен'},{value:'0',label:'Ожидает одобрения'}]} defaultValue={String(item.approved)}/><SelectField name="active" label="Аккаунт" options={[{value:'1',label:'Активен'},{value:'0',label:'Заблокирован'}]} defaultValue={String(item.active)}/><Field name="trial_start" label="Начало испытательного срока" type="date" defaultValue={item.trial_start||''}/><Field name="trial_end" label="Окончание испытательного срока" type="date" defaultValue={item.trial_end||''}/></>);
 case 'kpi':return simpleForm(<>{selectOptions('user_id',['operator','trial'])}<Field name="target_earnings" label="Цель заработка ($)" type="number" step="0.01" min="0" defaultValue={1000} required/><Field name="target_shifts" label="Цель смен" type="number" min="0" defaultValue={15} required/><Field name="target_hours" label="Цель часов" type="number" min="0" defaultValue={80} required/>{fieldDate('from_day','Начало периода')}{fieldDate('to_day','Конец периода',addDays(startDay(),30))}</>);
 case 'leave':return simpleForm(<>{fieldDate('from_day','С')}{fieldDate('to_day','По')}<div className="span2"><Area name="reason" label="Причина" required/></div></>);
 case 'leaveReview':return simpleForm(<><SelectField name="status" label="Решение" options={[{value:'approved',label:'Одобрить'},{value:'rejected',label:'Отклонить'}]}/><div className="span2"><Area name="note" label="Комментарий"/></div></>);
 case 'training':return simpleForm(<>{selectOptions('trainee_id',['trial'])}<Field name="title" label="Название задания" required/><div className="span2"><Area name="instructions" label="Описание" required/></div><Field name="material_url" label="Обучающий материал URL" type="url"/><Field name="due_day" label="Срок" type="date" defaultValue={addDays(startDay(),3)} required/></>);
 case 'trainingSubmit':return simpleForm(<div className="span2"><div className="alert">{item.title} · {item.instructions}</div><Area name="submission" label="Ответ" required/></div>);
 case 'trainingReview':return simpleForm(<><SelectField name="status" label="Решение" options={[{value:'passed',label:'Зачесть'},{value:'revision',label:'Вернуть на доработку'}]}/><div className="span2"><Area name="feedback" label="Обратная связь"/></div></>);
 case 'fine':return simpleForm(<>{selectOptions('user_id')}<Field name="amount" label="Сумма штрафа, $" type="number" min="0.01" step="0.01" required/><div className="span2"><Area name="reason" label="Причина" required/><div className="alert">Сотрудник получит уведомление. Автоматического списания денег нет.</div></div></>);
 case 'fineAppeal':return simpleForm(<div className="span2"><Area name="message" label="Почему вы оспариваете штраф?" required/></div>);
 case 'fineReview':return simpleForm(<><SelectField name="status" label="Решение" options={[{value:'active',label:'Оставить в силе'},{value:'cancelled',label:'Отменить'}]}/><Area name="note" label="Комментарий"/></>);
 case 'payout':return simpleForm(<><Field name="amount" label="Сумма, $" type="number" min="0.01" step="0.01" required/><div className="span2 alert">Заявка будет отправлена на проверку. Выплаты выполняются вручную.</div></>);
 case 'payoutReview':return simpleForm(<><SelectField name="status" label="Статус" options={item.status==='pending'?[{value:'approved',label:'Одобрить'},{value:'rejected',label:'Отклонить'}]:[{value:'paid',label:'Выплачено'},{value:'rejected',label:'Отклонить'}]}/><Area name="note" label="Комментарий"/></>);
 case 'chat':return <><div className="alert">Переписка по смене {dateRU(item.work_date)} · {item.start_time}–{item.end_time}</div><div className="chatmsgs">{messages.length?messages.map(m=><div key={m.id} className={'chatmsg '+(m.sender_id===user.id?'self':'')}><strong className="small">{m.sender_name}</strong><p>{m.message}</p><small>{timeRU(m.created_at)}</small></div>):<Empty text="Сообщений пока нет"/>}</div>{[item.operator_id,item.model_id].includes(user.id)?<form onSubmit={submit} className="chat-send"><input className="input" name="message" placeholder="Написать сообщение" maxLength={2000} required/><Button type="submit" variant="primary" disabled={busy}>Отправить</Button></form>:<div className="hint">Писать могут только участники смены</div>}</>;
 default:return <div className="alert">Форма недоступна</div>
 }};
 return <ModalShell title={titleMap[kind]||'Действие'} onClose={onClose}>{error&&<div className="alert" role="alert" style={{color:'var(--bad)',marginBottom:15}}>{error}</div>}{formBody()}</ModalShell>
}
interface ScreenProps{page:string;user:Person;config:Row;currency:Currency;data:Row;loading:boolean;error:string;open:(kind:string,row?:Row)=>void;perform:SaveFn;refresh:()=>void;
 weekStart:string;weekOffset:number;setWeekOffset:(n:number)=>void;analyticsFilters:Row;setAnalyticsFilters:(r:Row)=>void;analyticsPeople:Person[];setUser:(u:Person)=>void;setConfig:(c:Row)=>void;}
function Screen(p:ScreenProps){const {page,user,config,currency,data,loading,error,open,perform,refresh,weekStart,weekOffset,setWeekOffset,analyticsFilters,setAnalyticsFilters,analyticsPeople,setUser,setConfig}=p;
 const rows=Array.isArray(data.items)?data.items:[];const role=user.role,me=user.id,mg=manager(role),lead=role==='teamlead';
 const cash=(n:number)=>toCash(n,currency,config);
 const rowButton=(row:Row,action:string,title:string,variant='')=><Button variant={'small '+variant} onClick={()=>open(action,row)}>{title}</Button>;
 const managerAction=(name:string,kind:string)=>(mg||lead)&&<Button variant="primary" onClick={()=>open(kind)}>+ {name}</Button>;
 const formatNum=(n:number)=>Number(n||0).toLocaleString('ru-RU');
 const items=(name:string,description:string,action?:ReactNode)=> <Heading title={name} description={description} action={action}/>;
 const empty=!loading&&rows.length===0;
 if(error)return <>{items(pages[page], 'Ошибка загрузки данных')}<div className="alert" role="alert">{error} <Button onClick={refresh}>Повторить</Button></div></>;
 if(loading)return <div className="boot" style={{minHeight:260}}>Загрузка данных…</div>;
 if(page==='dashboard'){
  const b=data.balance||{},isModel=role==='model',modelShifts=data.model_shifts||[];
  return <>{items('Личный кабинет',isModel?'Ваши начисления и история смен':'Главная панель Finesse CRM')}
  <div className="metrics"><Metric label="Мой баланс" value={cash(b.available_cents)} subtitle="Доступно к заявке"/><Metric label="Всего начислено" value={cash(b.earned_cents)}/><Metric label="Заявки на выплату" value={cash(b.pending_cents)}/><Metric label={isModel?'Отработанных смен':'Уведомлений'} value={isModel?modelShifts.length:formatNum(data.notifications)}/></div>
  {isModel?<Card title="Заработок по сменам" subtitle="Без детализации по площадкам"><Table heads={['Дата','Время','Оператор','Начислено']} empty={!modelShifts.length}>{modelShifts.map((s:Row)=><tr key={s.id}><td>{dateRU(s.work_date)}</td><td>{s.start_time}–{s.end_time}</td><td>{s.operator_name}</td><td><strong>{cash(s.earned_cents)}</strong></td></tr>)}</Table></Card>:
  <><div className="cols3"><Card title="На проверке"><div className="card pad"><Metric label="Отчётов" value={data.pending_reports||0}/></div></Card><Card title="Выручка за подтверждённые отчёты"><div className="card pad"><Metric label="Итого" value={cash(data.approved_total_cents||0)}/></div></Card><Card title="Мои смены"><div className="card pad"><Metric label="Всего запланировано / завершено" value={data.my_shifts||0}/></div></Card></div><div className="gap"/><Card title="Порядок работы"><div className="card pad"><p className="hint">Оператор создаёт смену, выбирает модель, отправляет отчёт с пятью суммами. Тимлид или администратор проверяет отчёт; начисления формируются только после подтверждения.</p>{canCreateReport(role)&&<Button variant="primary" onClick={()=>open('report')}>+ Новый отчёт</Button>}</div></Card></>}
  </>
 }
 if(page==='shifts'){
  const wd=['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];const days=Array.from({length:7},(_,i)=>addDays(weekStart,i));
  return <>{items('Расписание смен','Смены, назначенные операторы и модели. Можно переписываться внутри смены.',canCreateShift(role)&&<Button variant="primary" onClick={()=>open('shift')}>+ Новая смена</Button>)}
  <div className="toolrow"><div><Button onClick={()=>setWeekOffset(weekOffset-1)}>‹ Неделя назад</Button><Button onClick={()=>setWeekOffset(0)}>Эта неделя</Button><Button onClick={()=>setWeekOffset(weekOffset+1)}>Следующая ›</Button></div><strong>{dateRU(days[0])} — {dateRU(days[6])}</strong></div>
  <div className="weekgrid">{days.map((d,i)=><div className="day" key={d}><div className="dayhead"><b>{wd[i]}</b><span>{d.slice(8)}</span></div><div className="daybody">{rows.filter(s=>s.work_date===d).length?rows.filter(s=>s.work_date===d).map(s=><div className="shiftcard" key={s.id}><b>{s.start_time}–{s.end_time}</b><p className="hint">Оператор: {s.operator_name}<br/>Модель: {s.model_name}</p><Status value={s.status}/><div className="actions" style={{marginTop:8}}>{rowButton(s,'chat','Написать')}{(s.operator_id===me||mg||lead)&&s.status==='planned'&&<Button variant="small" onClick={()=>perform(`shifts/${s.id}`,'PATCH',{status:'completed'})}>Завершить</Button>}</div></div>):<div className="empty" style={{padding:17}}>—</div>}</div></div>)}</div></>;
 }
 if(page==='reports'){
  return <>{items('Отчёты по сменам','Пять площадок, автоматический итог и обязательная проверка перед начислением.',canCreateReport(role)&&<Button variant="primary" onClick={()=>open('report')}>+ Новый отчёт</Button>)}
  <Card title="История отчётов" subtitle={`${rows.length} отчётов`}><Table heads={role==='model'?['Дата','Оператор / время','Начисление','Статус']:['Дата','Оператор','Модель','Общий заработок','Статус','Действия']} empty={empty}>{rows.map(r=><tr key={r.id}><td>{dateRU(r.work_date)}<div className="hint">{r.shift_id?'Связанная смена':'Без смены'}</div></td><td>{r.operator_name}<div className="hint">{r.start_time}–{r.end_time}</div></td>{role!=='model'&&<td>{r.model_name}</td>}<td><strong>{cash(role==='model'?r.earned_cents:r.total_cents)}</strong>{role!=='model'&&<div className="hint">{(r.platforms||[]).map((x:Row)=>x.amount_cents>0?`${x.platform_name}: ${cash(x.amount_cents)}`:null).filter(Boolean).join(' · ')}</div>}</td><td><Status value={r.status}/>{r.review_note&&<div className="hint">{r.review_note}</div>}</td>{role!=='model'&&<td>{r.status==='pending'&&(mg||lead)&&rowButton(r,'reportReview','Проверить','primary')}{['pending','changes_requested'].includes(r.status)&&(r.operator_id===me||mg)&&rowButton(r,'reportEdit','Изменить')}</td>}</tr>)}</Table></Card></>
 }
 if(page==='analytics'){
  const chart=Object.entries(data.daily||{}) as [string,number][],maximum=Math.max(1,...chart.map(x=>x[1]));
  const top=(record:Row)=>Object.entries(record||{}).sort((a,b)=>Number(b[1])-Number(a[1])).slice(0,8) as [string,number][];
  const diff=Number(data.total_cents||0)-Number(data.previous_total_cents||0);
  return <>{items('Аналитика агентства','Площадки, операторы, модели и сравнение периодов')}<div className="toolrow"><div><label className="field"><span>С</span><input type="date" className="input" value={analyticsFilters.from||''} onChange={e=>setAnalyticsFilters({...analyticsFilters,from:e.target.value})}/></label><label className="field"><span>По</span><input type="date" className="input" value={analyticsFilters.to||''} onChange={e=>setAnalyticsFilters({...analyticsFilters,to:e.target.value})}/></label></div></div>
  <div className="metrics"><Metric label="Выручка" value={cash(data.total_cents)} subtitle="По подтверждённым отчётам"/><Metric label="Отчётов" value={data.count||0}/><Metric label="Предыдущий период" value={cash(data.previous_total_cents||0)}/><Metric label="Изменение" value={(diff>=0?'+':'')+cash(diff)} subtitle="Относительно предыдущего периода"/></div>
  <div className="cols2"><Card title="Выручка по дням"><div className="card pad"><div className="chart">{chart.length?chart.map(([d,v])=><div className="chartcol" title={`${d}: ${usd(v)}`} key={d}><div className="chartbar" style={{height:Math.max(3,Math.round(v/maximum*155))+'px'}}/><span className="chartlabel">{d.slice(5)}</span></div>):<Empty text="Нет подтверждённых отчётов"/>}</div></div></Card><Card title="Выручка по площадкам"><div className="split-list">{top(data.platforms).length?top(data.platforms).map(([name,value])=><div className="listitem" key={name}><strong>{name}</strong><span>{cash(value)}</span></div>):<Empty/>}</div></Card></div>
  <div className="gap"/><div className="cols2"><Card title="Операторы"><div className="split-list">{top(data.operators).map(([name,value])=><div className="listitem" key={name}><strong>{name}</strong><span>{cash(value)}</span></div>)}{!top(data.operators).length&&<Empty/>}</div></Card><Card title="Модели"><div className="split-list">{top(data.models).map(([name,value])=><div className="listitem" key={name}><strong>{name}</strong><span>{cash(value)}</span></div>)}{!top(data.models).length&&<Empty/>}</div></Card></div></>
 }
 if(page==='users'){
  return <>{items('Сотрудники','Управление аккаунтами, ролями, никнеймами и командами')}
  <Card title="Команда" subtitle="Новые регистрации необходимо одобрять"><Table heads={['Сотрудник','Роль','Команда','Доступ','Действие']} empty={empty}>{rows.map(r=><tr key={r.id}><td><strong>{r.name}</strong><div className="hint">{r.email}{r.nickname?` · @${r.nickname}`:''}</div></td><td>{roleNames[r.role]||r.role}</td><td>{r.team_id?'Назначена':'—'}</td><td><Status value={!r.approved?'pending':!r.active?'cancelled':'approved'}/></td><td>{mg&&r.id!==me&&rowButton({...r,availableTeams:data.teams||[]},'user','Изменить','primary')}</td></tr>)}</Table></Card>
  {!mg&&<p className="note">Показаны сотрудники, доступные вашей роли. Полный список доступен руководству.</p>}</>
 }
 if(page==='teams'){
  return <>{items('Команды Finesse','Структура агентства с тимлидами, коучами, операторами и моделями.',mg&&<Button variant="primary" onClick={()=>open('team')}>+ Создать команду</Button>)}
  <div className="cols3">{rows.map(t=><Card key={t.id} title={t.name} right={mg&&rowButton(t,'team','Изменить')}><div className="card pad"><div className="kpi-tile"><span className="key">Выручка команды</span><div className="value">{cash(t.approved_total_cents)}</div></div><p className="hint">Участников: {(t.members||[]).length}</p>{(t.members||[]).map((x:Person)=><div className="listitem" key={x.id}><strong>{x.name}</strong><span className="muted small">{roleNames[x.role]}</span></div>)}</div></Card>)}{empty&&<div className="span2"><Empty text="Команд пока нет"/></div>}</div></>
 }
 if(page==='kpis'){
  return <>{items('Цели и KPI','Заработок, смены и отработанные часы.',managerAction('Назначить KPI','kpi'))}
  <div className="cols3">{rows.map(k=><Card title={k.user_name} key={k.id} subtitle={`${dateRU(k.from_day)} — ${dateRU(k.to_day)}`}><div className="card pad">
   <div className="kpi-progress"><div className="row between"><span>Заработок</span><strong>{usd(k.actual_cents)} / {usd(k.target_cents)}</strong></div><Progress value={k.actual_cents} target={k.target_cents}/></div>
   <div className="kpi-progress"><div className="row between"><span>Смены</span><strong>{k.actual_shifts} / {k.target_shifts}</strong></div><Progress value={k.actual_shifts} target={k.target_shifts}/></div>
   <div className="kpi-progress"><div className="row between"><span>Часы</span><strong>{Math.round(k.actual_minutes/60)} / {Math.round(k.target_minutes/60)}</strong></div><Progress value={k.actual_minutes} target={k.target_minutes}/></div>
  </div></Card>)}{empty&&<Empty text="Пока нет KPI"/>}</div></>
 }
 if(page==='leaves'){
  return <>{items('Отгулы','Заявки операторов и тимлидов, решение руководителя.',(['operator','trial','teamlead'].includes(role))&&<Button variant="primary" onClick={()=>open('leave')}>+ Запросить отгул</Button>)}
  <Card title="Заявки"><Table heads={['Сотрудник','Период','Причина','Статус','Действия']} empty={empty}>{rows.map(r=><tr key={r.id}><td>{r.user_name}</td><td>{dateRU(r.from_day)} — {dateRU(r.to_day)}</td><td>{r.reason}</td><td><Status value={r.status}/>{r.decision_note&&<div className="hint">{r.decision_note}</div>}</td><td>{r.status==='pending'&&(mg||lead&&r.user_id!==me)&&rowButton(r,'leaveReview','Рассмотреть','primary')}</td></tr>)}</Table></Card></>
 }
 if(page==='training'){
  return <>{items('Обучение и испытательный срок','Коуч назначает задания, стажёр сдаёт работу.',(mg||role==='coach')&&<Button variant="primary" onClick={()=>open('training')}>+ Новое задание</Button>)}
  <Card title="Задания"><Table heads={['Задание','Стажёр','Срок','Статус','Действие']} empty={empty}>{rows.map(r=><tr key={r.id}><td><strong>{r.title}</strong><div className="hint">{r.instructions}</div>{r.material_url&&<a href={r.material_url} target="_blank" rel="noreferrer">Материалы ↗</a>}</td><td>{r.trainee_name}<div className="hint">Коуч: {r.coach_name}</div></td><td>{dateRU(r.due_day)}</td><td><Status value={r.status}/>{r.feedback&&<div className="hint">{r.feedback}</div>}</td><td>{r.trainee_id===me&&['assigned','revision'].includes(r.status)&&rowButton(r,'trainingSubmit','Сдать задание','primary')}{r.status==='submitted'&&(mg||r.coach_id===me)&&rowButton(r,'trainingReview','Проверить','primary')}</td></tr>)}</Table></Card></>
 }
 if(page==='notifications'){
  const unread=rows.filter(x=>!x.read_at).length;
  return <>{items('Уведомления','Смены, штрафы, отчёты, выплаты и сообщения.',unread>0&&<Button onClick={()=>perform('notifications/read','POST',{ids:'all'})}>Прочитать все ({unread})</Button>)}
  <Card title="Центр уведомлений"><div className="split-list">{rows.map(n=><div className="listitem notification-item" key={n.id}><div><strong>{n.title}</strong><p>{n.message}</p><div className="hint">{timeRU(n.created_at)}</div></div>{n.read_at?<span className="hint">Прочитано</span>:<Button variant="small primary" onClick={()=>perform('notifications/read','POST',{ids:[n.id]})}>Прочитано ✓</Button>}</div>)}{empty&&<Empty text="Уведомлений нет"/>}</div></Card></>
 }
 if(page==='balances'){
  return <>{items('Балансы','Подтверждённые начисления, оплаченные и ожидающие выплаты.')}
  <Card title="Финансовые показатели"><Table heads={['Сотрудник','Начислено','В заявках','Выплачено','Доступно']} empty={empty}>{rows.map(b=><tr key={b.id}><td>{b.name}<div className="hint">{roleNames[b.role]}</div></td><td>{cash(b.earned_cents)}</td><td>{cash(b.pending_cents)}</td><td>{cash(b.paid_cents)}</td><td><strong>{cash(b.available_cents)}</strong></td></tr>)}</Table></Card></>
 }
 if(page==='payouts'){
  return <>{items('Выплаты','Ручное подтверждение и история заявок.',<Button variant="primary" onClick={()=>open('payout')}>+ Запросить выплату</Button>)}
  <Card title="Заявки на выплаты"><Table heads={['Дата','Сотрудник','Сумма','Статус','Действия']} empty={empty}>{rows.map(r=><tr key={r.id}><td>{timeRU(r.created_at)}</td><td>{r.user_name}<div className="hint">{r.method==='bank'?'Банковские реквизиты':'Кошелёк'}</div></td><td><strong>{cash(r.amount_cents)}</strong></td><td><Status value={r.status}/>{r.note&&<div className="hint">{r.note}</div>}</td><td>{mg&&['pending','approved'].includes(r.status)&&rowButton(r,'payoutReview','Изменить статус','primary')}</td></tr>)}</Table></Card></>
 }
 if(page==='fines'){
  return <>{items('Штрафы','Причина, сумма, уведомление и возможность оспорить.',mg&&<Button variant="primary" onClick={()=>open('fine')}>+ Назначить штраф</Button>)}
  <Card title="История штрафов"><Table heads={['Сотрудник','Дата','Сумма','Причина','Статус','Действия']} empty={empty}>{rows.map(f=><tr key={f.id}><td>{f.user_name}</td><td>{timeRU(f.created_at)}</td><td><strong>{cash(f.amount_cents)}</strong></td><td>{f.reason}{f.appeal_text&&<div className="hint">Оспорено: {f.appeal_text}</div>}</td><td><Status value={f.status}/></td><td>{f.user_id===me&&f.status==='active'&&rowButton(f,'fineAppeal','Оспорить')}{mg&&['active','appealed'].includes(f.status)&&rowButton(f,'fineReview','Рассмотреть','primary')}</td></tr>)}</Table></Card><p className="note">Штрафы не списываются с баланса автоматически.</p></>
 }
 if(page==='settings'){
  const saveProfile=async(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();const v=parseForm(e.currentTarget);
    const r=await perform('profile','PATCH',{...v,payout_type:v.payout_type||'',payout_ref:v.payout_ref||'',password_new:v.password_new||undefined,password_current:v.password_current||undefined},false);if(r?.user)setUser(r.user);(e.currentTarget.elements.namedItem('password_new') as HTMLInputElement).value='';(e.currentTarget.elements.namedItem('password_current') as HTMLInputElement).value=''};
  const saveConfig=async(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();const r=await perform('config','PATCH',parseForm(e.currentTarget),false);if(r?.config)setConfig(r.config)};
  return <>{items('Настройки','Профиль, реквизиты, тема оформления и параметры агентства')}
  <div className="cols2"><Card title="Мой профиль"><div className="card pad"><form onSubmit={saveProfile} className="formgrid"><Field name="name" label="Имя" defaultValue={user.name} required/><Field name="nickname" label="Никнейм" defaultValue={user.nickname||''}/><SelectField name="payout_type" label="Способ выплаты" options={[{value:'',label:'Не выбран'},{value:'bank',label:'Банковская карта (маскированные реквизиты)'},{value:'crypto',label:'Криптокошелёк'}]} defaultValue={user.payout_type||''}/><Field name="payout_ref" label="Реквизиты (без полного номера карты)" defaultValue={user.payout_ref||''}/><Field name="password_current" label="Текущий пароль" type="password"/><Field name="password_new" label="Новый пароль (от 12 символов)" type="password"/><div className="span2"><Button type="submit" variant="primary">Сохранить профиль</Button></div></form><div className="alert" style={{marginTop:16}}>Для банковских карт храните только название банка и последние 4 цифры. Реальные переводы эта CRM не выполняет.</div></div></Card>
  <Card title="Тема оформления"><div className="card pad"><p className="hint">Тема меняется в верхней панели сайта.</p><div className="brandline"><Logo size={76}/><div><b>Finesse</b><small>MODEL AGENCY</small></div></div></div></Card></div>
  {ownerOnly(role)&&<><div className="gap"/><Card title="Площадки и курс для отображения валют"><div className="card pad"><form onSubmit={saveConfig} className="formgrid">{[1,2,3,4,5].map(i=><Field key={i} name={'slot_'+i} label={'Площадка '+i} defaultValue={config['slot_'+i]} required/>)}<Field name="fx_rate" label="Тестовый курс ₽ за $1" type="number" step="0.01" min="0.01" defaultValue={config.fx_rate||90} required/><div className="span2"><Button type="submit" variant="primary">Сохранить настройки агентства</Button></div></form></div></Card></>}
  </>;
 }
 if(page==='audit'){
  return <>{items('Журнал действий','Последние административные события')}
  <Card title="События"><Table heads={['Дата','Действие','Тип','ID']} empty={empty}>{rows.map(r=><tr key={r.id}><td>{timeRU(r.created_at)}</td><td>{r.action}</td><td>{r.object_type}</td><td><code>{r.object_id}</code></td></tr>)}</Table></Card></>
 }
 return <Empty text="Раздел не найден"/>;
}
export default function App(){
 const [theme,setThemeState]=useState<Theme>(()=>{try{const v=localStorage.getItem('finesse-theme');return v==='light'||v==='dark'?v:'neon'}catch{return 'neon'}});
 const [currency,setCurrency]=useState<Currency>(()=>{try{return localStorage.getItem('finesse-currency')==='RUB'?'RUB':'USD'}catch{return 'USD'}});
 const [user,setUser]=useState<Person|null>(null);const [config,setConfig]=useState<Row>({});
 const [page,setPage]=useState('dashboard');const [boot,setBoot]=useState(true);
 const [data,setData]=useState<Row>({});const [loading,setLoading]=useState(false);const [error,setError]=useState('');
 const [dialog,setDialog]=useState<Dialog>(null);const [allPeople,setAllPeople]=useState<Person[]>([]);const [allShifts,setAllShifts]=useState<Row[]>([]);
 const [analyticsPeople,setAnalyticsPeople]=useState<Person[]>([]);const [unread,setUnread]=useState(0);
 const [menu,setMenu]=useState(false);const [toast,setToast]=useState('');const [reloader,setReloader]=useState(0);const [weekOffset,setWeekOffset]=useState(0);
 const [analyticsFilters,setAnalyticsFilters]=useState<Row>({from:addDays(startDay(),-29),to:startDay()});
 const weekStart=useMemo(()=>addDays(monday(startDay()),weekOffset*7),[weekOffset]);
 const setTheme=(t:Theme)=>{setThemeState(t);try{localStorage.setItem('finesse-theme',t)}catch{}};
 useEffect(()=>{document.body.dataset.theme=theme},[theme]);
 useEffect(()=>{try{localStorage.setItem('finesse-currency',currency)}catch{}},[currency]);
 useEffect(()=>{let active=true;api('session').then(r=>{if(!active)return;setCsrf(r.csrf);setUser(r.user);setConfig(r.config)}).catch(()=>{}).finally(()=>{if(active)setBoot(false)});return()=>{active=false}},[]);
 const load=useCallback(async()=>{
  if(!user)return;
  setLoading(true);setError('');let request='dashboard';
  if(page==='shifts')request=`shifts?from=${weekStart}&to=${addDays(weekStart,6)}`;
  else if(page==='analytics')request=`analytics?from=${analyticsFilters.from}&to=${analyticsFilters.to}&operator=${encodeURIComponent(analyticsFilters.operator||'')}&model=${encodeURIComponent(analyticsFilters.model||'')}`;
  else if(page!=='settings')request=page;
  try{
    if(page==='analytics'&&manager(user.role))api<{items:Person[]}>('users').then(x=>setAnalyticsPeople(x.items)).catch(()=>{});
    if(page==='users'&&manager(user.role)){ 
      const [all,pending,teams]=await Promise.all([api('users'),api('users/pending'),api('teams')]);
      setData({items:[...pending.items,...all.items.filter((x:Person)=>!pending.items.some((y:Person)=>y.id===x.id))],teams:teams.items});
    }else if(page==='settings'){setData({})}
    else setData(await api(request));
  }catch(e:any){setError(e.message);if(e.message==='Необходим вход')setUser(null)}finally{setLoading(false)}
 },[user?.id,page,weekStart,analyticsFilters.from,analyticsFilters.to,analyticsFilters.operator,analyticsFilters.model,reloader]);
 useEffect(()=>{if(user)void load()},[load]);
 useEffect(()=>{if(!user)return;let cancelled=false;const poll=()=>api<{items:Row[]}>('notifications').then(x=>{if(!cancelled){setUnread(x.items.filter(n=>!n.read_at).length);if(page==='notifications')setData(x)}}).catch(()=>{});poll();const timer=setInterval(poll,30000);return()=>{cancelled=true;clearInterval(timer)}},[user?.id,reloader,page]);
 const refresh=()=>setReloader(x=>x+1);
 const showToast=(s:string)=>{setToast(s);setTimeout(()=>setToast(''),4500)};
 const perform:SaveFn=async(url,method,payload,close=true)=>{try{const r=await api(url,method,payload);showToast('Сохранено успешно');refresh();if(close)setDialog(null);return r}
  catch(e:any){showToast('Ошибка: '+e.message);throw e}}
 const open=async(kind:string,row:Row={})=>{
  if(['shift','report','team','user','kpi','training','fine'].includes(kind)){
    try{const people=await api<{items:Person[]}>('users?q=').catch(()=>({items:[]}));setAllPeople(people.items.filter(x=>x.approved&&x.active));
      if(kind==='report'){const sh=await api<{items:Row[]}>(`shifts?from=${addDays(startDay(),-180)}&to=${addDays(startDay(),180)}`);setAllShifts(sh.items)}
      if(kind==='user'){const ts=await api<{items:Row[]}>('teams');row={...row,availableTeams:ts.items}}
    }catch(e:any){showToast('Ошибка загрузки: '+e.message)}
  }
  setDialog({kind,row});
 };
 const logout=async()=>{try{await api('logout','POST')}catch{}setCsrf('');setUser(null);setData({});setDialog(null);setPage('dashboard')};
 if(boot)return <div className="boot">Finesse CRM · соединение с сервером…</div>;
 if(!user)return <Auth theme={theme} setTheme={setTheme} onLogin={(u,csrf,c)=>{setCsrf(csrf);setUser(u);setConfig(c);refresh()}}/>;
 return <><div id="overlay" className={menu?'open':''} onClick={()=>setMenu(false)}/><div className="layout">
  <aside className={'sidebar '+(menu?'open':'')}><div className="sidebar-brand"><Brand/></div>
  {navGroups.map(group=><div key={group[0]}><div className="navheading">{group[0]}</div><nav className="navlinks">{group.slice(1).filter(key=>hasPage(key,user.role)).map(key=><button key={key} className={'navitem '+(page===key?'active':'')} onClick={()=>{setPage(key);setMenu(false)}}><span className="nav-symbol" aria-hidden="true">{iconMap[key]}</span><span>{pages[key]}</span></button>)}</nav></div>)}
  <div className="sidebar-bottom"><button className="navitem" onClick={logout}><span className="nav-symbol">↪</span>Выйти</button><div className="mini-profile"><span className="avatar">{user.name.split(' ').map(x=>x[0]).slice(0,2).join('').toUpperCase()}</span><div><b>{user.name}</b><small>{roleNames[user.role]}</small></div></div></div>
  </aside><div className="workspace"><header className="topbar"><div className="row"><button className="btn icononly mobile-menu" onClick={()=>setMenu(true)} aria-label="Открыть меню">☰</button><span className="topcrumb">{pages[page]}</span><span className="badge pink" style={{marginLeft:12}}>Finesse CRM · React</span></div><div className="topright"><select className="select top-select" aria-label="Тема" value={theme} onChange={e=>setTheme(e.target.value as Theme)}><option value="neon">🌸 Розовая</option><option value="dark">Тёмная</option><option value="light">Светлая</option></select><select className="select top-select" aria-label="Валюта" value={currency} onChange={e=>setCurrency(e.target.value as Currency)}><option value="USD">USD $</option><option value="RUB">RUB ₽</option></select><button className="btn icononly notification-top" aria-label="Уведомления" title="Уведомления" onClick={()=>setPage('notifications')}>♢{unread>0&&<sup className="unread-count">{unread>9?'9+':unread}</sup>}</button><div className="top-user"><span className="avatar">{user.name.charAt(0)}</span><div><b>{user.name}</b><small>{roleNames[user.role]}</small></div></div></div></header>
  <main className="main"><Screen {...{page,user,config,currency,data,loading,error,open,perform,refresh,weekStart,weekOffset,setWeekOffset,analyticsFilters,setAnalyticsFilters,analyticsPeople,setUser,setConfig}}/><div className="note">Finesse CRM · Все данные хранятся на сервере · Выплаты выполняются вручную · Видеозвонки, аудиозвонки и записи отсутствуют.</div></main></div></div>
  {dialog&&<DialogView key={dialog.kind+'-'+(dialog.row?.id||'new')} dialog={dialog} user={user} config={config} onClose={()=>setDialog(null)} onDone={refresh} request={perform} allPeople={allPeople} allShifts={allShifts}/>}
  {toast&&<div className="show" id="toast" role="status">{toast}</div>}
  </>;
}
