#!/usr/bin/env python3
"""Private CI transport. Never prints request headers, raw reports, or tokens."""
import json
import os
import sys
import urllib.request

def call(payload):
    request=urllib.request.Request(os.environ['SUPABASE_URL'].rstrip('/')+'/functions/v1/jobs',data=json.dumps(payload).encode(),headers={'Authorization':'Bearer '+os.environ['JOBS_SECRET'],'Content-Type':'application/json'})
    with urllib.request.urlopen(request,timeout=180) as response:return json.load(response)
if __name__=='__main__':
    if sys.argv[1]=='export':
        with open(sys.argv[2],'w') as f:json.dump(call({'action':'training-data'}),f)
    elif sys.argv[1]=='shadow':
        with open(sys.argv[2]) as f:artifact=json.load(f)
        call({'action':'model-shadow','artifact':artifact,'metrics':{name:artifact['pooled'][name]['metrics'] for name in ('launch','water')}})
        print('Shadow model stored; it was not published.')
    elif sys.argv[1]=='tick':
        result=call({'action':'tick'});print(json.dumps({'jobs':len(result.get('results',[]))}))
