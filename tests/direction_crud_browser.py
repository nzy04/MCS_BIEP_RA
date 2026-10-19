"""Direction CRUD through desktop/mobile controls, with isolated external API fixtures."""
import json, os, pathlib, sys
sys.path.insert(0,str(pathlib.Path('test-results/python-deps').resolve()))
from playwright.sync_api import sync_playwright, expect
base=os.environ.get('TEST_BASE_URL','http://127.0.0.1:5199/')
out=pathlib.Path('test-results/direction-crud').resolve();out.mkdir(parents=True,exist_ok=True)
def note(i,tags):
    return dict(id=f'note-{i:08x}-1111-4111-8111-111111111111',title='Shared Paper',subtitle='',year='2026',venue='arXiv',tags=tags,
      paperUrl='https://arxiv.org/abs/2601.12345',pdfUrl='https://arxiv.org/pdf/2601.12345',codeUrl='',author='Alice' if i==1 else 'Bob',authorLogin='alice' if i==1 else 'bob',authorId=i,
      createdAt='2026-10-18T01:00:00Z',updatedAt='2026-10-19T01:00:00Z',revision=f'rev-{i}',excerpt='独立阅读理解',readingDepth='精读',
      body='## 个人理解\n\n保留原始正文和自己的分析。',sections={k:'' for k in ['summary','problem','method','evidence','limitations','insights','original']},assets=[],sourceNames=[])
state={'directions':['方向甲','保留方向','空方向'],'notes':[note(1,['方向甲','保留方向']),note(2,['方向甲'])],'fail':False,'requests':[],'signed_in':True,'connected':True}
results=[]
def fixture(route):
    path=route.request.url.split('/api/',1)[1]
    if path=='config':route.fulfill(json=dict(title='MCS_BIEP',configured=state['connected'],authConfigured=state['connected'],repository='group/papers',branch='main'))
    elif path=='session':
        if state['signed_in']:route.fulfill(json=dict(id=1,login='alice',name='Alice',avatar='',canWrite=True))
        else:route.fulfill(status=401,json={'error':'not signed in'})
    elif path=='library':route.fulfill(json={'notes':state['notes'] if state['connected'] else []})
    elif path=='reviews':route.fulfill(json={'jobs':[]})
    elif path=='directions':
        method=route.request.method
        if method=='GET':route.fulfill(json={'directions':state['directions']});return
        data=route.request.post_data_json;state['requests'].append([method,data])
        if state['fail']:
            state['fail']=False;route.fulfill(status=503,json={'error':'同步失败，本次未修改。'});return
        name=data['name']
        if method=='POST':
            if name not in state['directions']:state['directions'].append(name)
            route.fulfill(json={'name':name,'directions':state['directions']});return
        replacement=None if method=='DELETE' else data['replacement']
        if replacement in state['directions'] and replacement!=name:
            route.fulfill(status=409,json={'error':'该研究方向已存在。'});return
        state['directions']=[replacement if n==name else n for n in state['directions'] if n!=name or replacement is not None]
        for n in state['notes']:
            if name in n['tags']:
                n['tags']=[replacement if t==name else t for t in n['tags'] if t!=name or replacement is not None];n['revision']+='-changed'
        route.fulfill(json={'name':replacement,'directions':state['directions'],'notes':state['notes'],'commitUrl':'https://github.com/group/papers/commit/test'})
    elif path.startswith('notes/'):
        route.fulfill(json=next(n for n in state['notes'] if n['id']==path.split('/')[1]))
    else:route.fulfill(status=404,json={'error':'unknown '+path})
with sync_playwright() as p:
    browser=p.chromium.launch(channel=os.environ.get('TEST_BROWSER_CHANNEL','msedge') or None,headless=True)
    try:
        ctx=browser.new_context(viewport={'width':1440,'height':1000});ctx.route('**/api/**',fixture)
        page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
        page.goto(base);page.wait_for_load_state('networkidle')
        page.get_by_label('筛选研究方向',exact=True).fill('空')
        expect(page.get_by_role('button',name='空方向 0',exact=True)).to_be_visible()
        expect(page.get_by_role('button',name='方向甲 1',exact=True)).to_have_count(0)
        page.get_by_label('筛选研究方向',exact=True).fill('')
        page.get_by_role('button',name='方向甲 1',exact=True).click()
        page.get_by_role('button',name='管理研究方向',exact=True).click();manager=page.get_by_role('dialog',name='管理研究方向',exact=True)
        manager.get_by_label('搜索研究方向',exact=True).fill('空')
        expect(manager.locator('.direction-manage-row')).to_have_count(1)
        manager.get_by_label('搜索研究方向',exact=True).fill('')
        manager.get_by_role('button',name='新建研究方向',exact=True).click()
        manager.get_by_label('新研究方向',exact=True).fill('新建空方向');manager.get_by_role('button',name='创建方向',exact=True).click()
        expect(manager.get_by_role('button',name='删除“新建空方向”',exact=True)).to_be_visible()
        manager.get_by_role('button',name='重命名“方向甲”',exact=True).click();manager.get_by_label('新方向名称',exact=True).fill('重命名方向')
        state['fail']=True;manager.get_by_role('button',name='保存名称',exact=True).click()
        expect(manager.get_by_role('alert')).to_contain_text('未修改');assert '方向甲' in state['directions']
        manager.get_by_role('button',name='保存名称',exact=True).click()
        expect(manager.get_by_role('button',name='删除“重命名方向”',exact=True)).to_be_visible()
        manager.get_by_role('button',name='关闭',exact=True).click()
        expect(page.get_by_role('heading',name='重命名方向',exact=True)).to_be_visible();expect(page.locator('.note-option')).to_have_count(2)
        results.append('home and manager search/create/rename work; failed rename preserves data; selected folder and multiple contributor notes update')
        page.get_by_role('button',name='管理研究方向',exact=True).click()
        manager.get_by_role('button',name='删除“重命名方向”',exact=True).click()
        expect(manager.get_by_text('影响 2 份笔记。',exact=False)).to_be_visible()
        count=len(state['requests']);manager.get_by_role('button',name='取消',exact=True).click();assert len(state['requests'])==count
        manager.get_by_role('button',name='删除“重命名方向”',exact=True).click();manager.get_by_role('button',name='确认删除方向',exact=True).click()
        expect(manager.get_by_role('button',name='删除“重命名方向”',exact=True)).to_have_count(0)
        manager.get_by_role('button',name='关闭',exact=True).click()
        expect(page.get_by_role('button',name='重命名方向 1',exact=True)).to_have_count(0)
        page.get_by_role('button',name='未分类 1',exact=True).click();expect(page.locator('.note-option')).to_have_count(1)
        assert state['notes'][0]['tags']==['保留方向'] and state['notes'][1]['tags']==[]
        assert all(n['pdfUrl']=='https://arxiv.org/pdf/2601.12345' for n in state['notes'])
        page.reload();page.wait_for_load_state('networkidle');expect(page.get_by_role('button',name='未分类 1',exact=True)).to_be_visible()
        results.append('delete requires confirmation; keeps all notes and PDF links, preserves other classifications, exposes unclassified notes, persists after reload')
        page.get_by_role('button',name='上传笔记',exact=True).click();page.get_by_role('button',name='在线写笔记',exact=True).click()
        page.get_by_label('笔记标题',exact=True).fill('当前编辑草稿');editor=page.get_by_role('textbox',name='笔记正文',exact=True);editor.fill('不能丢失的个人理解 DRAFT-SENTINEL。'*8)
        page.get_by_label('查找研究方向',exact=True).fill('保留');page.get_by_role('checkbox',name='保留方向',exact=True).check()
        page.get_by_role('button',name='管理研究方向',exact=True).click()
        manager.get_by_role('button',name='重命名“保留方向”',exact=True).click();manager.get_by_label('新方向名称',exact=True).fill('编辑中更新')
        manager.get_by_role('button',name='保存名称',exact=True).click();expect(manager.get_by_role('button',name='删除“编辑中更新”',exact=True)).to_be_visible()
        manager.get_by_role('button',name='关闭',exact=True).click();page.get_by_label('查找研究方向',exact=True).fill('')
        expect(page.get_by_role('checkbox',name='编辑中更新',exact=True)).to_be_checked();assert 'DRAFT-SENTINEL' in editor.inner_text()
        page.get_by_role('button',name='管理研究方向',exact=True).click();manager.get_by_role('button',name='删除“编辑中更新”',exact=True).click()
        manager.get_by_role('button',name='确认删除方向',exact=True).click();expect(manager.get_by_role('button',name='删除“编辑中更新”',exact=True)).to_have_count(0)
        manager.get_by_role('button',name='关闭',exact=True).click();expect(page.get_by_role('checkbox',name='编辑中更新',exact=True)).to_have_count(0);assert 'DRAFT-SENTINEL' in editor.inner_text()
        results.append('editor search and direction management preserve the complete draft; selected directions follow rename and deletion')
        mobile_ctx=browser.new_context(viewport={'width':390,'height':844});mobile_ctx.route('**/api/**',fixture)
        mobile=mobile_ctx.new_page();mobile.goto(base);mobile.wait_for_load_state('networkidle');mobile.get_by_role('button',name='管理研究方向',exact=True).click()
        mm=mobile.get_by_role('dialog',name='管理研究方向',exact=True);mm.get_by_role('button',name='删除“空方向”',exact=True).click()
        assert mobile.evaluate('document.documentElement.scrollWidth<=innerWidth')
        mm.get_by_role('button',name='确认删除方向',exact=True).click();expect(mm.get_by_role('button',name='删除“空方向”',exact=True)).to_have_count(0)
        mobile.screenshot(path=str(out/'mobile-manager.png'));mm.get_by_role('button',name='关闭',exact=True).click()
        results.append('390px mobile deletion and manager layout work without horizontal overflow')
        state['signed_in']=False;guest_ctx=browser.new_context();guest_ctx.route('**/api/**',fixture);guest=guest_ctx.new_page();guest.goto(base);guest.wait_for_load_state('networkidle')
        expect(guest.get_by_role('button',name='管理研究方向',exact=True)).to_have_count(0)
        results.append('public visitors can browse but cannot open maintenance actions')
        state['connected']=False;state['signed_in']=True;local_ctx=browser.new_context();local_ctx.route('**/api/**',fixture);local_ctx.route('**/data/library.json',lambda r:r.fulfill(json={'notes':[]}))
        local=local_ctx.new_page();local.goto(base);local.wait_for_load_state('networkidle')
        n=note(7,['本机方向']);n['local']=True
        local.evaluate('''async n => {await new Promise((resolve,reject)=>{const req=indexedDB.open('paper-commons-v1',1);req.onsuccess=()=>{const db=req.result;const tx=db.transaction('records','readwrite');tx.objectStore('records').put([n],'local-notes');tx.objectStore('records').put(['本机方向'],'directions');tx.oncomplete=()=>{db.close();resolve()};tx.onerror=reject}})}''',n)
        local.reload();local.wait_for_load_state('networkidle');local.get_by_role('button',name='管理研究方向',exact=True).click();lm=local.get_by_role('dialog',name='管理研究方向',exact=True)
        lm.get_by_role('button',name='重命名“本机方向”',exact=True).click();lm.get_by_label('新方向名称',exact=True).fill('本机新方向');lm.get_by_role('button',name='保存名称',exact=True).click()
        expect(lm.get_by_role('button',name='删除“本机新方向”',exact=True)).to_be_visible();lm.get_by_role('button',name='删除“本机新方向”',exact=True).click();lm.get_by_role('button',name='确认删除方向',exact=True).click()
        expect(lm.get_by_role('button',name='删除“本机新方向”',exact=True)).to_have_count(0);lm.get_by_role('button',name='关闭',exact=True).click();local.reload();local.wait_for_load_state('networkidle')
        expect(local.get_by_role('button',name='未分类 1',exact=True)).to_be_visible();expect(local.get_by_role('button',name='本机方向 1',exact=True)).to_have_count(0)
        results.append('local mode atomically persists direction rename/delete and keeps unclassified notes after reload')
        assert not errors,errors
    finally:browser.close()
(out/'results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(results,ensure_ascii=False))
