import {spawn,spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';

const root=resolve(import.meta.dirname,'..');
const dbdir=mkdtempSync(join(tmpdir(),'finesse-react-test-'));
const db=join(dbdir,'test.sqlite3');
const port=19790+Math.floor(Math.random()*1000);
const addr=`http://127.0.0.1:${port}`;
const source=join(root,'server/src/index.ts');
const env={...process.env,FINESSE_DB:db,FINESSE_PORT:String(port),FINESSE_HOST:'127.0.0.1',FINESSE_OWNER_EMAIL:'owner@test.local',FINESSE_OWNER_PASSWORD:'supersecure12345!',FINESSE_OWNER_NAME:'Владелец Finesse'};
const bootstrap=spawnSync('node',['--experimental-strip-types',source,'create-owner'],{env,encoding:'utf8'});
assert.equal(bootstrap.status,0,bootstrap.stderr+'\n'+bootstrap.stdout);
const child=spawn('node',['--experimental-strip-types',source],{env,stdio:['ignore','pipe','pipe']});
let logs='';child.stderr.on('data',b=>{logs+=b.toString()});child.stdout.on('data',b=>{logs+=b.toString()});
class Account{
 cookie='';csrf='';email:string;password:string;constructor(email:string,password='supersecure12345!'){this.email=email;this.password=password}
 async call(path:string,method='GET',data?:unknown,expected=200){const headers:Record<string,string>={Accept:'application/json'};
 if(method!=='GET'){headers['Content-Type']='application/json';if(this.csrf)headers['X-CSRF-Token']=this.csrf}
 if(this.cookie)headers.Cookie=this.cookie;
 const r=await fetch(addr+'/api/'+path,{method,headers,body:method==='GET'?undefined:JSON.stringify(data??{})});
 const body=await r.json();assert.equal(r.status,expected,`${method} ${path}: ${r.status} ${JSON.stringify(body)}`);
 if(path==='login'&&r.status===200){this.cookie=r.headers.get('set-cookie')?.split(';')[0]||'';this.csrf=body.csrf}
 return body;
 }
 async login(){await this.call('login','POST',{email:this.email,password:this.password})}
}
const owner=new Account('owner@test.local');
async function signup(name:string,role:string){const email=`${role}@test.local`,p=new Account(email);await p.call('register','POST',{name,email,password:p.password,nickname:role},201);return p}
async function main(){
 for(let i=0;i<60;i++){try{const r=await fetch(addr+'/health');if(r.ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
 const health=await fetch(addr+'/health');assert.equal(health.status,200);
 await owner.login();
 const operator=await signup('Оператор','operator');const model=await signup('Модель','model');const teamlead=await signup('Тимлид','teamlead');const coach=await signup('Коуч','coach');const trial=await signup('Стажёр','trial');
 const pending=await owner.call('users/pending');assert.equal(pending.items.length,5);
 const users:Record<string,string>={};for(const p of pending.items){const role=p.nickname;users[role]=p.id;await owner.call('users/'+p.id,'PATCH',{role,approved:true})}
 await operator.login();await model.login();await teamlead.login();await coach.login();await trial.login();
 const team=await owner.call('teams','POST',{name:'Команда А',lead_id:users.teamlead,coach_id:users.coach},201);
 await owner.call('users/'+users.operator,'PATCH',{team_id:team.id});await owner.call('users/'+users.model,'PATCH',{team_id:team.id});await owner.call('users/'+users.trial,'PATCH',{team_id:team.id});
 const today=new Date().toISOString().slice(0,10);
 const shift=await operator.call('shifts','POST',{model_id:users.model,work_date:today,start_time:'09:00',end_time:'16:00'},201);
 await operator.call(`shifts/${shift.id}/messages`,'POST',{message:'Привет, смена сегодня'},201);
 const messages=await model.call(`shifts/${shift.id}/messages`);assert.equal(messages.items.length,1);
 const report=await operator.call('reports','POST',{model_id:users.model,shift_id:shift.id,work_date:today,start_time:'09:00',end_time:'16:00',amounts:['100.25','199.75',0,0,0],notes:'Рабочая смена'},201);
 assert.equal(report.total_cents,30000);
 const pre=await operator.call('balances');assert.equal(pre.items[0].earned_cents,0);
 await teamlead.call(`reports/${report.id}/review`,'POST',{decision:'approved',note:'Все в порядке'});
 await teamlead.call(`reports/${report.id}/review`,'POST',{decision:'approved'},409);
 const b=await owner.call('balances');const byRole=Object.fromEntries(b.items.map((x:any)=>[x.role,x.earned_cents]));
 assert.equal(byRole.operator,6000);assert.equal(byRole.model,12000);assert.equal(byRole.teamlead,1500);assert.equal(byRole.coach,300);
 const mrep=await model.call('reports');assert.equal(mrep.items.length,1);assert.equal(mrep.items[0].earned_cents,12000);assert.ok(!('platforms' in mrep.items[0]));assert.ok(!('total_cents' in mrep.items[0]));
 const mdash=await model.call('dashboard');assert.equal(mdash.model_shifts[0].earned_cents,12000);assert.ok(!('platforms'in mdash));
 await model.call('analytics','GET',undefined,403);
 await operator.call('fines','POST',{user_id:users.model,amount:'10',reason:'test'},403);
 const fine=await owner.call('fines','POST',{user_id:users.operator,amount:'10.50',reason:'Пропущенное собрание'},201);
 const notices=await operator.call('notifications');assert.ok(notices.items.some((x:any)=>x.kind==='fine'&&x.message.includes('10.50')));
 await operator.call(`fines/${fine.id}/appeal`,'POST',{message:'Проверить уважительную причину'});
 await owner.call(`fines/${fine.id}/review`,'POST',{status:'cancelled'});
 const leave=await operator.call('leaves','POST',{from_day:'2026-12-01',to_day:'2026-12-01',reason:'Плановый выходной'},201);
 await owner.call(`leaves/${leave.id}/review`,'POST',{status:'approved'});
 const kpi=await teamlead.call('kpis','POST',{user_id:users.operator,from_day:today,to_day:today,target_earnings:100,target_shifts:1,target_hours:7},201);
 const ks=await operator.call('kpis');assert.ok(ks.items.some((k:any)=>k.id===kpi.id&&k.actual_shifts===1));
 const deniedTask=await coach.call('training','POST',{trainee_id:users.operator,title:'Тестовое обучение',instructions:'Прочитать материалы',due_day:'2026-12-14'},400);
 const task=await coach.call('training','POST',{trainee_id:users.trial,title:'Тестовое обучение',instructions:'Прочитать материалы',due_day:'2026-12-14'},201);
 await trial.call(`training/${task.id}/submit`,'POST',{submission:'Материалы изучены'});
 await coach.call(`training/${task.id}/review`,'POST',{status:'passed',feedback:'Отлично'});
 const taskResult=await trial.call('training');assert.equal(taskResult.items[0].status,'passed');
 const payoutPre=await operator.call('payouts','POST',{amount:'20'},400);
 await operator.call('profile','PATCH',{name:'Оператор',payout_type:'bank',payout_ref:'Банк, карта **** 1234'});
 const payout=await operator.call('payouts','POST',{amount:'20'},201);
 await owner.call(`payouts/${payout.id}/review`,'POST',{status:'approved'});
 await owner.call(`payouts/${payout.id}/review`,'POST',{status:'paid'});
 const opBal=await operator.call('balances');assert.equal(opBal.items[0].paid_cents,2000);
 const audit=await owner.call('audit');assert.ok(audit.items.length>=5);
 console.log('PASS: authorization, teams, shifts, messages, reports, earnings, visibility, fines, leaves, KPI, training, payouts, audit');
}
try{await main()}catch(e){console.error(e);console.error(logs);process.exitCode=1}finally{child.kill('SIGTERM');rmSync(dbdir,{recursive:true,force:true})}
