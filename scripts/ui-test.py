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
    studio.fill('#pw', KEY); studio.click('#f button'); studio.wait_for_selector('table.jobs')
    # create PDF job through the modal
    studio.click('header [data-new]'); studio.fill('#n-num', '30434'); studio.fill('#n-client', 'Jo Retailer')
    studio.fill('#n-co', 'Bendigo Auto Spares'); studio.fill('#n-email', 'jo@example.com')
    studio.fill('#n-desc', 'Spring catalogue — A4, 3pp, 150gsm satin, qty 2,000')
    studio.set_input_files('#n-drop input', f'{S}/catalogue-V1.pdf'); studio.screenshot(path=f'{OUT}/02-studio-new-job.png')
    studio.click('#n-go'); studio.wait_for_selector('[data-copy]'); studio.wait_for_selector('[data-viewer] canvas')
    link = studio.input_value('.linkbox input'); print('client link:', link); assert link.endswith('/proof/30434'), link
    studio.screenshot(path=f'{OUT}/03-studio-job-V1.png', full_page=True)

    c = b.new_page(viewport={'width': 1440, 'height': 1000})
    c.on('console', lambda m: m.type == 'error' and errs.append('client: ' + m.text))
    c.on('pageerror', lambda e: errs.append('client: ' + str(e)))
    c.goto(link); c.wait_for_selector('[data-viewer] .stage canvas'); c.wait_for_selector('.thumbs canvas:nth-child(3)')
    assert 'Page 1 / 3' in c.text_content('[data-pg]'); c.click('[data-next]'); c.wait_for_function("document.querySelector('[data-pg]').textContent.includes('Page 2 / 3')")
    assert '30434' in c.inner_text('main') and 'Spring catalogue' in c.inner_text('main') and 'Jo Retailer' in c.inner_text('main')
    c.screenshot(path=f'{OUT}/04-client-review-V1.png', full_page=True)
    c.click('.seg [data-a=changes]'); c.fill('#c-name', 'Jo Retailer'); c.fill('#c-note', 'Back cover: phone number is wrong, should be 03 5444 2127. See markup attached.')
    c.set_input_files('[data-drop] input', f'{S}/client-markup.png'); c.wait_for_selector('[data-files] li')
    c.screenshot(path=f'{OUT}/05-client-request-changes.png', full_page=True)
    c.click('[data-go]'); c.wait_for_selector('[data-state=changes_requested]')
    c.screenshot(path=f'{OUT}/06-client-waiting.png', full_page=True)

    studio.goto(BASE + '/studio'); studio.wait_for_selector('.activity'); studio.wait_for_timeout(300)
    studio.screenshot(path=f'{OUT}/07-studio-dashboard.png', full_page=True)
    studio.click('tr.row:has-text("30434")'); studio.wait_for_url('**/proof/studio/30434'); studio.wait_for_selector('.fb--changes img')
    studio.set_input_files('[data-vdrop] input', f'{S}/catalogue-V2.pdf'); studio.fill('[data-vnote]', 'Back cover phone number corrected.')
    studio.click('[data-vgo]'); studio.wait_for_function("document.querySelector('.vtag') && document.querySelector('.vtag').textContent.startsWith('V2')")
    studio.wait_for_selector('[data-viewer] canvas'); studio.screenshot(path=f'{OUT}/08-studio-job-V2.png', full_page=True)

    c.reload(); c.wait_for_selector('[data-viewer] .stage canvas')
    assert c.text_content('.vtag').strip().startswith('V2'); assert 'Back cover phone number corrected' in c.inner_text('main')
    c.screenshot(path=f'{OUT}/09-client-sees-V2.png', full_page=True)
    c.select_option('[data-vsel]', '1'); c.wait_for_selector('.banner'); c.select_option('[data-vsel]', '2'); c.wait_for_selector('.seg')
    c.click('.seg [data-a=approve]'); c.click('[data-go]'); assert 'tick the box' in c.text_content('[data-msg]')
    c.check('#c-ok'); c.click('[data-go]'); c.wait_for_selector('[data-state=approved]'); c.wait_for_selector('[data-viewer] .stage canvas')
    c.screenshot(path=f'{OUT}/10-client-approved.png', full_page=True)

    m = b.new_page(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
    m.goto(link); m.wait_for_selector('[data-viewer] .stage canvas'); m.screenshot(path=f'{OUT}/11-client-mobile.png', full_page=True)
    # client finds proof by job number from the entry page
    e = b.new_page(viewport={'width': 1440, 'height': 1000}); e.goto(BASE); e.fill('#jn', '30434'); e.click('#find button'); e.wait_for_url('**/proof/30434'); e.wait_for_selector('[data-state=approved]')
    # duplicate job number refused in the UI
    studio.goto(BASE + '/studio'); studio.wait_for_selector('table.jobs'); studio.click('header [data-new]'); studio.fill('#n-num', '30434'); studio.fill('#n-client', 'Someone'); studio.click('#n-go'); studio.wait_for_selector('#n-msg a'); assert 'already exists' in studio.text_content('#n-msg'); studio.screenshot(path=f'{OUT}/13-studio-duplicate-refused.png')
    studio.goto(BASE + '/studio'); studio.wait_for_selector('.activity'); studio.screenshot(path=f'{OUT}/12-studio-dashboard-final.png', full_page=True)
    b.close()
errs = [e for e in errs if '409' not in e]  # 409 = the intentional duplicate-job test
print('console errors:', errs or 'none'); sys.exit(1 if errs else 0)
