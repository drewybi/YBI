"""Reorder chips within a day, and set Date on Calendar on New job. Server must be running."""
import json, os, sys
from datetime import date, timedelta
from playwright.sync_api import sync_playwright

BASE = os.environ.get('BASE', 'http://127.0.0.1:4391/proof')
KEY = os.environ.get('KEY', 'ybi-proof')
OUT = os.environ.get('SHOTS', '/tmp/cal-reorder')
ART = os.environ.get('ART', '/opt/cursor/artifacts')
os.makedirs(OUT, exist_ok=True)
os.makedirs(ART, exist_ok=True)
errs = []

def add_days(iso, n):
    y, m, d = map(int, iso.split('-'))
    return (date(y, m, d) + timedelta(days=n)).isoformat()

def shot(page, name):
    page.screenshot(path=os.path.join(OUT, name))
    page.screenshot(path=os.path.join(ART, name))

def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox', '--disable-dev-shm-usage'])
        context = browser.new_context(viewport={'width': 1440, 'height': 1600})
        page = context.new_page()
        page.on('pageerror', lambda e: errs.append('page: ' + str(e)))
        page.on('console', lambda m: errs.append('console: ' + m.text) if m.type == 'error' else None)
        page.goto(BASE + '/studio/calendar?key=' + KEY)
        page.wait_for_selector('.calgrid')
        today = page.locator('.calcell.is-today').get_attribute('data-day')
        nxt = add_days(today, 1)
        later = add_days(today, 3)
        api = page.context.request

        def post(path, body):
            res = api.post(BASE + path, data=json.dumps(body), headers={'Content-Type': 'application/json'})
            assert res.ok, (path, res.status, res.text())
            return res.json()

        def get(path):
            res = api.get(BASE + path)
            assert res.ok, (path, res.status, res.text())
            return res.json()

        def titles(day, only=None):
            got = page.eval_on_selector_all(
                f'.calcell[data-day="{day}"] .calev__n',
                'els => els.map(e => e.textContent)')
            if only is None:
                return got
            want = set(only)
            return [t for t in got if t in want]

        def center(loc):
            loc.evaluate('el => el.scrollIntoView({block:"center", inline:"center"})')
            box = loc.bounding_box()
            assert box, 'missing box'
            return box

        def wait_toast(text):
            page.locator('.toast.on', has_text=text).wait_for()
            page.locator('.toast.on', has_text=text).wait_for(state='hidden')

        alpha = post('/api/calendar/events', {'title': 'Alpha', 'allDay': True, 'start': today, 'colour': 'red'})
        beta = post('/api/calendar/events', {'title': 'Beta', 'allDay': True, 'start': today, 'colour': 'blue'})
        gamma = post('/api/calendar/events', {'title': 'Gamma', 'allDay': True, 'start': today, 'colour': 'green'})
        page.reload()
        page.wait_for_selector(f'.calcell[data-day="{today}"] .calev[data-ev="{gamma["id"]}"]')
        assert titles(today, ('Alpha', 'Beta', 'Gamma')) == ['Alpha', 'Beta', 'Gamma'], titles(today)

        # A few pixels is still a click, not a reorder.
        chip = page.locator(f'.calcell[data-day="{today}"] .calev[data-ev="{alpha["id"]}"]')
        box = center(chip)
        page.mouse.move(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2)
        page.mouse.down()
        page.mouse.move(box['x'] + box['width'] / 2 + 3, box['y'] + box['height'] / 2 + 2)
        page.mouse.up()
        page.wait_for_selector('#evModal:not([hidden])')
        page.locator('#evModal [data-ev-close]').first.click()
        page.wait_for_selector('#evModal', state='hidden')
        assert get('/api/calendar/events/' + alpha['id'])['dayOrder'] is None

        # Slide Gamma above Alpha. Same column, so this is an order change and not a day move.
        src = page.locator(f'.calcell[data-day="{today}"] .calev[data-ev="{gamma["id"]}"]')
        dst = page.locator(f'.calcell[data-day="{today}"] .calev[data-ev="{alpha["id"]}"]')
        sb, db = center(src), center(dst)
        sx, sy = sb['x'] + sb['width'] / 2, sb['y'] + sb['height'] / 2
        dy = db['y'] + 4
        page.mouse.move(sx, sy)
        page.mouse.down()
        page.mouse.move(sx, dy, steps=16)
        page.wait_for_timeout(40)
        assert page.locator('.calev--ghost').count() == 1, 'drag ghost missing'
        assert page.locator('.calev.is-insert-before, .calev.is-insert-after').count() >= 1, 'no insert line'
        assert page.locator('.calcell.is-drop').count() == 0, 'same-day slide looked like a day move'
        shot(page, 'calendar-reorder-drag.png')
        page.mouse.up()
        wait_toast('Order saved')
        assert titles(today, ('Alpha', 'Beta', 'Gamma')) == ['Gamma', 'Alpha', 'Beta'], titles(today)
        shot(page, 'calendar-reorder-saved.png')
        saved = get(f'/api/calendar/events?from={today}&to={today}')['events']
        by_title = {e['title']: e for e in saved if e['title'] in ('Alpha', 'Beta', 'Gamma')}
        assert [by_title[t]['dayOrder'] for t in ('Gamma', 'Alpha', 'Beta')] == [0, 1, 2], by_title
        assert by_title['Gamma']['colour'] == 'green' and by_title['Alpha']['colour'] == 'red'

        page.reload()
        page.wait_for_selector('.calgrid')
        assert titles(today, ('Alpha', 'Beta', 'Gamma')) == ['Gamma', 'Alpha', 'Beta'], titles(today)

        # Dragging to another day still reschedules, and leaves the old order behind.
        g = page.locator(f'.calcell[data-day="{today}"] .calev[data-ev="{gamma["id"]}"]')
        gb, nb = center(g), center(page.locator(f'.calcell[data-day="{nxt}"]'))
        page.mouse.move(gb['x'] + gb['width'] / 2, gb['y'] + gb['height'] / 2)
        page.mouse.down()
        page.mouse.move(nb['x'] + nb['width'] / 2, nb['y'] + nb['height'] / 2, steps=14)
        page.wait_for_timeout(40)
        assert page.locator(f'.calcell[data-day="{nxt}"].is-drop').count() == 1
        page.mouse.up()
        wait_toast('Moved to')
        moved = get('/api/calendar/events/' + gamma['id'])
        assert moved['start'] == nxt and moved['allDay'] is True and moved['dayOrder'] is None and moved['colour'] == 'green', moved
        assert titles(today, ('Alpha', 'Beta', 'Gamma')) == ['Alpha', 'Beta'], titles(today)

        # Week view: all-day chips reorder while a timed event stays on its clock.
        post('/api/calendar/events', {'title': 'Standup', 'allDay': False, 'start': today + 'T09:30', 'end': today + 'T10:00', 'colour': 'purple'})
        page.reload()
        page.wait_for_selector('.calgrid')
        page.locator('[data-cal-mode="week"]').click()
        page.wait_for_selector('.calweek.has-hours')
        page.wait_for_selector(f'.calday[data-day="{today}"] .calday__all .calev[data-ev="{beta["id"]}"]')
        def week_titles():
            got = page.eval_on_selector_all(
                f'.calday[data-day="{today}"] .calday__all .calev__n',
                'els => els.map(e => e.textContent)')
            return [t for t in got if t in ('Alpha', 'Beta', 'Gamma', 'Standup')]
        assert week_titles()[:2] == ['Alpha', 'Beta'], week_titles()
        src = page.locator(f'.calday[data-day="{today}"] .calday__all .calev[data-ev="{beta["id"]}"]')
        dst = page.locator(f'.calday[data-day="{today}"] .calday__all .calev[data-ev="{alpha["id"]}"]')
        sb, db = center(src), center(dst)
        sx, sy = sb['x'] + sb['width'] / 2, sb['y'] + sb['height'] / 2
        page.mouse.move(sx, sy)
        page.mouse.down()
        page.mouse.move(sx, db['y'] + 4, steps=16)
        page.wait_for_timeout(40)
        assert page.locator('.calev.is-insert-before, .calev.is-insert-after').count() >= 1
        shot(page, 'calendar-reorder-week.png')
        page.mouse.up()
        wait_toast('Order saved')
        assert week_titles()[:2] == ['Beta', 'Alpha'], week_titles()
        assert page.locator(f'.calhours[data-day="{today}"] .calev', has_text='Standup').count() == 1
        again = get('/api/calendar/events/' + beta['id'])
        assert again['start'] == today and again['dayOrder'] == 0 and again['colour'] == 'blue', again

        # A failed save puts the chips back.
        keep_a = post('/api/calendar/events', {'title': 'Keep first', 'allDay': True, 'start': later, 'colour': 'yellow'})
        keep_b = post('/api/calendar/events', {'title': 'Keep second', 'allDay': True, 'start': later, 'colour': 'purple'})
        page.reload()
        page.wait_for_selector('.calgrid')
        # later may sit on the next month page
        if page.locator(f'.calcell[data-day="{later}"]').count() == 0:
            page.locator('[data-cal-next]').click()
            page.wait_for_selector(f'.calcell[data-day="{later}"]')

        def fail_order(route):
            if route.request.method == 'PATCH' and route.request.url.rstrip('/').endswith('/api/calendar/order'):
                route.fulfill(status=500, content_type='application/json', body='{"error":"Calendar save failed"}')
            else:
                route.continue_()

        page.route('**/api/calendar/order', fail_order)
        src = page.locator(f'.calcell[data-day="{later}"] .calev[data-ev="{keep_b["id"]}"]')
        dst = page.locator(f'.calcell[data-day="{later}"] .calev[data-ev="{keep_a["id"]}"]')
        sb, db = center(src), center(dst)
        sx = sb['x'] + sb['width'] / 2
        page.mouse.move(sx, sb['y'] + sb['height'] / 2)
        page.mouse.down()
        page.mouse.move(sx, db['y'] + 4, steps=16)
        page.mouse.up()
        page.locator('.toast.on', has_text='Calendar save failed').wait_for()
        page.locator('.toast.on', has_text='Calendar save failed').wait_for(state='hidden')
        assert titles(later, ('Keep first', 'Keep second')) == ['Keep first', 'Keep second'], titles(later)
        assert get('/api/calendar/events/' + keep_b['id'])['dayOrder'] is None
        page.unroute('**/api/calendar/order')

        # New job: Date on Calendar defaults to today, colour swatches still work, the chosen day wins.
        page.locator('[data-cal-mode="month"]').click()
        page.locator('[data-cal-today]').click()
        page.wait_for_selector(f'.calcell.is-today[data-day="{today}"]')
        visible = page.eval_on_selector_all('.calcell:not(.is-out)', 'els => els.map(e => e.dataset.day)')
        job_day = next(d for d in visible if d not in (today, nxt, later) and d > today)
        page.click('header [data-new]')
        page.wait_for_selector('#newModal:not([hidden])')
        assert page.locator('label[for="n-caldate"]').text_content().strip() == 'Date on Calendar'
        assert page.locator('#n-caldate').input_value() == today
        assert page.locator('#n-colour-label').text_content().strip() == 'Calendar colour'
        assert page.locator('#newForm input[name="colour"]').count() == 6
        assert page.locator('#newForm input[name="colour"][value="grey"]').is_checked()
        page.locator('#newForm .swatch', has_text='Red').click()
        assert page.locator('#newForm input[name="colour"][value="red"]').is_checked()
        assert not page.locator('#newForm input[name="colour"][value="grey"]').is_checked()
        page.locator('#newModal [data-close]').first.click()
        page.wait_for_selector('#newModal', state='hidden')
        page.click('header [data-new]')
        page.wait_for_selector('#newModal:not([hidden])')
        assert page.locator('#newForm input[name="colour"][value="grey"]').is_checked()
        assert page.locator('#n-caldate').input_value() == today
        page.locator('#newForm .swatch', has_text='Green').click()
        page.fill('#n-caldate', job_day)
        page.fill('#n-num', 'CALDAY1')
        page.fill('#n-client', 'Calendar Client')
        page.fill('#n-desc', 'Shopfront banners')
        shot(page, 'new-job-date.png')
        page.click('#n-go')
        page.wait_for_selector('[data-copy]')
        placed = get('/api/calendar/jobs/CALDAY1')
        assert placed['start'] == job_day and placed['colour'] == 'green' and placed['kind'] == 'job', placed
        assert placed['title'] == 'Shopfront banners', placed
        assert 'CALDAY1' not in placed['title'] and 'Calendar Client' not in placed['title']
        assert placed['start'] != today
        page.goto(BASE + '/studio/calendar')
        page.wait_for_selector('.calgrid')
        if page.locator(f'.calcell[data-day="{job_day}"]').count() == 0:
            page.locator('[data-cal-next]').click()
        chip = page.locator(f'.calcell[data-day="{job_day}"] .calev[data-kind="job"]', has_text='Shopfront banners')
        chip.wait_for()
        assert chip.inner_text().strip() == 'Shopfront banners', chip.inner_text()
        assert chip.locator('.calev__t').count() == 0
        assert chip.get_attribute('data-colour') == 'green'
        assert page.locator(f'.calcell[data-day="{today}"] .calev', has_text='Shopfront banners').count() == 0
        shot(page, 'calendar-job-on-chosen-day.png')
        browser.close()

    bad = [e for e in errs if 'favicon' not in e and '500' not in e]
    print('console/page errors:', bad or 'none')
    if bad:
        sys.exit(1)
    print('calendar reorder: ok')

if __name__ == '__main__':
    main()
