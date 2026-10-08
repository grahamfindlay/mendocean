#!/usr/bin/env python3
"""Immutable weather snapshots for the 24-hour Mendota provider comparison.

Standard library only. Keys stay in the environment or .env.weather-study.local.
The scheduler invokes `sample`; this script does not install an OS scheduler.
"""
import argparse
import concurrent.futures
import csv
import datetime as dt
import gzip
import itertools
import json
import math
import os
from pathlib import Path
import re
import statistics as stats
import urllib.error
import urllib.parse
import urllib.request
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
DEFAULT = ROOT / 'data/weather-studies/mendota-2026-10-07'
UTC = dt.timezone.utc
SOURCES = ['buoy', 'vc_jmp', 'vc_jmp_msn', 'vc_msn', 'iem_msn']
JMP = '43.0814,-89.3829'
MPH_MS = 2.2369362920544
MPH_KT = 1.1507794480235


def now():
    return dt.datetime.now(UTC)


def iso(t):
    return t.isoformat().replace('+00:00', 'Z')


def parse(t):
    return dt.datetime.fromisoformat(str(t).replace('Z', '+00:00')).astimezone(UTC)


def write_json(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('x') as f:
        json.dump(obj, f, indent=2, allow_nan=False)


def read_json(path):
    opener = gzip.open if path.suffix == '.gz' else open
    with opener(path, 'rt') as f:
        return json.load(f)


def archive(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(path, 'xt') as f:
        json.dump(obj, f, allow_nan=False)


def key():
    value = os.environ.get('VISUAL_CROSSING_API_KEY')
    p = ROOT / '.env.weather-study.local'
    if not value and p.exists():
        for line in p.read_text().splitlines():
            match = re.match(r'\s*(?:export\s+)?VISUAL_CROSSING_API_KEY\s*=\s*(.*?)\s*$', line)
            if match:
                value = match[1].strip('"\'')
    return value


def request(source, base, params, secret=None):
    started = now()
    public_params = {k: v for k, v in params.items() if k != 'key'}
    url = base + '?' + urllib.parse.urlencode(params)
    result = dict(source=source, requested_at=iso(started), endpoint=base,
                  parameters=public_params, transport='api')
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mendocean-weather-study/1.0'})
        with urllib.request.urlopen(req, timeout=25) as response:
            body = response.read().decode('utf-8')
            result.update(http_status=response.status,
                          response_headers={k: response.headers.get(k) for k in ['Date', 'Last-Modified', 'ETag']},
                          data=json.loads(body))
        if source == 'buoy' and result['data'].get('code') != 200:
            raise ValueError('Buoy API returned unsuccessful status')
        if source.startswith('vc_'):
            current = result['data'].get('currentConditions')
            if not current or not current.get('datetimeEpoch'):
                raise ValueError('VC returned no timestamped current conditions')
            if source in ['vc_jmp_msn', 'vc_msn'] and current.get('stations') != ['KMSN']:
                result['validation_error'] = 'MSN-only request did not return exactly KMSN; excluded from restricted comparison'
    except urllib.error.HTTPError as e:
        result.update(http_status=e.code, error=f'HTTP {e.code}')
    except Exception as e:
        message = str(e).replace(secret, '[redacted]') if secret else str(e)
        result['error'] = message
    result['received_at'] = iso(now())
    return result


def forecast_request():
    # Read the actual app URL builder, avoiding a second, drifting forecast definition.
    text = (ROOT / 'shared/weather.ts').read_text()
    domain = (ROOT / 'shared/domain.ts').read_text()
    location = re.search(r'export const LOCATION\s*=\s*\{(.*?)\}', domain, re.S).group(1)
    params = dict(re.findall(r'(\w+):\s*"([^"]*)"', text.split('return `https:')[0]))
    for coord in ['latitude', 'longitude']:
        params[coord] = re.search(coord + r':\s*([\d.-]+)', location).group(1)
    return request('open_meteo_forecast', 'https://api.open-meteo.com/v1/forecast', params)


def sample(study):
    manifest = read_json(study / 'manifest.json')
    t = now()
    if t > parse(manifest['end_utc']):
        print(json.dumps({'state': 'window_ended', 'end_utc': manifest['end_utc'], 'next': 'analyze'}))
        return
    slot = int((t - parse(manifest['start_utc'])).total_seconds() // 900)
    # Repeated scheduler turns do not issue duplicate paid/provider queries within one slot.
    for p in (study / 'snapshots').glob('*/run.json'):
        previous = read_json(p)
        if previous['slot'] == slot and all(previous['outcomes'].get(s) == 'ok' for s in ['open_meteo_forecast', 'buoy', 'iem_msn', 'iem_history']):
            print(json.dumps({'state': 'already_sampled', 'snapshot': str(p.parent)}))
            return
    batch = study / 'snapshots' / t.strftime('%Y%m%dT%H%M%S.%fZ')
    batch.mkdir(parents=True)
    calls = {'open_meteo_forecast': forecast_request,
             'buoy': lambda: request('buoy', 'https://metobs.ssec.wisc.edu/api/data.json',
                                     dict(site='mendota', inst='buoy', symbols='air_temp:wind_speed:wind_direction:gust:run_wind_speed', begin='-00:30:00', order='row')),
             'iem_msn': lambda: request('iem_msn', 'https://mesonet.agron.iastate.edu/json/current.py', dict(station='MSN', network='WI_ASOS')),
             'iem_history': lambda: request('iem_history', 'https://mesonet.agron.iastate.edu/api/1/obhistory.json',
                                           dict(station='MSN', network='WI_ASOS', date=t.astimezone(ZoneInfo('America/Chicago')).date().isoformat(), full='true'))}
    vc_key = key()
    if vc_key:
        for source, location in [('vc_jmp', JMP), ('vc_jmp_msn', JMP), ('vc_msn', 'stn:KMSN')]:
            params = dict(unitGroup='us', include='current', contentType='json', key=vc_key, options='useobs')
            if source != 'vc_jmp':
                params.update(maxDistance='8047', maxStations='1', options='stnslevel1,useobs')
            base = 'https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/' + urllib.parse.quote(location, safe='')
            calls[source] = lambda s=source, b=base, p=params: request(s, b, p, vc_key)
    outcomes = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=7) as pool:
        futures = {pool.submit(fn): name for name, fn in calls.items()}
        for future in concurrent.futures.as_completed(futures):
            name = futures[future]
            try:
                payload = future.result()
            except Exception as e:
                payload = dict(source=name, received_at=iso(now()), error=str(e))
            archive(batch / (name + '.json.gz'), payload)
            outcomes[name] = payload.get('error') or payload.get('validation_error') or 'ok'
    for source in SOURCES:
        outcomes.setdefault(source, 'needs_public_query_builder_capture')
    write_json(batch / 'run.json', dict(slot=slot, started_at=iso(t), ended_at=iso(now()), outcomes=outcomes))
    print(json.dumps(dict(state='sampled', snapshot=str(batch), outcomes=outcomes)))


def ingest(study, file, snapshot):
    """UI captures use the same public VC schema plus the literal displayed table."""
    captures = read_json(Path(file))
    batch = Path(snapshot) if snapshot else sorted((study / 'snapshots').glob('*/run.json'))[-1].parent
    for source, payload in captures.items():
        if source not in ['vc_jmp', 'vc_jmp_msn', 'vc_msn']:
            raise ValueError('Unknown VC source')
        data = payload['data']
        current = data['currentConditions']
        if not current.get('datetimeEpoch'):
            raise ValueError('VC capture requires exact observation timestamp')
        if source != 'vc_jmp' and current.get('stations') != ['KMSN']:
            raise ValueError('Restricted capture must visibly report exactly KMSN')
        archive(batch / (source + '.ui.json.gz'), dict(source=source, transport='public_query_builder', **payload))
    print(json.dumps({'state': 'ingested', 'snapshot': str(batch), 'sources': list(captures)}))


def backfill(study):
    """Recover station reports delayed at the end; never reconstruct forecast vintages."""
    manifest = read_json(study / 'manifest.json')
    start, end = parse(manifest['start_utc']), min(now(), parse(manifest['end_utc']))
    batch = study / 'backfills' / now().strftime('%Y%m%dT%H%M%S.%fZ')
    calls = [('buoy', 'https://metobs.ssec.wisc.edu/api/data.json',
              dict(site='mendota', inst='buoy', symbols='air_temp:wind_speed:wind_direction:gust:run_wind_speed',
                   begin=start.strftime('%Y-%m-%dT%H:%M:%S'), end=end.strftime('%Y-%m-%dT%H:%M:%S'), order='row'))]
    day = start.astimezone(ZoneInfo('America/Chicago')).date()
    last = end.astimezone(ZoneInfo('America/Chicago')).date()
    while day <= last:
        calls.append(('iem_history', 'https://mesonet.agron.iastate.edu/api/1/obhistory.json',
                      dict(station='MSN', network='WI_ASOS', date=day.isoformat(), full='true')))
        day += dt.timedelta(days=1)
    for i, (source, base, params) in enumerate(calls):
        payload = request(source, base, params)
        payload['transport'] = 'retrospective_backfill'
        archive(batch / f'{source}-{i}.json.gz', payload)
        print(json.dumps(dict(source=source, outcome=payload.get('error') or 'ok')))


def number(v):
    try:
        return float(v) if v is not None and math.isfinite(float(v)) else None
    except (ValueError, TypeError):
        return None


def multiply(v, factor):
    return None if number(v) is None else float(v) * factor


def observations(study):
    rows = []
    vintages = []
    health = []
    files = list((study / 'snapshots').glob('*/*.json.gz')) + list((study / 'backfills').glob('*/*.json.gz'))
    for path in sorted(files):
        payload = read_json(path)
        source = payload['source']
        received = payload.get('received_at', payload.get('requested_at'))
        health.append(dict(source=source, received_at=received, error=payload.get('error') or payload.get('validation_error'),
                           transport=payload.get('transport'), raw_file=str(path)))
        if payload.get('error') or payload.get('validation_error'):
            continue
        data = payload['data']

        def add(time, wind, gust, direction, temp, averaging, **extra):
            rows.append(dict(source=source if source != 'iem_history' else 'iem_msn', observed_at=iso(time),
                             received_at=received, wind_mph=number(wind), gust_mph=number(gust), direction_deg=number(direction),
                             temperature_f=number(temp), averaging=averaging, raw_file=str(path), collection_kind=payload.get('transport'), **extra))

        if source == 'buoy':
            result = data['results']
            for timestamp, values in zip(result['timestamps'], result['data']):
                v = dict(zip(result['symbols'], values))
                add(parse(timestamp), multiply(v.get('run_wind_speed'), MPH_MS), multiply(v.get('gust'), MPH_MS),
                    v.get('wind_direction'), None if number(v.get('air_temp')) is None else float(v['air_temp']) * 1.8 + 32,
                    'wind: trailing 2-minute mean; gust: trailing 2-minute maximum; direction: instantaneous',
                    instantaneous_wind_mph=multiply(v.get('wind_speed'), MPH_MS))
        elif source in ['iem_msn', 'iem_history']:
            records = [data['last_ob']] if source == 'iem_msn' else data['data']
            for v in records:
                raw = v.get('raw', v.get('metar')) or ''
                wind = v.get('windspeed[kt]', v.get('sknt'))
                direction = v.get('winddirection[deg]', v.get('drct'))
                temp = v.get('airtemp[F]', v.get('tmpf'))
                gust = v.get('gust')
                wind_match = re.search(r'(?:^|\s)(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?KT', raw)
                if gust is None and wind_match and wind_match[3]:
                    gust = float(wind_match[3])
                temp_match = re.search(r'\bT([01])(\d{3})([01])(\d{3})\b', raw)
                derived_temp = temp is None and bool(temp_match)
                if derived_temp:
                    celsius = int(temp_match[2])/10 * (-1 if temp_match[1] == '1' else 1)
                    temp = celsius * 1.8 + 32
                add(parse(v['utc_valid']), multiply(wind, MPH_KT), multiply(gust, MPH_KT), direction, temp,
                    'ASOS/METAR report; retain report type', metar=raw, report_type='MADISHF_5min' if 'MADISHF' in raw else 'METAR',
                    series=source, temperature_derived_from_metar=derived_temp)
        elif source.startswith('vc_'):
            v = data['currentConditions']
            add(dt.datetime.fromtimestamp(v['datetimeEpoch'], UTC), v.get('windspeed'), v.get('windgust'), v.get('winddir'), v.get('temp'),
                'provider current conditions; averaging not specified', stations=v.get('stations'))
        elif source == 'open_meteo_forecast':
            vintages.append(payload)
    return rows, vintages, health


def unique(rows, start, end):
    values = {}
    for row in rows:
        if not start <= parse(row['observed_at']) <= end:
            continue
        k = (row['source'], row['observed_at'])
        # Keep the most complete version of the observation; flag revisions separately.
        score = sum(row.get(x) is not None for x in ['wind_mph', 'gust_mph', 'direction_deg', 'temperature_f'])
        rank = (score, row['received_at'] or '')
        if k not in values or rank >= values[k][0]:
            values[k] = (rank, row)
    return sorted([v[1] for v in values.values()], key=lambda r: (r['observed_at'], r['source']))


def metrics(pairs, circular=False):
    if not pairs:
        return {'n': 0}
    diffs = [((a - b + 180) % 360 - 180) if circular else a - b for a, b in pairs]
    result = dict(n=len(pairs), bias=stats.mean(diffs), mae=stats.mean(map(abs, diffs)), rmse=math.sqrt(stats.mean(x*x for x in diffs)))
    if not circular and len(pairs) > 2 and stats.pstdev(a for a, b in pairs) > 0 and stats.pstdev(b for a, b in pairs) > 0:
        mean_a, mean_b = stats.mean(a for a,b in pairs), stats.mean(b for a,b in pairs)
        covariance = sum((a-mean_a)*(b-mean_b) for a,b in pairs)
        ss_a = sum((a-mean_a)**2 for a,b in pairs)
        ss_b = sum((b-mean_b)**2 for a,b in pairs)
        result['correlation'] = covariance / math.sqrt(ss_a*ss_b)
        slope = covariance / ss_b
        intercept = mean_a - slope*mean_b
        result['fit_a_from_b'] = dict(slope=slope, intercept=intercept)
    return result


def matched(a, b, tolerance=120):
    candidates = []
    for x in a:
        for y in b:
            gap = abs((parse(x['observed_at']) - parse(y['observed_at'])).total_seconds())
            if gap <= tolerance:
                candidates.append((gap, x, y))
    used_a, used_b, result = set(), set(), []
    for gap, x, y in sorted(candidates, key=lambda p: p[0]):
        ax, by = x['observed_at'], y['observed_at']
        if ax not in used_a and by not in used_b:
            result.append((x, y, gap))
            used_a.add(ax)
            used_b.add(by)
    return result


def analyze(study):
    manifest = read_json(study / 'manifest.json')
    start, end = parse(manifest['start_utc']), min(now(), parse(manifest['end_utc']))
    raw_rows, vintages, health = observations(study)
    rows = unique(raw_rows, start, end)
    by_source = {s: [r for r in rows if r['source'] == s] for s in SOURCES}
    freshness = {}
    for s in SOURCES:
        readings = [r for r in raw_rows if r['source'] == s and r['received_at'] and start <= parse(r['received_at'])
                    and r.get('collection_kind') != 'retrospective_backfill']
        latest_by_capture = {}
        for r in readings:
            if r['received_at']:
                capture = str(Path(r['raw_file']).parent)
                existing = latest_by_capture.get(capture)
                if not existing or parse(r['observed_at']) > existing[1]:
                    latest_by_capture[capture] = (parse(r['received_at']), parse(r['observed_at']))
        ages = [(k-v).total_seconds()/60 for k,v in latest_by_capture.values()]
        freshness[s] = dict(unique_observations=len(by_source[s]), captures=len(latest_by_capture),
                            median_age_minutes=stats.median(ages) if ages else None, max_age_minutes=max(ages) if ages else None,
                            missing_gust=sum(r['gust_mph'] is None for r in by_source[s]),
                            gust_below_wind=sum(r['gust_mph'] is not None and r['wind_mph'] is not None and r['gust_mph'] < r['wind_mph'] for r in by_source[s]))
    comparisons = []
    for a, b in itertools.combinations(SOURCES, 2):
        paired = matched(by_source[a], by_source[b])
        result = dict(a=a, b=b, sign='a minus b', tolerance_seconds=120, paired_times=len(paired),
                      median_time_gap_seconds=stats.median(p[2] for p in paired) if paired else None)
        for field in ['wind_mph', 'gust_mph', 'temperature_f', 'direction_deg']:
            values = [(x[field], y[field]) for x,y,gap in paired if x[field] is not None and y[field] is not None
                      and (field != 'direction_deg' or (x['wind_mph'] or 0) >= 1 and (y['wind_mph'] or 0) >= 1)]
            result[field] = metrics(values, field == 'direction_deg')
        result['exact_equal_wind'] = sum(x['wind_mph'] == y['wind_mph'] for x,y,g in paired if x['wind_mph'] is not None and y['wind_mph'] is not None)
        direction_groups = {}
        for sector, label in enumerate(['N','NE','E','SE','S','SW','W','NW']):
            values = [(x['wind_mph'], y['wind_mph']) for x,y,g in paired
                      if x['wind_mph'] is not None and y['wind_mph'] is not None and y['direction_deg'] is not None
                      and y['wind_mph'] >= 1 and int((y['direction_deg']+22.5)%360//45) == sector]
            direction_groups[label] = metrics(values)
        result['wind_by_b_direction'] = direction_groups
        result['wind_by_b_speed'] = {label: metrics([(x['wind_mph'],y['wind_mph']) for x,y,g in paired
                                                  if x['wind_mph'] is not None and y['wind_mph'] is not None and low <= y['wind_mph'] < high])
                                     for label,low,high in [('0-5',0,5),('5-10',5,10),('10-15',10,15),('15+',15,float('inf'))]}
        vectors = []
        for x,y,g in paired:
            if all(r['wind_mph'] is not None and r['direction_deg'] is not None for r in [x,y]):
                u = lambda r: -r['wind_mph']*math.sin(math.radians(r['direction_deg']))
                v = lambda r: -r['wind_mph']*math.cos(math.radians(r['direction_deg']))
                vectors.append(math.hypot(u(x)-u(y),v(x)-v(y)))
        result['mean_wind_vector_difference_mph'] = stats.mean(vectors) if vectors else None
        comparisons.append(result)
    # Score each valid-time once per nominal lead against observations available in the study.
    # Choose forecast vintage closest to 1/3/6/12/24 hours before the target (within 15 minutes).
    selected = {}
    for vintage in vintages:
        issued = parse(vintage['received_at'])  # availability proxy, not model issuance time
        hourly = vintage['data'].get('minutely_15') or vintage['data']['hourly']
        for i, target in enumerate(hourly.get('time', [])):
            valid = dt.datetime.fromtimestamp(target, UTC)
            if not start <= valid <= end or valid <= issued:
                continue
            lead = (valid-issued).total_seconds()/3600
            for nominal in [1,3,6,12,24]:
                distance = abs(lead-nominal)
                k = (target, nominal)
                if distance <= 0.25 and (k not in selected or distance < selected[k][0]):
                    values = {out: number(hourly.get(inp, [None]*len(hourly['time']))[i]) for out, inp in
                              [('wind_mph','wind_speed_10m'), ('gust_mph','wind_gusts_10m'), ('temperature_f','temperature_2m'), ('direction_deg','wind_direction_10m')]}
                    selected[k] = (distance, valid, values, issued)
    forecast_scores = []
    for nominal in [1,3,6,12,24]:
        for source in SOURCES:
            pairs = {f: [] for f in ['wind_mph','gust_mph','temperature_f','direction_deg']}
            for (target, lead), (_, valid, predicted, issued) in selected.items():
                if lead != nominal:
                    continue
                # Do not score a truncated observation window at a study boundary.
                if valid - dt.timedelta(seconds=450) < start or valid + dt.timedelta(seconds=450) > end:
                    continue
                window = [r for r in by_source[source] if abs((parse(r['observed_at'])-valid).total_seconds()) <= 450]
                if not window:
                    continue
                actual = {}
                for field in pairs:
                    measured = [r[field] for r in window if r[field] is not None
                                and (field != 'direction_deg' or (r['wind_mph'] or 0) >= 1)]
                    if not measured:
                        actual[field] = None
                    elif field == 'direction_deg':
                        actual[field] = math.degrees(math.atan2(stats.mean(math.sin(math.radians(x)) for x in measured), stats.mean(math.cos(math.radians(x)) for x in measured))) % 360
                    elif field == 'gust_mph':
                        actual[field] = max(measured)
                    else:
                        actual[field] = stats.mean(measured)
                for field in pairs:
                    if predicted[field] is not None and actual[field] is not None and (field != 'direction_deg' or min(predicted['wind_mph'] or 0, actual['wind_mph'] or 0) >= 1):
                        pairs[field].append((predicted[field], actual[field]))
            forecast_scores.append(dict(source=source, nominal_lead_hours=nominal, sign='forecast minus observation',
                                        **{f: metrics(pairs[f], f=='direction_deg') for f in pairs}))
    runs = [read_json(p) for p in (study / 'snapshots').glob('*/run.json')]
    expected = min(96, int((end-start).total_seconds()//900)+1)
    slot_by_batch = {str(p.parent): read_json(p)['slot'] for p in (study / 'snapshots').glob('*/run.json')}
    coverage = {}
    for source in SOURCES + ['open_meteo_forecast']:
        captured = {slot_by_batch[str(Path(h['raw_file']).parent)] for h in health
                    if h['source'] == source and not h['error'] and str(Path(h['raw_file']).parent) in slot_by_batch}
        coverage[source] = dict(captured_slots=len(captured), missing_slots=sorted(set(range(expected))-captured))
    report = dict(window_start_utc=iso(start), window_end_utc=iso(end), generated_at=iso(now()),
                  complete_window=now() >= parse(manifest['end_utc']), expected_slots=expected, recorded_slots=len({r['slot'] for r in runs}),
                  forecast_vintages=len(vintages), coverage=coverage, freshness=freshness, observation_comparisons=comparisons,
                  forecast_comparisons=forecast_scores, collection_errors=[h for h in health if h['error']],
                  limitations=['Single 24-hour window cannot establish general rowability thresholds or seasonal calibration.',
                               'Forecast fetched/received time is an availability proxy, not a decision time or model issuance time.',
                               'Pairwise comparison uses unique timestamps and one-to-one nearest matches within 2 minutes.',
                               'Forecast scoring uses centered 15-minute observation windows: mean sustained wind/temperature, maximum reported gust, circular mean direction.',
                               'The averaging periods differ between providers. Missing gusts remain missing.',
                               'Short-lead evaluations overlap in time; sample counts do not imply independent statistical trials.'])
    output = study / 'analysis'
    output.mkdir(exist_ok=True)
    (output / 'metrics.json').write_text(json.dumps(report, indent=2, allow_nan=False))
    fields = ['source','observed_at','received_at','wind_mph','gust_mph','direction_deg','temperature_f','instantaneous_wind_mph','averaging','stations','metar','report_type','series','temperature_derived_from_metar','collection_kind','raw_file']
    with (output / 'observations.csv').open('w') as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)
    lines = ['# Mendota 24-hour weather comparison', '', f"Window: {iso(start)} to {iso(end)}.",
             f"Recorded {report['recorded_slots']} of {expected} expected collection slots; {len(vintages)} forecast vintages.", '',
             '| Source | Unique observations | Captures | Median age (min) | Missing gusts |', '|---|---:|---:|---:|---:|']
    for s, v in freshness.items():
        lines.append(f"| {s} | {v['unique_observations']} | {v['captures']} | {v['median_age_minutes']} | {v['missing_gust']} |")
    lines += ['', 'Wind comparisons use a minus b, in mph. Only readings within two minutes are paired.', '',
              '| a | b | Pairs | Bias | MAE | RMSE | Correlation |', '|---|---|---:|---:|---:|---:|---:|']
    for c in comparisons:
        m = c['wind_mph']
        fmt = lambda k: f"{m[k]:.2f}" if k in m else '—'
        lines.append(f"| {c['a']} | {c['b']} | {m['n']} | {fmt('bias')} | {fmt('mae')} | {fmt('rmse')} | {fmt('correlation')} |")
    lines += ['', 'Forecast errors use forecast minus observation, in mph.', '',
              '| Observation source | Lead (hours) | Pairs | Wind bias | Wind MAE |', '|---|---:|---:|---:|---:|']
    for c in forecast_scores:
        m = c['wind_mph']
        lines.append(f"| {c['source']} | {c['nominal_lead_hours']} | {m['n']} | {m.get('bias', '—')} | {m.get('mae', '—')} |")
    lines += ['', '## Interpretation limits', ''] + ['- ' + x for x in report['limitations']]
    (output / 'report.md').write_text('\n'.join(lines)+'\n')
    print(json.dumps({'state': 'analyzed', 'report': str(output / 'report.md'), 'metrics': str(output / 'metrics.json'),
                      'recorded_slots': report['recorded_slots'], 'forecast_vintages': len(vintages), 'sources': freshness}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['init','sample','ingest-vc','backfill','status','analyze'])
    parser.add_argument('--study', type=Path, default=DEFAULT)
    parser.add_argument('--vc-file')
    parser.add_argument('--snapshot')
    args = parser.parse_args()
    if args.command == 'init':
        t = now()
        write_json(args.study / 'manifest.json', dict(start_utc=iso(t), end_utc=iso(t+dt.timedelta(hours=24)),
                    cadence_minutes=15, location=JMP, sources=SOURCES, forecast_provider='Open-Meteo, app request',
                    forecast_file='shared/weather.ts', forecast_time_convention='response received time; preserve each vintage',
                    vc_msn_restriction=dict(location=JMP, maxDistance=8047, maxStations=1, options='stnslevel1,useobs', required_current_stations=['KMSN']),
                    collector_host='local Codex heartbeat; machine and Codex must remain running'))
        print((args.study / 'manifest.json').read_text())
    elif args.command == 'sample':
        sample(args.study)
    elif args.command == 'ingest-vc':
        if not args.vc_file:
            parser.error('--vc-file required')
        ingest(args.study, args.vc_file, args.snapshot)
    elif args.command == 'analyze':
        analyze(args.study)
    elif args.command == 'backfill':
        backfill(args.study)
    else:
        manifest = read_json(args.study / 'manifest.json')
        runs = sorted((args.study / 'snapshots').glob('*/run.json'))
        print(json.dumps(dict(manifest=manifest, vc_api_key_available=bool(key()), samples=len(runs),
                              latest=str(runs[-1].parent) if runs else None), indent=2))


if __name__ == '__main__':
    main()
