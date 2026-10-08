#!/usr/bin/env python3
"""Repeatable weather validation; never fits or publishes rowability thresholds.

Private inputs stay in memory. Output contains aggregate counts/metrics and weather
plots, never user identities, notes, credentials, or individual row reports.
"""
import argparse
import gzip
import json
import math
import os
import statistics as stats
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from jobs import call

UTC = timezone.utc
SOURCES = ('buoy', 'iem_msn', 'vc_jmp')

def parse(value):
    return datetime.fromisoformat(value.replace('Z', '+00:00'))

def metric(pairs):
    pairs = [(a, b) for a, b in pairs if isinstance(a, (int, float)) and isinstance(b, (int, float)) and math.isfinite(a) and math.isfinite(b)]
    if not pairs:
        return dict(n=0, bias=None, mae=None, correlation=None)
    a, b = zip(*pairs)
    va, vb = stats.pvariance(a), stats.pvariance(b)
    correlation = stats.mean((x-stats.mean(a))*(y-stats.mean(b)) for x, y in pairs)/math.sqrt(va*vb) if va and vb else None
    return dict(n=len(pairs), bias=stats.mean(x-y for x, y in pairs), mae=stats.mean(abs(x-y) for x, y in pairs), correlation=correlation)

def download(path):
    url = os.environ['SUPABASE_URL'].rstrip('/')+'/storage/v1/object/authenticated/weather-archive/'+urllib.parse.quote(path, safe='/')
    key = os.environ['SUPABASE_SERVICE_ROLE_KEY']
    request = urllib.request.Request(url, headers={'Authorization': 'Bearer '+key, 'apikey': key})
    with urllib.request.urlopen(request, timeout=45) as response:
        return json.loads(gzip.decompress(response.read()))

def window_value(rows, valid, field):
    start, end = valid-timedelta(minutes=7.5), valid+timedelta(minutes=7.5)
    values = [(r[field], max(0, (min(end, parse(r['end']))-max(start, parse(r['start']))).total_seconds())) for r in rows if r.get(field) is not None and parse(r['end']) > start and parse(r['start']) < end]
    if not values:
        return None
    if field == 'gust':
        return max(v for v, _ in values)
    return sum(v*w for v, w in values)/sum(w for _, w in values)

def outcome_conditions(reports):
    """Descriptive outcome strata; give each outing equal weight within a stratum."""
    groups = {}
    for row in reports:
        report = row.get('report', {})
        outcome = report.get('outcome')
        if outcome not in ('rowed', 'stayed_ashore', 'did_not_attend'):
            continue
        label = outcome + (f" / rating {report['rating']}" if report.get('rating') is not None else '')
        groups.setdefault(label, []).append(row)
    result = {}
    for label, group in groups.items():
        evidence = {}
        for row in group:
            forecast = row.get('forecast') or {}
            values = {s['source']: s for s in (row.get('measurements') or {}).get('sources', []) if s.get('bins', 0) > 0}
            if row.get('source_kind') == 'archived_forecast':
                values['archived_forecast'] = forecast
            for source, conditions in values.items():
                for field in ('wind', 'gust', 'temperature'):
                    value = conditions.get(field)
                    if isinstance(value, (int, float)) and math.isfinite(value):
                        evidence.setdefault((source,field), {}).setdefault(row['outing_id'], []).append(value)
        result[label] = dict(outings=len({r['outing_id'] for r in group}), reports=len(group), conditions={})
        for (source,field), outings in evidence.items():
            # Multiple reporters may use different intervals; average them within each outing first.
            values = [stats.mean(v) for v in outings.values()]
            result[label]['conditions'].setdefault(source, {})[field] = dict(outings=len(values), mean=stats.mean(values), minimum=min(values), maximum=max(values))
    return result

def analyze(rows, vintages, reports, start, end):
    rows = list({(r['source'], r['start']): r for r in rows if parse(r['end']) > start and parse(r['start']) < end}.values())
    by = {s: sorted((r for r in rows if r['source'] == s), key=lambda r: r['start']) for s in SOURCES}
    expected = math.ceil((end-start).total_seconds()/300)
    result = dict(start=start.isoformat(), end=end.isoformat(), sources={}, comparisons={}, forecast_leads={}, row_reports={})
    for source, rr in by.items():
        ages = [(parse(r['received_at'])-parse(r['observed_at'])).total_seconds()/60 for r in rr]
        combinations = {}
        for r in rr:
            key = '/'.join(sorted(r.get('stations', [])))
            combinations[key] = combinations.get(key, 0)+1
        result['sources'][source] = dict(bins=len(rr), expected_bins=expected, missing_bin_fraction=1-len(rr)/expected, missing_gusts=sum(r.get('gust') is None for r in rr), incomplete_samples=sum('incomplete_samples' in r.get('flags', []) for r in rr), suspicious_gusts=sum('gust_below_wind' in r.get('flags', []) for r in rr), median_delivery_minutes=stats.median(ages) if ages else None, max_delivery_minutes=max(ages) if ages else None, station_combinations=combinations)
    for first, second in [('buoy','iem_msn'), ('buoy','vc_jmp'), ('vc_jmp','iem_msn')]:
        other = {r['start']: r for r in by[second]}
        aligned = [(r, other[r['start']]) for r in by[first] if r['start'] in other]
        comparisons = {f: metric([(a.get(f),b.get(f)) for a,b in aligned]) for f in ['wind','gust','temperature']}
        comparisons['direction_mae_degrees'] = stats.mean(abs((a['direction']-b['direction']+180)%360-180) for a,b in aligned if a.get('direction') is not None and b.get('direction') is not None) if any(a.get('direction') is not None and b.get('direction') is not None for a,b in aligned) else None
        comparisons['wind_by_first_source_direction'] = {name: metric([(a.get('wind'),b.get('wind')) for a,b in aligned if a.get('direction') is not None and int((a['direction']+22.5)%360/45)==sector]) for sector,name in enumerate(['N','NE','E','SE','S','SW','W','NW'])}
        result['comparisons'][first+' minus '+second] = comparisons
    selected = {lead:{} for lead in [1,3,6,12,24]}
    for vintage in vintages:
        received = parse(vintage['fetched_at'])
        for hour in vintage.get('quarter_hours') or vintage.get('hours', []):
            valid = parse(hour['time'])
            if valid-timedelta(minutes=7.5) < start or valid+timedelta(minutes=7.5) > end:
                continue
            for lead in selected:
                distance = abs((valid-received).total_seconds()/3600-lead)
                prior = selected[lead].get(hour['time'])
                if distance <= .25 and (prior is None or distance < prior[0]):
                    selected[lead][hour['time']] = (distance,hour)
    common = set.intersection(*(set(v) for v in selected.values()))
    for lead, values in selected.items():
        score = {}
        for source in SOURCES:
            score[source] = {field: metric([(hour.get(field),window_value(by[source],parse(time),field)) for time,(_,hour) in values.items()]) for field in ['wind','gust','temperature']}
            score[source]['common_targets_wind'] = metric([(values[t][1].get('wind'),window_value(by[source],parse(t),'wind')) for t in common])
        result['forecast_leads'][str(lead)] = score
    # Outcomes are counted per outing, not inflated by multiple reporters.
    result['row_reports'] = dict(outings=len({r['outing_id'] for r in reports}), reports=len(reports), archived_forecast_reports=sum(r.get('source_kind')=='archived_forecast' for r in reports), enriched_reports=sum(bool(r.get('measurements')) for r in reports), measured_reports=sum(any(s.get('bins', 0) > 0 for s in (r.get('measurements') or {}).get('sources', [])) for r in reports))
    result['row_reports']['outcome_counts'] = {outcome:len({r['outing_id'] for r in reports if r.get('report',{}).get('outcome')==outcome}) for outcome in ['rowed','stayed_ashore','did_not_attend']}
    result['row_reports']['conditions_by_outcome_and_rating'] = outcome_conditions(reports)
    return result, by, selected

def figures(output, by, selected):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    import matplotlib.dates as dates
    from zoneinfo import ZoneInfo
    zone = ZoneInfo('America/Chicago')
    colors = dict(buoy='#197699', iem_msn='#bb602b', vc_jmp='#765ba4')
    fig, axes = plt.subplots(3,1,figsize=(12,10),sharex=True,layout='constrained')
    for ax, field, unit in zip(axes,['wind','temperature','direction'],['Wind (mph)','Temperature (°F)','Direction (degrees from north)']):
        for source, rows in by.items():
            rr = [r for r in rows if r.get(field) is not None and (field != 'direction' or (r.get('wind') or 0) >= 1)]
            ax.scatter([parse(r['start']).astimezone(zone) for r in rr],[r[field] for r in rr],s=4,label=source,color=colors[source])
        forecast = [h for _,h in selected[1].values() if h.get(field) is not None and (field != 'direction' or (h.get('wind') or 0) >= 1)]
        ax.scatter([parse(h['time']).astimezone(zone) for h in forecast],[h[field] for h in forecast],s=7,marker='x',color='black',label='Archived forecast about 1 hour ahead')
        ax.set_ylabel(unit); ax.grid(alpha=.2)
        if field=='direction':
            ax.set_ylim(0,360);ax.set_yticks([0,90,180,270,360],['N','E','S','W','N'])
    axes[0].legend(ncol=2);axes[-1].xaxis.set_major_formatter(dates.DateFormatter('%m-%d %H:%M',tz=zone));axes[-1].set_xlabel('Time in America/Chicago · Observations: UW SSEC, IEM, Visual Crossing · Forecast: Open-Meteo')
    fig.savefig(output/'conditions.png',dpi=160);fig.savefig(output/'conditions.pdf');plt.close(fig)

def run(start, end, output):
    exported = call({'action':'weather-export','start':start.isoformat(),'end':end.isoformat()})
    rows = exported['observations']['rows']
    with ThreadPoolExecutor(max_workers=4) as pool:
        for bundle in pool.map(download, exported['observations']['bundles']):
            rows.extend(bundle['rows'])
        vintages = []
        for archived in pool.map(download, [v['object_path'] for v in exported['forecasts']]):
            vintages.append(archived.get('forecast',archived))
    result, by, selected = analyze(rows,vintages,exported['reports'],start,end)
    output.mkdir(parents=True,exist_ok=True)
    (output/'metrics.json').write_text(json.dumps(result,indent=2)+'\n')
    figures(output,by,selected)
    lines = ['# Mendocean weather evaluation', '',f'Window: {start.isoformat()} through {end.isoformat()}.', '',
             'This report describes weather relationships; it does not train or publish thresholds.', '',
             '| Source | Available / expected five-minute bins | Median delivery delay (min) | Missing gusts |',
             '|---|---:|---:|---:|']
    for source,s in result['sources'].items():
        lines.append(f"| {source} | {s['bins']} / {s['expected_bins']} | {s['median_delivery_minutes']} | {s['missing_gusts']} |")
    lines.extend(['','![Observed and forecast wind, temperature and direction](conditions.png)','',
                  'See metrics.json for wind/temperature/gust bias, MAE, correlations, circular direction differences, direction sectors, station combinations, missingness, delivery delays, forecast lead times, row-report coverage and descriptive conditions grouped by outcome/rating. Each outing receives equal weight within an outcome/rating group; mixed reports may place an outing in multiple groups. Historical fallback forecasts are excluded from those forecast summaries.', '',
                  'Limits: sources use different averaging definitions and locations. Airport and VC bins contain point reports. Forecast scoring uses weighted five-minute summaries overlapping centered 15-minute windows, including partial boundary bins. All lead times additionally use common valid targets. Serially related readings are not independent evidence. Sparse sectors/outcomes cannot establish rowability. Delivery delay reflects recorded availability, not a provider SLA. Later forecast vintages never fill missing earlier forecasts. Raw data remains in private archives.', '',
                  'Review whether default VC adds useful information across directions and row outcomes. Outcome summaries are descriptive and cannot establish a threshold; held-out forecast-to-rowability validation remains a separate shadow-training review.', '',
                  'Weather data: [UW SSEC](https://metobs.ssec.wisc.edu/), [Iowa Environmental Mesonet](https://mesonet.agron.iastate.edu/), [Visual Crossing](https://www.visualcrossing.com/). Forecasts: [Open-Meteo](https://open-meteo.com/).'])
    (output/'report.md').write_text('\n'.join(lines)+'\n')
    print('Weather evaluation saved; no model or production settings changed.')

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--start');parser.add_argument('--end');parser.add_argument('--out',default='weather-evaluation')
    parser.add_argument('--vc-trial-days',type=int)
    args = parser.parse_args()
    if args.vc_trial_days is not None:
        if not 0 <= args.vc_trial_days <= 60:
            parser.error('Trial duration must be 0–60 days.')
        call({'action':'weather-vc-trial','days':args.vc_trial_days})
        print('VC trial duration updated; 0 stops collection.')
    else:
        end = parse(args.end) if args.end else datetime.now(UTC).replace(hour=0,minute=0,second=0,microsecond=0)
        start = parse(args.start) if args.start else end-timedelta(days=7)
        if not timedelta(0) < end-start <= timedelta(days=14):
            parser.error('Evaluation window must be greater than zero and no longer than 14 days.')
        try:
            run(start,end,Path(args.out))
        except Exception:
            # Provider exceptions may carry URLs or credentials. Preserve only a fixed public failure.
            raise SystemExit('Weather evaluation failed. Check credentials, archive availability, and dependencies; no private exception was logged.')
