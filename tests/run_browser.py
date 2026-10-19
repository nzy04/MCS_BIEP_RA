"""Run all browser workflows against the development or production preview server."""
import json, os, pathlib, subprocess, sys, time
root=pathlib.Path(__file__).resolve().parents[1]
results=[]
for name in ['browser_smoke.py','document_browser.py','contributors_browser.py','directions_browser.py','direction_moves_browser.py','direction_crud_browser.py','review_browser.py','members_browser.py']:
    started=time.monotonic()
    result=subprocess.run([sys.executable,str(root/'tests'/name)],cwd=root,env=os.environ.copy(),text=True,encoding='utf-8',capture_output=True,timeout=180)
    entry={'test':name,'passed':result.returncode==0,'seconds':round(time.monotonic()-started,2),'output':result.stdout.strip(),'error':result.stderr.strip() if result.returncode else ''}
    results.append(entry);print(json.dumps(entry,ensure_ascii=False),flush=True)
out=root/'test-results/final-audit';out.mkdir(parents=True,exist_ok=True)
(out/'browser-results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
sys.exit(0 if all(r['passed'] for r in results) else 1)
