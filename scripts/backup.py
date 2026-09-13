#!/usr/bin/env python3
"""Encrypt a logical database backup directly from stdout; no plaintext dump file."""
import os
import subprocess
from urllib.parse import urlparse, unquote

if __name__=='__main__':
    u=urlparse(os.environ['DATABASE_URL'])
    env={**os.environ,'PGHOST':u.hostname,'PGPORT':str(u.port or 5432),'PGUSER':unquote(u.username or ''),'PGPASSWORD':unquote(u.password or ''),'PGDATABASE':u.path.lstrip('/'),'PGSSLMODE':'require'}
    command=['docker','run','--rm']
    for key in ('PGHOST','PGPORT','PGUSER','PGPASSWORD','PGDATABASE','PGSSLMODE'):command+=['--env',key]
    command+=['postgres:17','pg_dump','--format=custom','--no-owner','--no-acl','--schema=public','--schema=private','--schema=auth','--schema=storage']
    os.makedirs('backup',exist_ok=True)
    dump=subprocess.Popen(command,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,env=env)
    encrypted=subprocess.run(['age','--recipient',os.environ['AGE_RECIPIENT'],'--output','backup/database.dump.age'],stdin=dump.stdout,capture_output=True)
    dump.stdout.close();dump.wait()
    if dump.returncode or encrypted.returncode:
        raise SystemExit('Encrypted database backup failed. No raw database output was logged.')
    print('Encrypted database backup created.')
