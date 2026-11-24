#!/usr/bin/env python3
"""Smoke: add a document, freeze a Pack, study one bite and finish it.
The flow the M5 study runner exists for, driven through the real UI against
the dev mock API:
  sign up -> Library -> New Pack -> paste a document -> map -> freeze ->
  write questions -> Practice -> Start a bite -> answer every step -> back here.
Run it with a fresh mock (codes are single use, the mock is in memory):
  python3 dev/smoke-with.py dev/smoke-study.py
Screenshots go to dev/shots-study/."""
import os
import sys
import time

from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://localhost:8787")
CODE = os.environ.get("CODE", "TRL-2345-6789-ABCD")
OUT = os.environ.get("OUT", os.path.join(os.path.dirname(os.path.abspath(__file__)), "shots-study"))
os.makedirs(OUT, exist_ok=True)
TEXT = (
    "A project has a start, a scope and a finish date. "
    "A milestone marks a single point in time, not a period of work. "
    "A baseline is the approved version of the plan you measure against."
)
problems = []


def shot(page, name):
    page.screenshot(path=os.path.join(OUT, name + ".png"), full_page=True)


def check(cond, message):
    if not cond:
        problems.append(message)
        print("PROBLEM:", message)


def config_route(route):
    route.fulfill(status=200, content_type="application/json", body='{"apiBase": "%s/api/v1"}' % BASE)


def sign_up(page):
    page.goto(BASE + "/#/access")
    page.wait_for_timeout(700)
    page.fill("#code", CODE)
    page.click("button[type=submit]")
    page.wait_for_timeout(900)
    page.fill("#name", "Study Walker")
    page.fill("#email", "study-%d@example.com" % int(time.time()))
    page.fill("#password", "demo-passphrase-here")
    page.click("button[type=submit]")
    page.wait_for_timeout(1800)
    check("#/" in page.url, "sign up did not land in the app: " + page.url)


def add_document(page):
    """Library -> New Pack -> paste -> map -> freeze -> questions."""
    page.goto(BASE + "/#/library")
    page.wait_for_timeout(1000)
    page.click("button:has-text('New Pack')")
    page.wait_for_timeout(400)
    page.fill("dialog input", "Trail basics")
    page.click("dialog button.p")
    page.wait_for_timeout(1200)
    check("/#/library/review" in page.url, "New Pack did not open the review screen: " + page.url)
    page.fill("textarea", TEXT)
    page.click("button:has-text('Add pasted text')")
    page.wait_for_timeout(2500)
    body = page.inner_text("body")
    check("Getting started" in body, "the map reply did not fill the review screen")
    check("null" not in body, "a null leaked into the review screen")
    check("Trail basics.txt" not in body, "an empty placeholder document was left in the Pack")
    check("Pasted text 1" in body, "the first real document has the wrong source name")
    check(body.count("2 facts need review") >= 2, "the review screen is missing total or topic needs-review badges")
    shot(page, "01-review")
    review_url = page.url
    page.goto(BASE + "/#/library")
    page.wait_for_timeout(500)
    check("2 facts need review" in page.inner_text("body"), "the Library is missing the draft Pack needs-review badge")
    page.goto(review_url)
    page.wait_for_timeout(500)
    page.get_by_role("button", name="Drop", exact=True).click()
    page.locator("dialog").get_by_role("button", name="Drop", exact=True).click()
    page.wait_for_timeout(500)
    check("facts need review" not in page.inner_text("body"), "the review header badge stayed stale after dropping a topic")
    page.fill("textarea", TEXT)
    page.click("button:has-text('Add pasted text')")
    page.wait_for_timeout(2500)
    freeze = page.query_selector("button:has-text('Freeze the Pack')")
    check(freeze is not None and freeze.is_enabled(), "the freeze button is not ready")
    if freeze:
        freeze.click()
        page.wait_for_timeout(1500)
    # More facts than the mock map returns would still be fine; one pass is enough.
    gen = page.query_selector("button:has-text('Write questions')")
    check(gen is not None and gen.is_enabled(), "Write questions button is missing or disabled")
    if gen and gen.is_enabled():
        gen.click()
    try:
        page.locator(".toast").filter(has_text="Questions written").wait_for(state="visible", timeout=5000)
    except Exception:
        check(False, "Write questions did not show a success toast")
    body = page.inner_text("body")
    check("0 of " not in body, "variants were not generated")
    check("Frozen" in body, "the Pack is not frozen")
    shot(page, "02-frozen")
    page.goto(BASE + "/#/library")
    page.wait_for_timeout(700)
    check("2 facts need review" in page.inner_text("body"), "the Library is missing the Pack needs-review badge")


def answer_step(page):
    """Answer whatever activity is on screen. Returns the activity kind seen."""
    html = page.content()
    if page.query_selector("#cloze-in"):
        page.fill("#cloze-in", "time")
        page.click("#main button:has-text('Check')")
        return "cloze"
    if page.query_selector("#main button:has-text('Show answer')"):
        page.click("#main button:has-text('Show answer')")
        page.wait_for_timeout(150)
        page.click("button[aria-label='Good']")
        return "flash"
    if page.query_selector("button[aria-label='Again']"):
        page.click("button[aria-label='Good']")
        return "flash"
    group = page.query_selector("#main [role=group]")
    if group:
        kind = "swipe" if "swipeCard" in html else "true-false"
        group.query_selector_all("button")[-1 if kind == "swipe" else 0].click()
        return kind
    options = page.query_selector_all("#main section > .stack > .btn")
    if len(options) >= 2:
        options[0].click()
        return "quiz"
    return "unknown"


def study_one_bite(page):
    page.goto(BASE + "/#/practice")
    page.wait_for_timeout(1400)
    body = page.inner_text("body")
    check("Start a bite" in body, "Practice has no start button")
    check("Review weak facts" in body, "Practice has no weak review button")
    shot(page, "03-practice")
    page.click("#main button:has-text('Start a bite')")
    page.wait_for_timeout(1800)
    check("#/study" in page.url, "Start a bite did not open the runner: " + page.url)
    shot(page, "04-step1")
    kinds = []
    for index in range(14):
        if "#/bite" in page.url:
            break
        nxt = next_step(page)
        if nxt:
            nxt.click()
            page.wait_for_timeout(600)
            continue
        kinds.append(answer_step(page))
        page.wait_for_timeout(800)
        shot(page, "05-step-%02d" % index)
        nxt = next_step(page)
        if nxt:
            nxt.click()
            page.wait_for_timeout(600)
    page.wait_for_timeout(1600)
    check("#/bite" in page.url, "the bite did not reach Bite complete: " + page.url)
    check("Bite complete" in page.inner_text("body"), "Bite complete screen missing")
    check("unknown" not in kinds, "an activity was not answered: " + str(kinds))
    shot(page, "06-bite-complete")
    print("activities answered:", kinds)
    page.goto(BASE + "/#/practice")
    page.wait_for_timeout(1400)
    check("Resume your bite" not in page.inner_text("body"), "a finished bite can still be resumed")


def next_step(page):
    for label in ("Next", "Finish bite"):
        button = page.get_by_role("button", name=label, exact=True)
        if button.count() and button.is_visible():
            return button
    return None


def themes(page):
    for theme in ["light", "ocean", "matcha", "dark"]:
        page.evaluate("document.documentElement.dataset.theme = '%s'" % theme)
        page.goto(BASE + "/#/practice")
        page.wait_for_timeout(1000)
        page.click("#main button:has-text('Start a bite')")
        page.wait_for_timeout(1400)
        check("#/study" in page.url, "the runner did not open in theme " + theme)
        shot(page, "07-theme-" + theme)
        page.click("button:has-text('Finish now')")
        page.wait_for_timeout(400)
        page.click("dialog button.p")
        page.wait_for_timeout(800)


with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, reduced_motion="reduce")
    page = ctx.new_page()
    page.route("**/config.json*", config_route)
    errors = []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))

    sign_up(page)
    add_document(page)
    study_one_bite(page)
    themes(page)

    real_errors = [e for e in errors if "favicon" not in e.lower()]
    print("console errors:", real_errors[:8])
    if real_errors:
        problems.append("console errors: %d" % len(real_errors))
    print("PROBLEMS:", problems if problems else "none")
    print("shots in", OUT)
    browser.close()
    sys.exit(1 if problems else 0)
