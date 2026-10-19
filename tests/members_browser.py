import os,sys,pathlib,json
sys.path.insert(0,str(pathlib.Path('test-results/python-deps').resolve()))
from playwright.sync_api import sync_playwright,expect
base=os.environ.get('TEST_BASE_URL','http://127.0.0.1:5199/')
out=pathlib.Path('test-results/members');out.mkdir(parents=True,exist_ok=True)
state={'invitation':None,'members':[],'logged_in':False,'join_calls':0,'generation':0}
owner={'id':1,'login':'owner','name':'维护者','avatar':'','canWrite':True,'isAdmin':True}
guest={'id':2,'login':'test-member','name':'测试组员','avatar':'','isAdmin':False}
def session(role):
    if role=='owner':return owner
    if not state['logged_in']:return None
    member=next((m for m in state['members'] if m['id']==2),None)
    return {**guest,'canWrite':bool(member and member['active'])}
def fixture(route):
    path=route.request.url.split('/api/',1)[1]
    role=route.request.headers.get('x-test-role','guest')
    data=route.request.post_data_json if route.request.post_data else {}
    if path=='config':route.fulfill(json={'title':'MCS_BIEP','configured':True,'authConfigured':True,'membershipConfigured':True,'reviewConfigured':True,'repository':'group/papers','branch':'main'})
    elif path=='session':route.fulfill(json=session(role))
    elif path=='library':route.fulfill(json={'notes':[]})
    elif path=='directions':route.fulfill(json={'directions':[]})
    elif path=='reviews':route.fulfill(json={'jobs':[]})
    elif path=='members':
        route.fulfill(status=200 if role=='owner' else 403,json={'members':state['members'],'invitation':state['invitation'],'configured':True} if role=='owner' else {'error':'只有维护者可以管理成员。'})
    elif path=='members/invitation':
        assert role=='owner'
        if route.request.method=='DELETE':state['invitation']=None;route.fulfill(json={'ok':True})
        else:
            state['generation']+=1
            token=('v' if state['generation']==1 else 'w')*43
            state['invitation']={'url':base.rstrip('/')+'/#join/'+token,'expiresAt':'2099-01-01T00:00:00Z','uses':0,'maxUses':50}
            route.fulfill(json=state['invitation'])
    elif path=='members/2':
        assert role=='owner'
        state['members'][0]['active']=data['active'];route.fulfill(json={'ok':True})
    elif path=='invitations/preview':
        valid=bool(state['invitation'] and state['invitation']['url'].endswith(data['token']))
        route.fulfill(json={'valid':valid,'message':'' if valid else '邀请链接已停用，请向维护者获取新链接。'})
    elif path=='auth/login':
        assert route.request.method=='POST'
        assert data['returnTo'].startswith('/#join/')
        state['logged_in']=True
        route.fulfill(json={'url':base+'?auth_done=1'+data['returnTo'][1:]})
    elif path=='invitations/join':
        state['join_calls']+=1
        member=next((m for m in state['members'] if m['id']==2),None)
        if member and not member['active']:route.fulfill(status=403,json={'error':'此账号已被移出论文库，请联系维护者恢复资格。'})
        else:
            if not member:
                state['members'].append({'id':2,'login':'test-member','name':'测试组员','joinedAt':'2026-10-19T00:00:00Z','active':True})
                state['invitation']['uses']+=1
            route.fulfill(json={'user':session(role)})
    else:route.fulfill(status=404,json={'error':'test endpoint not configured'})
with sync_playwright() as p:
    browser=p.chromium.launch(channel=os.environ.get('TEST_BROWSER_CHANNEL','msedge') or None,headless=True)
    admin=browser.new_context(viewport={'width':1440,'height':1000},permissions=['clipboard-read','clipboard-write'],extra_http_headers={'X-Test-Role':'owner'})
    admin.route('**/api/**',fixture);a=admin.new_page();errors=[]
    a.on('pageerror',lambda e:errors.append(str(e)))
    a.goto(base);a.get_by_role('link',name='组员管理',exact=True).click()
    a.get_by_role('heading',name='组员管理',exact=True).wait_for()
    a.get_by_role('button',name='生成邀请链接',exact=True).click()
    link=a.get_by_role('textbox',name='邀请链接').input_value()
    a.get_by_role('button',name='复制邀请链接',exact=True).click()
    expect(a.get_by_role('button',name='已复制',exact=True)).to_be_visible()
    assert a.evaluate('navigator.clipboard.readText()')==link
    a.screenshot(path=str(out/'admin-invitation.png'))
    member_context=browser.new_context(viewport={'width':1440,'height':1000},extra_http_headers={'X-Test-Role':'guest'})
    member_context.route('**/api/**',fixture);m=member_context.new_page();m.on('pageerror',lambda e:errors.append(str(e)))
    m.goto(link);m.get_by_role('button',name='使用 GitHub 加入',exact=True).click()
    m.get_by_role('status').filter(has_text='已加入论文库').wait_for()
    assert state['join_calls']==1 and state['invitation']['uses']==1
    assert m.get_by_role('link',name='组员管理',exact=True).count()==0
    a.get_by_role('button',name='刷新',exact=True).click()
    a.get_by_text('@test-member',exact=True).wait_for()
    a.get_by_role('button',name='移除',exact=True).click()
    a.get_by_role('button',name='确认移除',exact=True).click()
    a.get_by_text('已移除',exact=True).wait_for()
    m.goto(link);m.get_by_role('alert').filter(has_text='移出论文库').wait_for()
    a.get_by_role('button',name='恢复资格',exact=True).click()
    expect(a.get_by_role('button',name='移除',exact=True)).to_be_visible()
    m.get_by_role('button',name='重试加入',exact=True).click()
    m.get_by_role('status').filter(has_text='已加入论文库').wait_for()
    a.get_by_role('button',name='更换链接',exact=True).click()
    expect(a.get_by_role('button',name='复制邀请链接',exact=True)).to_be_visible()
    assert a.get_by_role('textbox',name='邀请链接').input_value()!=link
    m.goto(link);m.get_by_role('alert').filter(has_text='已停用').wait_for()
    a.set_viewport_size({'width':390,'height':844})
    assert a.evaluate('document.documentElement.scrollWidth <= innerWidth')
    a.screenshot(path=str(out/'members-mobile.png'),full_page=True)
    a.get_by_role('button',name='停用链接',exact=True).click()
    expect(a.get_by_role('button',name='生成邀请链接',exact=True)).to_be_visible()
    assert not errors,errors
    browser.close()
print(json.dumps({'ownerInvitationCopy':True,'githubLoginThenAutomaticJoin':True,'memberHasNoAdminEntry':True,'removeBlocksExistingSession':True,'restore':True,'rotateAndRevoke':True,'mobile390':True,'runtimeErrors':errors},ensure_ascii=False))
