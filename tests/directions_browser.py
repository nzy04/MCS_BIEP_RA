import json, os, pathlib, sys
sys.path.insert(0, str(pathlib.Path('test-results/python-deps').resolve()))
from playwright.sync_api import sync_playwright, expect

base=os.environ.get('TEST_BASE_URL','http://127.0.0.1:5199/')
out=pathlib.Path('test-results/directions').resolve(); out.mkdir(parents=True,exist_ok=True)
state={'directions':['既有方向','空文件夹'],'submitted':[],'fail':False}
results=[]

def fixture(route):
    path=route.request.url.split('/api/',1)[1]
    if path=='config': route.fulfill(json={'title':'MCS_BIEP','configured':True,'authConfigured':True,'repository':'test/papers','branch':'main'})
    elif path=='session': route.fulfill(json={'id':1,'login':'member','name':'成员','avatar':'','canWrite':True})
    elif path=='library': route.fulfill(json={'notes':[]})
    elif path=='reviews': route.fulfill(json={'jobs':[]})
    elif path=='directions':
        if route.request.method=='POST':
            if state['fail']:
                state['fail']=False; route.fulfill(status=503,json={'error':'目录暂时不可用，未创建。'}); return
            name=route.request.post_data_json['name'].strip()
            if name not in state['directions']: state['directions'].append(name)
            route.fulfill(json={'name':name,'directions':state['directions']})
        else: route.fulfill(json={'directions':state['directions']})
    elif path=='publish':
        note=route.request.post_data_json['note'];state['submitted'].append(note)
        route.fulfill(status=202,json={'job':{'id':'review-'+'a'*48,'noteId':note['id'],'title':note['title'],'status':'queued','createdAt':'2026-10-19T01:00:00Z','updatedAt':'2026-10-19T01:00:00Z','issues':[],'message':''}})
    else: route.fulfill(status=404,json={'error':'Unknown fixture '+path})

def write_note(page,title):
    page.get_by_role('button',name='在线写笔记',exact=True).click()
    page.get_by_label('笔记标题',exact=True).fill(title)
    page.get_by_role('textbox',name='笔记正文',exact=True).fill('这是用户自己填写的研究问题、核心方法和个人理解，发布时不得改变手动选择的文件夹。'*5)

def submit(page):
    page.get_by_role('button',name='查看发布预览',exact=True).click()
    page.get_by_role('button',name='确认发布到仓库',exact=True).click()
    expect(page.get_by_role('heading',name='我的提交',exact=True)).to_be_visible()

with sync_playwright() as p:
    browser=p.chromium.launch(channel=os.environ.get('TEST_BROWSER_CHANNEL', 'msedge') or None,headless=True)
    try:
        ctx=browser.new_context(viewport={'width':1440,'height':1100});ctx.route('**/api/**',fixture)
        page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
        page.goto(base);page.wait_for_load_state('networkidle')
        expect(page.get_by_role('button',name='空文件夹 0',exact=True)).to_be_visible()
        page.get_by_role('heading',name='研究方向',exact=True).click(button='right')
        page.get_by_role('menuitem',name='新建研究方向',exact=True).click()
        page.get_by_label('新研究方向',exact=True).fill('我自己的长期课题')
        state['fail']=True;page.get_by_role('button',name='创建方向',exact=True).click()
        expect(page.get_by_role('alert')).to_contain_text('未创建')
        page.get_by_role('button',name='创建方向',exact=True).click()
        expect(page.get_by_role('heading',name='我自己的长期课题',exact=True)).to_be_visible()
        expect(page.get_by_text('这个方向还没有笔记',exact=True)).to_be_visible()
        page.reload();page.wait_for_load_state('networkidle')
        expect(page.get_by_role('button',name='我自己的长期课题 0',exact=True)).to_be_visible()
        page.screenshot(path=str(out/'desktop-folders.png'),full_page=True)
        results.append('empty custom folders persist after refresh; failed create leaves catalog unchanged')

        page.get_by_role('button',name='我自己的长期课题 0',exact=True).click()
        page.get_by_role('button',name='在此方向添加笔记',exact=True).click()
        write_note(page,'手动归类的笔记')
        expect(page.get_by_role('checkbox',name='我自己的长期课题',exact=True)).to_be_checked()
        page.get_by_role('button',name='新建研究方向',exact=True).click()
        page.get_by_role('menuitem',name='新建研究方向',exact=True).click()
        page.get_by_label('新研究方向',exact=True).fill('完全自定义 / A')
        page.get_by_role('button',name='创建方向',exact=True).click()
        expect(page.get_by_role('checkbox',name='完全自定义 / A',exact=True)).to_be_checked()
        page.screenshot(path=str(out/'desktop-picker.png'),full_page=True)
        submit(page)
        assert state['submitted'][-1]['tags']==['我自己的长期课题','完全自定义 / A']
        results.append('adding from folder preselects it; editor creates and selects new custom names; submitted manual choices are exact')

        page.get_by_role('button',name='上传笔记',exact=True).click()
        write_note(page,'自动归类的笔记')
        page.get_by_role('checkbox',name='既有方向',exact=True).check()
        page.get_by_role('button',name='清空，改为自动归类',exact=True).click()
        expect(page.get_by_text('未选择方向：提交后由大模型自动归类，优先使用已有方向。',exact=True)).to_be_visible()
        submit(page)
        assert state['submitted'][-1]['tags']==[]
        results.append('clearing selection submits empty tags to automatic model classification, with clear user-facing explanation')

        mobile_ctx=browser.new_context(viewport={'width':390,'height':844});mobile_ctx.route('**/api/**',fixture)
        mobile=mobile_ctx.new_page();mobile.goto(base);mobile.wait_for_load_state('networkidle')
        mobile.get_by_role('button',name='研究方向操作',exact=True).click()
        mobile.get_by_role('menuitem',name='新建研究方向',exact=True).click()
        mobile.get_by_label('新研究方向',exact=True).fill('很长的自定义文件夹名称用于手机显示验证')
        mobile.get_by_role('button',name='创建方向',exact=True).click()
        assert mobile.evaluate('document.documentElement.scrollWidth<=innerWidth')
        mobile.screenshot(path=str(out/'mobile-folders.png'),full_page=True)
        results.append('390px mobile custom folder controls have no horizontal overflow')
        assert not errors,errors
        expect(page.get_by_role('link',name='使用指南',exact=True)).to_be_visible()
        results.append('no browser runtime errors; existing usage guide navigation preserved')
    finally: browser.close()

(out/'results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(results,ensure_ascii=False))
