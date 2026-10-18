import sys, pathlib, json, os
sys.path.insert(0, str(pathlib.Path('test-results/python-deps').resolve()))
from playwright.sync_api import sync_playwright

out = pathlib.Path('test-results').resolve()
base = os.environ.get('TEST_BASE_URL', 'http://127.0.0.1:5188/')
state = {'jobs': [], 'submitted': None, 'publish_calls': 0, 'published': None}
job_id = 'review-' + 'a' * 48
receipt = {'model': 'test-model', 'policyVersion': 'test', 'reviewedAt': '2026-10-18T15:00:00Z', 'directions': ['世界模型', '规划控制'], 'sources': [{'title': 'World Models', 'url': 'https://arxiv.org/abs/1803.10122', 'kind': 'provided'}], 'supplements': []}

def fixture(route):
    path = route.request.url.split('/api/', 1)[1]
    if path == 'config':
        route.fulfill(json={'title': 'MCS_BIEP', 'configured': True, 'authConfigured': True, 'reviewConfigured': True, 'repository': 'test-group/test-repo', 'branch': 'main'})
    elif path == 'session':
        route.fulfill(json={'id': 7, 'login': 'test-member', 'name': '测试成员', 'githubName': '测试成员', 'nickname': '', 'avatar': '', 'canWrite': True})
    elif path == 'library':
        note = state['published']
        route.fulfill(json={'notes': [{k: v for k, v in note.items() if k not in ['sections', 'assets', 'sourceNames', 'review']}] if note else []})
    elif path == 'reviews':
        route.fulfill(json={'jobs': state['jobs']})
    elif path == 'publish':
        state['publish_calls'] += 1
        state['submitted'] = route.request.post_data_json['note']
        job = {'id': job_id, 'noteId': state['submitted']['id'], 'title': state['submitted']['title'], 'status': 'queued', 'createdAt': '2026-10-18T15:00:00Z', 'updatedAt': '2026-10-18T15:00:00Z', 'issues': [], 'message': ''}
        state['jobs'] = [job]
        route.fulfill(status=202, json={'job': job})
    elif path == 'reviews/' + job_id:
        route.fulfill(json={'job': state['jobs'][0], 'note': state['submitted'] if state.get('details', True) else None})
    elif path.startswith('notes/') and state['published']:
        route.fulfill(json=state['published'])
    else:
        route.fulfill(status=404, json={'error': 'Test endpoint not configured'})

with sync_playwright() as p:
    browser = p.chromium.launch(channel='msedge', headless=True)
    context = browser.new_context(viewport={'width': 1440, 'height': 1000})
    context.route('**/api/**', fixture)
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(base); page.wait_for_load_state('networkidle')
    page.get_by_role('button', name='上传笔记', exact=True).click()
    page.get_by_role('button', name='在线写笔记', exact=True).click()
    page.get_by_label('笔记标题', exact=True).fill('World Models')
    original_insights = '我希望进一步检验长时预测误差对规划和策略迁移的影响。'
    body = '## 问题与背景\n\n学习潜在环境模型，减少策略训练所需的真实环境交互。\n\n## 个人判断\n\n' + original_insights
    page.get_by_role('button', name='Markdown', exact=True).click()
    page.get_by_label('Markdown 正文', exact=True).fill(body)
    page.get_by_role('button', name='查看发布预览', exact=True).click()
    assert state['publish_calls'] == 0
    page.get_by_role('button', name='确认发布到仓库', exact=True).click()
    page.get_by_role('heading', name='我的提交', exact=True).wait_for()
    page.locator('.review-status', has_text='审核中').wait_for()
    assert state['publish_calls'] == 1
    page.screenshot(path=str(out / 'review-pending.png'), full_page=False)
    state['jobs'][0].update(status='needs_changes', issues=[{'field': 'method', 'message': '请补充方法的关键模块和实现思路。'}], receipt=receipt)
    page.reload(); page.locator('.review-status', has_text='待修改').wait_for()
    assert '关键模块' in page.locator('.review-issues').inner_text()
    page.screenshot(path=str(out / 'review-feedback.png'), full_page=False)
    state['details'] = False
    page.get_by_role('button', name='修改笔记', exact=True).click()
    assert original_insights in page.get_by_role('textbox', name='笔记正文', exact=True).inner_text()
    page.get_by_role('button', name='Markdown', exact=True).click()
    page.get_by_label('Markdown 正文', exact=True).fill(body + '\n\n## 关键模块\n\n视觉编码器压缩图像，循环动态模型学习演化，控制器利用潜在状态决策。')
    page.get_by_role('button', name='查看发布预览', exact=True).click()
    page.get_by_role('button', name='确认发布到仓库', exact=True).click()
    page.locator('.review-status', has_text='审核中').wait_for()
    assert state['publish_calls'] == 2
    state['published'] = {**state['submitted'], 'tags': receipt['directions'], 'review': receipt, 'revision': 'approved-version', 'updatedAt': '2026-10-18T15:03:00Z'}
    state['jobs'][0].update(status='published', receipt=receipt, commitUrl='https://github.com/test-group/test-repo/commit/test')
    page.get_by_role('button', name='刷新', exact=True).click()
    page.locator('.review-status', has_text='已发布').wait_for()
    page.get_by_role('button', name='阅读笔记', exact=True).click()
    page.get_by_role('heading', name='World Models', exact=True).wait_for()
    assert original_insights in page.locator('.note-body').inner_text()
    assert page.locator('.review-receipt').count() == 1
    mobile = browser.new_context(viewport={'width': 390, 'height': 844})
    mobile.route('**/api/**', fixture)
    mobile_page = mobile.new_page(); mobile_page.goto(base + '#reviews'); mobile_page.wait_for_load_state('networkidle')
    mobile_page.locator('.review-status', has_text='已发布').wait_for()
    assert mobile_page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    mobile_page.screenshot(path=str(out / 'review-mobile.png'), full_page=True)
    assert not errors, errors
    browser.close()
print(json.dumps({'callsOnlyAfterConfirmation': True, 'pendingSurvivesReload': True, 'feedbackAndRevision': True, 'publishedReadable': True, 'mobile390': True, 'runtimeErrors': errors}, ensure_ascii=False))
