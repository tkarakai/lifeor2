"""Boot/deploy an isolated local evaluation backend. Never targets the normal deployment."""
from pathlib import Path
import json,os,subprocess,shutil,time,urllib.request
source=Path(__file__).resolve().parents[2]
root=source/'.convex/query-evaluation/workspace'
root.mkdir(parents=True,exist_ok=True)
for d in ['convex','lib']:
 shutil.copytree(source/d,root/d,dirs_exist_ok=True)
shutil.copy2(source/'scripts/evaluation/fixture.ts.txt',root/'convex/evaluationFixture.ts')
for f in ['package.json','bun.lock','tsconfig.json','convex.json']:
 if (source/f).exists():shutil.copy2(source/f,root/f)
if not(root/'node_modules').exists():(root/'node_modules').symlink_to(source/'node_modules',target_is_directory=True)
state=root.parent/'backend';state.mkdir(exist_ok=True)
details=root.parent/'details.git'
if not details.exists():subprocess.run(['git','init','--bare',str(details)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
config=json.loads((source/'.convex/standalone/config.json').read_text())
port,site=3340,3341
def recognized_backend():
 if not (state/'pid').exists(): return None
 pid=int((state/'pid').read_text())
 check=subprocess.run(['ps','-p',str(pid),'-o','command='],capture_output=True,text=True)
 if check.returncode: return None
 if str(state/'backend.sqlite3') not in check.stdout: raise RuntimeError('Evaluation PID belongs to an unrecognized process')
 return pid
try:
 urllib.request.urlopen(f'http://127.0.0.1:{port}/instance_name',timeout=1)
 if recognized_backend() is None: raise RuntimeError('Port 3340 is occupied by an unrecognized process')
 print('Evaluation backend already listening',flush=True)
except (urllib.error.URLError,TimeoutError):
 pid=recognized_backend()
 if pid is None:
  log=open(state/'backend.log','a')
  p=subprocess.Popen([config['binary'],'--interface','127.0.0.1','--port',str(port),'--site-proxy-port',str(site),'--instance-name',config['instanceName'],'--instance-secret',config['instanceSecret'],'--disable-beacon','--local-storage',str(state/'storage'),str(state/'backend.sqlite3')],cwd=root,stdout=log,stderr=log,start_new_session=True)
  pid=p.pid
  (state/'pid').write_text(str(pid))
 print('Waiting for isolated backend startup (large persisted indexes can take several minutes)',flush=True)
 for i in range(600):
  try:
   urllib.request.urlopen(f'http://127.0.0.1:{port}/instance_name',timeout=1)
   break
  except (urllib.error.URLError,TimeoutError):
   if recognized_backend() is None: raise RuntimeError('Isolated backend exited; inspect backend/backend.log')
   time.sleep(.5)
 else: raise RuntimeError('Isolated backend did not become ready within five minutes; inspect backend/backend.log')
env=dict(os.environ)
for k in ['CONVEX_DEPLOYMENT','CONVEX_DEPLOY_KEY','CONVEX_SELF_HOSTED_URL','CONVEX_SELF_HOSTED_ADMIN_KEY']:env.pop(k,None)
env.update(CONVEX_SELF_HOSTED_URL=f'http://127.0.0.1:{port}',CONVEX_SELF_HOSTED_ADMIN_KEY=config['adminKey'])
for vals in [[{'name':'LIFE_QUERY_EVALUATION','value':'isolated-local'},{'name':'SITE_URL','value':f'http://localhost:3300'},{'name':'BETTER_AUTH_SECRET','value':config['authSecret']}]]:
 req=urllib.request.Request(f'http://127.0.0.1:{port}/api/update_environment_variables',data=json.dumps({'changes':vals}).encode(),headers={'Content-Type':'application/json','Authorization':'Convex '+config['adminKey']})
 urllib.request.urlopen(req).read()
# Dedicated file is private; commands never print credentials.
f=root/'.env.local';f.write_text('\n'.join(f'{k}={v}' for k,v in env.items() if k.startswith('CONVEX_SELF_'))+'\n');f.chmod(0o600)
subprocess.run([str(source/'node_modules/.bin/convex'),'dev','--once','--typecheck','disable'],cwd=root,env=env,check=True)
print('Isolated evaluation backend deployed on 3340/3341; original database unchanged.')
