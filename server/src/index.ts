/** Finesse CRM 4 — Node.js + TypeScript API. Uses Node's built-in SQLite driver (Node 22.16+).
 * Existing Finesse Python SQLite files can be reused; no Python process is required.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, createHash, scryptSync, timingSafeEqual } from 'node:crypto';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const FILE=process.env.FINESSE_DB || join(ROOT,'data/finesse.sqlite3');
const PORT=Number(process.env.FINESSE_PORT||8080);
const HOST=process.env.FINESSE_HOST||'127.0.0.1';
const PROD=process.env.FINESSE_ENV==='production';
const DAY_MS=86400000;
const ROLES=['owner','admin','teamlead','coach','operator','trial','model'];
const OPS=['operator','trial'];
const ADM=['owner','admin'];
// Shares are strictly server side; never return to client.
const SHARES:Record<string,number>={operator:20,model:40,teamlead:5,coach:1};
const defaultSites=['Площадка 1','Площадка 2','Площадка 3','Площадка 4','Площадка 5'];
const uid=()=>randomBytes(12).toString('hex');
const now=()=>new Date().toISOString().replace(/\.\d{3}Z$/,'Z');
const today=()=>new Date().toISOString().slice(0,10);
const days=(n:number)=>new Date(Date.now()+n*DAY_MS).toISOString().slice(0,10);
const val=(x:unknown,m=500,required=false)=>{const s=String(x??'').trim();if(s.length>m||(required&&!s))fail(400,'Некорректная длина текста');return s};
const mail=(x:unknown)=>{const s=val(x,190,true).toLowerCase();if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s))fail(400,'Укажите корректный email');return s};
const day=(x:unknown)=>{const s=val(x,10,true);const d=new Date(s+'T12:00:00Z');if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==s)fail(400,'Неверный формат даты');return s};
const tm=(x:unknown)=>{const s=val(x,5,true);if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(s))fail(400,'Неверное время');return s};
const money=(x:unknown)=>{const s=String(x??'').trim().replace(',','.');if(!/^\d+(\.\d{1,2})?$/.test(s))fail(400,'Некорректная сумма');const [w,f='']=s.split('.');const c=Number(w)*100+Number(f.padEnd(2,'0'));if(!Number.isSafeInteger(c)||c<0||c>1e10)fail(400,'Сумма вне диапазона');return c};
const display=(c:number)=>`$${(c/100).toFixed(2)}`;
class ApiError extends Error{status:number;constructor(status:number,msg:string){super(msg);this.status=status}}
function fail(status:number,msg:string):never{throw new ApiError(status,msg)}
function check(x:unknown,msg='Недостаточно прав',status=403):asserts x {if(!x)fail(status,msg)}
function passwordHash(p:string){if(typeof p!=='string'||p.length<12||p.length>200)fail(400,'Пароль должен содержать от 12 до 200 символов');const salt=randomBytes(16);const digest=scryptSync(p,salt,64,{N:16384,r:8,p:1,maxmem:64*1024*1024});return `scrypt$16384$8$1$${salt.toString('hex')}$${digest.toString('hex')}`}
function passwordOK(p:string,saved:string){try{const [kind,n,r,parallel,salt,hash]=saved.split('$');if(kind!=='scrypt')return false;const original=Buffer.from(hash,'hex');const test=scryptSync(p,Buffer.from(salt,'hex'),original.length,{N:+n,r:+r,p:+parallel,maxmem:64*1024*1024});return timingSafeEqual(test,original)}catch{return false}}

mkdirSync(dirname(FILE),{recursive:true});
const db=new DatabaseSync(FILE,{enableForeignKeyConstraints:true});
db.exec('PRAGMA busy_timeout=15000; PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;');
db.exec(readFileSync(join(ROOT,'server/src/schema.sql'),'utf8'));
for(let i=1;i<=5;i++)db.prepare('INSERT OR IGNORE INTO config(key,value) VALUES (?,?)').run('slot_'+i,defaultSites[i-1]);
db.prepare('INSERT OR IGNORE INTO config(key,value) VALUES (?,?)').run('fx_rate','90');
db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now());
const q=(sql:string,...params:any[])=>db.prepare(sql).get(...params) as any|undefined;
const all=(sql:string,...params:any[])=>db.prepare(sql).all(...params) as any[];
const run=(sql:string,...params:any[])=>db.prepare(sql).run(...params);
const insert=(table:string,fields:Record<string,unknown>)=>{const keys=Object.keys(fields);run(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')})`,...keys.map(k=>fields[k]));};
function transaction<T>(fn:()=>T):T {db.exec('BEGIN IMMEDIATE');try{const v=fn();db.exec('COMMIT');return v}catch(err){db.exec('ROLLBACK');throw err}}
function info(u:any,viewer?:any){const keys=['id','name','email','nickname','role','team_id','approved','active','trial_start','trial_end','created_at'];if(!viewer||viewer.id===u.id)keys.push('payout_type','payout_ref');return Object.fromEntries(keys.map(k=>[k,u[k]]))}
const manager=(u:any)=>ADM.includes(u.role);
const conf=()=>Object.fromEntries(all('SELECT key,value FROM config').map(x=>[x.key,x.value]));
const publicConf=(u:any)=>u.role==='model'?Object.fromEntries(Object.entries(conf()).filter(([k])=>!k.startsWith('slot_'))):conf();
const activeUsers=(roles:string[]=[])=>all('SELECT * FROM users WHERE active=1 AND approved=1').filter(u=>!roles.length||roles.includes(u.role));
function teamScope(u:any,targetId:string){if(manager(u)||u.id===targetId)return true;const t=q('SELECT team_id FROM users WHERE id=?',targetId);return !!(t?.team_id&&u.team_id===t.team_id&&['teamlead','coach'].includes(u.role))}
function canManageTeam(u:any,targetId:string){if(manager(u))return true;if(u.role!=='teamlead'||!u.team_id||u.id===targetId)return false;return q('SELECT team_id FROM users WHERE id=?',targetId)?.team_id===u.team_id}
function visiblePerson(u:any,t:any){if(manager(u)||u.id===t.id)return true;if(['teamlead','coach'].includes(u.role)&&u.team_id&&u.team_id===t.team_id)return true;if(OPS.includes(u.role)&&t.role==='model')return true;if(u.role==='model')return !!q('SELECT id FROM shifts WHERE (operator_id=? AND model_id=?) OR (model_id=? AND operator_id=?) LIMIT 1',t.id,u.id,u.id,t.id);return false}
const visibleShift=(u:any,s:any)=>manager(u)||[s.operator_id,s.model_id].includes(u.id)||(['teamlead','coach'].includes(u.role)&&teamScope(u,s.operator_id));
const visibleReport=(u:any,r:any)=>manager(u)||[r.operator_id,r.model_id].includes(u.id)||teamScope(u,r.operator_id);
function notice(userId:string,kind:string,title:string,message:string){insert('notifications',{id:uid(),user_id:userId,kind,title,message,created_at:now()})}
function notifyAdmins(kind:string,title:string,message:string){for(const u of activeUsers(ADM))notice(u.id,kind,title,message)}
function audit(u:any,action:string,object_type:string,object_id:string){insert('audit_log',{id:uid(),actor_id:u.id,action,object_type,object_id,created_at:now()})}
function balances(ids:string[]|null=null){const users=all('SELECT id,name,nickname,email,role,team_id FROM users WHERE approved=1 AND active=1').filter(u=>ids===null||ids.includes(u.id));return users.map(u=>{const earned=q('SELECT COALESCE(SUM(amount_cents),0) AS n FROM earnings WHERE user_id=?',u.id).n;const paid=q("SELECT COALESCE(SUM(amount_cents),0) AS n FROM payouts WHERE user_id=? AND status='paid'",u.id).n;const pending=q("SELECT COALESCE(SUM(amount_cents),0) AS n FROM payouts WHERE user_id=? AND status IN ('pending','approved')",u.id).n;return {...u,earned_cents:earned,paid_cents:paid,pending_cents:pending,available_cents:Math.max(0,earned-paid-pending)}})}
function viewReport(u:any,r:any){if(u.role==='model'){const e=q('SELECT amount_cents FROM earnings WHERE report_id=? AND user_id=?',r.id,u.id);const {total_cents,...rest}=r;return {...rest,earned_cents:e?.amount_cents||0}}
  return {...r,platforms:all('SELECT slot,platform_name,amount_cents FROM report_platforms WHERE report_id=? ORDER BY slot',r.id)};}
const sessionsSecret=(req:IncomingMessage)=>{const cookie=req.headers.cookie||'';const match=cookie.match(/(?:^|;\s*)finesse_session=([A-Za-z0-9_-]{24,100})/);if(!match)return null;const hash=createHash('sha256').update(match[1]).digest('hex');const s=q('SELECT * FROM sessions WHERE token_hash=? AND expires_at>?',hash,now());if(!s)return null;const u=q('SELECT * FROM users WHERE id=?',s.user_id);return u&&u.approved&&u.active?{u,s}:null};
function createSession(u:any){const token=randomBytes(36).toString('base64url');const csrf=randomBytes(30).toString('base64url');insert('sessions',{token_hash:createHash('sha256').update(token).digest('hex'),user_id:u.id,csrf,expires_at:new Date(Date.now()+14*DAY_MS).toISOString().replace(/\.\d{3}Z$/,'Z')});return {csrf,cookie:`finesse_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${14*86400}${PROD?'; Secure':''}`}}
const failed=new Map<string,number[]>();
function rate(ip:string,key:string){const k=ip+':'+key;const t=Date.now();const xs=(failed.get(k)||[]).filter(x=>x>t-900000);check(xs.length<8,'Слишком много попыток. Повторите позже.',429);xs.push(t);failed.set(k,xs)}
function cleanRate(ip:string,key:string){failed.delete(ip+':'+key)}
function statusInput(x:any,valid:string[]){const v=val(x,40,true);check(valid.includes(v),'Недопустимый статус',400);return v}
function model(id:string){const t=q('SELECT * FROM users WHERE id=?',id);check(t&&t.role==='model'&&t.active&&t.approved,'Модель не найдена',400);return t}
function operator(id:string){const t=q('SELECT * FROM users WHERE id=?',id);check(t&&OPS.includes(t.role)&&t.active&&t.approved,'Оператор не найден',400);return t}
function checkTeam(op:any,mo:any){if(op.team_id&&mo.team_id)check(op.team_id===mo.team_id,'Модель не относится к команде оператора',400)}
function checkedAmountList(amounts:any){check(Array.isArray(amounts)&&amounts.length===5,'Нужно пять сумм по площадкам',400);const cs=amounts.map((x:any)=>money(x||0));check(cs.reduce((a:number,b:number)=>a+b,0)>0,'Общий заработок должен быть больше нуля',400);return cs}
const countTime=(start:string,end:string)=>(+end.slice(0,2)*60+ +end.slice(3,5))-(+start.slice(0,2)*60+ +start.slice(3,5));

interface Ctx{method:string;route:string;seg:string[];data:any;search:URLSearchParams;u:any;s:any;ip:string}
function handle(c:Ctx):{payload:any;status?:number;cookie?:string}{
 const {method,route,seg,data,search,u,s,ip}=c;
 const result=(payload:any,status=200,cookie?:string)=>({payload,status,cookie});
 if(route==='health'&&method==='GET')return result({ok:true});
 if(route==='register'&&method==='POST'){
  rate(ip,'registration');const email=mail(data.email),name=val(data.name,120,true),nickname=val(data.nickname,50)||null,hash=passwordHash(data.password);
  check(!q('SELECT id FROM users WHERE email=?',email),'Email уже зарегистрирован',409);if(nickname)check(!q('SELECT id FROM users WHERE nickname=?',nickname),'Никнейм уже занят',409);
  const id=uid();transaction(()=>{insert('users',{id,email,nickname,name,role:'trial',password_hash:hash,approved:0,active:1,created_at:now(),trial_start:today(),trial_end:days(14)});notifyAdmins('user','Новая регистрация',`${name} (${email}) ожидает подтверждения аккаунта`)});
  return result({message:'Заявка на регистрацию отправлена. Администратор должен одобрить аккаунт.'},201);
 }
 if(route==='login'&&method==='POST'){
  const email=mail(data.email);rate(ip,email);const a=q('SELECT * FROM users WHERE email=?',email);
  if(!a||!passwordOK(data.password||'',a.password_hash))fail(401,'Неверный email или пароль');check(a.active,'Аккаунт отключён');check(a.approved,'Ожидайте подтверждения аккаунта администратором');cleanRate(ip,email);
  const {csrf,cookie}=createSession(a);return result({user:info(a),csrf},200,cookie);
 }
 check(u,'Необходим вход',401);
 if(route==='logout'&&method==='POST'){run('DELETE FROM sessions WHERE token_hash=?',s.token_hash);return result({ok:true},200,`finesse_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${PROD?'; Secure':''}`)}
 if(route==='session'&&method==='GET')return result({user:info(u),csrf:s.csrf,config:publicConf(u)});
 if(route==='profile'&&method==='PATCH'){
  const name=val(data.name??u.name,120,true),nickname=val(data.nickname??u.nickname,50)||null;
  if(nickname)check(!q('SELECT id FROM users WHERE nickname=? AND id<>?',nickname,u.id),'Никнейм уже занят',409);
  const updates:Record<string,any>={name,nickname};
  if('payout_type'in data){const typ=statusInput(data.payout_type,['','bank','crypto']),ref=val(data.payout_ref,120);
    if(typ==='bank'&&/\d{12,}/.test(ref.replace(/\s+/g,'')))fail(400,'Не сохраняйте полный номер банковской карты. Укажите банк и последние 4 цифры.');updates.payout_type=typ;updates.payout_ref=ref}
  if(data.password_new){check(passwordOK(data.password_current||'',u.password_hash),'Текущий пароль неверен',400);updates.password_hash=passwordHash(data.password_new)}
  const columns=Object.keys(updates);transaction(()=>{run(`UPDATE users SET ${columns.map(k=>`${k}=?`).join(',')} WHERE id=?`,...columns.map(k=>updates[k]),u.id);
  if(data.password_new)run('DELETE FROM sessions WHERE user_id=? AND token_hash<>?',u.id,s.token_hash)});
  return result({user:info(q('SELECT * FROM users WHERE id=?',u.id))});
 }
 if(route==='users'&&method==='GET'){
  const term=val(search.get('q'),90).toLowerCase(),filter=search.get('role')||'';
  let users=all('SELECT * FROM users ORDER BY created_at DESC').filter(x=>visiblePerson(u,x));
  if(term)users=users.filter(x=>`${x.email} ${x.nickname||''} ${x.name}`.toLowerCase().includes(term));
  if(OPS.includes(u.role)&&term.length<2)users=users.filter(x=>x.id===u.id);
  if(filter)users=users.filter(x=>x.role===filter);
  return result({items:users.map(x=>info(x,u))});
 }
 if(route==='users/pending'&&method==='GET'){check(manager(u));return result({items:all('SELECT * FROM users WHERE approved=0 ORDER BY created_at DESC').map(x=>info(x,u))})}
 if(seg.length===2&&seg[0]==='users'&&method==='PATCH'){
  check(manager(u));const target=q('SELECT * FROM users WHERE id=?',seg[1]);check(target,'Пользователь не найден',404);
  check(target.id!==u.id||!['role','approved','active'].some(k=>k in data),'Нельзя менять свою роль или доступ',400);
  if(u.role!=='owner')check(target.role!=='owner'&&data.role!=='owner','Только владелец может управлять владельцами');
  const updates:Record<string,any>={};for(const key of ['name','nickname','role','team_id','approved','active','trial_start','trial_end']){
    if(!(key in data))continue;let v=data[key];if(key==='name')v=val(v,120,true);if(key==='nickname')v=val(v,50)||null;if(key==='role')v=statusInput(v,ROLES);
    if(key==='team_id'){v=v||null;if(v)check(q('SELECT id FROM teams WHERE id=?',v),'Команда не найдена',400)}
    if(['approved','active'].includes(key))v=v?1:0;if(['trial_start','trial_end'].includes(key))v=v?day(v):null;updates[key]=v;
  }
  check(Object.keys(updates).length,'Нет изменений',400);
  transaction(()=>{const cols=Object.keys(updates);run(`UPDATE users SET ${cols.map(k=>k+'=?').join(',')} WHERE id=?`,...cols.map(k=>updates[k]),target.id);
    if(data.approved)notice(target.id,'account','Доступ открыт','Ваш аккаунт подтверждён. Добро пожаловать в Finesse!');
    if('active'in data&&!data.active)run('DELETE FROM sessions WHERE user_id=?',target.id);audit(u,'update','user',target.id)});
  return result({item:info(q('SELECT * FROM users WHERE id=?',target.id),u)});
 }
 if(route==='config'&&method==='GET')return result({config:publicConf(u)});
 if(route==='config'&&method==='PATCH'){
  check(u.role==='owner');transaction(()=>{for(let i=1;i<=5;i++){const k='slot_'+i;if(k in data)run('UPDATE config SET value=? WHERE key=?',val(data[k],55,true),k)}
  if('fx_rate'in data){const x=Number(data.fx_rate);check(Number.isFinite(x)&&x>0&&x<10000,'Некорректный курс',400);run('UPDATE config SET value=? WHERE key=?',String(x),'fx_rate')}audit(u,'update','config','global')});return result({config:conf()});
 }
 if(route==='teams'&&method==='GET'){
  let items=all('SELECT * FROM teams ORDER BY name');if(!manager(u))items=items.filter(x=>x.id===u.team_id);
  for(const t of items){t.approved_total_cents=q("SELECT COALESCE(SUM(r.total_cents),0) AS n FROM reports r JOIN users op ON op.id=r.operator_id WHERE op.team_id=? AND r.status='approved'",t.id).n;
    const members=all('SELECT * FROM users WHERE team_id=? AND active=1 AND approved=1 ORDER BY role,name',t.id);t.members=members.map(x=>u.role==='model'?{id:x.id,name:x.name,role:x.role,nickname:x.nickname}:info(x,u))}
  return result({items});
 }
 if(route==='teams'&&['POST','PATCH'].includes(method)){
  check(manager(u));const id=method==='POST'?uid():seg[1];const previous=method==='PATCH'?q('SELECT * FROM teams WHERE id=?',id):null;
  if(method==='PATCH')check(previous,'Команда не найдена',404);
  const name=val(data.name??previous?.name,90,true);const lead=data.lead_id??previous?.lead_id??null,coach=data.coach_id??previous?.coach_id??null;
  if(lead)check(q("SELECT id FROM users WHERE id=? AND role='teamlead' AND approved=1",lead),'Тимлид не найден',400);
  if(coach)check(q("SELECT id FROM users WHERE id=? AND role='coach' AND approved=1",coach),'Коуч не найден',400);
  transaction(()=>{if(method==='POST')insert('teams',{id,name,lead_id:lead,coach_id:coach,created_at:now()});else run('UPDATE teams SET name=?,lead_id=?,coach_id=? WHERE id=?',name,lead,coach,id);
    for(const person of [lead,coach])if(person)run('UPDATE users SET team_id=? WHERE id=?',id,person);audit(u,method==='POST'?'create':'update','team',id)});
  return result({id},method==='POST'?201:200);
 }
 if(route==='shifts'&&method==='GET'){
  const from=day(search.get('from')||today()),to=day(search.get('to')||days(31));check(from<=to,'Неверный период',400);
  const items=all(`SELECT sh.*,op.name AS operator_name,op.nickname AS operator_nick,mo.name AS model_name,mo.nickname AS model_nick
    FROM shifts sh JOIN users op ON op.id=sh.operator_id JOIN users mo ON mo.id=sh.model_id
    WHERE sh.work_date BETWEEN ? AND ? ORDER BY sh.work_date,sh.start_time`,from,to);
  return result({items:items.filter(x=>visibleShift(u,x))});
 }
 if(route==='shifts'&&method==='POST'){
  check([...OPS,'teamlead','admin','owner'].includes(u.role),'Создавать смены могут операторы и руководители');
  const op=operator(OPS.includes(u.role)?u.id:data.operator_id);
  if(u.role==='teamlead')check(canManageTeam(u,op.id),'Не ваша команда');const mo=model(data.model_id);checkTeam(op,mo);
  const work_date=day(data.work_date),start_time=tm(data.start_time),end_time=tm(data.end_time);check(start_time<end_time,'Окончание должно быть позже начала',400);
  const conflict=q(`SELECT id FROM shifts WHERE work_date=? AND status!='cancelled' AND (operator_id IN (?,?) OR model_id IN (?,?))
    AND start_time<? AND end_time>? LIMIT 1`,work_date,op.id,mo.id,op.id,mo.id,end_time,start_time);
  check(!conflict,'В это время у участника уже есть смена',409);
  check(!q("SELECT id FROM leaves WHERE user_id=? AND status='approved' AND from_day<=? AND to_day>=? LIMIT 1",op.id,work_date,work_date),'У оператора одобрен отгул на эту дату',409);
  const id=uid();transaction(()=>{insert('shifts',{id,operator_id:op.id,model_id:mo.id,work_date,start_time,end_time,status:'planned',created_at:now()});
    for(const person of [op,mo])notice(person.id,'shift','Новая смена',`${work_date} ${start_time}–${end_time}, ${op.name} / ${mo.name}`);audit(u,'create','shift',id)});
  return result({id},201);
 }
 if(seg.length===2&&seg[0]==='shifts'&&method==='PATCH'){
  const sh=q('SELECT * FROM shifts WHERE id=?',seg[1]);check(sh,'Смена не найдена',404);check(sh.operator_id===u.id||manager(u)||canManageTeam(u,sh.operator_id));
  transaction(()=>{
    if('status'in data){const status=statusInput(data.status,['planned','completed','cancelled']);run('UPDATE shifts SET status=? WHERE id=?',status,sh.id)}
    else{const work_date=day(data.work_date||sh.work_date),start_time=tm(data.start_time||sh.start_time),end_time=tm(data.end_time||sh.end_time);
      check(start_time<end_time,'Неверное время',400);const conflict=q(`SELECT id FROM shifts WHERE id<>? AND work_date=? AND status!='cancelled'
      AND (operator_id IN (?,?) OR model_id IN (?,?)) AND start_time<? AND end_time>? LIMIT 1`,sh.id,work_date,sh.operator_id,sh.model_id,sh.operator_id,sh.model_id,end_time,start_time);
      check(!conflict,'В это время уже есть смена',409);
      run('UPDATE shifts SET work_date=?,start_time=?,end_time=? WHERE id=?',work_date,start_time,end_time,sh.id)}
    for(const person of new Set([sh.operator_id,sh.model_id]))notice(person,'shift','Смена изменена',`Изменения по смене ${sh.work_date}`);
    audit(u,'update','shift',sh.id)
  });return result({ok:true});
 }
 if(seg.length===3&&seg[0]==='shifts'&&seg[2]==='messages'&&['GET','POST'].includes(method)){
  const sh=q('SELECT * FROM shifts WHERE id=?',seg[1]);check(sh&&visibleShift(u,sh),'Смена недоступна',404);
  if(method==='GET')return result({items:all('SELECT m.*,u.name AS sender_name FROM messages m JOIN users u ON u.id=m.sender_id WHERE shift_id=? ORDER BY created_at ASC LIMIT 300',sh.id)});
  // Only participants can write; management can read a team shift but not impersonate them.
  check([sh.operator_id,sh.model_id].includes(u.id),'Писать могут только участники смены');
  const message=val(data.message,2000,true),id=uid();transaction(()=>{insert('messages',{id,shift_id:sh.id,sender_id:u.id,message,created_at:now()});
    for(const person of [sh.operator_id,sh.model_id])if(person!==u.id)notice(person,'message','Сообщение по смене',`${u.name}: ${message.slice(0,150)}`)});
  return result({id},201);
 }
 if(route==='reports'&&method==='GET'){
  const rows=all(`SELECT r.*,op.name AS operator_name,mo.name AS model_name FROM reports r JOIN users op ON op.id=r.operator_id
    JOIN users mo ON mo.id=r.model_id ORDER BY r.created_at DESC LIMIT 400`);
  return result({items:rows.filter(x=>visibleReport(u,x)).map(x=>viewReport(u,x))});
 }
 if(route==='reports'&&method==='POST'){
  check([...OPS,'teamlead','admin','owner'].includes(u.role),'Вы не можете создавать отчёт');
  const op=operator(OPS.includes(u.role)?u.id:data.operator_id);if(u.role==='teamlead')check(canManageTeam(u,op.id),'Не ваша команда');
  const mo=model(data.model_id);checkTeam(op,mo);const shift_id=data.shift_id||null;
  let shift:any;if(shift_id){shift=q('SELECT * FROM shifts WHERE id=?',shift_id);
    check(shift&&shift.operator_id===op.id&&shift.model_id===mo.id,'Связанная смена не соответствует участникам',400);
    check(!q("SELECT id FROM reports WHERE shift_id=? AND status IN ('pending','approved','changes_requested')",shift_id),'Для смены уже есть отчёт',409);
  }
  const work_date=day(data.work_date),start_time=tm(data.start_time),end_time=tm(data.end_time);
  if(shift_id)check(shift.work_date===work_date,'Дата отчёта не совпадает со связанной сменой',400);
  check(start_time<end_time,'Некорректное время смены',400);
  const notes=val(data.notes,2000),cs=checkedAmountList(data.amounts),total_cents=cs.reduce((a:number,b:number)=>a+b,0),id=uid(),site=conf();
  transaction(()=>{
    insert('reports',{id,shift_id,operator_id:op.id,model_id:mo.id,work_date,start_time,end_time,notes,total_cents,status:'pending',created_at:now()});
    cs.forEach((amount:number,i:number)=>insert('report_platforms',{report_id:id,slot:i+1,platform_name:site['slot_'+(i+1)],amount_cents:amount}));
    const recipients=new Set(activeUsers(ADM).map(x=>x.id));if(op.team_id){const team=q('SELECT lead_id FROM teams WHERE id=?',op.team_id);if(team?.lead_id)recipients.add(team.lead_id)}
    for(const person of recipients)notice(person,'report','Отчёт на проверке',`${op.name}: отчёт за ${work_date} на ${display(total_cents)}`);
    audit(u,'create','report',id)
  });return result({id,total_cents,status:'pending'},201);
 }
 if(seg.length===2&&seg[0]==='reports'&&method==='PATCH'){
  const r=q('SELECT * FROM reports WHERE id=?',seg[1]);check(r,'Отчёт не найден',404);
  check(u.id===r.operator_id||manager(u));check(['pending','changes_requested'].includes(r.status),'Этот отчёт уже проверен',409);
  const notes=val(data.notes??r.notes,2000);transaction(()=>{
    if('amounts'in data){const cs=checkedAmountList(data.amounts);cs.forEach((x:number,i:number)=>run('UPDATE report_platforms SET amount_cents=? WHERE report_id=? AND slot=?',x,r.id,i+1));
      run("UPDATE reports SET total_cents=?,notes=?,status='pending',review_note='' WHERE id=?",cs.reduce((a:number,b:number)=>a+b,0),notes,r.id)}
    else run("UPDATE reports SET notes=?,status='pending',review_note='' WHERE id=?",notes,r.id);
    audit(u,'edit','report',r.id)
  });return result({ok:true});
 }
 if(seg.length===3&&seg[0]==='reports'&&seg[2]==='review'&&method==='POST'){
  const r=q('SELECT * FROM reports WHERE id=?',seg[1]);check(r,'Отчёт не найден',404);
  check(manager(u)||(u.role==='teamlead'&&canManageTeam(u,r.operator_id)),'Вы не можете проверять этот отчёт');
  const decision=statusInput(data.decision,['approved','changes_requested','rejected']),comment=val(data.note,1200);
  if(decision!=='approved')check(comment,'Укажите причину возврата или отклонения',400);
  transaction(()=>{
    const current=q('SELECT status FROM reports WHERE id=?',r.id);check(current.status==='pending','Отчёт уже проверен',409);
    run('UPDATE reports SET status=?,review_note=?,reviewer_id=?,reviewed_at=? WHERE id=?',decision,comment,u.id,now(),r.id);
    if(decision==='approved'){
      const op=q('SELECT * FROM users WHERE id=?',r.operator_id),mo=q('SELECT * FROM users WHERE id=?',r.model_id);
      const shares:[string,string][]=[[op.id,'operator'],[mo.id,'model']];const teamId=op.team_id||mo.team_id;
      if(teamId){const team=q('SELECT * FROM teams WHERE id=?',teamId);if(team?.lead_id)shares.push([team.lead_id,'teamlead']);if(team?.coach_id)shares.push([team.coach_id,'coach'])}
      const distributed=new Set<string>();
      for(const [userId,role] of shares){if(distributed.has(userId))continue;distributed.add(userId);
        const amount=Math.floor((r.total_cents*SHARES[role]+50)/100);
        insert('earnings',{id:uid(),user_id:userId,report_id:r.id,amount_cents:amount,created_at:now()});
        notice(userId,'earning','Начисление по отчёту',`${r.work_date}: начислено ${display(amount)}`);
      }
      if(r.shift_id)run("UPDATE shifts SET status='completed' WHERE id=?",r.shift_id);
    }
    notice(r.operator_id,'report','Отчёт проверен',`${decision}: ${comment||'Отчёт одобрен'}`);audit(u,'review','report',r.id)
  });return result({ok:true});
 }
 if(route==='balances'&&method==='GET'){
  let ids:string[]|null=null;if(!manager(u)){
    if(['teamlead','coach'].includes(u.role)&&u.team_id)ids=all('SELECT id FROM users WHERE team_id=?',u.team_id).map(x=>x.id);
    else ids=[u.id]
  }return result({items:balances(ids)});
 }
 if(route==='payouts'&&method==='GET'){
  const items=all('SELECT p.*,u.name AS user_name FROM payouts p JOIN users u ON u.id=p.user_id ORDER BY p.created_at DESC LIMIT 400');
  return result({items:items.filter(x=>manager(u)||x.user_id===u.id)});
 }
 if(route==='payouts'&&method==='POST'){
  const amount=money(data.amount);check(amount>0,'Сумма должна быть больше нуля',400);
  const id=transaction(()=>{const b=balances([u.id])[0];check(b&&amount<=b.available_cents,'Недостаточно доступных средств',400);
    check(['bank','crypto'].includes(u.payout_type)&&u.payout_ref,'Сначала укажите реквизиты в настройках',400);
    const id=uid();insert('payouts',{id,user_id:u.id,amount_cents:amount,method:u.payout_type,requisites:u.payout_ref,status:'pending',created_at:now()});
    notifyAdmins('payout','Новая заявка на выплату',`${u.name} запросил ${display(amount)}`);audit(u,'create','payout',id);return id
  });return result({id},201);
 }
 if(seg.length===3&&seg[0]==='payouts'&&seg[2]==='review'&&method==='POST'){
  check(manager(u));const p=q('SELECT * FROM payouts WHERE id=?',seg[1]);check(p,'Заявка не найдена',404);
  const status=statusInput(data.status,['approved','paid','rejected']);const allowed:Record<string,string[]>={pending:['approved','rejected'],approved:['paid','rejected']};
  check(allowed[p.status]?.includes(status),'Нельзя изменить статус этой заявки',409);
  transaction(()=>{run('UPDATE payouts SET status=?,note=?,reviewer_id=?,reviewed_at=? WHERE id=?',status,val(data.note,600),u.id,now(),p.id);
  notice(p.user_id,'payout','Статус выплаты изменился',`Заявка ${display(p.amount_cents)}: ${status}`);audit(u,'review','payout',p.id)});
  return result({ok:true});
 }
 if(route==='fines'&&method==='GET'){
  const items=all('SELECT f.*,u.name AS user_name FROM fines f JOIN users u ON u.id=f.user_id ORDER BY f.created_at DESC LIMIT 400');
  return result({items:items.filter(x=>teamScope(u,x.user_id))});
 }
 if(route==='fines'&&method==='POST'){
  check(manager(u));const t=q('SELECT * FROM users WHERE id=?',data.user_id);check(t,'Сотрудник не найден',400);
  const amount=money(data.amount);check(amount>0,'Сумма штрафа должна быть больше нуля',400);
  const reason=val(data.reason,1000,true),id=uid();transaction(()=>{insert('fines',{id,user_id:t.id,issuer_id:u.id,amount_cents:amount,reason,created_at:now()});
    notice(t.id,'fine','Назначен штраф',`Сумма ${display(amount)}. Причина: ${reason}`);audit(u,'create','fine',id)});
  return result({id},201);
 }
 if(seg.length===3&&seg[0]==='fines'&&seg[2]==='appeal'&&method==='POST'){
  const f=q('SELECT * FROM fines WHERE id=?',seg[1]);check(f,'Штраф не найден',404);
  check(u.id===f.user_id&&f.status==='active','Оспорить штраф нельзя');const message=val(data.message,1000,true);
  transaction(()=>{run("UPDATE fines SET status='appealed',appeal_text=? WHERE id=?",message,f.id);notifyAdmins('fine','Штраф оспорен',`${u.name}: ${message}`)});
  return result({ok:true});
 }
 if(seg.length===3&&seg[0]==='fines'&&seg[2]==='review'&&method==='POST'){
  check(manager(u));const f=q('SELECT * FROM fines WHERE id=?',seg[1]);check(f,'Штраф не найден',404);
  const status=statusInput(data.status,['active','cancelled']);check(['active','appealed'].includes(f.status),'Штраф закрыт',409);
  transaction(()=>{run('UPDATE fines SET status=?,review_note=? WHERE id=?',status,val(data.note,1000),f.id);
    notice(f.user_id,'fine','Решение по штрафу',`Штраф ${display(f.amount_cents)}: ${status==='cancelled'?'отменён':'оставлен в силе'}`);audit(u,'review','fine',f.id)});
  return result({ok:true});
 }
 if(route==='kpis'&&method==='GET'){
  const items=all('SELECT k.*,u.name AS user_name FROM kpis k JOIN users u ON u.id=k.user_id ORDER BY k.created_at DESC LIMIT 400').filter(x=>teamScope(u,x.user_id));
  for(const k of items){k.actual_cents=q('SELECT COALESCE(SUM(e.amount_cents),0) AS n FROM earnings e JOIN reports r ON r.id=e.report_id WHERE e.user_id=? AND r.work_date BETWEEN ? AND ?',k.user_id,k.from_day,k.to_day).n;
    const rs=all("SELECT start_time,end_time FROM reports WHERE operator_id=? AND status='approved' AND work_date BETWEEN ? AND ?",k.user_id,k.from_day,k.to_day);
    k.actual_shifts=rs.length;k.actual_minutes=rs.reduce((n,r)=>n+countTime(r.start_time,r.end_time),0)
  }return result({items});
 }
 if(route==='kpis'&&method==='POST'){
  check(manager(u)||u.role==='teamlead');const t=operator(data.user_id);if(u.role==='teamlead')check(canManageTeam(u,t.id));
  const from_day=day(data.from_day),to_day=day(data.to_day);check(from_day<=to_day,'Неверный период',400);
  const target_cents=money(data.target_earnings||0),target_shifts=Number(data.target_shifts||0),target_minutes=Number(data.target_hours||0)*60;
  check(Number.isInteger(target_shifts)&&Number.isInteger(target_minutes)&&target_shifts>=0&&target_shifts<=1000&&target_minutes>=0&&target_minutes<=100000,'Слишком большое значение цели',400);
  const id=uid();transaction(()=>{insert('kpis',{id,user_id:t.id,assigned_by:u.id,from_day,to_day,target_cents,target_shifts,target_minutes,created_at:now()});
  notice(t.id,'kpi','Новая цель KPI',`Цель на период ${from_day} — ${to_day}`);audit(u,'create','kpi',id)});
  return result({id},201);
 }
 if(route==='leaves'&&method==='GET'){
  const items=all('SELECT l.*,u.name AS user_name FROM leaves l JOIN users u ON u.id=l.user_id ORDER BY l.created_at DESC LIMIT 400');
  return result({items:items.filter(x=>teamScope(u,x.user_id))});
 }
 if(route==='leaves'&&method==='POST'){
  check([...OPS,'teamlead'].includes(u.role),'Заявки доступны операторам и тимлидам');
  const from_day=day(data.from_day),to_day=day(data.to_day),reason=val(data.reason,1000,true);check(from_day<=to_day,'Неверный период',400);
  const id=uid();transaction(()=>{insert('leaves',{id,user_id:u.id,from_day,to_day,reason,created_at:now()});
    notifyAdmins('leave','Новая заявка на отгул',`${u.name}: ${from_day}–${to_day}`);
    if(u.team_id){const t=q('SELECT lead_id FROM teams WHERE id=?',u.team_id);if(t?.lead_id&&t.lead_id!==u.id)notice(t.lead_id,'leave','Отгул в команде',`${u.name} подал заявку`)}}
  );return result({id},201);
 }
 if(seg.length===3&&seg[0]==='leaves'&&seg[2]==='review'&&method==='POST'){
  const lev=q('SELECT * FROM leaves WHERE id=?',seg[1]);check(lev,'Заявка не найдена',404);
  check(manager(u)||canManageTeam(u,lev.user_id));check(lev.status==='pending','Заявка уже рассмотрена',409);
  const status=statusInput(data.status,['approved','rejected']);if(status==='approved')check(!q("SELECT id FROM shifts WHERE operator_id=? AND work_date BETWEEN ? AND ? AND status='planned' LIMIT 1",lev.user_id,lev.from_day,lev.to_day),'На период отгула назначены смены. Перенесите их.',409);
  transaction(()=>{run('UPDATE leaves SET status=?,decision_note=?,decided_by=? WHERE id=?',status,val(data.note,600),u.id,lev.id);
    notice(lev.user_id,'leave','Решение по отгулу',`Заявка ${lev.from_day}–${lev.to_day}: ${status}`);audit(u,'review','leave',lev.id)});
  return result({ok:true});
 }
 if(route==='training'&&method==='GET'){
  const items=all('SELECT t.*,u.name AS trainee_name,c.name AS coach_name FROM training t JOIN users u ON u.id=t.trainee_id JOIN users c ON c.id=t.coach_id ORDER BY t.created_at DESC LIMIT 400');
  return result({items:items.filter(x=>x.trainee_id===u.id||x.coach_id===u.id||teamScope(u,x.trainee_id))});
 }
 if(route==='training'&&method==='POST'){
  check(manager(u)||u.role==='coach');const trainee=q('SELECT * FROM users WHERE id=?',data.trainee_id);
  check(trainee&&trainee.role==='trial','Нужен оператор на испытательном сроке',400);
  if(u.role==='coach')check(trainee.team_id&&trainee.team_id===u.team_id);
  const title=val(data.title,130,true),instructions=val(data.instructions,4000,true),material_url=val(data.material_url,300),due_day=day(data.due_day);
  if(material_url)check(/^https?:\/\//.test(material_url),'Ссылка должна начинаться с https://',400);
  const id=uid();transaction(()=>{insert('training',{id,trainee_id:trainee.id,coach_id:u.id,title,instructions,material_url,due_day,created_at:now()});
    notice(trainee.id,'training','Новое учебное задание',title);audit(u,'create','training',id)});
  return result({id},201);
 }
 if(seg.length===3&&seg[0]==='training'&&seg[2]==='submit'&&method==='POST'){
  const t=q('SELECT * FROM training WHERE id=?',seg[1]);check(t,'Задание не найдено',404);
  check(t.trainee_id===u.id&&['assigned','revision'].includes(t.status),'Вы не можете отправить это задание');
  const submission=val(data.submission,4000,true);transaction(()=>{run("UPDATE training SET status='submitted',submission=? WHERE id=?",submission,t.id);
    notice(t.coach_id,'training','Задание на проверке',`${u.name}: ${t.title}`)});return result({ok:true});
 }
 if(seg.length===3&&seg[0]==='training'&&seg[2]==='review'&&method==='POST'){
  const t=q('SELECT * FROM training WHERE id=?',seg[1]);check(t,'Задание не найдено',404);
  check(manager(u)||u.id===t.coach_id,'Только коуч или руководство');check(t.status==='submitted','Сначала дождитесь сдачи задания',409);
  const status=statusInput(data.status,['passed','revision']),feedback=val(data.feedback,1400);if(status==='revision')check(feedback,'Укажите исправления',400);
  transaction(()=>{run('UPDATE training SET status=?,feedback=? WHERE id=?',status,feedback,t.id);
    notice(t.trainee_id,'training','Задание проверено',`${t.title}: ${status}. ${feedback}`);audit(u,'review','training',t.id)});return result({ok:true});
 }
 if(route==='analytics'&&method==='GET'){
  check(u.role!=='model','Модели не видят аналитику площадок');
  const from=day(search.get('from')||days(-30)),to=day(search.get('to')||today());check(from<=to,'Неверный период',400);
  const opFilter=search.get('operator')||'',moFilter=search.get('model')||'';
  const rows=all("SELECT id,work_date,operator_id,model_id,total_cents,status FROM reports WHERE status='approved' AND work_date BETWEEN ? AND ?",from,to)
    .filter(x=>visibleReport(u,x)&&(!opFilter||x.operator_id===opFilter)&&(!moFilter||x.model_id===moFilter));
  const dateDiff=Math.round((Date.parse(to)-Date.parse(from))/DAY_MS)+1;
  const previousFrom=new Date(Date.parse(from)-dateDiff*DAY_MS).toISOString().slice(0,10),previousTo=new Date(Date.parse(from)-DAY_MS).toISOString().slice(0,10);
  const prev=all("SELECT id,operator_id,model_id,total_cents FROM reports WHERE status='approved' AND work_date BETWEEN ? AND ?",previousFrom,previousTo)
    .filter(x=>visibleReport(u,x)&&(!opFilter||x.operator_id===opFilter)&&(!moFilter||x.model_id===moFilter));
  const out:any={total_cents:0,count:rows.length,previous_total_cents:prev.reduce((n,x)=>n+x.total_cents,0),daily:{},platforms:{},operators:{},models:{}};
  for(const r of rows){out.total_cents+=r.total_cents;
    out.daily[r.work_date]=(out.daily[r.work_date]||0)+r.total_cents;
    const op=q('SELECT name FROM users WHERE id=?',r.operator_id)?.name||'—',mo=q('SELECT name FROM users WHERE id=?',r.model_id)?.name||'—';
    out.operators[op]=(out.operators[op]||0)+r.total_cents;out.models[mo]=(out.models[mo]||0)+r.total_cents;
    for(const p of all('SELECT platform_name,amount_cents FROM report_platforms WHERE report_id=?',r.id))out.platforms[p.platform_name]=(out.platforms[p.platform_name]||0)+p.amount_cents;
  }return result(out);
 }
 if(route==='dashboard'&&method==='GET'){
  const b=balances([u.id])[0],notifications=q('SELECT COUNT(*) AS n FROM notifications WHERE user_id=? AND read_at IS NULL',u.id).n;
  if(u.role==='model')return result({balance:b,notifications,model_shifts:all(`SELECT r.id,r.work_date,r.start_time,r.end_time,e.amount_cents AS earned_cents,op.name AS operator_name
  FROM earnings e JOIN reports r ON e.report_id=r.id JOIN users op ON op.id=r.operator_id WHERE e.user_id=? ORDER BY r.work_date DESC LIMIT 30`,u.id)});
  let rows=all('SELECT status,total_cents,operator_id FROM reports');if(!manager(u))rows=rows.filter(x=>teamScope(u,x.operator_id));
  return result({balance:b,notifications,pending_reports:rows.filter(x=>x.status==='pending').length,
    approved_total_cents:rows.filter(x=>x.status==='approved').reduce((n,x)=>n+x.total_cents,0),
    my_shifts:q("SELECT COUNT(*) AS n FROM shifts WHERE (operator_id=? OR model_id=?) AND status!='cancelled'",u.id,u.id).n});
 }
 if(route==='notifications'&&method==='GET')return result({items:all('SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 150',u.id)});
 if(route==='notifications/read'&&method==='POST'){
  if(data.ids==='all')run('UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL',now(),u.id);
  else if(Array.isArray(data.ids))for(const id of data.ids.slice(0,150))run('UPDATE notifications SET read_at=? WHERE id=? AND user_id=?',now(),id,u.id);
  else fail(400,'Не указаны уведомления');return result({ok:true});
 }
 if(route==='audit'&&method==='GET'){check(u.role==='owner');return result({items:all('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 200')})}
 fail(404,'Команда API не найдена');
}

const mime:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon','.woff2':'font/woff2','.webp':'image/webp'};
function respond(res:ServerResponse,status:number,payload:any,cookie?:string){const body=Buffer.isBuffer(payload)?payload:Buffer.from(JSON.stringify(payload));
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Content-Length':String(body.length),'Cache-Control':'no-store',...(cookie?{'Set-Cookie':cookie}:{})});res.end(body)}
const MAX_BODY=1024*1024;
async function readBody(req:IncomingMessage):Promise<any>{const ct=String(req.headers['content-type']||'').split(';')[0];check(ct==='application/json','Требуется application/json',415);
  let size=0;const chunks:Buffer[]=[];for await(const chunk of req){size+=chunk.length;if(size>MAX_BODY)fail(413,'Тело запроса слишком большое');chunks.push(chunk)}
  try{const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));check(value&&typeof value==='object'&&!Array.isArray(value),'Ожидается JSON-объект',400);return value}
  catch(e){if(e instanceof ApiError)throw e;fail(400,'Некорректный JSON')}
}
async function serve(req:IncomingMessage,res:ServerResponse){
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  if(PROD)res.setHeader('Strict-Transport-Security','max-age=31536000');
  const url=new URL(req.url||'/',`http://${HOST}`);const path=url.pathname;
  try{
    check(!path.includes('..')&&!path.includes('\\')&&!path.includes('\0'),'Недопустимый путь',400);
    if(path==='/health'){respond(res,200,{ok:true,service:'finesse-crm-node'});return}
    if(path.startsWith('/api/')){
      const method=req.method||'GET',route=path.slice(5),seg=route.split('/').filter(Boolean);
      check(['GET','POST','PATCH','DELETE'].includes(method),'Недопустимый метод',405);
      const auth=sessionsSecret(req),user=auth?.u||null,s=auth?.s||null;
      const data=method==='GET'?{}:await readBody(req);
      if(method!=='GET'&&!['register','login'].includes(route))check(user&&s&&req.headers['x-csrf-token']===s.csrf,'Недействительный CSRF-токен',403);
      const sourceIp=String(req.socket.remoteAddress||'unknown');
      const ip=['127.0.0.1','::1','::ffff:127.0.0.1'].includes(sourceIp)?String(req.headers['x-real-ip']||sourceIp).slice(0,64):sourceIp;
      const out=handle({method,route,seg,data,search:url.searchParams,u:user,s,ip});respond(res,out.status||200,out.payload,out.cookie);return;
    }
    if(req.method!=='GET'&&req.method!=='HEAD')fail(405,'Недопустимый метод');
    const staticRoot=join(ROOT,'dist');let requested=decodeURIComponent(path);
    if(requested==='/')requested='/index.html';
    let file=resolve(staticRoot,'.'+requested);
    if(!file.startsWith(staticRoot+ '/'))fail(403,'Запрещено');
    if(!existsSync(file)){if(!extname(requested))file=join(staticRoot,'index.html');else fail(404,'Файл не найден')}
    const ext=extname(file);check(ext in mime,'Запрещён тип файла',403);const b=readFileSync(file);
    res.writeHead(200,{'Content-Type':mime[ext],'Content-Length':String(b.length),'Cache-Control':ext==='.html'?'no-store':'public, max-age=3600'});if(req.method!=='HEAD')res.end(b);else res.end();
  }catch(error:any){if(error instanceof ApiError)respond(res,error.status,{error:error.message});else if(/UNIQUE constraint|FOREIGN KEY constraint/.test(String(error)))respond(res,409,{error:'Конфликт данных'});else{console.error('Server error:',error?.stack||error);respond(res,500,{error:'Внутренняя ошибка сервера'})}}
}

async function ownerCommand(reset=false){
  const rl=createInterface({input:process.stdin,output:process.stdout});
  try{
    const email=mail((process.env.FINESSE_OWNER_EMAIL||await rl.question('Email аккаунта: ')).trim());
    if(reset)check(q('SELECT * FROM users WHERE email=?',email),'Аккаунт не найден',404);
    else check(!q('SELECT id FROM users WHERE email=?',email),'Аккаунт уже существует',409);
    const name=reset?'':val(process.env.FINESSE_OWNER_NAME||await rl.question('Имя владельца: '),120)||'Владелец Finesse';
    // If terminal echo hiding is needed, use the helper script deploy/create-owner.sh,
    // which supplies FINESSE_OWNER_PASSWORD without displaying it in the terminal.
    const password=process.env.FINESSE_OWNER_PASSWORD;
    check(password&&password.length>=12,'Укажите пароль через FINESSE_OWNER_PASSWORD (минимум 12 символов)',400);
    if(reset){transaction(()=>{const target=q('SELECT id FROM users WHERE email=?',email);run('UPDATE users SET password_hash=? WHERE id=?',passwordHash(password),target.id);run('DELETE FROM sessions WHERE user_id=?',target.id)})}
    else insert('users',{id:uid(),email,name,role:'owner',password_hash:passwordHash(password),approved:1,active:1,created_at:now()});
    console.log(reset?'Пароль обновлён':'Аккаунт владельца создан');
  }finally{rl.close()}
}
const command=process.argv[2];
if(command==='create-owner'||command==='reset-password')ownerCommand(command==='reset-password').catch(e=>{console.error(e.message);process.exitCode=1});
else if(command==='init-db')console.log('SQLite ready:',FILE);
else if(!command||command==='serve'){const s=createServer(serve);s.listen(PORT,HOST,()=>console.log(`Finesse CRM Node.js listening at http://${HOST}:${PORT}`));}
else {console.error('Unknown command:',command);process.exitCode=1}
