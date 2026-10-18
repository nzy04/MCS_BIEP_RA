"""Title intake and catalog browser acceptance; all writes use local API fixtures."""
import json, os, pathlib, sys
sys.path.insert(0, str(pathlib.Path("test-results/python-deps").resolve()))
from playwright.sync_api import sync_playwright, expect

out=pathlib.Path("test-results/catalog").resolve();out.mkdir(parents=True,exist_ok=True)
base=os.environ.get("TEST_BASE_URL","http://127.0.0.1:5188/")
candidate=dict(title="World Models",authors=["David Ha","Jürgen Schmidhuber"],year="2018",venue="arXiv",abstract="We explore building generative neural network models of popular reinforcement learning environments.",paperUrl="https://arxiv.org/abs/1803.10122",pdfUrl="https://arxiv.org/pdf/1803.10122",doi="",source="arxiv",tags=["世界模型"],license="",score=1,token="signed-candidate")
paper={**{k:v for k,v in candidate.items() if k!="token"},"id":"paper-"+"a"*32,"createdAt":"2026-10-18T00:00:00Z","updatedAt":"2026-10-18T00:00:00Z","addedBy":"alice","pdfStatus":"external","pdfMessage":"PDF 已验证；未确认可再分发许可，保留原站链接。","pdfVerified":True}
account=dict(id=1,login="alice",name="Alice",avatar="",canWrite=True)
job=dict(id="review-"+"b"*48,kind="paper",noteId=paper["id"],title=paper["title"],status="queued",createdAt=paper["createdAt"],updatedAt=paper["updatedAt"],issues=[],message="")
state=dict(signed=True,searches=0,submissions=0,published=False,jobs=[],papers=[],empty=False,fail=False)
def fixture(route):
    path=route.request.url.split("/api/",1)[1]
    if path=="config":route.fulfill(json=dict(title="MCS_BIEP",configured=True,authConfigured=True,reviewConfigured=True,repository="group/papers",branch="main"))
    elif path=="session":route.fulfill(body=json.dumps(account if state["signed"] else None),content_type="application/json")
    elif path=="library":route.fulfill(json={"notes":[]})
    elif path=="papers":route.fulfill(json={"papers":state["papers"]})
    elif path.startswith("papers/"):route.fulfill(json=paper)
    elif path=="directions":route.fulfill(json={"directions":["世界模型","机器人"]})
    elif path=="paper-search":
        state["searches"]+=1
        if state["fail"]:route.fulfill(status=503,json={"error":"来源暂时不可用，请稍后重试。"})
        else:route.fulfill(json=dict(candidates=[] if state["empty"] else [candidate,{**candidate,"title":"World Models for Other Tasks","authors":["Other"],"year":"2026","token":"other"}],fallback=False,message="未找到可靠匹配。" if state["empty"] else ""))
    elif path=="paper-collect":
        body=route.request.post_data_json;assert body["token"]=="signed-candidate";assert body["tags"]==["世界模型","机器人"]
        state["submissions"]+=1;state["jobs"]=[job.copy()];route.fulfill(status=202,json={"job":job})
    elif path=="reviews":route.fulfill(json={"jobs":state["jobs"]})
    else:route.fulfill(status=404,json={"error":"Unknown fixture "+path})

results=[]
with sync_playwright() as p:
    browser=p.chromium.launch(channel="msedge",headless=True)
    try:
        ctx=browser.new_context(viewport={"width":1440,"height":1000});ctx.route("**/api/**",fixture)
        page=ctx.new_page();errors=[];page.on("pageerror",lambda e:errors.append(str(e)))
        page.goto(base+"#collect");expect(page.get_by_role("heading",name="按标题收录",exact=True)).to_be_visible()
        page.get_by_label("论文标题",exact=True).fill("World Models");assert state["searches"]==0
        page.get_by_role("button",name="检索论文",exact=True).click();expect(page.locator(".candidate")).to_have_count(2)
        assert state["submissions"]==0
        page.locator(".candidate").first.click();page.get_by_label("机器人",exact=True).check()
        page.screenshot(path=str(out/"desktop-intake.png"),full_page=True)
        page.get_by_role("button",name="确认收录",exact=True).click();expect(page.get_by_role("heading",name="我的提交",exact=True)).to_be_visible();expect(page.locator(".review-status")).to_have_text("收录中")
        assert state["searches"]==1 and state["submissions"]==1
        results.append("search requires explicit action; candidate confirmation submits once with selected directions")
        state["jobs"][0].update(status="published",message=paper["pdfMessage"],commitUrl="https://github.com/group/papers/commit/test")
        state["papers"]=[paper]
        page.get_by_role("button",name="刷新",exact=True).click();expect(page.locator(".review-status")).to_have_text("已收录")
        page.get_by_role("button",name="查看论文",exact=True).click();expect(page.locator(".catalog-paper h1")).to_have_text("World Models");expect(page.get_by_role("link",name="阅读 PDF",exact=True)).to_have_attribute("href",candidate["pdfUrl"])
        expect(page.locator(".pdf-message")).to_contain_text("原站链接");page.screenshot(path=str(out/"desktop-paper.png"),full_page=True)
        results.append("completed job opens paper with abstract, verified PDF link and no fabricated notes")
        page.get_by_role("button",name="返回论文库",exact=True).click();expect(page.locator(".paper-card")).to_have_count(1);expect(page.locator(".library-stats")).to_contain_text("0 份笔记");expect(page.locator(".reading-label")).to_have_text("待读")
        page.get_by_role("textbox",name="搜索论文").fill("David Ha");expect(page.locator(".paper-card")).to_have_count(1)
        page.locator(".card-title").click();page.get_by_role("button",name="添加我的笔记",exact=True).click();expect(page.get_by_role("textbox",name="笔记标题",exact=True)).to_have_value("World Models")
        results.append("catalog entries are searchable by paper authors and start independent personal notes")
        page.goto(base+"#collect");page.set_viewport_size({"width":390,"height":844});page.get_by_label("论文标题",exact=True).fill("World Models");page.get_by_role("button",name="检索论文",exact=True).click();page.locator(".candidate").first.click()
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"),"mobile horizontal overflow"
        assert page.evaluate("[...document.querySelectorAll('.primary-nav a')].every(a=>a.getBoundingClientRect().bottom <= document.querySelector('.app-header').getBoundingClientRect().bottom)"),"navigation outside header"
        page.screenshot(path=str(out/"mobile-intake.png"),full_page=True)
        page.set_viewport_size({"width":900,"height":900});assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"),"tablet horizontal overflow"
        results.append("390px mobile and 900px tablet layouts have no page overflow")
        state["empty"]=True;page.get_by_role("button",name="检索论文",exact=True).click();expect(page.get_by_role("alert")).to_contain_text("未找到可靠匹配");expect(page.get_by_role("button",name="确认收录",exact=True)).to_have_count(0)
        state["fail"]=True;page.get_by_role("button",name="检索论文",exact=True).click();expect(page.get_by_role("alert")).to_contain_text("来源暂时不可用")
        results.append("empty and failed searches report actionable messages without a submit action")
        state["signed"]=False;page.reload();expect(page.get_by_role("heading",name="登录后收录论文",exact=True)).to_be_visible();expect(page.get_by_label("论文标题",exact=True)).to_have_count(0)
        assert not errors,errors
        results.append("anonymous collection requires login; no browser exceptions")
        (out/"results.json").write_text(json.dumps({"passed":results,"errors":errors},ensure_ascii=False,indent=2),encoding="utf-8")
        print(json.dumps({"passed":len(results),"results":results},ensure_ascii=False))
    finally:browser.close()

