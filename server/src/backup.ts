/** Atomic online SQLite backup; run from systemd timer, not from a browser. */
import { DatabaseSync, backup } from 'node:sqlite';
import { mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join,resolve } from 'node:path';
const data=process.env.FINESSE_DB||resolve('data/finesse.sqlite3');
const out=process.env.FINESSE_BACKUP_DIR||resolve('backups');
mkdirSync(out,{recursive:true});
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
const name=join(out,`finesse-${stamp}.sqlite3`);
const db=new DatabaseSync(data,{readOnly:true});
try{await backup(db,name);console.log('Created SQLite backup:',name)}finally{db.close()}
const files=readdirSync(out).filter(x=>/^finesse-.*\.sqlite3$/.test(x)).sort();
for(const old of files.slice(0,Math.max(0,files.length-14)))unlinkSync(join(out,old));
