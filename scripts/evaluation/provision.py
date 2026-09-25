"""Provision fictional records and a private grant only in the isolated backend."""
from pathlib import Path
import json,subprocess,secrets,os
root=Path(__file__).resolve().parents[2]/'.convex/query-evaluation/workspace'
credential=root.parent/'credentials.json'
if credential.exists():
 print('Evaluation credentials already provisioned');raise SystemExit
env=dict(os.environ)
for key in ['CONVEX_DEPLOYMENT','CONVEX_DEPLOY_KEY','CONVEX_SELF_HOSTED_URL','CONVEX_SELF_HOSTED_ADMIN_KEY']:env.pop(key,None)
for line in (root/'.env.local').read_text().splitlines():
 if '=' in line:
  key,value=line.split('=',1);env[key]=value
if env.get('CONVEX_SELF_HOSTED_URL')!='http://127.0.0.1:3340':raise RuntimeError('Refusing non-evaluation backend')
secret='lor_at_'+secrets.token_urlsafe(32)
r=subprocess.run([str(root/'node_modules/.bin/convex'),'run','evaluationFixture:initialize',json.dumps({'token':secret})],cwd=root,env=env,capture_output=True,text=True)
if r.returncode:
 print(r.stderr.replace(secret,'[redacted]'));raise SystemExit(1)
a=json.loads(r.stdout);a['token']=secret
credential.write_text(json.dumps(a));credential.chmod(0o600)
print('Isolated family sample and evaluation grant provisioned')
