"""Browser acceptance for grouped notes and account nicknames (local API fixtures)."""
import copy
import json
import os
import pathlib
import sys
import zipfile

sys.path.insert(0, str(pathlib.Path("test-results/python-deps").resolve()))
from playwright.sync_api import sync_playwright, expect

out = pathlib.Path("test-results/contributors").resolve()
out.mkdir(parents=True, exist_ok=True)
base_url = os.environ.get("TEST_BASE_URL", "http://127.0.0.1:5199/")
results = []
sections = {key: "" for key in ["summary", "problem", "method", "evidence", "limitations", "insights", "original"]}


def note(number, login, author, title="Shared Paper", url="https://arxiv.org/abs/2601.12345"):
    return dict(id=f"note-{str(number) * 8}-{str(number) * 4}-4{str(number) * 3}-8{str(number) * 3}-{str(number) * 12}", title=title,
                subtitle="同论文的独立阅读笔记", year="2026", venue="arXiv", tags=["世界模型"], paperUrl=url, codeUrl="",
                author=author, authorLogin=login, authorId=1 if login == "alice" else 2,
                createdAt="2026-10-17T10:00:00Z", updatedAt=f"2026-10-18T1{number}:00:00Z", revision=f"revision-{number}",
                excerpt=f"{login}的独立内容", readingDepth="精读", sections={**sections, "summary": f"{login}的独立内容"}, assets=[], sourceNames=[])


notes = [note(1, "alice", "Alice GitHub"), note(2, "bob", "Bob", url="https://arxiv.org/pdf/2601.12345v2.pdf"),
         note(3, "alice", "Alice GitHub", "Another Paper", "https://doi.org/10.1000/another")]
notes[2].pop("authorId")  # A historical upload predating numeric account IDs.
account = dict(id=1, login="alice", name="Alice GitHub", githubName="Alice GitHub", nickname="", avatar="", canWrite=True)
state = {"fail_next": False, "signed_in": True}


def fixture(route):
    path = route.request.url.split("/api/", 1)[1]
    if path == "config":
        route.fulfill(json=dict(title="MCS_BIEP", configured=True, authConfigured=True, repository="group/papers", branch="main"))
    elif path == "session":
        route.fulfill(json=account if state["signed_in"] else None)
    elif path == "library":
        route.fulfill(json={"notes": notes})
    elif path == "directions":
        route.fulfill(json={"directions": ["世界模型"]})
    elif path.startswith("notes/"):
        found = next(n for n in notes if n["id"] == path.split("/")[1])
        route.fulfill(json=found)
    elif path == "reviews":
        route.fulfill(json={"jobs": []})
    elif path == "profile":
        assert route.request.method == "PUT"
        if state["fail_next"]:
            state["fail_next"] = False
            route.fulfill(status=503, json={"error": "暂时无法同步，昵称尚未修改。"})
            return
        nickname = route.request.post_data_json["nickname"].strip()
        account.update(nickname=nickname, name=nickname or account["githubName"])
        for n in notes:
            if n["authorLogin"] == "alice":
                n.update(author=account["name"], authorId=1)
        route.fulfill(json={"user": account, "notes": notes})
    else:
        route.fulfill(status=404, json={"error": f"Unknown fixture {path}"})


with sync_playwright() as p:
    browser = p.chromium.launch(channel="msedge", headless=True)
    try:
        ctx = browser.new_context(viewport={"width": 1440, "height": 1100}, accept_downloads=True)
        ctx.route("**/api/**", fixture)
        page = ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(base_url)
        page.wait_for_load_state("networkidle")
        expect(page.locator(".paper-card")).to_have_count(2)
        expect(page.locator(".library-stats")).to_contain_text("3 份笔记")
        expect(page.locator(".library-stats")).to_contain_text("2 位贡献者")
        shared = page.locator(".paper-card").filter(has=page.locator(".note-option", has_text="@bob"))
        expect(shared.locator(".note-option")).to_have_count(2)
        page.screenshot(path=str(out / "desktop-library.png"), full_page=True)
        page.get_by_role("textbox", name="搜索论文").fill("bob")
        expect(page.locator(".paper-card")).to_have_count(1)
        expect(page.locator(".note-option")).to_have_count(2)
        page.get_by_role("textbox", name="搜索论文").fill("")
        results.append("3 independent notes grouped into 2 papers; contributor count and author search preserve all choices")

        shared.locator(".note-option").filter(has_text="@bob").click()
        expect(page.locator(".note-preview")).to_contain_text("bob的独立内容")
        expect(page.get_by_role("button", name="编辑笔记", exact=True)).to_have_count(0)
        expect(page.locator(".reader-aside .note-option")).to_have_count(2)
        page.locator(".reader-aside .note-option").filter(has_text="@alice").click()
        expect(page.locator(".note-preview")).to_contain_text("alice的独立内容")
        expect(page.get_by_role("button", name="编辑笔记", exact=True)).to_be_visible()
        page.get_by_role("button", name="添加我的笔记", exact=True).click()
        expect(page.get_by_label("笔记标题", exact=True)).to_have_value("Shared Paper")
        expect(page.get_by_role("textbox", name="笔记正文", exact=True)).to_have_text("")
        page.locator('.metadata-panel > summary').click()
        expect(page.get_by_label("分享人", exact=True)).to_have_value("Alice GitHub")
        assert page.get_by_label("分享人", exact=True).get_attribute("readonly") is not None
        page.get_by_role("link", name="论文库", exact=True).click()
        results.append("reader switches author content; edit is owner-only; adding own note copies paper metadata with empty content")

        page.get_by_role("button", name="设置昵称", exact=True).click()
        expect(page.get_by_role("dialog")).to_be_visible()
        page.get_by_label("昵称", exact=True).fill("小张")
        state["fail_next"] = True
        page.get_by_role("button", name="保存昵称", exact=True).click()
        expect(page.get_by_role("alert")).to_contain_text("昵称尚未修改")
        expect(page.locator(".account")).to_contain_text("Alice GitHub")
        page.get_by_role("button", name="保存昵称", exact=True).click()
        expect(page.get_by_role("dialog")).to_have_count(0)
        expect(page.locator(".account")).to_contain_text("小张")
        expect(page.locator(".note-option").filter(has_text="小张")).to_have_count(2)
        expect(page.locator(".note-option").filter(has_text="@bob")).to_contain_text("Bob")
        page.reload()
        page.wait_for_load_state("networkidle")
        expect(page.locator(".account")).to_contain_text("小张")
        page.locator(".note-option").filter(has_text="@alice").first.click()
        expect(page.locator(".note-meta")).to_contain_text("小张")
        page.screenshot(path=str(out / "desktop-reader.png"), full_page=True)
        with page.expect_download() as downloaded:
            page.get_by_role("button", name="导出笔记包", exact=True).click()
        with zipfile.ZipFile(downloaded.value.path()) as package:
            assert 'author: "小张"' in package.read('note.md').decode('utf-8')
        results.append("nickname failure leaves identity unchanged; save updates both old notes; reload, reader and Markdown export retain new name")

        page.get_by_role("button", name="设置昵称", exact=True).click()
        page.get_by_role("button", name="使用 GitHub 名称", exact=True).click()
        page.get_by_role("button", name="保存昵称", exact=True).click()
        expect(page.locator(".account")).to_contain_text("Alice GitHub")
        expect(page.locator(".note-meta")).to_contain_text("Alice GitHub")
        page.get_by_role("button", name="设置昵称", exact=True).click()
        page.keyboard.press("Escape")
        expect(page.get_by_role("dialog")).to_have_count(0)
        results.append("clearing nickname restores GitHub name and prior-note attribution; Escape closes dialog")

        mobile_ctx = browser.new_context(viewport={"width": 390, "height": 844})
        mobile_ctx.route("**/api/**", fixture)
        mobile = mobile_ctx.new_page()
        mobile.goto(base_url)
        mobile.wait_for_load_state("networkidle")
        assert mobile.evaluate("document.documentElement.scrollWidth <= innerWidth")
        mobile.get_by_role("button", name="设置昵称", exact=True).click()
        mobile.get_by_label("昵称", exact=True).fill("长昵称" * 13)
        mobile.get_by_role("button", name="保存昵称", exact=True).click()
        expect(mobile.get_by_role("dialog")).to_have_count(0)
        mobile.screenshot(path=str(out / "mobile-library.png"), full_page=True)
        assert mobile.evaluate("document.documentElement.scrollWidth <= innerWidth")
        mobile.locator(".note-option").filter(has_text="@alice").first.click()
        expect(mobile.locator(".note-preview")).to_be_visible()
        assert mobile.evaluate("document.documentElement.scrollWidth <= innerWidth")
        results.append("390px signed-in mobile library, long nickname and reader show no horizontal overflow")

        page.get_by_role("button", name="上传笔记", exact=True).click()
        page.get_by_role("button", name="在线写笔记", exact=True).click()
        page.get_by_label("笔记标题", exact=True).fill("改名后仍应保留的草稿")
        page.get_by_role("textbox", name="笔记正文", exact=True).fill("先前输入的正文不能被昵称自动填充覆盖。")
        page.wait_for_timeout(1000)  # Wait for the existing 700ms draft debounce.
        page.reload()
        page.get_by_role("button", name="恢复继续编辑", exact=True).wait_for()
        page.wait_for_timeout(1000)
        page.get_by_role("button", name="恢复继续编辑", exact=True).click()
        expect(page.get_by_label("笔记标题", exact=True)).to_have_value("改名后仍应保留的草稿")
        expect(page.get_by_role("textbox", name="笔记正文", exact=True)).to_have_text("先前输入的正文不能被昵称自动填充覆盖。")
        page.locator('.metadata-panel > summary').click()
        expect(page.get_by_label("分享人", exact=True)).to_have_value(account["name"])
        results.append("restoring a signed-in draft preserves its title and body after debounce while adopting current nickname")

        state["signed_in"] = False
        guest_ctx = browser.new_context()
        guest_ctx.route("**/api/**", fixture)
        guest = guest_ctx.new_page()
        guest.goto(base_url)
        guest.wait_for_load_state("networkidle")
        expect(guest.locator(".paper-card")).to_have_count(2)
        guest.locator(".note-option").filter(has_text="@bob").click()
        expect(guest.locator(".note-preview")).to_contain_text("bob的独立内容")
        expect(guest.get_by_role("button", name="编辑笔记", exact=True)).to_have_count(0)
        results.append("guest can select and read each contributor note without an account")
        assert not errors, errors
        results.append("no desktop browser runtime errors")
    finally:
        browser.close()

(out / "results.json").write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(results, ensure_ascii=False))
