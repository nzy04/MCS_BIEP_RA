import sys, pathlib, json, os, copy
sys.path.insert(0, str(pathlib.Path('test-results/python-deps').resolve()))
from playwright.sync_api import sync_playwright

out = pathlib.Path('test-results').resolve()
base = os.environ.get('TEST_BASE_URL', 'http://127.0.0.1:5188/')
state = {'jobs': [], 'submitted': None, 'publish_calls': 0, 'published': None}
job_id = 'review-' + 'a' * 48
receipt = {'model': 'test-model', 'policyVersion': 'test', 'reviewedAt': '2026-10-18T15:00:00Z', 'directions': ['世界模型', '规划控制'], 'sources': [{'title': 'World Models', 'url': 'https://arxiv.org/abs/1803.10122', 'kind': 'provided'}], 'supplements': []}
pdf_url = 'https://arxiv.org/pdf/1803.10122'
receipt['supplements'] = [{'field': 'pdfUrl', 'value': pdf_url, 'sourceUrl': 'https://arxiv.org/abs/1803.10122'}]

def fixture(route):
    path = route.request.url.split('/api/', 1)[1]
    if path == 'config':
        route.fulfill(json={'title': 'MCS_BIEP', 'configured': True, 'authConfigured': True, 'reviewConfigured': True, 'repository': 'test-group/test-repo', 'branch': 'main'})
    elif path == 'directions':
        route.fulfill(json={'directions': []})
    elif path == 'session':
        route.fulfill(json={'id': 7, 'login': 'test-member', 'name': '测试成员', 'githubName': '测试成员', 'nickname': '', 'avatar': '', 'canWrite': True})
    elif path == 'library':
        note = state['published']
        route.fulfill(json={'notes': [{k: v for k, v in note.items() if k not in ['sections', 'assets', 'sourceNames', 'review']}] if note else []})
    elif path == 'reviews':
        if state.get('hold_list'):
            state['held_list'] = (route, copy.deepcopy(state['jobs']))
        else:
            route.fulfill(json={'jobs': state['jobs']})
    elif path == 'publish':
        state['publish_calls'] += 1
        state['submitted'] = route.request.post_data_json['note']
        job = {'id': job_id, 'noteId': state['submitted']['id'], 'title': state['submitted']['title'], 'status': 'queued', 'createdAt': '2026-10-18T15:00:00Z', 'updatedAt': '2026-10-18T15:00:00Z', 'issues': [], 'message': ''}
        state['jobs'] = [job]
        route.fulfill(status=202, json={'job': job})
    elif path == 'reviews/' + job_id:
        if route.request.method == 'DELETE':
            state['delete_calls'] = state.get('delete_calls', 0) + 1
            if state.pop('fail_delete', False):
                route.fulfill(status=503, json={'error': '删除暂时不可用，请稍后重试。'})
            else:
                state['jobs'] = []
                route.fulfill(json={'deleted': True})
        else:
            route.fulfill(json={'job': state['jobs'][0], 'note': state['submitted'] if state.get('details', True) else None})
    elif path.startswith('notes/') and state['published']:
        route.fulfill(json=state['published'])
    else:
        route.fulfill(status=404, json={'error': 'Test endpoint not configured'})

with sync_playwright() as p:
    browser = p.chromium.launch(channel=os.environ.get('TEST_BROWSER_CHANNEL', 'msedge') or None, headless=True)
    context = browser.new_context(viewport={'width': 1440, 'height': 1000})
    context.route('**/api/**', fixture)
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(base); page.wait_for_load_state('networkidle')
    page.get_by_role('button', name='上传笔记', exact=True).click()
    page.get_by_role('button', name='在线写笔记', exact=True).click()
    page.get_by_label('笔记标题', exact=True).fill('World Models')
    page.get_by_text('论文信息', exact=True).click()
    assert page.get_by_label('PDF 下载链接', exact=True).input_value() == ''
    original_insights = '我希望进一步检验长时预测误差对规划和策略迁移的影响。'
    body = '## 问题与背景\n\n学习潜在环境模型，减少策略训练所需的真实环境交互。\n\n## 个人判断\n\n' + original_insights
    page.get_by_role('button', name='Markdown', exact=True).click()
    page.get_by_label('Markdown 正文', exact=True).fill(body)
    page.get_by_role('button', name='查看发布预览', exact=True).click()
    assert state['publish_calls'] == 0
    page.get_by_role('button', name='确认发布到仓库', exact=True).click()
    page.get_by_role('heading', name='我的提交', exact=True).wait_for()
    page.locator('.review-status', has_text='审核中').wait_for()
    assert page.get_by_role('button', name='删除提交', exact=True).count() == 0
    assert state['publish_calls'] == 1
    assert state['submitted'].get('pdfUrl', '') == ''
    page.screenshot(path=str(out / 'review-pending.png'), full_page=False)
    state['jobs'][0].update(status='needs_changes', issues=[{'field': 'method', 'message': '请补充方法的关键模块和实现思路。'}, {'field':'insights','message':'请说明作出判断的依据和适用条件。','quote':original_insights},{'field':'year','message':'请核对论文的发表年份。'}], receipt=receipt)
    page.reload(); page.locator('.review-status', has_text='待修改').wait_for()
    assert '关键模块' in page.locator('.review-issues').inner_text()
    page.screenshot(path=str(out / 'review-feedback.png'), full_page=False)
    state['details'] = False
    page.get_by_role('button', name='修改笔记', exact=True).click()
    assert original_insights in page.get_by_role('textbox', name='笔记正文', exact=True).inner_text()
    assert page.locator('.review-feedback li').count()==3
    assert page.locator('.review-mark').inner_text()==original_insights
    assert page.get_by_label('发表年份',exact=True).get_attribute('aria-invalid')=='true'
    assert page.locator('.review-feedback').evaluate('(el)=>getComputedStyle(el).color')=='rgb(161, 37, 27)'
    page.screenshot(path=str(out/'review-red-guidance.png'),full_page=True)
    page.get_by_role('button', name='Markdown', exact=True).click()
    page.get_by_label('Markdown 正文', exact=True).fill(body + '\n\n## 关键模块\n\n视觉编码器压缩图像，循环动态模型学习演化，控制器利用潜在状态决策。')
    page.get_by_role('button', name='查看发布预览', exact=True).click()
    page.get_by_role('button', name='确认发布到仓库', exact=True).click()
    page.locator('.review-status', has_text='审核中').wait_for()
    assert state['publish_calls'] == 2
    assert 'review-mark' not in state['submitted']['body']
    state['published'] = {**state['submitted'], 'pdfUrl': pdf_url, 'tags': receipt['directions'], 'review': receipt, 'revision': 'approved-version', 'updatedAt': '2026-10-18T15:03:00Z'}
    state['jobs'][0].update(status='published', receipt=receipt, commitUrl='https://github.com/test-group/test-repo/commit/test')
    page.get_by_role('button', name='刷新', exact=True).click()
    page.locator('.review-status', has_text='已发布').wait_for()
    page.get_by_role('button', name='阅读笔记', exact=True).click()
    page.get_by_role('heading', name='World Models', exact=True).wait_for()
    assert original_insights in page.locator('.note-body').inner_text()
    assert page.locator('.review-receipt').count() == 1
    assert page.get_by_role('link', name='论文 PDF').get_attribute('href') == pdf_url
    page.locator('.review-receipt summary').click()
    assert page.locator('.reader-aside .ai-badge').count()==1
    assert '自动补充' not in page.locator('.review-receipt').inner_text()
    assert '补充论文来源' not in page.locator('.review-receipt').inner_text()
    page.screenshot(path=str(out / 'pdf-background-result.png'), full_page=True)
    mobile = browser.new_context(viewport={'width': 390, 'height': 844})
    mobile.route('**/api/**', fixture)
    mobile_page = mobile.new_page(); mobile_page.goto(base + '#reviews'); mobile_page.wait_for_load_state('networkidle')
    mobile_page.locator('.review-status', has_text='已发布').wait_for()
    assert mobile_page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    mobile_page.screenshot(path=str(out / 'review-mobile.png'), full_page=True)
    # Deleting a published submission preserves the published note.
    mobile_page.get_by_role('button', name='删除提交', exact=True).click()
    assert mobile_page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    mobile_page.get_by_role('button', name='确认删除', exact=True).click()
    mobile_page.get_by_role('heading', name='暂无提交', exact=True).wait_for()
    mobile_page.goto(base + '#paper/' + state['published']['id'])
    mobile_page.get_by_role('heading', name='World Models', exact=True).wait_for()
    # Also delete a needs_changes record, including failure/cancel and stale polling.
    state['jobs'] = [{'id': job_id, 'noteId': state['submitted']['id'], 'title': '待修改的笔记', 'status': 'needs_changes', 'createdAt': '2026-10-18T15:00:00Z', 'updatedAt': '2026-10-18T15:00:00Z', 'issues': [], 'message': ''}]
    page.goto(base + '#reviews'); page.reload()
    page.get_by_role('heading', name='待修改的笔记', exact=True).wait_for()
    delete_button = page.get_by_role('button', name='删除提交', exact=True)
    edit_box = page.get_by_role('button', name='修改笔记', exact=True).bounding_box()
    delete_box = delete_button.bounding_box()
    assert delete_box['x'] > edit_box['x'] + edit_box['width']
    assert abs(delete_box['y'] - edit_box['y']) < 3
    page.screenshot(path=str(out / 'review-delete.png'), full_page=False)
    await_script = '''async (id) => {
        const db = await new Promise((resolve,reject) => { const r=indexedDB.open('paper-commons-v1',1); r.onsuccess=()=>resolve(r.result); r.onerror=()=>reject(r.error); });
        await new Promise((resolve,reject) => { const t=db.transaction('records','readwrite'); const s=t.objectStore('records'); s.put({saved:true},'review-draft:'+id); s.put({unrelated:true},'draft'); t.oncomplete=resolve; t.onerror=()=>reject(t.error); }); db.close();
    }'''
    page.evaluate(await_script, job_id)
    delete_button.click(); page.get_by_role('button', name='取消', exact=True).click()
    assert state['delete_calls'] == 1
    state['fail_delete'] = True
    delete_button.click(); page.get_by_role('button', name='确认删除', exact=True).click()
    page.get_by_role('alert').filter(has_text='删除暂时不可用').wait_for()
    assert page.locator('.review-item').count() == 1
    state['hold_list'] = True
    page.get_by_role('button', name='刷新', exact=True).click()
    page.wait_for_function("document.querySelector('.review-heading button').disabled")
    page.get_by_role('button', name='确认删除', exact=True).click()
    page.get_by_role('heading', name='暂无提交', exact=True).wait_for()
    state['hold_list'] = False
    held_route, snapshot = state.pop('held_list')
    held_route.fulfill(json={'jobs': snapshot})
    page.wait_for_function("!document.querySelector('.review-heading button').disabled")
    assert page.locator('.review-item').count() == 0
    saved = page.evaluate('''async (id) => { const db = await new Promise(r=>{const q=indexedDB.open('paper-commons-v1',1);q.onsuccess=()=>r(q.result)}); const read=(key)=>new Promise(r=>{const q=db.transaction('records').objectStore('records').get(key);q.onsuccess=()=>r(q.result??null)}); const result=[await read('review-draft:'+id),await read('draft')];db.close();return result; }''', job_id)
    assert saved == [None, {'unrelated': True}], saved
    page.reload(); page.get_by_role('heading', name='暂无提交', exact=True).wait_for()
    assert not errors, errors
    browser.close()
print(json.dumps({'callsOnlyAfterConfirmation': True, 'pendingSurvivesReload': True, 'feedbackAndRevision': True, 'publishedReadable': True, 'mobile390': True, 'deleteNeedsChangesAndPublished': True, 'deleteFailureAndCancel': True, 'stalePollDoesNotResurrect': True, 'draftCleanup': True, 'runtimeErrors': errors}, ensure_ascii=False))
