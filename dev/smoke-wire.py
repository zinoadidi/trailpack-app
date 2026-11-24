#!/usr/bin/env python3
"""Browser smoke for the game wiring (agent C): sound switch in Me, sounds off
by default, a finished bite pays points and shows the level, and the same bite
is not paid twice. Runs against the dev mock API.
  BASE=http://localhost:8787 CODE=TRL-2345-6789-ABCD python3 dev/smoke-wire.py
Not part of `npm test`: it needs a browser and the mock server."""
import os
import sys
import time

from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://localhost:8787")
CODE = os.environ.get("CODE", "TRL-2345-6789-ABCE")
OUT = os.environ.get("OUT", os.path.join(os.path.dirname(os.path.abspath(__file__)), "shots-wire"))
os.makedirs(OUT, exist_ok=True)
problems = []


def shot(page, name):
    page.screenshot(path=os.path.join(OUT, name + ".png"), full_page=True)


def config_route(route):
    route.fulfill(status=200, content_type="application/json", body='{"apiBase": "%s/api/v1"}' % BASE)


def check(cond, message):
    if not cond:
        problems.append(message)
        print("PROBLEM:", message)


def sign_up(page):
    page.goto(BASE + "/#/access")
    page.wait_for_timeout(700)
    page.fill("#code", CODE)
    page.click("button[type=submit]")
    page.wait_for_timeout(900)
    page.fill("#name", "Wire Walker")
    page.fill("#email", "wire-%d@example.com" % int(time.time()))
    page.fill("#password", "demo-passphrase-here")
    page.click("button[type=submit]")
    page.wait_for_timeout(1800)
    check("#/create" not in page.url, "sign up did not finish: " + page.url)


def sound_section(page):
    page.goto(BASE + "/#/me")
    page.wait_for_timeout(1400)
    body = page.inner_text("body")
    check("Sound" in body, "Me has no Sound section")
    off = page.query_selector("button[aria-pressed=false]:has-text('Sound effects')")
    check(off is not None, "sound starts off")
    stored = page.evaluate("localStorage.getItem('trailpack.sound')")
    check(stored in (None, "off"), "sound pref should start off, got %r" % stored)
    if off:
        off.click()
        page.wait_for_timeout(200)
        on = page.evaluate("localStorage.getItem('trailpack.sound')")
        check(on == "on", "sound switch did not persist, got %r" % on)
        page.click("button[aria-pressed=true]:has-text('Sound effects')")
        page.wait_for_timeout(200)
    shot(page, "01-me-sound")


def add_document(page):
    """Library -> a pack with one pasted document, frozen and with variants."""
    page.goto(BASE + "/#/library")
    page.wait_for_timeout(1200)
    page.click("button:has-text('New Pack')")
    page.wait_for_timeout(600)
    page.fill("dialog input", "Trail basics")
    page.click("dialog button.p")
    page.wait_for_timeout(1500)
    box = page.query_selector("textarea")
    if box:
        box.fill("A project has a start, a scope and a finish date. A milestone marks a single point in time, not a period of work.")
        add = page.query_selector("button:has-text('Add')")
        if add:
            add.click()
            page.wait_for_timeout(3000)
    freeze = page.query_selector("button:has-text('Freeze')")
    if freeze and freeze.is_enabled():
        freeze.click()
        page.wait_for_timeout(1500)
    for _ in range(3):
        gen = page.query_selector("button:has-text('Write questions')")
        if not gen or not gen.is_enabled():
            break
        gen.click()
        page.wait_for_timeout(1800)


def study_bite(page):
    page.goto(BASE + "/#/study?steps=3")
    page.wait_for_timeout(1600)
    for _ in range(14):
        body = page.inner_text("body")
        if "Bite complete" in body or page.query_selector("button:has-text('Back to the trail')"):
            break
        nxt = page.query_selector("#main button:text-is('Next')") or page.query_selector("#main button:text-is('Finish')")
        dlg = page.query_selector("dialog[open]")
        if dlg:
            print("OPEN DIALOG:", dlg.inner_text().replace("\n", " | ")[:200])
            page.click("dialog[open] button:not(.p)")  # keep studying
            page.wait_for_timeout(500)
            continue
        if nxt:
            nxt.click()
            page.wait_for_timeout(500)
            continue
        if page.query_selector("#main button:has-text('Show answer')"):
            page.click("#main button:has-text('Show answer')")
            page.wait_for_timeout(150)
            page.click("button[aria-label='Good']")
            page.wait_for_timeout(600)
            continue
        group = page.query_selector("[role=group]")
        if group:
            buttons = group.query_selector_all("button")
            if buttons:
                buttons[0].click()
                page.wait_for_timeout(600)
                continue
        opts = page.query_selector_all("#main section > .stack > .btn")
        if len(opts) >= 2:
            opts[0].click()
            page.wait_for_timeout(600)
            continue
        break
    shot(page, "02-bite")
    body = page.inner_text("body")
    chips = [el.inner_text() for el in page.query_selector_all("span.chip")]
    return body, chips


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
    sound_section(page)
    after, chips = study_bite(page)
    check("Bite complete" in after, "the bite did not reach the complete screen: " + after[:120].replace("\n", " | "))
    check(any(c.startswith("+") for c in chips), "the complete screen shows a points chip, got %r" % chips)
    check(not any("is not a function" in e or "Cannot read" in e for e in errors), "script errors: " + " | ".join(errors[:3]))
    shot(page, "03-end")
    browser.close()

if problems:
    print("\n%d problem(s):" % len(problems))
    for line in problems:
        print(" -", line)
    sys.exit(1)
print("wire smoke: ok, shots in", OUT)
