#!/usr/bin/env python3
"""Smoke the standalone Practice round against a fresh dev mock API.
Run with: python3 dev/smoke-with.py dev/smoke-practice.py"""
import os
import sys
import time

from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://localhost:8787")
CODE = os.environ.get("CODE", "TRL-2345-6789-ABCD")
OUT = os.environ.get("OUT", os.path.join(os.path.dirname(os.path.abspath(__file__)), "shots-practice"))
TEXT = "A project starts with a goal. A milestone is one point in time. A baseline is the approved plan used to measure progress."
problems = []


def check(condition, message):
    if not condition:
        problems.append(message)
        print("PROBLEM:", message)


def config_route(route):
    route.fulfill(status=200, content_type="application/json", body='{"apiBase":"%s/api/v1"}' % BASE)


def sign_up(page):
    page.goto(BASE + "/#/access")
    page.wait_for_timeout(700)
    page.fill("#code", CODE)
    page.click("button[type=submit]")
    page.wait_for_timeout(900)
    page.fill("#name", "Practice Walker")
    page.fill("#email", "practice-%d@example.com" % int(time.time()))
    page.fill("#password", "demo-passphrase-here")
    page.click("button[type=submit]")
    page.wait_for_timeout(1500)
    check("#/" in page.url, "sign up did not open the app")


def add_pack(page):
    page.goto(BASE + "/#/library")
    page.wait_for_timeout(900)
    page.click("button:has-text('New Pack')")
    page.wait_for_timeout(300)
    page.fill("dialog input", "Project basics")
    page.click("dialog button.p")
    page.wait_for_timeout(800)
    page.fill("textarea", TEXT)
    page.click("button:has-text('Add pasted text')")
    page.wait_for_timeout(1800)
    freeze = page.query_selector("button:has-text('Freeze the Pack')")
    check(freeze is not None and freeze.is_enabled(), "Pack could not be frozen")
    if freeze:
        freeze.click()
        page.wait_for_timeout(1200)
    generate = page.query_selector("button:has-text('Write questions')")
    if generate and generate.is_enabled():
        generate.click()
        page.wait_for_timeout(1800)


def stored_counts(page):
    return page.evaluate("""async () => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('trailpack');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const rows = await new Promise((resolve, reject) => {
        const request = db.transaction('docs').objectStore('docs').getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      db.close();
      const progress = rows.filter((row) => row.collection === 'progress' && row.doc);
      return {
        attempts: rows.filter((row) => row.collection === 'attempts' && row.doc).length,
        progress: progress.length,
        states: progress.map((row) => row.doc.state),
      };
    }""")


with sync_playwright() as playwright:
    os.makedirs(OUT, exist_ok=True)
    browser = playwright.chromium.launch()
    page = browser.new_page(viewport={"width": 390, "height": 844}, reduced_motion="reduce")
    page.set_default_timeout(5000)
    page.route("**/config.json*", config_route)
    errors = []
    page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
    page.on("pageerror", lambda error: errors.append(str(error)))
    sign_up(page)
    add_pack(page)
    page.goto(BASE + "/#/practice")
    page.wait_for_timeout(1000)
    button = page.query_selector('[data-practice-type="flash"]')
    check(button is not None, "Practice has no flashcard drill")
    if button:
        button.click()
        page.wait_for_selector("#main button:has-text('Show answer')", timeout=8000)
        answered = 0
        for _ in range(10):
            if page.query_selector("[data-practice-result]"):
                break
            next_button = page.query_selector("#main button:has-text('Next')")
            if next_button:
                next_button.click()
                page.wait_for_timeout(350)
                continue
            show = page.query_selector("#main button:has-text('Show answer')")
            if show:
                show.click()
                page.wait_for_timeout(150)
            rate = "Again" if answered == 0 else "Good"
            choice = page.query_selector("#main button[aria-label='%s']" % rate)
            if choice:
                choice.click()
                answered += 1
                page.wait_for_timeout(500)
            else:
                break
        check(page.query_selector("[data-practice-result]") is not None, "Practice round did not complete")
        counts = stored_counts(page)
        check(counts["attempts"] >= 1, "Practice did not save an attempt record")
        check(counts["progress"] >= 1, "Practice did not update local progress")
        page.screenshot(path=os.path.join(OUT, "round.png"), full_page=True)
        page.click("[data-practice-result] button:has-text('Choose another activity')")
        page.wait_for_selector("#main button:has-text('Review weak facts')", timeout=8000)
        review = page.query_selector("#main button:has-text('Review weak facts')")
        check(review is not None and review.is_enabled(), "weak facts were not offered for review")
        if review:
            review.click()
            page.wait_for_selector('[data-practice-type="flash"]', timeout=8000)
            flash = page.query_selector('[data-practice-type="flash"]')
            check(flash is not None, "weak review has no flashcard drill")
            if flash:
                flash.click()
                page.wait_for_selector("#main button:has-text('Show answer')", timeout=8000)
                check("Question 1 of 1" in page.locator("#main").inner_text(), "weak review included facts that were not weak")
    real_errors = [error for error in errors if "favicon" not in error.lower()]
    check(not real_errors, "browser errors: " + str(real_errors[:4]))
    print("stored rows:", counts if button else "not run")
    print("PROBLEMS:", problems if problems else "none")
    browser.close()
    sys.exit(1 if problems else 0)
