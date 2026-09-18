"""Resume a separately granted sample before varied synthetic history growth."""
from pathlib import Path
import json, subprocess, secrets, os, time
root=Path(__file__).resolve().parents[2]/'.convex/query-evaluation/workspace'
credential=root.parent/'diverse-credentials.json'
env=dict(os.environ)
for key in ['CONVEX_DEPLOYMENT','CONVEX_DEPLOY_KEY','CONVEX_SELF_HOSTED_URL','CONVEX_SELF_HOSTED_ADMIN_KEY']:env.pop(key,None)
for line in (root/'.env.local').read_text().splitlines():
 if '=' in line:
  key,value=line.split('=',1);env[key]=value
if env.get('CONVEX_SELF_HOSTED_URL')!='http://127.0.0.1:3340':raise RuntimeError('Refusing non-evaluation backend')
def run(name,args):
 for attempt in range(6):
  result=subprocess.run([str(root/'node_modules/.bin/convex'),'run',name,json.dumps(args)],cwd=root,env=env,capture_output=True,text=True)
  if result.returncode==0:return json.loads(result.stdout)
  message=result.stderr.replace(args.get('token','NO_TOKEN'), '[redacted]')
  if attempt==5 or not any(word in message.lower() for word in ['timed out','timeout','execution time','concurrency']):raise RuntimeError(message)
  time.sleep(1)
if credential.exists():
 data=json.loads(credential.read_text())
else:
 token='lor_at_'+secrets.token_urlsafe(32)
 data=run('evaluationFixture:initializeResumable',{'token':token});data['token']=token
 credential.write_text(json.dumps(data));credential.chmod(0o600)
if not data.get('seedComplete'):
 for month in range(9):
  result=run('sampleData:populateMonthForOwner',{'userId':data['userId'],'datasetId':data['datasetId'],'monthIndex':month})
  data['nextMonth']=result['nextMonth'];credential.write_text(json.dumps(data));print(f'Varied fixture sample month {month+1}/9 ready',flush=True)
 data['seedComplete']=True;credential.write_text(json.dumps(data))
print('Separate varied fixture provisioned')
