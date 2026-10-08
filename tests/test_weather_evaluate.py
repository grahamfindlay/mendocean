import sys
import unittest
from datetime import datetime, timezone, timedelta
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'scripts'))
from weather_evaluate import metric, analyze, outcome_conditions
from train import records

class WeatherEvaluationTests(unittest.TestCase):
    def test_missing_values_are_not_calm(self):
        self.assertEqual(metric([(None, 2), (float('nan'), 0)])['n'], 0)
        self.assertEqual(metric([(4, 2), (0, 0)])['bias'], 1)

    def test_forecast_vintages_and_missing_leads(self):
        start = datetime(2026, 10, 7, 12, tzinfo=timezone.utc)
        end = start + timedelta(hours=2)
        valid = start+timedelta(hours=1)
        row = dict(source='buoy', start=valid.isoformat(), end=(valid+timedelta(minutes=5)).isoformat(), observed_at=valid.isoformat(), received_at=(valid+timedelta(minutes=10)).isoformat(), wind=4, gust=None, temperature=60, direction=270, flags=[], stations=['buoy'])
        vintage = dict(fetched_at=start.isoformat(),quarter_hours=[dict(time=valid.isoformat(),wind=5,gust=8,temperature=60)])
        later = dict(fetched_at=(valid+timedelta(hours=1)).isoformat(),quarter_hours=[dict(time=valid.isoformat(),wind=100,gust=100,temperature=100)])
        result, _, _ = analyze([row],[vintage,later],[],start,end)
        self.assertEqual(result['forecast_leads']['1']['buoy']['wind']['bias'], 1)
        self.assertEqual(result['forecast_leads']['24']['buoy']['wind']['n'], 0)
        self.assertEqual(result['sources']['buoy']['missing_gusts'], 1)

    def test_retrospective_forecasts_do_not_train_advance_predictions(self):
        row = dict(outing_id='row',starts_at='2026-10-07T12:00Z',weather={'wind':5,'gust':8,'direction':270},report={'outcome':'rowed','rating':2})
        self.assertEqual(records([{**row,'source_kind':'historical_forecast'}],'launch'), [])
        self.assertEqual(len(records([{**row,'source_kind':'archived_forecast'}],'launch')),1)

    def test_outcome_summaries_weight_outings_and_exclude_retrospective_forecasts(self):
        def row(outing, wind, source='archived_forecast'):
            return dict(outing_id=outing, report={'outcome':'rowed','rating':2}, source_kind=source, forecast={'wind':wind}, measurements={'sources':[{'source':'buoy','bins':1,'wind':wind}]})
        result = outcome_conditions([row('a',2), row('a',4), row('b',9,'historical_forecast')])['rowed / rating 2']
        self.assertEqual(result['conditions']['buoy']['wind']['mean'],6)
        self.assertEqual(result['conditions']['archived_forecast']['wind']['mean'],3)
        self.assertEqual(result['outings'],2)

if __name__ == '__main__':
    unittest.main()
