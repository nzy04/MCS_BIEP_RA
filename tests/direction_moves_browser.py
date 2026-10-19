"""Direction creation, drag/drop and mobile move acceptance with isolated API fixtures."""
import copy, json, os, pathlib, sys
sys.path.insert(0, str(pathlib.Path('test-results/python-deps').resolve()))
from playwright.sync_api import sync_playwright, expect
base = os.environ.get('TEST_BASE_URL', 'http://127.0.0.1:5188/')
out = pathlib.Path('test-results/direction-moves').resolve(); out.mkdir(parents=True, exist_ok=True)
sections = {k: '' for k in ['summary','problem','method','evidence','limitations','insights','original']}
def note(i, author, tags):
    return dict(id=f'note-{i:08x}-1111-4111-8111-111111111111', title='Shared World Model', subtitle='', year='2026', venue='arXiv', tags=tags,
      paperUrl='https://arxiv.org/abs/2601.12345', pdfUrl='', codeUrl='', author=author, authorLogin=author.lower(), authorId=i,
      createdAt='2026-10-18T01:00:00Z', updatedAt='2026-10-19T01:00:00Z', revision=f'revision-{i}', excerpt=f'{author}的个人理解',
      readingDepth='精读', body=f'## 阅读理解\n\n{author}对方法和实验的理解。', sections=sections, assets=[], sourceNames=[])
state = {'notes':[note(1,'Alice',['方向甲','保留方向']),note(2,'Bob',['方向甲'])], 'directions':['方向甲','方向乙','方向丙','保留方向'], 'requests':[], 'fail':False, 'signed_in':True}
results=[]
def fixture(route):
    path=route.request.url.split('/api/',1)[1]
    if path=='config': route.fulfill(json=dict(title='MCS_BIEP',configured=True,authConfigured=True,repository='group/papers',branch='main'))
    elif path=='session': route.fulfill(json=dict(id=1,login='alice',name='Alice',avatar='',canWrite=True) if state['signed_in'] else None)
    elif path=='library': route.fulfill(json={'notes':state['notes']})
    elif path=='reviews': route.fulfill(json={'jobs':[]})
    elif path=='directions':
        if route.request.method=='POST':
            name=route.request.post_data_json['name']; state['directions'].append(name)
            route.fulfill(json={'name':name,'directions':state['directions']})
        else: route.fulfill(json={'directions':state['directions']})
    elif path=='notes/move':
        payload=route.request.post_data_json; state['requests'].append(payload)
        if state['fail']:
            state['fail']=False; route.fulfill(status=409,json={'error':'笔记已有更新，请刷新后再移动。'});return
        for entry in payload['notes']:
            n=next(n for n in state['notes'] if n['id']==entry['id'])
            assert n['revision']==entry['revision']
            n['tags']=[t for t in n['tags'] if t!=payload['source']] if payload['source'] is not None else []
            if payload['target'] not in n['tags']:n['tags'].append(payload['target'])
            n['revision']+='-moved'
        route.fulfill(json={'notes':state['notes'],'commitUrl':'https://github.com/group/papers/commit/test'})
    else: route.fulfill(status=404,json={'error':'Unknown fixture '+path})

with sync_playwright() as p:
    browser=p.chromium.launch(channel=os.environ.get('TEST_BROWSER_CHANNEL', 'msedge') or None,headless=True)
    try:
        context=browser.new_context(viewport={'width':1440,'height':1100});context.route('**/api/**',fixture)
        page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
        page.goto(base);page.wait_for_load_state('networkidle')
        page.get_by_role('button',name='方向甲 1',exact=True).click()
        expect(page.locator('.note-option')).to_have_count(2)
        page.locator('.note-option').filter(has_text='Alice').drag_to(page.get_by_role('button',name='方向乙 0',exact=True))
        expect(page.locator('.note-option')).to_have_count(1)
        assert state['requests'][-1]['notes'][0]['id']==state['notes'][0]['id']
        assert state['requests'][-1]['source']=='方向甲'
        assert state['notes'][0]['tags']==['保留方向','方向乙']
        page.locator('.paper-card').drag_to(page.get_by_role('button',name='方向乙 1',exact=True))
        expect(page.get_by_text('这个方向还没有笔记',exact=True)).to_be_visible()
        page.get_by_role('button',name='方向乙 1',exact=True).click()
        expect(page.locator('.note-option')).to_have_count(2)
        page.screenshot(path=str(out/'desktop-moved.png'),full_page=True)
        results.append('single contributor drag and whole-card drag move exact IDs; retain other directions; counts and source list update')
        page.get_by_role('button',name='移动全部笔记',exact=True).click()
        dialog=page.get_by_role('dialog');expect(dialog).to_be_visible()
        dialog.get_by_label('目标研究方向',exact=True).select_option('方向丙');state['fail']=True
        before=copy.deepcopy(state['notes']);dialog.get_by_role('button',name='确认移动',exact=True).click()
        expect(dialog.get_by_role('alert')).to_contain_text('已有更新')
        assert state['notes']==before
        expect(page.locator('.paper-card')).to_have_count(1)
        dialog.get_by_role('button',name='确认移动',exact=True).click()
        expect(dialog).not_to_be_visible()
        page.get_by_role('button',name='方向丙 1',exact=True).click();expect(page.locator('.note-option')).to_have_count(2)
        page.reload();page.wait_for_load_state('networkidle')
        expect(page.get_by_role('button',name='方向丙 1',exact=True)).to_be_visible()
        results.append('failed move preserves UI and note state; retry succeeds; persisted classification survives reload')
        mobile_context=browser.new_context(viewport={'width':390,'height':844});mobile_context.route('**/api/**',fixture)
        mobile=mobile_context.new_page();mobile.goto(base);mobile.wait_for_load_state('networkidle')
        mobile.get_by_role('button',name='移动 Alice 的笔记',exact=True).click()
        mobile.get_by_role('dialog').get_by_label('目标研究方向',exact=True).select_option('方向甲')
        mobile.screenshot(path=str(out/'mobile-move.png'),full_page=True)
        mobile.get_by_role('dialog').get_by_role('button',name='确认移动',exact=True).click()
        expect(mobile.get_by_role('dialog')).not_to_be_visible()
        assert state['requests'][-1]['source'] is None
        assert state['notes'][0]['tags']==['方向甲']
        assert mobile.evaluate('document.documentElement.scrollWidth<=innerWidth')
        results.append('mobile accessible move dialog works from all papers; no horizontal overflow')
        state['signed_in']=False
        anonymous_context=browser.new_context();anonymous_context.route('**/api/**',fixture)
        anon=anonymous_context.new_page();anon.goto(base);anon.wait_for_load_state('networkidle')
        anon.get_by_role('button',name='新建研究方向',exact=True).click()
        expect(anon.get_by_label('新研究方向',exact=True)).to_be_visible()
        expect(anon.locator('.direction-create').get_by_role('link',name='登录 GitHub',exact=True)).to_be_visible()
        state['notes']=[];state['directions']=[]
        anon.reload();anon.wait_for_load_state('networkidle')
        anon.get_by_role('button',name='上传笔记',exact=True).click()
        anon.get_by_role('button',name='在线写笔记',exact=True).click()
        anon.get_by_role('button',name='新建研究方向',exact=True).click()
        anon.get_by_label('新研究方向',exact=True).fill('第一个研究方向')
        expect(anon.locator('.direction-picker').get_by_role('link',name='登录 GitHub',exact=True)).to_be_visible()
        assert not errors,errors
        results.append('anonymous users see create entry and name field with explicit login action; no hidden dead end or runtime errors')
    finally:browser.close()
(out/'results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(results,ensure_ascii=False))
