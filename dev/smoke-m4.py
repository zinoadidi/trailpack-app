#!/usr/bin/env python3
"""Browser smoke test for M4 only (progress, biting, Lens, exports, certificate).
Runs against the dev mock API. Not part of `npm test`: it needs a browser.
  BASE=http://localhost:8801 CODE=TRL-... python3 dev/smoke-m4.py
"""
import os
import sys
import time

from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://localhost:8801")
CODE = os.environ.get("CODE", "")
# Study codes are single use: the second account needs a second unused code.
# The seed mock prints CODE and also seeds CODE with its last letter bumped.
CODE2 = os.environ.get("CODE2", CODE[:-1] + "E" if CODE.endswith("D") else "")
OUT = os.environ.get("OUT", os.path.join(os.path.dirname(os.path.abspath(__file__)), "shots-m4"))
os.makedirs(OUT, exist_ok=True)
problems = []


def shot(page, name):
    page.screenshot(path=os.path.join(OUT, name + ".png"), full_page=True)


def config_route(route):
    route.fulfill(status=200, content_type="application/json", body='{"apiBase": "%s/api/v1"}' % BASE)


def sign_up(page):
    page.goto(BASE + "/#/access")
    page.wait_for_timeout(600)
    page.fill("#code", CODE)
    page.click("button[type=submit]")
    page.wait_for_timeout(800)
    page.fill("#name", "Demo Walker")
    page.fill("#email", "m4-%d@example.com" % int(time.time()))
    page.fill("#password", "demo-passphrase-here")
    page.click("button[type=submit]")
    page.wait_for_timeout(1600)


with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, reduced_motion="reduce")
    page = ctx.new_page()
    page.route("**/config.json*", config_route)
    errors = []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))
    sign_up(page)
    if "#/" not in page.url:
        problems.append("sign up did not land on trail: " + page.url)

    # Trail has the M4 entry points
    page.goto(BASE + "/#/me")
    page.wait_for_timeout(900)
    body = page.inner_text("body")
    for needle in ["Your progress", "Exports"]:
        if needle not in body:
            problems.append("trail missing entry point: " + needle)
    shot(page, "01-trail")
    page.goto(BASE + "/#/me")
    page.wait_for_timeout(900)
    body = page.inner_text("body")
    for needle in ["Your progress", "Exports"]:
        if needle not in body:
            problems.append("trail missing entry point: " + needle)
    shot(page, "01-trail")

    # Progress screen: level, streaks, shortcuts, achievements
    page.goto(BASE + "/#/progress")
    page.wait_for_timeout(1200)
    body = page.inner_text("body")
    for needle in ["Level 1", "Day streak", "Plan streak", "Shortcuts", "Achievements", "of 28", "Study style"]:
        if needle not in body:
            problems.append("progress missing: " + needle)
    shot(page, "02-progress")

    # Presets: pick Exam crammer and approve
    page.click("button:has-text('Exam crammer')")
    page.wait_for_timeout(500)
    body = page.inner_text("body")
    if "Apply this Lens change?" not in body:
        problems.append("preset did not open the approval sheet")
    shot(page, "03-lens-approve")
    page.click("dialog button.btn.p")
    page.wait_for_timeout(800)
    body = page.inner_text("body")
    if "Exam crammer" not in body:
        problems.append("Lens preset was not applied")
    shot(page, "04-lens-applied")

    # Prompt bar with the rule fallback (mock may or may not answer, both fine)
    page.fill(".lensbar input", "more scenarios, fewer definitions")
    page.click(".lensbar button.btn.p")
    page.wait_for_timeout(1200)
    if page.query_selector("dialog"):
        page.click("dialog button.btn.p")
        page.wait_for_timeout(600)
    shot(page, "05-lens-prompt")

    # Shortcuts: spend one
    before = page.inner_text("body")
    page.click("button:has-text('Use a shortcut')")
    page.wait_for_timeout(800)
    after = page.inner_text("body")
    if before.split("shortcut") == after.split("shortcut"):
        problems.append("shortcut button did nothing visible")
    shot(page, "06-shortcut")

    # Bite complete: demo bite, reduced motion means no confetti pieces
    page.goto(BASE + "/#/bite")
    page.wait_for_timeout(1400)
    body = page.inner_text("body")
    for needle in ["Bite complete", "Variety bonus", "Day streak"]:
        if needle not in body:
            problems.append("bite screen missing: " + needle)
    pieces = page.eval_on_selector_all(".confetti .piece", "els => els.length")
    if pieces != 0:
        problems.append("confetti drawn under reduced motion: %d" % pieces)
    if "less motion" not in body:
        problems.append("no reduced motion note on the bite screen")
    shot(page, "07-bite-reduced")

    ctx2 = browser.new_context(viewport={"width": 390, "height": 844})
    page2 = ctx2.new_page()
    page2.route("**/config.json*", config_route)
    page2.goto(BASE + "/#/access")
    page2.wait_for_timeout(600)
    page2.fill("#code", CODE2)
    page2.click("button[type=submit]")
    page2.wait_for_timeout(800)
    page2.fill("#name", "Demo Walker 2")
    page2.fill("#email", "m4b-%d@example.com" % int(time.time()))
    page2.fill("#password", "demo-passphrase-here")
    page2.click("button[type=submit]")
    page2.wait_for_timeout(1600)
    page2.goto(BASE + "/#/bite")
    page2.wait_for_timeout(1400)
    pieces = page2.eval_on_selector_all(".confetti .piece", "els => els.length")
    if pieces == 0:
        problems.append("no confetti with motion allowed")
    shot(page2, "08-bite-motion")

    # Exports: no pack yet, so the empty state, then the certificate gate
    page.goto(BASE + "/#/exports")
    page.wait_for_timeout(900)
    body = page.inner_text("body")
    if "Freeze a pack first" not in body:
        problems.append("exports empty state missing")
    shot(page, "09-exports-empty")

    # The Library tab opens the library (exports is reached from Me)
    page.click("a[href='#/library']")
    page.wait_for_timeout(800)
    if "#/library" not in page.url:
        problems.append("Library tab did not open the library: " + page.url)

    # Every theme still paints on the progress screen
    for theme in ["Dark", "Light", "Deep Ocean", "Matcha Pop"]:
        page.goto(BASE + "/#/me")
        page.wait_for_timeout(800)
        page.click(".themebtn[aria-label='%s']" % theme)
        page.wait_for_timeout(700)
        page.goto(BASE + "/#/progress")
        page.wait_for_timeout(900)
        shot(page, "10-progress-" + theme.replace(" ", "-").lower())

    browser.close()
    real = [e for e in errors if "favicon" not in e.lower()]
    if real:
        problems.append("console errors: %s" % real[:3])
    print("PROBLEMS:", problems if problems else "none")
    sys.exit(1 if problems else 0)
