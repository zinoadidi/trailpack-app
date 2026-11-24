#!/usr/bin/env python3
"""Exercise the real local app shell against its mock API on three viewports."""
import json
import os
import subprocess
import time
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parent.parent
BASE = 'http://127.0.0.1:18877'


def run():
    server = subprocess.Popen(
        ['node', 'dev/mock-api.mjs', '--port=18877'], cwd=ROOT,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
    )
    try:
        assert 'Trailpack mock API' in server.stdout.readline(), 'mock API failed to start'
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch()
            for width in (390, 768, 1440):
                context = browser.new_context(viewport={'width': width, 'height': 900})
                page = context.new_page()
                errors = []
                page.on('pageerror', lambda error: errors.append(str(error)))
                failed_requests = []
                page.on('requestfailed', lambda request: failed_requests.append((request.url, request.failure)))
                page.route('**/config.json*', lambda route: route.fulfill(
                    status=200, content_type='application/json',
                    body=json.dumps({'apiBase': BASE + '/api/v1'}),
                ))
                page.goto(BASE + '/#/login')
                page.locator('#email').fill('owner@example.com')
                page.locator('#password').fill('-'.join(['a', 'demo', 'pass', 'phrase']))
                page.locator('button[type=submit]').click()
                page.wait_for_url('**/#/')
                if width == 390:
                    # A previously cached config can name the example origin after reload.
                    page.route('https://example.invalid/api/v1/**', lambda route: route.fulfill(
                        response=route.fetch(url=route.request.url.replace('https://example.invalid', BASE, 1))))
                    def slow_refresh(route):
                        response = route.fetch(url=BASE + '/api/v1/auth/refresh')
                        time.sleep(1)
                        route.fulfill(response=response)
                    page.route('**/api/v1/auth/refresh', slow_refresh)
                    page.reload(wait_until='networkidle')
                    page.wait_for_function("import('/src/app/state.js').then(m => !!m.state.user)")
                    assert page.url.endswith('/#/'), f'session restoration changed the signed-in route: {page.url}'
                    page.unroute('**/api/v1/auth/refresh', slow_refresh)
                    new_tab = context.new_page()
                    new_tab.route('**/config.json*', lambda route: route.fulfill(
                        status=200, content_type='application/json', body=json.dumps({'apiBase': BASE + '/api/v1'})))
                    new_tab.route('https://example.invalid/api/v1/**', lambda route: route.fulfill(
                        response=route.fetch(url=route.request.url.replace('https://example.invalid', BASE, 1))))
                    new_tab.route('**/api/v1/auth/refresh', slow_refresh)
                    new_tab.goto(BASE + '/#/library', wait_until='networkidle')
                    new_tab.wait_for_function("import('/src/app/state.js').then(m => !!m.state.user)")
                    assert new_tab.url.endswith('/#/library'), f'new tab lost its signed-in route: {new_tab.url}'
                    expect(new_tab.get_by_role('heading', name='Library', exact=True)).to_be_visible()
                    new_tab.close()
                    def unreachable_api(route):
                        route.abort('internetdisconnected')
                    page.route('**/api/v1/auth/refresh', unreachable_api)
                    page.reload(wait_until='networkidle')
                    expect(page.get_by_role('heading', name='The Trail', exact=True)).to_be_visible()
                    assert page.url.endswith('/#/'), 'unreachable API discarded cached local session'
                    page.unroute('**/api/v1/auth/refresh', unreachable_api)
                    page.goto(BASE + '/#/no-such-route')
                    expect(page.get_by_role('heading', name='Nothing here')).to_be_visible(timeout=5000)
                    page.goto(BASE + '/#/')
                expect(page.get_by_role('heading', name='The Trail', exact=True)).to_be_visible()
                nav = page.locator('nav.tabbar')
                assert nav.is_visible(), f'navigation missing at {width}px'
                topbar = page.locator('.workspace-topbar')
                if width < 1000:
                    expect(topbar).to_be_visible()
                    expect(topbar.locator('a[href="#/me"]')).to_be_visible()
                else:
                    expect(topbar).to_be_hidden()
                assert nav.locator('a').count() >= 4, 'primary routes missing'
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), f'overflow at {width}px'
                await_activity = '''async (kind) => {
                  const { default: render } = await import('/src/screens/activities/' + kind + '.js');
                  const host = document.createElement('div'); host.id = 'activity-check'; document.querySelector('#main').append(host);
                  window.activityAnswers = [];
                  const prompt = 'A long learning prompt with many ordinary words '.repeat(20);
                  const variant = kind === 'quiz'
                    ? { prompt, choices: ['First answer', 'Second answer'], answer: 1, why: 'Reason' }
                    : { statement: prompt, answer: true, why: 'Reason' };
                  window.activityCheck = render(host, {}, { t: (key) => key, variant, fact: { statement: prompt }, onAnswer: (answer) => window.activityAnswers.push(answer) });
                }'''
                cleanup_activity = "window.activityCheck.destroy(); document.querySelector('#activity-check').remove()"
                page.evaluate(await_activity, 'quiz')
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), f'long quiz overflows at {width}px'
                page.keyboard.press('2')
                page.keyboard.press('1')
                assert page.evaluate("activityAnswers.length === 1 && activityAnswers[0].correct && activityAnswers[0].why === 'Reason'"), 'quiz keyboard scoring or duplicate guard failed'
                expect(page.locator('#activity-check button').nth(1)).to_have_attribute('aria-pressed', 'true')
                page.evaluate(cleanup_activity)
                page.evaluate(await_activity, 'swipe')
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), f'long swipe overflows at {width}px'
                page.keyboard.press('ArrowRight')
                assert page.evaluate('activityAnswers.length === 1 && activityAnswers[0].correct'), 'swipe keyboard answer failed'
                page.evaluate(cleanup_activity)
                page.evaluate(await_activity, 'swipe')
                page.locator('#activity-check button').first.click()
                assert page.evaluate('activityAnswers.length === 1 && !activityAnswers[0].correct'), 'swipe button answer failed'
                page.evaluate(cleanup_activity)
                if width == 390:
                    flash_guard = page.evaluate('''async () => {
                      const { default: render } = await import('/src/screens/activities/flash.js');
                      const host = document.createElement('div'); document.body.append(host);
                      let answers = 0;
                      const activity = render(host, {}, { t: (key) => key, fact: { id: 'fact' },
                        variant: { front: 'question', back: 'answer' }, onAnswer: () => answers++ });
                      host.querySelector('[aria-label="study.again"]').click();
                      const before = answers;
                      host.querySelector('.btn.p.block').click();
                      host.querySelector('[aria-label="study.again"]').click();
                      const after = answers;
                      activity.destroy(); host.remove();
                      return { before, after };
                    }''')
                    assert flash_guard == {'before': 0, 'after': 1}, f'flash rating bypassed reveal: {flash_guard}'
                    source_requests = []
                    search_requests = []
                    map_requests = []
                    def search_route(route):
                        search_requests.append(route.request.post_data)
                        if len(search_requests) == 1:
                            route.fulfill(status=503, content_type='application/json', body='{"error":"search_unavailable"}')
                        else:
                            route.fulfill(status=200, content_type='application/json', body=json.dumps({
                                'results': [{'title': 'Cell biology', 'url': 'https://example.org/cells', 'source': 'Example Learning Foundation', 'description': 'Cell basics'}],
                            }))
                    page.route('**/api/v1/ingest/search', search_route)
                    def source_route(route):
                        source_requests.append(route.request.post_data)
                        if len(source_requests) == 1:
                            route.fulfill(status=503, content_type='application/json', body='{"error":"source_unavailable"}')
                        else:
                            route.fulfill(status=200, content_type='application/json', body=json.dumps({
                                'url': 'https://example.org/cells', 'text': 'Cells form tissues. Cells need energy.',
                                'pages': [{'n': 1, 'text': 'Cells form tissues.'}, {'n': 2, 'text': 'Cells need energy.'}], 'meta': {},
                            }))
                    page.route('**/api/v1/ingest/source', source_route)
                    def map_route(route):
                        map_requests.append(route.request.post_data)
                        if len(map_requests) == 1:
                            route.fulfill(status=503, content_type='application/json', body='{"error":"model_unavailable"}')
                        else:
                            route.fulfill(response=route.fetch(url=BASE + '/api/v1/llm/chat'))
                    page.get_by_role('link', name='Learn a topic').click()
                    page.get_by_label('What would you like to learn?').fill('Cell biology')
                    page.get_by_role('button', name='Find sources').click()
                    expect(page.get_by_text('Search is unavailable. Try again or add a document instead.')).to_be_visible()
                    expect(page.get_by_label('What would you like to learn?')).to_have_value('Cell biology')
                    expect(page.get_by_role('link', name='Add a document')).to_be_visible()
                    page.get_by_role('button', name='Find sources').click()
                    expect(page.get_by_text('Example Learning Foundation', exact=True)).to_be_visible()
                    page.get_by_role('checkbox', name='Cell biology').check()
                    page.get_by_label('What would you like to learn?').fill('New topic')
                    expect(page.get_by_role('button', name='Continue to review')).to_be_disabled()
                    page.get_by_label('What would you like to learn?').fill('Cell biology')
                    page.get_by_role('button', name='Find sources').click()
                    page.get_by_role('checkbox', name='Cell biology').check()
                    assert not source_requests, 'sources fetched before confirmation'
                    page.get_by_role('button', name='Continue to review').click()
                    expect(page.get_by_role('heading', name='Cell biology', exact=True)).to_be_visible()
                    assert not source_requests, 'sources fetched before review action'
                    page.get_by_role('button', name='Import Cell biology').click()
                    expect(page.get_by_text('Could not import this source. Try again or remove it.')).to_be_visible()
                    page.route('**/api/v1/llm/chat', map_route)
                    page.get_by_role('button', name='Import Cell biology').click()
                    expect(page.get_by_text('Could not import this source. Try again or remove it.')).to_be_visible(timeout=10000)
                    page.get_by_role('button', name='Import Cell biology').click()
                    expect(page.get_by_role('link', name='example.org')).to_be_visible()
                    assert len(source_requests) == 3, 'source fetch retried without learner action'
                    assert any('page=\\"2\\"' in req or 'page="2"' in req for req in map_requests), 'imported page 2 missing from map prompt'
                    page.unroute('**/api/v1/llm/chat', map_route)
                    for title in ('Biology cells', 'History empires'):
                        page.goto(BASE + '/#/library', wait_until='networkidle')
                        page.get_by_role('button', name='New Pack', exact=True).first.click()
                        page.get_by_label('Pack title').fill(title)
                        page.get_by_role('button', name='Create and add documents').click()
                        page.wait_for_url('**/#/library/review?id=*')
                        expect(page.get_by_role('heading', name=title, exact=True)).to_be_visible()
                        if title == 'Biology cells':
                            page.locator('input[type=file]').set_input_files({
                                'name': 'cell-notes.txt', 'mimeType': 'text/plain',
                                'buffer': b'Cells are the building blocks of life. Every cell has a membrane.',
                            })
                            expect(page.get_by_text('cell-notes.txt', exact=True).first).to_be_visible()
                            expect(page.get_by_text('Getting started').first).to_be_visible(timeout=15000)
                    page.goto(BASE + '/#/library', wait_until='networkidle')
                    search = page.get_by_role('searchbox', name='Search your library')
                    search.fill('biology')
                    expect(page.get_by_text('Biology cells', exact=True)).to_be_visible()
                    expect(page.get_by_text('History empires', exact=True)).to_have_count(0)
                    search.fill('nothing matches')
                    expect(page.get_by_text('No matching packs.', exact=True)).to_be_visible()
                    search.clear()
                    expect(page.get_by_text('History empires', exact=True)).to_be_visible()
                    page.evaluate('''async () => {
                      const store = await import('/src/study/store.js');
                      const progress = await import('/src/study/progress-store.js');
                      const options = { sync: null };
                      await store.savePack({ id: 'camp-smoke', title: 'Camp smoke', sources: [
                        { id: 'source', name: 'Study notes', url: 'https://example.org/lesson' },
                      ] }, options);
                      for (const id of ['past-fact', 'current-fact']) {
                        await store.saveFact({ id, packId: 'camp-smoke', statement: id, sourceId: 'source', page: 2,
                          variants: [{ id: id + '-card', factId: id, type: 'flashcard', front: id, back: 'answer' }] }, options);
                      }
                      await progress.savePlan({ packId: 'camp-smoke', camps: [
                        { id: 'past', title: 'Past', state: 'summited', factIds: ['past-fact'] },
                        { id: 'current', title: 'Current', state: 'open', factIds: ['current-fact'] },
                        { id: 'future', title: 'Future', state: 'locked', factIds: [] },
                      ] }, options);
                      await store.setActivePack('camp-smoke');
                    }''')
                    page.goto(BASE + '/#/', wait_until='networkidle')
                    expect(page.locator('.campdot')).to_have_count(3)
                    expect(page.locator('.campdot').nth(2)).to_be_disabled()
                    for index, camp_id, fact_id in ((0, 'past', 'past-fact'), (1, 'current', 'current-fact')):
                        page.locator('.campdot').nth(index).click()
                        page.wait_for_url('**/#/study?camp=' + camp_id)
                        if index == 1:
                            dialog = page.get_by_role('dialog', name='Leave this bite?')
                            expect(dialog).to_be_visible()
                            dialog.get_by_role('button', name='Keep studying').click()
                            expect(page.locator('.campdot')).to_have_count(3)
                            assert page.evaluate("import('/src/app/state.js').then(m => m.state.studySession.session.campId)") == 'past'
                            page.locator('.campdot').nth(index).click()
                            dialog.get_by_role('button', name='Leave', exact=True).click()
                        page.wait_for_function('''async ([camp, fact]) => {
                          const { state } = await import('/src/app/state.js');
                          const session = state.studySession?.session;
                          return session?.campId === camp && session.steps.length > 0 && session.steps.every((step) => step.factId === fact);
                        }''', arg=[camp_id, fact_id])
                        flash = page.get_by_role('region', name='Flashcard')
                        expect(flash).to_be_visible()
                        expect(flash.get_by_text('answer', exact=True)).to_be_hidden()
                        again = flash.locator('button[aria-label="Again"]')
                        expect(again).to_be_hidden()
                        again.evaluate('(button) => button.click()')
                        expect(flash.get_by_role('button', name='Show answer', exact=True)).to_be_visible()
                        flash.get_by_role('button', name='Show answer', exact=True).click()
                        expect(flash.get_by_text('answer', exact=True)).to_be_visible()
                        expect(again).to_be_visible()
                        source = page.locator('.study-source')
                        expect(source.locator('summary')).to_have_text('Source')
                        expect(source.get_by_role('link', name='Open source')).to_be_hidden()
                        source.locator('summary').click()
                        expect(source.get_by_text('Study notes')).to_be_visible()
                        expect(source.get_by_text('Page 2')).to_be_visible()
                        expect(source.get_by_role('link', name='Open source')).to_have_attribute('href', 'https://example.org/lesson')
                        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'study source overflows on mobile'
                        shots = os.environ.get('TRAILPACK_SMOKE_SHOTS')
                        if shots:
                            Path(shots).mkdir(parents=True, exist_ok=True)
                            page.screenshot(path=str(Path(shots) / ('study-source-' + camp_id + '-mobile.png')))
                        page.set_viewport_size({'width': 1440, 'height': 900})
                        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'study source overflows on desktop'
                        assert page.locator('.study-source').bounding_box()['x'] > page.locator('.study-workspace > .stack').bounding_box()['x'], 'source is not beside the activity on desktop'
                        if shots:
                            page.screenshot(path=str(Path(shots) / ('study-source-' + camp_id + '-desktop.png')))
                        page.set_viewport_size({'width': width, 'height': 900})
                        page.locator('nav.tabbar a[href="#/"]').click()
                        expect(page.locator('.campdot')).to_have_count(3)
                    page.goto(BASE + '/#/', wait_until='networkidle')
                    swipe = page.evaluate('''async () => {
                      const { default: render } = await import('/src/screens/activities/swipe.js');
                      const host = document.createElement('div'); document.body.append(host);
                      const answers = [];
                      const activity = render(host, {}, { t: (key) => key, variant: { statement: 'Test', answer: true }, fact: {}, onAnswer: (answer) => answers.push(answer) });
                      const card = host.querySelector('.swipeCard'); card.setPointerCapture = () => {};
                      for (const [type, x] of [['pointerdown', 0], ['pointermove', 100], ['pointercancel', 100]])
                        card.dispatchEvent(new PointerEvent(type, { pointerId: 1, clientX: x }));
                      const afterCancel = answers.length;
                      host.querySelectorAll('button')[1].click(); host.querySelectorAll('button')[1].click();
                      const afterClicks = answers.length;
                      activity.destroy(); host.remove();
                      return { afterCancel, afterClicks };
                    }''')
                    assert swipe['afterCancel'] == 0, 'cancelled swipe recorded an answer'
                    assert swipe['afterClicks'] == 1, 'repeated swipe answer was recorded twice'
                    after_destroy = page.evaluate('''async () => {
                      const { renderActivity } = await import('/src/screens/activities/index.js');
                      const host = document.createElement('div'); document.body.append(host);
                      let answers = 0;
                      const activity = await renderActivity(host, { type: 'swipe' }, { t: (key) => key, variant: { statement: 'Test', answer: true }, fact: {}, onAnswer: () => answers++ });
                      activity.destroy?.();
                      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
                      host.remove(); return answers;
                    }''')
                    assert after_destroy == 0, 'destroyed activity still handles keyboard input'
                if width == 1440:
                    assert page.locator('.main').bounding_box()['width'] > 1100, 'desktop workspace is still a narrow mobile column'
                    page.evaluate("document.documentElement.dataset.theme = 'matcha'")
                    background = nav.evaluate('(el) => getComputedStyle(el).backgroundColor')
                    assert background == 'rgb(32, 59, 43)', f'Matcha desktop navigation is not forest green: {background}'
                nav.locator('a').first.focus()
                page.keyboard.press('Tab')
                assert page.evaluate('document.activeElement.matches(":focus-visible")'), 'keyboard focus not visible'
                page.emulate_media(reduced_motion='reduce')
                assert page.locator('.btn').first.evaluate('(el) => getComputedStyle(el).transitionDuration') == '0s', 'reduced-motion preference ignored'
                for theme in ('dark', 'light', 'ocean', 'matcha'):
                    for route in ('/', '/practice', '/library', '/me'):
                        page.goto(BASE + '/#' + route, wait_until='networkidle')
                        page.evaluate('(theme) => document.documentElement.dataset.theme = theme', theme)
                        assert page.locator('nav.tabbar').is_visible(), f'navigation missing on {route}'
                        expect(page.locator(f'nav.tabbar a[href="#{route}"]')).to_have_attribute('aria-current', 'page', timeout=3000)
                        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), f'overflow on {route}, {theme}, {width}px'
                        if route == '/me':
                            assert page.locator('.themebtn .name b').count() == 4, 'theme labels missing'
                            if width == 390:
                                for control in page.locator('button.btn.sm:visible, .seg button:visible').all():
                                    assert control.bounding_box()['height'] >= 44, f'small touch target: {control.inner_text()}'
                                contrast_failures = page.evaluate('''() => {
                                  const host = document.createElement('div'); document.body.append(host);
                                  const ctx = document.createElement('canvas').getContext('2d');
                                  const lum = (rgb) => rgb.slice(0, 3).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
                                    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
                                  const pixel = () => [...ctx.getImageData(0, 0, 1, 1).data];
                                  const failures = [];
                                  for (const kind of ['t', 'a', 'f', 'o', 'v', 'e', 'm', 'k']) {
                                    const chip = document.createElement('span'); chip.className = 'chip ' + kind; host.append(chip);
                                    const style = getComputedStyle(chip);
                                    for (const base of ['--page', '--surface', '--raised']) {
                                      ctx.clearRect(0, 0, 1, 1);
                                      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue(base).trim(); ctx.fillRect(0, 0, 1, 1);
                                      ctx.fillStyle = style.backgroundColor; ctx.fillRect(0, 0, 1, 1); const bg = lum(pixel());
                                      ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = style.color; ctx.fillRect(0, 0, 1, 1); const fg = lum(pixel());
                                      const ratio = (Math.max(bg, fg) + .05) / (Math.min(bg, fg) + .05);
                                      if (ratio < 4.5) failures.push(kind + '/' + base + ':' + ratio.toFixed(2));
                                    }
                                    chip.remove();
                                  }
                                  host.remove(); return failures;
                                }''')
                                assert not contrast_failures, f'{theme} chip contrast: {contrast_failures}'
                            for label in page.locator('.themebtn .name b').all():
                                assert label.evaluate('(el) => el.scrollWidth <= el.clientWidth + 1'), f'clipped theme label at {width}px'
                        if width == 1440 and os.environ.get('WORKSPACE_SHOTS'):
                            page.screenshot(path=str(Path(os.environ['WORKSPACE_SHOTS']) / (theme + '-' + (route.strip('/') or 'home') + '.png')), full_page=True)
                page.evaluate('navigator.serviceWorker.ready')
                assert page.evaluate("caches.match('/styles/app.css').then(Boolean)"), 'workspace CSS not cached for offline use'
                page.goto(BASE + '/#/')
                expect(page.get_by_role('heading', name='The Trail', exact=True)).to_be_visible()
                if width == 390:
                    page.evaluate("import('/src/app/prefs.js').then(m => m.setPref('sync', false))")
                context.set_offline(True)
                page.reload(wait_until='domcontentloaded')
                try:
                    expect(page.get_by_role('heading', name='The Trail', exact=True)).to_be_visible(timeout=10000)
                except AssertionError as error:
                    raise AssertionError(f'offline boot failed; page errors: {errors}; requests: {failed_requests}') from error
                assert page.url.endswith('/#/'), f'offline reload lost signed-in home: {page.url}'
                padding = page.evaluate("getComputedStyle(document.querySelector('.main')).paddingTop")
                assert padding in ('20px', '32px', '48px'), f'offline CSS not applied: padding {padding}'
                if width == 390:
                    refreshes = []
                    def revoked_refresh(route):
                        refreshes.append(route.request.url)
                        route.fulfill(status=401, content_type='application/json', body='{"error":"invalid_credentials"}')
                    page.route('**/api/v1/auth/refresh', revoked_refresh)
                    context.set_offline(False)
                    expect(page.locator('#email')).to_be_visible(timeout=10000)
                    assert refreshes, 'reconnect did not revalidate a cached session with sync disabled'
                assert not errors, errors
                context.close()
            browser.close()
    finally:
        server.terminate()
        server.wait(timeout=5)


if __name__ == '__main__':
    run()
    print('workspace shell: mobile, tablet and desktop passed')
