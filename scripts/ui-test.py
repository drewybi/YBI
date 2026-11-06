"""Browser happy-path test + screenshots (Playwright, headless). Server must be running."""
import os, sys, re
from playwright.sync_api import sync_playwright
BASE = os.environ.get('BASE', 'http://localhost:4321/proof'); KEY = os.environ.get('KEY', 'ybi-proof')
R = os.path.join(os.path.dirname(__file__), '..'); S = os.path.join(R, 'samples'); OUT = os.path.join(R, 'screenshots')
errs = []
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    studio = b.new_page(viewport={'width': 1440, 'height': 1000})
    studio.on('console', lambda m: m.type == 'error' and errs.append('studio: ' + m.text))
    studio.on('pageerror', lambda e: errs.append('studio: ' + str(e)))
    studio.goto(BASE + '/studio'); studio.wait_for_selector('#pw'); studio.screenshot(path=f'{OUT}/01-entry-login.png')
    assert studio.locator('#jn').count() == 0
    studio.fill('#pw', KEY); studio.click('#f button'); studio.wait_for_selector('table.jobs')
    studio.wait_for_selector('.eband video')
    assert 'harry-' not in studio.content()
    assert 'engine.mp4' in studio.content()
    # create PDF job through the modal
    studio.click('header [data-new]'); studio.fill('#n-num', '30434'); studio.fill('#n-client', 'Jo Retailer')
    studio.fill('#n-co', 'Bendigo Auto Spares'); studio.fill('#n-email', 'jo@example.com')
    studio.fill('#n-desc', 'Spring catalogue — A4, 3pp, 150gsm satin, qty 2,000')
    studio.set_input_files('#n-drop input', f'{S}/catalogue-V1.pdf'); studio.screenshot(path=f'{OUT}/02-studio-new-job.png')
    studio.click('#n-go'); studio.wait_for_selector('[data-copy]'); studio.wait_for_selector('[data-viewer] canvas')
    link = studio.input_value('.linkbox input'); print('client link:', link); assert '/proof/30434?k=' in link, link
    studio.screenshot(path=f'{OUT}/03-studio-job-V1.png', full_page=True)

    c = b.new_page(viewport={'width': 1440, 'height': 1000})
    c.on('console', lambda m: m.type == 'error' and errs.append('client: ' + m.text))
    c.on('pageerror', lambda e: errs.append('client: ' + str(e)))
    c.goto(link);     c.wait_for_selector('[data-viewer] .stage canvas'); c.wait_for_selector('.thumbs canvas:nth-child(3)')
    c.wait_for_function("""() => document.querySelectorAll('.stage.is-pdf [data-page-slot]').length === 3 && document.querySelector('.stage.is-pdf canvas').width > 10""")
    c.wait_for_selector('.eband video')
    assert 'harry-' not in c.content() and 'engine.mp4' in c.content()
    assert 'Page 1 / 3' in c.text_content('[data-pg]')
    assert 'Scroll to read every page' in c.inner_text('main')
    assert c.locator('a[aria-label="Download file"]').count() == 1 and c.locator('a[aria-label="Open in new tab"]').count() == 1
    # Each page is fitted in the stage with about 10% clear on the tight axis (fit / 1.2).
    def assert_page_fits(scope):
        c.wait_for_function("""(sel) => {
          const stage = document.querySelector(sel);
          const canvas = stage && stage.querySelector('[data-page-slot="1"] canvas');
          if (!canvas || canvas.width < 10) return false;
          const cr = canvas.getBoundingClientRect();
          const sr = stage.getBoundingClientRect();
          const tight = Math.min((stage.clientWidth - cr.width) / stage.clientWidth, (stage.clientHeight - cr.height) / stage.clientHeight);
          const inside = cr.top >= sr.top - 1 && cr.bottom <= sr.bottom + 1 && cr.left >= sr.left - 1 && cr.right <= sr.right + 1;
          const centered = Math.abs((cr.top + cr.bottom) / 2 - (sr.top + sr.bottom) / 2) < 8;
          return inside && centered && tight >= 0.12 && tight <= 0.22;
        }""", arg=scope)
    assert_page_fits('.stage.is-pdf')
    gap = c.evaluate("""() => {
      const stage = document.querySelector('.stage.is-pdf');
      const a = stage.querySelector('[data-page-slot="1"] canvas').getBoundingClientRect();
      const b = stage.querySelector('[data-page-slot="2"] canvas').getBoundingClientRect();
      const oldGap = Math.max(0, stage.clientHeight - a.height) / 2 + Math.max(0, stage.clientHeight - b.height) / 2;
      const between = b.top - a.bottom;
      return { between, oldGap, ratio: between / oldGap };
    }""")
    assert 0.45 <= gap['ratio'] <= 0.55, gap
    c.eval_on_selector('.stage.is-pdf', 'el => { el.scrollTop = el.scrollHeight; }')
    c.wait_for_function("document.querySelector('[data-pg]').textContent.includes('Page 3 / 3')")
    box3 = c.locator('.stage.is-pdf [data-page-slot="3"] canvas').bounding_box()
    stage_box = c.locator('.stage.is-pdf').bounding_box()
    assert box3 and stage_box and box3['y'] >= stage_box['y'] - 2 and box3['y'] + box3['height'] <= stage_box['y'] + stage_box['height'] + 2, (box3, stage_box)
    c.click('[data-prev]'); c.wait_for_function("document.querySelector('[data-pg]').textContent.includes('Page 2 / 3')")
    c.click('[data-prev]'); c.wait_for_function("document.querySelector('[data-pg]').textContent.includes('Page 1 / 3')")
    c.wait_for_function("""() => {
      const stage = document.querySelector('.stage.is-pdf');
      const cr = stage.querySelector('[data-page-slot="1"] canvas').getBoundingClientRect();
      const sr = stage.getBoundingClientRect();
      return Math.abs((cr.top + cr.bottom) / 2 - (sr.top + sr.bottom) / 2) < 6;
    }""")
    c.click('[data-expand]'); c.wait_for_selector('.viewer.is-fs')
    assert_page_fits('.viewer.is-fs .stage.is-pdf')
    fs = c.locator('.viewer.is-fs').bounding_box()
    assert fs['y'] <= 1 and fs['width'] > 1300 and fs['height'] > 900, fs
    c.screenshot(path=f'{OUT}/15-pdf-fullscreen.png')
    c.click('[data-zin]'); c.wait_for_selector('.stage.is-zoomed')
    c.click('[data-next]'); c.wait_for_function("document.querySelector('[data-pg]').textContent.includes('Page 2 / 3')")
    c.keyboard.press('Escape'); c.wait_for_function("!document.querySelector('.viewer').classList.contains('is-fs')")
    assert 'Page 2 / 3' in c.text_content('[data-pg]')
    assert '30434' in c.inner_text('main') and 'Spring catalogue' in c.inner_text('main') and 'Jo Retailer' in c.inner_text('main')
    c.screenshot(path=f'{OUT}/04-client-review-V1.png', full_page=True)
    c.click('.seg [data-a=changes]'); c.wait_for_selector('.sheet.is-place')
    c.wait_for_function("""() => {
      const cv = document.querySelector('[data-viewer] .stage [data-page-slot="1"] canvas');
      return cv && cv.width > 400;
    }""")
    page1 = c.locator('[data-viewer] .stage [data-page-slot="1"] canvas')
    page1.scroll_into_view_if_needed()
    box = page1.bounding_box()
    stage = c.locator('[data-viewer] .stage').bounding_box()
    y = max(box['y'], stage['y']) + 40
    c.mouse.click(box['x'] + box['width'] * 0.3, y)
    c.wait_for_selector('.pin')
    c.mouse.click(box['x'] + box['width'] * 0.72, y + 80)
    c.wait_for_selector('.notelist .note:nth-child(2) textarea')
    c.locator('.notelist textarea').nth(0).fill('Move the logo up')
    c.locator('.notelist textarea').nth(1).fill('Phone should be 03 5444 2127')
    c.click('.notelist .note:nth-child(2) .note__n')
    c.wait_for_selector('.notelist .note:nth-child(2).on')
    c.wait_for_selector('.pin.on')
    c.locator('.pin').first.click()
    c.wait_for_selector('.notelist .note:nth-child(1).on')
    c.screenshot(path=f'{OUT}/14-client-stickies.png')
    c.fill('#c-name', 'Jo Retailer'); c.fill('#c-note', 'Back cover: phone number is wrong, should be 03 5444 2127. See markup attached.')
    c.set_input_files('[data-drop] input', f'{S}/client-markup.png'); c.wait_for_selector('[data-files] li')
    c.screenshot(path=f'{OUT}/05-client-request-changes.png', full_page=True)
    c.click('[data-go]'); c.wait_for_selector('[data-state=changes_requested]')
    c.wait_for_selector('.stage .pin')
    assert 'Move the logo up' in c.inner_text('[data-state=changes_requested]')
    c.locator('[data-state=changes_requested] .note__hit', has_text='Phone should').click()
    c.wait_for_selector('.pin.on')
    c.screenshot(path=f'{OUT}/06-client-waiting.png', full_page=True)

    studio.goto(BASE + '/studio'); studio.wait_for_selector('table.jobs'); studio.wait_for_selector('.eband')
    studio.screenshot(path=f'{OUT}/07-studio-dashboard.png', full_page=True)
    studio.click('tr.row:has-text("30434")'); studio.wait_for_url('**/proof/studio/30434'); studio.wait_for_selector('.fb--changes img')
    studio.wait_for_selector('.stage .pin')
    assert 'Move the logo up' in studio.inner_text('.fb--changes')
    studio.locator('.fb--changes .note__hit', has_text='Phone should').click()
    studio.wait_for_selector('.pin.on')
    studio.wait_for_selector('.notelist--ro .note.on')
    assert 'Page 1' in studio.text_content('.notelist--ro')
    studio.locator('.fb--changes').screenshot(path=f'{OUT}/16-studio-stickies.png')
    href = studio.locator('a', has_text='Download changes PDF').get_attribute('href')
    origin = BASE[:-6] if BASE.endswith('/proof') else BASE
    pdf = studio.context.request.get(origin + href)
    assert pdf.status == 200 and 'pdf' in pdf.headers['content-type'] and pdf.body()[:4] == b'%PDF', (pdf.status, pdf.headers.get('content-type'))
    studio.set_input_files('[data-vdrop] input', f'{S}/catalogue-V2.pdf'); studio.fill('[data-vnote]', 'Back cover phone number corrected.')
    studio.click('[data-vgo]'); studio.wait_for_function("document.querySelector('.vtag') && document.querySelector('.vtag').textContent.startsWith('V2')")
    studio.wait_for_selector('[data-viewer] canvas'); studio.screenshot(path=f'{OUT}/08-studio-job-V2.png', full_page=True)

    c.reload(); c.wait_for_selector('[data-viewer] .stage canvas')
    assert c.text_content('.vtag').strip().startswith('V2'); assert 'Back cover phone number corrected' in c.inner_text('main')
    c.screenshot(path=f'{OUT}/09-client-sees-V2.png', full_page=True)
    c.select_option('[data-vsel]', '1'); c.wait_for_selector('.banner'); c.select_option('[data-vsel]', '2'); c.wait_for_selector('.seg')
    c.click('.seg [data-a=approve]'); c.click('[data-go]'); assert 'tick the box' in c.text_content('[data-msg]')
    c.check('#c-ok'); c.click('[data-go]'); c.wait_for_selector('[data-state=approved]'); c.wait_for_selector('[data-viewer] .stage canvas')
    assert 'Spotted something' not in c.inner_text('[data-state=approved]')
    assert '5444 2127' not in c.inner_text('[data-state=approved]')
    c.screenshot(path=f'{OUT}/10-client-approved.png', full_page=True)

    m = b.new_page(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
    m.goto(link); m.wait_for_selector('.eband'); m.wait_for_selector('[data-viewer] .stage canvas'); m.screenshot(path=f'{OUT}/11-client-mobile.png', full_page=True)
    rm = b.new_page(viewport={'width': 1280, 'height': 800})
    rm.emulate_media(reduced_motion='reduce')
    rm.goto(link); rm.wait_for_selector('.eband')
    assert rm.eval_on_selector('.eband__vid', 'el => getComputedStyle(el).display') == 'none'
    assert rm.eval_on_selector('.eband__still', 'el => getComputedStyle(el).display') != 'none'
    # a bare job number does not open the proof
    e = b.new_page(viewport={'width': 1440, 'height': 1000}); e.goto(BASE + '/30434'); e.wait_for_selector('text=secure link')
    assert e.locator('[data-viewer]').count() == 0
    # duplicate job number refused in the UI
    studio.goto(BASE + '/studio'); studio.wait_for_selector('table.jobs'); studio.click('header [data-new]'); studio.fill('#n-num', '30434'); studio.fill('#n-client', 'Someone'); studio.click('#n-go'); studio.wait_for_selector('#n-msg a'); assert 'already exists' in studio.text_content('#n-msg'); studio.screenshot(path=f'{OUT}/13-studio-duplicate-refused.png')
    studio.goto(BASE + '/studio'); studio.wait_for_selector('table.jobs'); studio.screenshot(path=f'{OUT}/12-studio-dashboard-final.png', full_page=True)
    b.close()
errs = [e for e in errs if '409' not in e]  # 409 = the intentional duplicate-job test
print('console errors:', errs or 'none'); sys.exit(1 if errs else 0)
