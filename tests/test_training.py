import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from train import records, split, train, features, context_rows

def row(outing,user='a',outcome='rowed',reason=None):
 return {'outing_id':outing,'user_id':user,'starts_at':'2026-09-10T12:00:00Z','weather':{'wind':7,'direction':180,'gust':10,'preceding':[]},'report':{'outcome':outcome,'reason':reason,'rating':2}}
class TrainingTests(unittest.TestCase):
 def test_one_total_weight_per_outing(self):
  data=records([row('1','a'),row('1','b'),row('2')],'launch')
  self.assertEqual(sum(r['weight'] for r in data if r['outing']=='1'),1)
 def test_excludes_absences_and_nonweather_cancellations(self):
  data=records([row('1',outcome='did_not_attend'),row('2',outcome='stayed_ashore',reason='non_weather'),row('3',outcome='stayed_ashore',reason='wind_waves')],'launch')
  self.assertEqual([r['outing'] for r in data],['3'])
 def test_keeps_calendar_days_together(self):
  rows=[{'day':f'2026-09-{d:02}','outing':f'{d}-{j}'} for d in range(1,21) for j in range(2)]
  a,b=split(rows);self.assertFalse(set(r['day'] for r in a)&set(r['day'] for r in b))
 def test_personal_data_does_not_borrow_other_users(self):
  artifact=train([row('1','a'),row('2','b'),row('3','b')])
  self.assertEqual(artifact['personal']['a']['launch']['outings'],1)
  self.assertFalse(artifact['eligible'])
 def test_actual_boat_is_not_a_predictor(self):
  a=row('1');b=row('1');b['report']['launched_boats']=['8+']
  self.assertEqual(records([a],'launch')[0]['x'],records([b],'launch')[0]['x'])
 def test_missing_wind_does_not_train_as_calm(self):
  self.assertIsNone(features({'wind':None,'direction':1}))
 def test_both_route_rating_is_not_duplicated(self):
  r=row('1');r['report']['route']='both'
  self.assertEqual(context_rows([r],'east','any','none','water'),[])
  r['report']['segments']=[{'route':'east','rating':4}]
  self.assertEqual(context_rows([r],'east','any','none','water')[0]['report']['rating'],4)
 def test_launch_context_uses_planned_boat(self):
  r=row('1');r['planned_boat']='2x';r['report']['boat_class']='8+'
  self.assertEqual(len(context_rows([r],'either','2x','none','launch')),1)
  self.assertEqual(context_rows([r],'either','8+','none','launch'),[])
if __name__=='__main__':unittest.main()
