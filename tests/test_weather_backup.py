import io
import json
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'scripts'))
from weather_backup import archive_objects


class WeatherBackupTests(unittest.TestCase):
    def test_nested_observations_forecasts_and_pagination(self):
        folders = {'': [{'name':'2026-10-07'}, {'name':'observations'}, {'name':'observation-bundles'}],
                   '2026-10-07': [{'name':'forecast.json.gz','id':'f'}],
                   'observations': [{'name':'buoy'}],
                   'observations/buoy': [{'name':'2026-10-07'}],
                   'observations/buoy/2026-10-07': [{'name':f'{i}.json.gz','id':str(i)} for i in range(5)],
                   'observation-bundles': [{'name':'2026-07-01'}],
                   'observation-bundles/2026-07-01': [{'name':'bundle.json.gz','id':'b'}]}
        def requester(path, payload):
            rows = folders[payload['prefix']]
            start=payload['offset']
            return io.StringIO(json.dumps(rows[start:start+payload['limit']]))
        files=set(archive_objects(requester,page_size=2))
        self.assertEqual(files, {'2026-10-07/forecast.json.gz','observation-bundles/2026-07-01/bundle.json.gz'} | {f'observations/buoy/2026-10-07/{i}.json.gz' for i in range(5)})

    def test_invalid_paths_do_not_enter_recovery_archive(self):
        def requester(path,payload):
            return io.StringIO('[{"name":"../private","id":"x"}]')
        with self.assertRaises(ValueError):
            list(archive_objects(requester))


if __name__ == '__main__':
    unittest.main()
