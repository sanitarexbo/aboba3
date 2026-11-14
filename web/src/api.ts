export interface Person {
 id:string;name:string;email:string;nickname?:string|null;role:string;team_id?:string|null;
 approved?:number;active?:number;trial_start?:string|null;trial_end?:string|null;
 payout_type?:string;payout_ref?:string;
}
export type Row=Record<string,any>;
export const roleNames: Record<string,string>={owner:'Владелец',admin:'Администратор',teamlead:'Тимлид',coach:'Коуч',operator:'Оператор',trial:'Оператор · исп. срок',model:'Модель'};
export const statusNames:Record<string,string>={pending:'На проверке',approved:'Одобрено',paid:'Выплачено',rejected:'Отклонено',changes_requested:'На исправлении',active:'Действует',appealed:'Оспорен',cancelled:'Отменено',planned:'Запланирована',completed:'Завершена',passed:'Зачтено',revision:'На доработке',assigned:'Назначено',submitted:'Сдано'};
export const pages:Record<string,string>={dashboard:'Обзор',shifts:'Расписание',reports:'Отчёты',analytics:'Аналитика',users:'Сотрудники',teams:'Команды',kpis:'Цели и KPI',leaves:'Отгулы',training:'Обучение',notifications:'Уведомления',balances:'Балансы',payouts:'Выплаты',fines:'Штрафы',settings:'Настройки',audit:'Журнал действий'};
let csrf='';
export function setCsrf(value:string){csrf=value}
export async function api<T=any>(endpoint:string,method='GET',payload?:unknown):Promise<T>{
 const options:RequestInit={method,credentials:'same-origin',headers:{Accept:'application/json'}};
 if(method!=='GET'){options.headers={'Accept':'application/json','Content-Type':'application/json',...(csrf?{'X-CSRF-Token':csrf}:{})};options.body=JSON.stringify(payload??{})}
 const url='/api/'+endpoint.replace(/^\//,'');let response:Response;
 try{response=await fetch(url,options)}catch{throw new Error('Нет соединения с сервером')}
 const data=await response.json().catch(()=>({error:'Некорректный ответ сервера'}));
 if(!response.ok)throw new Error(data.error||`HTTP ${response.status}`);
 return data as T;
}
export const startDay=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
export const isoDay=(d:Date)=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
export const addDays=(s:string,days:number)=>{const d=new Date(s+'T12:00:00');d.setDate(d.getDate()+days);return isoDay(d)};
export const monday=(s:string)=>{const d=new Date(s+'T12:00:00');return addDays(s,-(d.getDay()+6)%7)};
export const dateRU=(s:string)=>s?new Date(s+'T12:00:00').toLocaleDateString('ru-RU',{day:'2-digit',month:'short',year:'numeric'}):'—';
export const timeRU=(s:string)=>s?new Date(s).toLocaleString('ru-RU',{dateStyle:'short',timeStyle:'short'}):'—';
export const usd=(c:number)=>'$'+((Number(c)||0)/100).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
export const toCash=(c:number,currency:'USD'|'RUB',fx:Record<string,string>)=>(Number(c||0)*(currency==='RUB'?Number(fx.fx_rate||90):1)/100).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})+(currency==='RUB'?' ₽':' $');
export function parseForm(form:HTMLFormElement):Row{const data:Row={};for(const [k,v] of new FormData(form).entries())data[k]=String(v);return data}
