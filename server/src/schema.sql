PRAGMA journal_mode=WAL;
        PRAGMA synchronous=NORMAL;
        CREATE TABLE IF NOT EXISTS users(
          id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,nickname TEXT UNIQUE,name TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'trial',password_hash TEXT NOT NULL,
          approved INTEGER NOT NULL DEFAULT 0,active INTEGER NOT NULL DEFAULT 1,
          team_id TEXT, trial_start TEXT,trial_end TEXT,
          payout_type TEXT DEFAULT '',payout_ref TEXT DEFAULT '', created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sessions(
          token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,csrf TEXT NOT NULL,
          expires_at TEXT NOT NULL,FOREIGN KEY(user_id) REFERENCES users(id)
        );
        CREATE INDEX IF NOT EXISTS ix_sessions_user ON sessions(user_id);
        CREATE TABLE IF NOT EXISTS teams(
          id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE,lead_id TEXT,coach_id TEXT,created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS shifts(
          id TEXT PRIMARY KEY,operator_id TEXT NOT NULL,model_id TEXT NOT NULL,
          work_date TEXT NOT NULL,start_time TEXT NOT NULL,end_time TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'planned',created_at TEXT NOT NULL,
          FOREIGN KEY(operator_id) REFERENCES users(id),FOREIGN KEY(model_id) REFERENCES users(id)
        );
        CREATE INDEX IF NOT EXISTS ix_shifts_date ON shifts(work_date);
        CREATE TABLE IF NOT EXISTS reports(
          id TEXT PRIMARY KEY,shift_id TEXT,operator_id TEXT NOT NULL,model_id TEXT NOT NULL,
          work_date TEXT NOT NULL,start_time TEXT NOT NULL,end_time TEXT NOT NULL,notes TEXT NOT NULL DEFAULT '',
          total_cents INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'pending',review_note TEXT DEFAULT '',
          reviewer_id TEXT,created_at TEXT NOT NULL,reviewed_at TEXT,
          FOREIGN KEY(shift_id) REFERENCES shifts(id),
          FOREIGN KEY(operator_id) REFERENCES users(id),FOREIGN KEY(model_id) REFERENCES users(id)
        );
        CREATE INDEX IF NOT EXISTS ix_reports_status ON reports(status,work_date);
        CREATE TABLE IF NOT EXISTS report_platforms(
          report_id TEXT NOT NULL,slot INTEGER NOT NULL,platform_name TEXT NOT NULL,amount_cents INTEGER NOT NULL,
          PRIMARY KEY(report_id,slot),FOREIGN KEY(report_id) REFERENCES reports(id)
        );
        CREATE TABLE IF NOT EXISTS earnings(
          id TEXT PRIMARY KEY,user_id TEXT NOT NULL,report_id TEXT NOT NULL,amount_cents INTEGER NOT NULL,
          created_at TEXT NOT NULL,UNIQUE(user_id,report_id),
          FOREIGN KEY(user_id) REFERENCES users(id),FOREIGN KEY(report_id) REFERENCES reports(id)
        );
        CREATE TABLE IF NOT EXISTS payouts(
          id TEXT PRIMARY KEY,user_id TEXT NOT NULL,amount_cents INTEGER NOT NULL,method TEXT NOT NULL,
          requisites TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',note TEXT DEFAULT '',reviewer_id TEXT,
          created_at TEXT NOT NULL,reviewed_at TEXT,
          FOREIGN KEY(user_id) REFERENCES users(id)
        );
        CREATE TABLE IF NOT EXISTS fines(
          id TEXT PRIMARY KEY,user_id TEXT NOT NULL,issuer_id TEXT NOT NULL,amount_cents INTEGER NOT NULL,
          reason TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'active',appeal_text TEXT DEFAULT '',
          review_note TEXT DEFAULT '',created_at TEXT NOT NULL,
          FOREIGN KEY(user_id) REFERENCES users(id)
        );
        CREATE TABLE IF NOT EXISTS kpis(
          id TEXT PRIMARY KEY,user_id TEXT NOT NULL,assigned_by TEXT NOT NULL,from_day TEXT NOT NULL,to_day TEXT NOT NULL,
          target_cents INTEGER NOT NULL,target_shifts INTEGER NOT NULL,target_minutes INTEGER NOT NULL,
          created_at TEXT NOT NULL,FOREIGN KEY(user_id) REFERENCES users(id)
        );
        CREATE TABLE IF NOT EXISTS leaves(
          id TEXT PRIMARY KEY,user_id TEXT NOT NULL,from_day TEXT NOT NULL,to_day TEXT NOT NULL,
          reason TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',decision_note TEXT DEFAULT '',
          decided_by TEXT,created_at TEXT NOT NULL,
          FOREIGN KEY(user_id) REFERENCES users(id)
        );
        CREATE TABLE IF NOT EXISTS training(
          id TEXT PRIMARY KEY,trainee_id TEXT NOT NULL,coach_id TEXT NOT NULL,title TEXT NOT NULL,
          instructions TEXT NOT NULL,material_url TEXT DEFAULT '',due_day TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'assigned',submission TEXT DEFAULT '',feedback TEXT DEFAULT '',
          created_at TEXT NOT NULL,FOREIGN KEY(trainee_id) REFERENCES users(id)
        );
        CREATE TABLE IF NOT EXISTS notifications(
          id TEXT PRIMARY KEY,user_id TEXT NOT NULL,kind TEXT NOT NULL,title TEXT NOT NULL,
          message TEXT NOT NULL,read_at TEXT,created_at TEXT NOT NULL,
          FOREIGN KEY(user_id) REFERENCES users(id)
        );
        CREATE INDEX IF NOT EXISTS ix_notifs_user ON notifications(user_id,created_at);
        CREATE TABLE IF NOT EXISTS messages(
          id TEXT PRIMARY KEY,shift_id TEXT NOT NULL,sender_id TEXT NOT NULL,message TEXT NOT NULL,created_at TEXT NOT NULL,
          FOREIGN KEY(shift_id) REFERENCES shifts(id)
        );
        CREATE INDEX IF NOT EXISTS ix_messages_shift ON messages(shift_id,created_at);
        CREATE TABLE IF NOT EXISTS config(key TEXT PRIMARY KEY,value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS audit_log(id TEXT PRIMARY KEY,actor_id TEXT NOT NULL,action TEXT NOT NULL,
          object_type TEXT NOT NULL,object_id TEXT NOT NULL,created_at TEXT NOT NULL);
