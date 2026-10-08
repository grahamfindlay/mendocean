#!/usr/bin/env python3
"""Weekly encrypted export of all immutable weather archives to independent storage.

Object contents stream into an encrypted tar without plaintext files. Each
archive is complete because GitHub artifact retention is seven days.
"""
import io
import json
import os
import subprocess
import tarfile
import urllib.request
import urllib.parse
from datetime import datetime,timedelta,timezone

def request(path,payload=None):
    req=urllib.request.Request(os.environ['SUPABASE_URL'].rstrip('/')+path,data=json.dumps(payload).encode() if payload is not None else None,headers={'Authorization':'Bearer '+os.environ['SUPABASE_SERVICE_ROLE_KEY'],'apikey':os.environ['SUPABASE_SERVICE_ROLE_KEY'],'Content-Type':'application/json'})
    return urllib.request.urlopen(req,timeout=60)

def archive_objects(requester=request, page_size=100):
    """Traverse all prefixes, including source/day observation archive folders."""
    prefixes=['']
    while prefixes:
        prefix=prefixes.pop()
        offset=0
        while True:
            with requester('/storage/v1/object/list/weather-archive',{'prefix':prefix,'limit':page_size,'offset':offset,'sortBy':{'column':'name','order':'asc'}}) as response:
                objects=json.load(response)
            for obj in objects:
                name='/'.join(part for part in [prefix,obj['name']] if part)
                if not name or any(part in ('','..','.') for part in name.split('/')):
                    raise ValueError('Invalid archive path')
                if obj.get('id'):
                    yield name
                else:
                    prefixes.append(name)
            if len(objects)<page_size:
                break
            offset+=page_size

if __name__=='__main__':
    os.makedirs('backup',exist_ok=True)
    age=subprocess.Popen(['age','--recipient',os.environ['AGE_RECIPIENT'],'--output','backup/weather.tar.age'],stdin=subprocess.PIPE)
    try:
        with tarfile.open(fileobj=age.stdin,mode='w|') as archive:
            for name in archive_objects():
                with request('/storage/v1/object/authenticated/weather-archive/'+urllib.parse.quote(name,safe='/')) as response:content=response.read()
                info=tarfile.TarInfo(name);info.size=len(content);archive.addfile(info,io.BytesIO(content))
        age.stdin.close();age.wait()
        if age.returncode:raise RuntimeError()
    except Exception:
        age.terminate();raise SystemExit('Weather archive export failed; no credentials were logged.')
    print('Encrypted weather archive created.')
