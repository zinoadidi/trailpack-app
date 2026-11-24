#!/usr/bin/env python3
"""A synced Pack should appear after signing in on a fresh device."""
import json
import subprocess
from pathlib import Path
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parent.parent
BASE = 'http://127.0.0.1:18878'
server = subprocess.Popen(['node', 'dev/mock-api.mjs', '--port=18878'], cwd=ROOT,
                          stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
try:
    assert 'Trailpack mock API' in server.stdout.readline(), 'mock API failed to start'
    with sync_playwright() as p:
        browser = p.chromium.launch()

        def login(context):
            page = context.new_page()
            page.route('**/config.json*', lambda route: route.fulfill(
                status=200, content_type='application/json', body=json.dumps({'apiBase': BASE + '/api/v1'})))
            page.goto(BASE + '/#/login')
            page.locator('#email').fill('owner@example.com')
            page.locator('#password').fill('-'.join(['a', 'demo', 'pass', 'phrase']))
            page.locator('button[type=submit]').click()
            page.wait_for_url('**/#/')
            return page

        first = browser.new_context()
        page = login(first)
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.locator('nav.tabbar a[href="#/me"]').click()
        sync_button = page.get_by_role('button', name='Sync now')
        sync_button.click()
        expect(sync_button).to_be_enabled(timeout=10000)
        assert not errors, f'manual sync raised a page error: {errors}'
        result = page.evaluate('''async () => {
          const { state } = await import('/src/app/state.js');
          const { savePack } = await import('/src/study/store.js');
          await state.api.updateMe({ theme: 'matcha' });
          await savePack({ id: 'sync-smoke-pack', title: 'Synced device pack', status: 'frozen' });
          await state.sync.sync();
          return { ...(await state.sync.sync()), pending: await state.sync.pendingCount() };
        }''')
        assert result['status'] == 'synced' and result['pending'] == 0, f'first device could not sync: {result}'
        second = browser.new_context()
        page2 = login(second)
        page2.locator('nav.tabbar a[href="#/library"]').click()
        expect(page2.get_by_text('Synced device pack', exact=True)).to_be_visible(timeout=10000)
        assert page2.evaluate('document.documentElement.dataset.theme') == 'matcha', 'fresh device ignored the account theme'
        page2.emulate_media(color_scheme='dark')
        page2.wait_for_timeout(250)  # allow the matchMedia change event to run
        assert page2.evaluate('document.documentElement.dataset.theme') == 'matcha', 'system colour change overwrote the explicit account theme'
        print('fresh-device sign-in restored the synced Pack')
        browser.close()
finally:
    server.terminate()
    server.wait(timeout=5)
