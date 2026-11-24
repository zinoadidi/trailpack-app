#!/usr/bin/env python3
"""Browser smoke test for M1. Drives the real app against the dev mock API.
Screenshots go to the temp dir printed at the end. Not part of the repo tests."""
import os
import sys
import time
import glob
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://localhost:8787")
CODE = os.environ.get("CODE", "")
OUT = os.environ.get("OUT", os.path.join(os.path.dirname(os.path.abspath(__file__)), "shots"))
os.makedirs(OUT, exist_ok=True)

problems = []

def config_route(route):
    route.fulfill(status=200, content_type="application/json",
                  body='{"apiBase": "%s/api/v1"}' % BASE)


def shot(page, name):
    page.screenshot(path=os.path.join(OUT, name + ".png"), full_page=True)

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 390, "height": 844})
    page = ctx.new_page()
    # Point the app at this mock server, then reload so the module graph restarts.
    page.route("**/config.json*", config_route)
    errors = []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))

    page.goto(BASE + "/")
    page.wait_for_timeout(800)
    print("url after load:", page.url)
    if "#/access" not in page.url:
        problems.append("not redirected to access: " + page.url)
    shot(page, "01-access")

    # bad code
    page.fill("#code", "TRL-ZZZZ-ZZZZ-ZZZZ")
    page.click("button[type=submit]")
    page.wait_for_timeout(600)
    body = page.inner_text("body")
    if "did not work" not in body:
        problems.append("no generic error for a bad code")
    shot(page, "02-access-error")

    # language switch before sign in (Estonian)
    page.wait_for_timeout(300)
    page.click("button.langpill[lang='et']")
    page.wait_for_timeout(800)
    if "Õppekood" not in page.inner_text("body"):
        problems.append("app language did not switch to Estonian")
    shot(page, "03-access-et")
    page.click("button.langpill[lang='en']")
    page.wait_for_timeout(800)

    # redeem a real code
    page.fill("#code", CODE)
    page.click("button[type=submit]")
    page.wait_for_timeout(900)
    if "#/create" not in page.url:
        problems.append("valid code did not go to create: " + page.url)
        shot(page, "zz-create-failed")
        print("PROBLEMS:", problems)
        sys.exit(1)
    shot(page, "04-create")

    page.fill("#name", "Demo User")
    page.fill("#email", "demo-%d@example.com" % int(time.time()))
    page.fill("#password", "demo-passphrase-here")
    page.click("button[type=submit]")
    page.wait_for_timeout(1500)
    print("after create:", page.url)
    if page.url.rstrip("/").endswith("#") or "#/" != page.url[-2:]:
        pass
    shot(page, "05-home")

    # Me
    page.click("a[href='#/me']")
    page.wait_for_timeout(1500)
    body = page.inner_text("body")
    for needle in ["AI model", "Muse", "DeepSeek Flash", "Sync", "Storage", "Sign out"]:
        if needle not in body:
            problems.append("Me screen missing: " + needle)
    shot(page, "06-me")

    # themes: light (Sunrise), ocean (Deep Ocean), matcha (Matcha Pop), system
    for theme, shotname in [("Light", "07-me-light"), ("Deep Ocean", "07b-me-ocean"), ("Matcha Pop", "07c-me-matcha")]:
        page.click(f".themebtn[aria-label='{theme}']")
        page.wait_for_timeout(800)
        applied = page.evaluate("document.documentElement.dataset.theme")
        if theme == "Light" and applied != "light":
            problems.append("light theme not applied: " + str(applied))
        if theme == "Deep Ocean" and applied != "ocean":
            problems.append("ocean theme not applied: " + str(applied))
        if theme == "Matcha Pop" and applied != "matcha":
            problems.append("matcha theme not applied: " + str(applied))
        shot(page, shotname)

    # system follows the OS (headless Chromium defaults to light)
    page.click(".themes ~ .row button:has-text('System')")
    page.wait_for_timeout(800)
    applied = page.evaluate("document.documentElement.dataset.theme")
    if applied not in ("light", "dark"):
        problems.append("system theme did not resolve: " + str(applied))

    # back to dark
    page.click(".themebtn[aria-label='Dark']")
    page.wait_for_timeout(800)
    applied = page.evaluate("document.documentElement.dataset.theme")
    if applied != "dark":
        problems.append("dark theme not applied: " + str(applied))

    # model choice
    page.click("button.opt:has-text('DeepSeek Flash')")
    page.wait_for_timeout(1200)
    body = page.inner_text("body")
    shot(page, "08-me-model")

    # language screen
    page.click("a[href='#/language']")
    page.wait_for_timeout(800)
    shot(page, "09-language")
    page.click("button.lang:has-text('Español')")
    page.wait_for_timeout(1200)
    shot(page, "10-language-es")
    page.click("button.lang:has-text('English')")
    page.wait_for_timeout(1000)

    # Admin is owner only; a member should never see it
    page.goto(BASE + "/#/admin")
    page.wait_for_timeout(800)
    if "#/admin" in page.url:
        problems.append("member reached admin")
    shot(page, "11-admin-blocked")

    # sign out keeps data, then log in again
    email = page.evaluate("JSON.parse(localStorage.getItem('trailpack.prefs')||'{}')")
    page.click("a[href='#/me']")
    page.wait_for_timeout(1000)
    signin_email = None
    for row in page.query_selector_all(".kv"):
        pass
    page.click("button:has-text('Sign out')")
    page.wait_for_timeout(1200)
    if "#/access" not in page.url:
        problems.append("sign out did not return to access: " + page.url)
    shot(page, "12-signed-out")

    page.goto(BASE + "/#/login")
    page.wait_for_timeout(600)
    shot(page, "13-login")

    # owner flow in a fresh context
    ctx2 = browser.new_context(viewport={"width": 390, "height": 844})
    p2 = ctx2.new_page()
    p2.on("pageerror", lambda e: errors.append("owner: " + str(e)))
    p2.route("**/config.json*", config_route)
    p2.goto(BASE + "/#/login")
    p2.wait_for_timeout(700)
    p2.fill("#email", "owner@example.com")
    p2.fill("#password", "a-demo-pass-phrase")
    p2.click("button[type=submit]")
    p2.wait_for_timeout(1500)
    p2.goto(BASE + "/#/admin")
    p2.wait_for_timeout(1800)
    body = p2.inner_text("body")
    for needle in ["Study codes", "Create one time code", "Accounts", "Usage", "Providers"]:
        if needle not in body:
            problems.append("admin missing: " + needle)
    shot(p2, "14-admin")
    p2.click("button:has-text('Create one time code')")
    p2.wait_for_timeout(1500)
    shot(p2, "15-admin-code")
    body = p2.inner_text("body")
    if "copy it now" not in body:
        problems.append("created code not shown once")

    # desktop width
    ctx3 = browser.new_context(viewport={"width": 1280, "height": 900})
    p3 = ctx3.new_page()
    p3.route("**/config.json*", config_route)
    p3.goto(BASE + "/")
    p3.wait_for_timeout(800)
    shot(p3, "16-desktop-access")

    browser.close()

    real_errors = [e for e in errors if "favicon" not in e.lower() and "400" not in e]
    print("console errors:", real_errors[:10])
    if real_errors:
        problems.append("console errors: %d" % len(real_errors))
    print("PROBLEMS:", problems if problems else "none")
    print("shots in", OUT)
    sys.exit(1 if problems else 0)
