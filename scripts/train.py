#!/usr/bin/env python3
"""Dependency-free, conservative shadow training. Never publishes a model.

Each outing contributes total weight one to each outcome. Chronological splits
keep every report from the same Madison calendar day in the same partition.
No actual launched-fleet fields are used as prediction features.
"""
import argparse
import json
import math
from collections import Counter
from datetime import datetime
from zoneinfo import ZoneInfo

VERSION = 'weather-v1'

def sigmoid(v):
    return 1 / (1 + math.exp(-max(-35, min(35, v))))

def features(weather):
    wind, direction = weather.get('wind'), weather.get('direction')
    if not isinstance(wind, (int, float)) or not isinstance(direction, (int, float)):
        return None
    if not math.isfinite(wind) or not math.isfinite(direction) or wind < 0:
        return None
    gust = weather.get('gust')
    previous = [p['wind'] for p in weather.get('preceding', []) if isinstance(p.get('wind'), (int, float))]
    angle = math.radians(direction)
    return [1, wind / 20, (gust or 0) / 30, math.sin(angle), math.cos(angle),
            sum(previous) / len(previous) / 20 if previous else 0,
            int(gust is None), int(not previous)]

def day(row):
    return datetime.fromisoformat(row['starts_at'].replace('Z', '+00:00')).astimezone(ZoneInfo('America/Chicago')).date().isoformat()

def records(rows, outcome):
    result = []
    for row in rows:
        report = row['report']
        x = features(row['weather'])
        if x is None:
            continue
        if outcome == 'launch':
            if report['outcome'] == 'rowed':
                y = 1
            elif report['outcome'] == 'stayed_ashore' and report.get('reason') == 'wind_waves':
                y = 0
            else:
                continue
        else:
            if report['outcome'] != 'rowed' or report.get('rating') not in range(1, 6):
                continue
            y = report['rating']
        result.append(dict(x=x, y=y, outing=row['outing_id'], day=day(row)))
    counts = Counter(r['outing'] for r in result)
    for r in result:
        r['weight'] = 1 / counts[r['outing']]
    return result

def split(rows):
    days = sorted(set(r['day'] for r in rows))
    if len(days) < 10:
        return [], []
    boundary = days[max(1, int(len(days) * .8))]
    return [r for r in rows if r['day'] < boundary], [r for r in rows if r['day'] >= boundary]

def fit(rows, threshold=None):
    beta = [0.] * 8
    total = sum(r['weight'] for r in rows)
    for step in range(1000):
        gradient = [0.] * 8
        for r in rows:
            y = r['y'] if threshold is None else int(r['y'] > threshold)
            p = sigmoid(sum(a*b for a, b in zip(beta, r['x'])))
            for j in range(8):
                gradient[j] += r['weight'] * (p-y) * r['x'][j]
        rate = .5 / (1 + step / 500)
        for j in range(8):
            beta[j] -= rate * (gradient[j]/total + (.02*beta[j] if j else 0))
    return beta

def predict(beta, x):
    return sigmoid(sum(a*b for a, b in zip(beta, x)))

def binary_metrics(rows, beta, baseline, threshold=None):
    total = sum(r['weight'] for r in rows)
    pairs = [(predict(beta,r['x']), r['y'] if threshold is None else int(r['y'] > threshold), r['weight']) for r in rows]
    brier = sum(w*(p-y)**2 for p,y,w in pairs)/total
    base = sum(w*(baseline-y)**2 for _,y,w in pairs)/total
    calibration = 0
    for bin_id in range(5):
        bucket = [(p,y,w) for p,y,w in pairs if min(4,int(p*5)) == bin_id]
        weight = sum(w for _,_,w in bucket)
        if weight:
            calibration += abs(sum(w*(p-y) for p,y,w in bucket))/total
    return dict(brier=brier, baseline_brier=base, calibration_error=calibration)

def train_family(rows, outcome):
    dataset = records(rows, outcome)
    n = len(set(r['outing'] for r in dataset))
    training, holdout = split(dataset)
    base = dict(eligible=False, outings=n, outcome=outcome, metrics={})
    if n < 100 or len(set(r['outing'] for r in holdout)) < 20 or not training:
        return dict(base, reason='Need 100 outings and a chronological holdout of 20 outings.')
    if outcome == 'launch':
        for value in (0,1):
            if len(set(r['outing'] for r in dataset if r['y']==value)) < 20:
                return dict(base, reason='Need 20 rowing and 20 weather-related non-rowing outings.')
        if len({r['y'] for r in holdout}) < 2 or len({r['y'] for r in training}) < 2:
            return dict(base, reason='Both outcomes must appear in training and holdout.')
        beta = fit(training)
        baseline = sum(r['y']*r['weight'] for r in training)/sum(r['weight'] for r in training)
        metrics = binary_metrics(holdout,beta,baseline)
        eligible = metrics['brier'] < metrics['baseline_brier'] and metrics['calibration_error'] <= .15
        return dict(base,eligible=eligible,coefficients=fit(dataset),metrics=metrics,
                    holdout_start=min(r['day'] for r in holdout),reason=None if eligible else 'Held-out improvement or calibration requirement not met.')
    if len(set(r['outing'] for r in dataset if r['y']>1)) < 30 or len(set(r['y'] for r in training)) < 3:
        return dict(base,reason='Need broader observed water conditions.')
    coefficients,metrics=[],[]
    for threshold in range(1,5):
        positives = sum(r['weight'] for r in training if r['y']>threshold)
        negatives = sum(r['weight'] for r in training if r['y']<=threshold)
        if min(positives,negatives) < 10:
            return dict(base,reason='Too few examples at one or more water-rating thresholds, including forced-off rows.')
        beta = fit(training,threshold)
        metric = binary_metrics(holdout,beta,positives/(positives+negatives),threshold)
        metrics.append(metric);coefficients.append(fit(dataset,threshold))
    eligible=all(m['calibration_error'] <= .15 for m in metrics) and sum(m['brier'] for m in metrics)<sum(m['baseline_brier'] for m in metrics)
    return dict(base,eligible=eligible,coefficients=coefficients,metrics=metrics,holdout_start=min(r['day'] for r in holdout),reason=None if eligible else 'Water-model validation requirements not met.')

def context_rows(rows, route, boat, coach, outcome):
    result=[]
    for row in rows:
        report=row['report']
        if coach!='none':
            if coach=='uncoached' and report.get('coach_state')!='uncoached':continue
            if coach!='uncoached' and coach not in row.get('coaches',[]):continue
        if boat!='any':
            # Launch predictions use the plan, never the fleet that actually launched.
            candidate=row.get('planned_boat') if outcome=='launch' else report.get('boat_class')
            if candidate!=boat:continue
        if route!='either':
            if report.get('route')==route:pass
            elif outcome=='water' and report.get('route')=='both':
                segment=next((s for s in report.get('segments',[]) if s['route']==route),None)
                if segment is None:continue
                row={**row,'report':{**report,'rating':segment['rating']}}
            else:continue
        result.append(row)
    return result

def bundle(rows):
    result={name:train_family(rows,name) for name in ('launch','water')}
    result['contextual']={}
    routes=['either','east','west']
    boats=['any']+sorted(set(r.get('planned_boat') for r in rows if r.get('planned_boat')) | set(r['report'].get('boat_class') for r in rows if r['report'].get('boat_class')))
    coaches=['none','uncoached']+sorted(set(c for r in rows for c in r.get('coaches',[])))
    for route in routes:
        for boat in boats:
            for coach in coaches:
                if (route,boat,coach)==('either','any','none'):continue
                selected={name:context_rows(rows,route,boat,coach,name) for name in ('launch','water')}
                if not any(len(set(r['outing_id'] for r in subset))>=100 for subset in selected.values()):continue
                if coach!='none':
                    # Require at least 20 outings and overlap with other coaching contexts.
                    own=context_rows(rows,'either','any',coach,'launch')
                    other=[r for r in rows if r not in own]
                    own_bins=Counter(int(r['weather']['wind']//5) for r in own if isinstance(r['weather'].get('wind'),(int,float)))
                    other_bins=Counter(int(r['weather']['wind']//5) for r in other if isinstance(r['weather'].get('wind'),(int,float)))
                    if len(set(r['outing_id'] for r in own))<20 or sum(min(n,other_bins[k]) for k,n in own_bins.items())<10:continue
                result['contextual']['|'.join((route,boat,coach))]={name:train_family(subset,name) for name,subset in selected.items()}
    return result

def train(rows):
    pooled=bundle(rows)
    # Every personal fit, including its contexts, starts from that user's own reports.
    personal={uid:bundle([r for r in rows if r['user_id']==uid]) for uid in sorted(set(r['user_id'] for r in rows))}
    eligible=any(pooled[name]['eligible'] for name in ('launch','water')) or any(m[name]['eligible'] for m in pooled['contextual'].values() for name in ('launch','water'))
    eligible=eligible or any(family[name]['eligible'] for family in personal.values() for name in ('launch','water'))
    return dict(version=VERSION,eligible=eligible,pooled=pooled,personal=personal,
                context='weather_with_optional_context',trained_through=max((r['starts_at'] for r in rows),default=None))

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('input');parser.add_argument('output');args=parser.parse_args()
    with open(args.input) as f: snapshot=json.load(f)
    rows=snapshot['rows'] if isinstance(snapshot,dict) else snapshot
    result=train(rows)
    result['dataset_revision']=snapshot.get('revision') if isinstance(snapshot,dict) else None
    with open(args.output,'w') as f:json.dump(result,f,indent=2,allow_nan=False)
    print(json.dumps({'outings':len(set(r['outing_id'] for r in rows)),'eligible':result['eligible'],'mode':'shadow'}))
