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
from datetime import datetime,timedelta,timezone

def request(path,payload=None):
    req=urllib.request.Request(os.environ['SUPABASE_URL'].rstrip('/')+path,data=json.dumps(payload).encode() if payload is not None else None,headers={'Authorization':'Bearer '+os.environ['SUPABASE_SERVICE_ROLE_KEY'],'apikey':os.environ['SUPABASE_SERVICE_ROLE_KEY'],'Content-Type':'application/json'})
    return urllib.request.urlopen(req,timeout=60)

if __name__=='__main__':
    os.makedirs('backup',exist_ok=True)
    age=subprocess.Popen(['age','--recipient',os.environ['AGE_RECIPIENT'],'--output','backup/weather.tar.age'],stdin=subprocess.PIPE)
    try:
        with tarfile.open(fileobj=age.stdin,mode='w|') as archive:
            prefixes=[]; root_offset=0
            while True:
                with request('/storage/v1/object/list/weather-archive',{'prefix':'','limit':100,'offset':root_offset}) as response:roots=json.load(response)
                prefixes.extend(obj['name'] for obj in roots)
                if len(roots)<100:break
                root_offset+=100
            for prefix in prefixes:
                offset=0
                while True:
                    with request('/storage/v1/object/list/weather-archive',{'prefix':prefix,'limit':100,'offset':offset}) as response:objects=json.load(response)
                    for obj in objects:
                        if not obj.get('id'):continue
                        name=prefix+'/'+obj['name']
                        with request('/storage/v1/object/authenticated/weather-archive/'+name) as response:content=response.read()
                        info=tarfile.TarInfo(name);info.size=len(content);archive.addfile(info,io.BytesIO(content))
                    if len(objects)<100:break
                    offset+=100
        age.stdin.close();age.wait()
        if age.returncode:raise RuntimeError()
    except Exception:
        age.terminate();raise SystemExit('Weather archive export failed; no credentials were logged.')
    print('Encrypted weather archive created.')
