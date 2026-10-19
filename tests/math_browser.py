"""Math survives the actual import/edit/save/export workflow; no production writes."""
import os, pathlib, json, zipfile, sys
sys.path.insert(0, str(pathlib.Path('test-results/python-deps').resolve()))
from playwright.sync_api import sync_playwright, expect

root = pathlib.Path(__file__).resolve().parents[1]
out = root / 'test-results/math'
out.mkdir(parents=True, exist_ok=True)
base = os.environ.get('TEST_BASE_URL', 'http://127.0.0.1:5199/')
source = r'''# 公式与笔记验收

## 潜在动力学

状态$x_t$，行内预测 \(\hat z_{t+1}=f_\theta(z_t,a_t)\)。

$$
\mathcal L = \frac{1}{N}\sum_{i=1}^{N}\|z_i-\hat z_i\|_2^2
$$

\[
A=\begin{bmatrix}1 & 2 \\ 3 & 4\end{bmatrix}
\]

```math
\int_0^1 x^2\,dx = \frac{1}{3}
```

| 量 | 定义 |
| --- | --- |
| 正则 | $\lambda_i$ |

```python
literal = '$not_math$'
```

代码 `$also_not_math$`，价格 \$5 和 \$10，引用\[第2页\]。

错误公式保留源码 $\notARealCommand{x}$，后续正文仍应显示。

不可信公式 $\href{javascript:alert(1)}{click}$。

<span onclick="window.__MATH_BAD__=true">HTML 安全检查</span><script>window.__MATH_BAD__=true</script>
'''
source += '\n$$\n' + '+'.join('x_{'+str(i)+'}' for i in range(36)) + '\n$$\n'
(out / 'note.md').write_text(source, encoding='utf-8')

def fixture(route):
    path = route.request.url.split('/api/', 1)[1]
    values = {'config': {'title':'MCS_BIEP','configured':False,'authConfigured':False,'repository':'','branch':'main'}, 'session':None, 'directions':{'directions':[]}}
    route.fulfill(json=values.get(path, {'notes':[]}))

with sync_playwright() as p:
    browser = p.chromium.launch(channel=os.environ.get('TEST_BROWSER_CHANNEL','msedge') or None, headless=True)
    context = browser.new_context(viewport={'width':1440,'height':1050})
    context.route('**/api/**', fixture)
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(base+'#import')
    page.get_by_test_id('note-file').set_input_files(str(out/'note.md'))
    page.get_by_text('已解析，可继续整理',exact=True).wait_for()
    page.get_by_role('button',name='继续整理',exact=True).click()
    editor = page.get_by_role('textbox',name='笔记正文',exact=True)
    expect(editor.locator('[data-type="inline-math"]')).to_have_count(5)
    expect(editor.locator('[data-type="block-math"]')).to_have_count(4)
    assert editor.locator('.katex').count() >= 6
    assert r'\notARealCommand' in editor.inner_text()
    assert '$not_math$' in editor.locator('pre').inner_text()
    assert '$also_not_math$' in editor.inner_text()
    assert '[第2页]' in editor.inner_text()
    assert not page.evaluate('Boolean(window.__MATH_BAD__)')
    assert editor.locator('a[href^="javascript:"]').count() == 0
    editor.click(); editor.press('Control+End'); editor.press('Enter'); editor.type('编辑后公式仍保留。')
    page.get_by_role('button',name='Markdown',exact=True).click()
    markdown = page.get_by_role('textbox',name='Markdown 正文')
    value = markdown.input_value()
    for formula in [r'x_t',r'\hat z_{t+1}',r'\mathcal L',r'\begin{bmatrix}1 & 2 \\ 3 & 4\end{bmatrix}',r'\int_0^1',r'\lambda_i',r'\notARealCommand{x}']:
        assert formula in value, (formula,value)
    assert 'katex-html' not in value and '<math' not in value
    markdown.fill(value.replace('$x_t$', '$x_{t+1}$'))
    page.get_by_role('button',name='图文编辑',exact=True).click()
    expect(editor.locator('[data-latex="x_{t+1}"]')).to_have_count(1)
    page.get_by_role('button',name='预览',exact=True).click()
    preview = page.locator('.source-panel .note-body')
    expect(preview.locator('[data-type="block-math"]')).to_have_count(4)
    assert preview.locator('math').count() >= 6
    page.locator('.body-editor-heading').scroll_into_view_if_needed()
    page.screenshot(path=str(out/'desktop.png'))
    page.get_by_role('button',name='查看发布预览',exact=True).click()
    page.get_by_role('button',name='确认保存到本机',exact=True).click()
    reader = page.locator('.reader-paper .note-body')
    expect(reader.locator('[data-type="block-math"]')).to_have_count(4)
    page.reload(); page.wait_for_load_state('networkidle')
    expect(reader.locator('[data-latex="x_{t+1}"]')).to_have_count(1)
    assert '编辑后公式仍保留' in reader.inner_text()
    page.set_viewport_size({'width':390,'height':844})
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    assert reader.locator('[data-type="block-math"]').last.evaluate('(el)=>el.scrollWidth > el.clientWidth')
    page.screenshot(path=str(out/'mobile.png'))
    with page.expect_download() as download:
        page.get_by_role('button',name='导出笔记包',exact=True).click()
    download.value.save_as(str(out/'export.zip'))
    with zipfile.ZipFile(out/'export.zip') as z:
        exported = z.read('note.md').decode()
    assert '$x_{t+1}$' in exported and r'\sum_{i=1}^{N}' in exported
    assert 'katex' not in exported and '<math' not in exported
    page.goto(base+'#import'); page.reload(); page.wait_for_load_state('networkidle')
    page.get_by_test_id('note-file').set_input_files(str(out/'export.zip'))
    page.get_by_text('已解析，可继续整理',exact=True).wait_for()
    page.get_by_role('button',name='继续整理',exact=True).click()
    expect(editor.locator('[data-type="block-math"]')).to_have_count(4)
    expect(editor.locator('[data-latex="x_{t+1}"]')).to_have_count(1)
    assert not errors, errors
    browser.close()
print(json.dumps({'inlineAndBlockDelimiters':True,'mathCodeFence':True,'tableFormulas':True,'richEditSourceSaveReloadExportReimport':True,'codeCurrencyAndCitationsPreserved':True,'invalidMathReadable':True,'unsafeMathAndHtmlBlocked':True,'mobile390':True,'runtimeErrors':errors}))
