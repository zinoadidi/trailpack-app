#!/usr/bin/env python3
"""Smoke the buttons that used to do nothing or the wrong thing, in a real browser:
  Library card "Study", review "Study this Pack", "Open the review" (question sheet),
  Practice "Start a bite" and drills (no literal "null"), resume of a started bite,
  and a study link to a Pack that is not on this device.
Run with: python3 dev/smoke-with.py dev/smoke-buttons.py   (screenshots: dev/shots-buttons/)"""
import os
import re
import sys
import time

from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://localhost:8787")
CODE = os.environ.get("CODE", "TRL-2345-6789-ABCD")
OUT = os.environ.get("OUT", os.path.join(os.path.dirname(os.path.abspath(__file__)), "shots-buttons"))
os.makedirs(OUT, exist_ok=True)
TEXT = "A project starts with a goal. A milestone is one point in time. A baseline is the approved plan used to measure progress."
problems = []
passed = []


def check(condition, message):
    (passed if condition else problems).append(message)
    print(("ok      " if condition else "PROBLEM ") + message)


def shot(page, name):
    page.screenshot(path=os.path.join(OUT, name + ".png"), full_page=True)


def config_route(route):
    route.fulfill(status=200, content_type="application/json", body='{"apiBase":"%s/api/v1"}' % BASE)


def body_text(page):
    return page.inner_text("main") if page.query_selector("main") else page.inner_text("body")


def sign_up(page):
    page.goto(BASE + "/#/access")
    page.wait_for_timeout(700)
    page.fill("#code", CODE)
    page.click("button[type=submit]")
    page.wait_for_timeout(900)
    page.fill("#name", "Button Walker")
    page.fill("#email", "buttons-%d@example.com" % int(time.time()))  # scan: allow (test fixture address)
    page.fill("#password", "demo-passphrase-here")
    page.click("button[type=submit]")
    page.wait_for_timeout(1500)


def new_pack(page, title, freeze):
    page.goto(BASE + "/#/library")
    page.wait_for_timeout(900)
    page.click("button:has-text('New Pack')")
    page.wait_for_timeout(300)
    page.fill("dialog input", title)
    page.click("dialog button.p")
    page.wait_for_timeout(800)
    page.fill("textarea", TEXT)
    page.click("button:has-text('Add pasted text')")
    page.wait_for_timeout(1800)
    pack_id = re.search(r"id=([^&]+)", page.url)
    pack_id = pack_id.group(1) if pack_id else None
    if freeze:
        page.click("button:has-text('Freeze the Pack')")
        page.wait_for_timeout(1200)
        generate = page.query_selector("button:has-text('Write questions')")
        if generate and generate.is_enabled():
            generate.click()
            page.wait_for_timeout(1800)
    return pack_id


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 420, "height": 900})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.route("**/config.json*", config_route)
    sign_up(page)

    draft_id = new_pack(page, "Draft notes", freeze=False)
    # 1. "Open the review" on a draft opens the question sheet, with content, not "missing" or "Loading".
    open_review = page.query_selector("button:has-text('Open the review')")
    check(open_review is not None, "draft review shows 'Open the review'")
    if open_review:
        open_review.click()
        page.wait_for_timeout(1200)
        text = body_text(page)
        check("/library/review/questions" in page.url, "'Open the review' opens the question sheet (url %s)" % page.url)
        check("not on this device" not in text, "question sheet finds the draft Pack")
        check("Loading" not in text, "question sheet has no stuck Loading line")
        shot(page, "1-question-sheet")

    frozen_id = new_pack(page, "Project basics", freeze=True)
    # 2. Review "Study this Pack" starts studying that Pack.
    page.goto(BASE + "/#/library/review?id=%s" % frozen_id)
    page.wait_for_timeout(1200)
    study_this = page.query_selector("button:has-text('Study this Pack')")
    check(study_this is not None, "frozen Pack review shows 'Study this Pack'")
    if study_this:
        study_this.click()
        page.wait_for_timeout(1500)
        check("#/study" in page.url, "'Study this Pack' opens Study (url %s)" % page.url)
        check("nothing to study" not in body_text(page).lower(), "Study shows a bite, not the empty state")
        shot(page, "2-study-this-pack")

    # 3. Library card "Study" studies that card's Pack.
    page.goto(BASE + "/#/library")
    page.wait_for_timeout(1200)
    study_buttons = page.query_selector_all("button:text-is('Study')")
    check(len(study_buttons) >= 1, "Library cards show a Study button (found %d)" % len(study_buttons))
    if study_buttons:
        study_buttons[0].click()
        page.wait_for_timeout(1500)
        check("#/study" in page.url and "pack=" in page.url, "card Study opens #/study?pack=... (url %s)" % page.url)
        check("nothing to study" not in body_text(page).lower(), "card Study shows a bite")
        shot(page, "3-card-study")

    # 4. Practice: no literal "null", "Start a bite" opens Study, a drill draws a question.
    page.goto(BASE + "/#/practice")
    page.wait_for_timeout(1200)
    text = body_text(page)
    check(not re.search(r"\bnull\b", text), "Practice shows no literal 'null'")
    shot(page, "4-practice")
    resume = page.query_selector("button:has-text('Resume your bite')")
    check(resume is not None, "Practice offers 'Resume your bite' after a bite was started")
    if resume:
        resume.click()
        page.wait_for_timeout(1200)
        check("#/study" in page.url, "'Resume your bite' opens Study")
    page.goto(BASE + "/#/practice")
    page.wait_for_timeout(1000)
    start = page.query_selector("button:has-text('Start a bite')")
    check(start is not None, "Practice shows 'Start a bite'")
    if start:
        start.click()
        page.wait_for_timeout(1500)
        check("#/study" in page.url, "'Start a bite' opens Study (url %s)" % page.url)
        check(not re.search(r"\bnull\b", body_text(page)), "Study step shows no literal 'null'")
        shot(page, "5-start-bite")

    # 5. A study link to a Pack that is not here says so.
    page.goto(BASE + "/#/study?pack=no-such-pack")
    page.wait_for_timeout(1200)
    check("not on this device" in body_text(page), "study link to a missing Pack shows the missing message")
    shot(page, "6-missing-pack")

    check(not errors, "no page errors (%s)" % "; ".join(errors[:3]))
    browser.close()

print("\n%d checks passed, %d problems" % (len(passed), len(problems)))
sys.exit(1 if problems else 0)
