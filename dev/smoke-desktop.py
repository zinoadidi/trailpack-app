#!/usr/bin/env python3
"""Desktop layout smoke: 1440x900. Checks the language pills are visible without
a click, the sidebar rail sits on the left once signed in, nothing overflows
sideways, and the mobile layout (390px) still has a bottom bar.
  python3 dev/smoke-with.py dev/smoke-desktop.py"""
import os
import sys
import time
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://localhost:8787")
CODE = os.environ.get("CODE", "")
OUT = os.environ.get("OUT", os.path.join(os.path.dirname(os.path.abspath(__file__)), "shots-desktop"))
os.makedirs(OUT, exist_ok=True)
problems = []


def shot(page, name):
    page.screenshot(path=os.path.join(OUT, name + ".png"), full_page=True)


def overflow(page, label):
    wide = page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
    if wide > 1:
        problems.append("%s: page scrolls sideways by %spx" % (label, wide))


with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 900})
    page = ctx.new_page()
    page.route("**/config.json*", lambda r: r.fulfill(status=200, content_type="application/json", body='{"apiBase": "%s/api/v1"}' % BASE))
    errors = []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(BASE + "/")
    page.wait_for_timeout(800)

    pills = page.locator("button.langpill")
    if pills.count() != 5 or not pills.first.is_visible():
        problems.append("language pills not all visible on the access screen")
    shot(page, "01-access-desktop")
    overflow(page, "access")

    page.fill("#code", CODE)
    page.click("button[type=submit]")
    page.wait_for_timeout(900)
    page.fill("#name", "Desk User")
    page.fill("#email", "desk-%d@example.com" % int(time.time()))
    page.fill("#password", "desk-passphrase-here")
    page.click("button[type=submit]")
    page.wait_for_timeout(1500)
    shot(page, "02-home-desktop")
    overflow(page, "home")

    box = page.locator("nav.tabbar").bounding_box()
    if not box or box["x"] > 5 or box["width"] > 300 or box["height"] < 600:
        problems.append("sidebar rail not on the left at 1440px: %s" % box)
    main = page.locator("#main").bounding_box()
    if main and main["x"] < 200:
        problems.append("content sits under the sidebar: %s" % main)

    for route, name in [("me", "03-me-desktop"), ("library", "04-library-desktop"), ("language", "05-language-desktop")]:
        page.goto(BASE + "/#/" + route)
        page.wait_for_timeout(900)
        shot(page, name)
        overflow(page, route)

    page.set_viewport_size({"width": 390, "height": 844})
    page.goto(BASE + "/#/")
    page.wait_for_timeout(800)
    box = page.locator("nav.tabbar").bounding_box()
    if not box or box["y"] < 600 or box["width"] < 380:
        problems.append("mobile layout lost its bottom bar: %s" % box)
    shot(page, "06-home-mobile")
    overflow(page, "mobile home")

    if errors:
        problems.append("console errors: %s" % errors[:3])
    browser.close()

print("shots:", OUT)
print("PROBLEMS:" if problems else "OK", problems if problems else "")
sys.exit(1 if problems else 0)
