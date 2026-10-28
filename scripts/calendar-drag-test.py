"""Drag-to-reschedule on the staff calendar. Server must be running. Uses system Chrome."""
import json, os, sys
from datetime import date, timedelta
from playwright.sync_api import sync_playwright

BASE = os.environ.get('BASE', 'http://127.0.0.1:4391/proof')
KEY = os.environ.get('KEY', 'ybi-proof')
OUT = os.environ.get('SHOTS', '/tmp/cal-drag')
os.makedirs(OUT, exist_ok=True)
errs = []

def add_days(iso, n):
    y, m, d = map(int, iso.split('-'))
    return (date(y, m, d) + timedelta(days=n)).isoformat()

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
        mid = add_days(today, 1)
        span_end = add_days(today, 2)
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

        press = post('/api/calendar/events', {'title': 'Press check', 'allDay': True, 'start': today, 'colour': 'blue'})
        span = post('/api/calendar/events', {'title': 'Install week', 'allDay': True, 'start': today, 'end': span_end, 'colour': 'green'})
        review = post('/api/calendar/events', {'title': 'Client review', 'allDay': False, 'start': today + 'T09:30', 'end': today + 'T10:00', 'colour': 'purple'})
        half = post('/api/calendar/events', {'title': 'Half hour', 'allDay': False, 'start': today + 'T11:00', 'end': today + 'T11:30', 'colour': 'yellow'})
        revert = post('/api/calendar/events', {'title': 'Revert me', 'allDay': True, 'start': today, 'colour': 'red'})
        job = post('/api/jobs', {'jobNumber': 'DRAG1', 'clientName': 'Drag Client'})
        page.reload()
        page.wait_for_selector(f'.calcell[data-day="{today}"] .calev[data-ev="{press["id"]}"]')

        def center(loc):
            loc.evaluate('el => el.scrollIntoView({block:"center", inline:"center"})')
            b = loc.bounding_box()
            assert b, 'missing box'
            return b['x'] + b['width'] / 2, b['y'] + b['height'] / 2

        def drag(src, dst, shot=None):
            sx, sy = center(src)
            dx, dy = center(dst)
            page.mouse.move(sx, sy)
            page.mouse.down()
            page.mouse.move(dx, dy, steps=14)
            page.wait_for_timeout(40)
            assert page.locator('.calev--ghost').count() == 1, 'drag ghost missing'
            assert page.locator('.calev.is-dragging').count() >= 1, 'source chip not faded'
            assert dst.evaluate('el => el.classList.contains("is-drop")'), 'drop target not highlighted'
            if shot:
                page.screenshot(path=os.path.join(OUT, shot))
            page.mouse.up()
            page.wait_for_timeout(30)

        # Month: day-to-day, keep all-day, keep colour. Click must not open the editor.
        src = page.locator(f'.calcell[data-day="{today}"] .calev[data-ev="{press["id"]}"]')
        dst = page.locator(f'.calcell[data-day="{nxt}"]')
        assert dst.count() == 1, 'next day is not on the month grid'
        drag(src, dst, 'month-drag.png')
        page.locator('.toast.on', has_text='Moved to').wait_for()
        assert page.locator('#evModal').count() == 0 or page.locator('#evModal').is_hidden()
        moved = get('/api/calendar/events/' + press['id'])
        assert moved['start'] == nxt and moved['end'] is None and moved['allDay'] is True and moved['colour'] == 'blue', moved
        assert page.locator(f'.calcell[data-day="{nxt}"] .calev[data-ev="{press["id"]}"]').count() == 1

        # A short press still edits. A few pixels is not a drag.
        chip = page.locator(f'.calcell[data-day="{nxt}"] .calev[data-ev="{press["id"]}"]')
        chip.click()
        page.wait_for_selector('#evModal:not([hidden])')
        assert page.locator('#ev-title').input_value() == 'Press check'
        page.locator('#evModal [data-ev-close]').first.click()
        page.wait_for_selector('#evModal', state='hidden')
        patches = []
        page.on('request', lambda r: patches.append(r.url) if r.method == 'PATCH' else None)
        sx, sy = center(chip)
        page.mouse.move(sx, sy)
        page.mouse.down()
        page.mouse.move(sx + 3, sy + 2)
        page.mouse.up()
        page.wait_for_selector('#evModal:not([hidden])')
        assert not any('/api/calendar/' in u for u in patches), patches
        page.locator('#evModal [data-ev-close]').first.click()
        page.wait_for_selector('#evModal', state='hidden')

        # Multi-day chip dragged from the middle day shifts the whole span.
        mid_chip = page.locator(f'.calcell[data-day="{mid}"] .calev[data-ev="{span["id"]}"]')
        drag(mid_chip, page.locator(f'.calcell[data-day="{span_end}"]'))
        page.locator('.toast.on', has_text='Moved to').wait_for()
        span_got = get('/api/calendar/events/' + span['id'])
        assert span_got['start'] == mid and span_got['end'] == later and span_got['allDay'] is True, span_got

        # Proof job uses the job PATCH and stays all-day.
        job_chip = page.locator(f'.calcell[data-day="{today}"] .calev', has_text='DRAG1')
        assert job_chip.count() == 1
        drag(job_chip, page.locator(f'.calcell[data-day="{nxt}"]'))
        page.locator('.toast.on', has_text='Job moved').wait_for()
        job_cal = get('/api/calendar/jobs/DRAG1')
        assert job_cal['start'] == nxt and job_cal['kind'] == 'job' and job_cal['allDay'] is True, job_cal

        # Week view: drop on a day keeps the clock; drop on a half-hour slot moves it.
        page.locator('[data-cal-mode="week"]').click()
        page.wait_for_selector('.calweek.has-hours')
        page.wait_for_selector('.calslot[data-slot="14:00"]')
        days = page.eval_on_selector_all('.calday', 'els => els.map(e => e.dataset.day)')
        other = next(d for d in days if d != today)
        slot_day = next(d for d in reversed(days) if d != today)
        head = page.locator(f'.calday[data-day="{other}"]')
        drag(page.locator(f'.calhours[data-day="{today}"] .calev[data-ev="{review["id"]}"]'), head, 'week-day-drag.png')
        page.locator('.toast.on', has_text='Moved to').wait_for()
        review_got = get('/api/calendar/events/' + review['id'])
        assert review_got['start'] == other + 'T09:30' and review_got['end'] == other + 'T10:00' and review_got['allDay'] is False, review_got

        slot = page.locator(f'.calhours[data-day="{slot_day}"] [data-slot="14:00"]')
        drag(page.locator(f'.calhours[data-day="{today}"] .calev[data-ev="{half["id"]}"]'), slot, 'week-slot-drag.png')
        page.locator('.toast.on', has_text='2:00 pm').wait_for()
        half_got = get('/api/calendar/events/' + half['id'])
        assert half_got['start'] == slot_day + 'T14:00' and half_got['end'] == slot_day + 'T14:30' and half_got['allDay'] is False, half_got

        # Failed PATCH puts the chip back.
        def fail_patch(route):
            if route.request.method == 'PATCH':
                route.fulfill(status=500, content_type='application/json', body='{"error":"Calendar save failed"}')
            else:
                route.continue_()
        page.locator('[data-cal-mode="month"]').click()
        page.wait_for_selector('.calgrid')
        page.route('**/api/calendar/events/*', fail_patch)
        before = get('/api/calendar/events/' + revert['id'])
        drag(page.locator(f'.calcell[data-day="{today}"] .calev[data-ev="{revert["id"]}"]'), page.locator(f'.calcell[data-day="{nxt}"]'))
        page.locator('.toast.on', has_text='Calendar save failed').wait_for()
        page.locator(f'.calcell[data-day="{today}"] .calev[data-ev="{revert["id"]}"]').wait_for()
        assert page.locator(f'.calcell[data-day="{nxt}"] .calev[data-ev="{revert["id"]}"]').count() == 0
        again = get('/api/calendar/events/' + revert['id'])
        assert again['start'] == before['start'] and again['end'] == before['end'], again
        page.unroute('**/api/calendar/events/*')

        # Narrow week view keeps day-to-day drag and does not force the time grid.
        mob = context.new_page()
        mob.set_viewport_size({'width': 390, 'height': 844})
        mob.on('pageerror', lambda e: errs.append('mobile: ' + str(e)))
        mob.goto(BASE + '/studio/calendar')
        mob.wait_for_selector('.calgrid')
        assert mob.evaluate('''() => { const el = document.querySelector('.calgrid .calev'); return !!el && getComputedStyle(el).display === 'none'; }''')
        mob.locator('[data-cal-mode="week"]').click()
        mob.wait_for_selector('.calday .calev')
        assert mob.locator('.calweek.has-hours').count() == 0
        chip = mob.locator('.calday .calev', has_text='Revert me')
        origin = chip.evaluate('el => el.closest("[data-day]").dataset.day')
        days = mob.eval_on_selector_all('.calday', 'els => els.map(e => e.dataset.day)')
        idx = days.index(origin)
        dest_day = days[idx + 1] if idx + 1 < len(days) else days[idx - 1]
        target = mob.locator(f'.calday[data-day="{dest_day}"]')
        chip.drag_to(target)
        mob.locator('.toast.on', has_text='Moved to').wait_for()
        mob_got = get('/api/calendar/events/' + revert['id'])
        assert mob_got['start'] == dest_day and mob_got['allDay'] is True, mob_got
        mob.close()

        # Client proof page is unchanged: studio drag script is not on it.
        bare = page.goto(BASE + '/DRAG1')
        assert bare.status == 200
        html = page.content()
        assert 'cal-move' not in html and 'data-cal-root' not in html
        browser.close()
    bad = [e for e in errs if 'favicon' not in e and '500' not in e and '403' not in e]
    print('console/page errors:', bad or 'none')
    if bad:
        sys.exit(1)
    print('calendar drag: ok')

if __name__ == '__main__':
    main()
