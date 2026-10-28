"""Create tiny test proofs in ./samples (JPG, multi-page PDF V1 + V2, client markup PNG)."""
import os
from PIL import Image, ImageDraw, ImageFont
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor
D = os.path.join(os.path.dirname(__file__), '..', 'samples'); os.makedirs(D, exist_ok=True)
def font(sz):
    for f in ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf']:
        if os.path.exists(f): return ImageFont.truetype(f, sz)
    return ImageFont.load_default()
# JPG poster
im = Image.new('RGB', (1200, 1600), '#1b1b1e'); d = ImageDraw.Draw(im)
d.rectangle([60, 60, 1140, 1540], outline='#A7A9AC', width=6)
d.text((110, 160), 'BENDIGO', font=font(150), fill='#f3f1ec'); d.text((110, 330), 'MOTOR SHOW', font=font(110), fill='#A7A9AC')
d.rectangle([110, 520, 1090, 1150], fill='#3a3a40'); d.text((380, 800), '[ hero image ]', font=font(50), fill='#8a8a90')
d.text((110, 1220), 'SAT 14 MARCH · PRINCE OF WALES SHOWGROUNDS', font=font(36), fill='#f3f1ec')
d.text((110, 1300), 'Tickets: 0400 000 000', font=font(44), fill='#f3f1ec')
im.save(os.path.join(D, 'poster-A2.jpg'), quality=88)
# multi-page PDFs
def pdf(name, ver, phone):
    c = canvas.Canvas(os.path.join(D, name), pagesize=A4); w, h = A4
    pages = [('FRONT COVER', 'Spring catalogue 2026'), ('PAGE 2', 'Products & pricing'), ('BACK COVER', 'Contact: ' + phone)]
    for i, (t, s) in enumerate(pages, 1):
        c.setFillColor(HexColor('#09090a')); c.rect(0, 0, w, h, fill=1, stroke=0)
        c.setStrokeColor(HexColor('#A7A9AC')); c.setLineWidth(3); c.rect(30, 30, w - 60, h - 60)
        c.setFillColor(HexColor('#f3f1ec')); c.setFont('Helvetica-Bold', 46); c.drawString(60, h - 140, t)
        c.setFont('Helvetica', 22); c.setFillColor(HexColor('#A7A9AC')); c.drawString(60, h - 180, s)
        c.setFillColor(HexColor('#2a2a2f')); c.rect(60, 220, w - 120, h - 460, fill=1, stroke=0)
        c.setFillColor(HexColor('#f3f1ec')); c.setFont('Helvetica-Bold', 120); c.drawCentredString(w / 2, h / 2 - 40, ver)
        c.setFont('Helvetica', 12); c.drawString(60, 60, f'YBI Creative sample proof · {ver} · page {i} of 3'); c.showPage()
    c.save()
pdf('catalogue-V1.pdf', 'V1', '03 5444 0000')
pdf('catalogue-V2.pdf', 'V2', '03 5444 2127')
# client markup
mk = Image.new('RGB', (800, 500), 'white'); d = ImageDraw.Draw(mk)
d.ellipse([120, 120, 520, 330], outline='red', width=8); d.text((140, 380), 'Phone number wrong - should be 03 5444 2127', font=font(26), fill='red')
mk.save(os.path.join(D, 'client-markup.png'))
print('samples written to', os.path.abspath(D)); print(os.listdir(D))
