"""Generates a test PDF laid out like a Bulgarian card statement (fictional data).

Two dates (transaction / posting), a separate time column, a transaction-type column
("Покупка", "Възстановяване"…), an amount in the original currency plus one in the account
currency, wrapped and centred column headers, and all amounts written without a sign.
Used to build src/lib/__fixtures__/card-statement.items.json:

    python3 scripts/make-test-card-statement.py /tmp/card-statement.pdf
    node scripts/pdf-items.mjs /tmp/card-statement.pdf src/lib/__fixtures__/card-statement.items.json
"""
import sys
from reportlab.lib.pagesizes import A4, landscape
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

pdfmetrics.registerFont(TTFont('Sans', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'))
pdfmetrics.registerFont(TTFont('Sans-Bold', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'))

out = sys.argv[1] if len(sys.argv) > 1 else '/tmp/card-statement.pdf'
W, H = landscape(A4)
c = canvas.Canvas(out, pagesize=(W, H))

# (left, right, header lines, alignment)
cols = [
    (40, 100, ['Дата на', 'трансакция'], 'c'),
    (104, 140, ['Час'], 'c'),
    (146, 360, ['Описание'], 'l'),
    (366, 450, ['Вид', 'трансакция'], 'c'),
    (456, 540, ['Сума в оригинална', 'валута'], 'r'),
    (546, 580, ['Валута'], 'c'),
    (586, 660, ['Дата на', 'осчетоводяване'], 'c'),
    (666, 800, ['Сума във валута', 'на сметката (EUR)'], 'r'),
]

c.setFont('Sans-Bold', 12)
c.drawString(40, H - 45, 'Извлечение по кредитна карта')
c.setFont('Sans', 8.5)
c.drawString(40, H - 62, 'Карта: 5168 XXXX XXXX 1234    Период: 01.11.2026 – 24.11.2026    Валута на сметката: EUR')

y = H - 95
c.setFont('Sans-Bold', 7.5)
for left, right, lines, align in cols:
    for i, text in enumerate(lines):
        yy = y - i * 9
        if align == 'c':
            c.drawCentredString((left + right) / 2, yy, text)
        elif align == 'r':
            c.drawRightString(right, yy, text)
        else:
            c.drawString(left, yy, text)
y -= 30

rows = [
    ('24.11.2026', '15:55', 'LIDAL BALGARIYA EOOD-PLEVEN-BG', 'Покупка', '4,33', 'EUR', '25.11.2026', '4,33'),
    ('24.11.2026', '15:54', 'KARGO OIL-PLEVEN-BG', 'Покупка', '39,99', 'EUR', '25.11.2026', '39,99'),
    ('24.11.2026', '15:51', 'ANTHROPIC CLAUDE SUB-DUBLIN 4-IE', 'Покупка', '25,00', 'USD', '25.11.2026', '21,60'),
    ('24.11.2026', '11:19', 'BILLA 316 02-PLOVDIV-BG', 'Покупка', '4,81', 'EUR', '25.11.2026', '4,81'),
    ('23.11.2026', '15:10', 'LUKOYL BALGARIYA EOOD-PLEVEN-BG', 'Покупка', '39,19', 'EUR', '24.11.2026', '39,19'),
    ('21.11.2026', '10:02', 'BILLA 316 02-PLOVDIV-BG', 'Възстановяване', '3,20', 'EUR', '22.11.2026', '3,20'),
    ('20.11.2026', '15:14', 'AMREST EOOD-SOFIA-BG', 'Покупка', '8,99', 'EUR', '21.11.2026', '8,99'),
    ('20.11.2026', '15:13', 'LIDL BALGARIYA EOOD-PLOVDIV-BG', 'Покупка', '4,56', 'EUR', '21.11.2026', '4,56'),
    ('19.11.2026', '11:21', 'BILLA 316 02-PLOVDIV-BG', 'Покупка', '2,66', 'EUR', '20.11.2026', '2,66'),
    ('18.11.2026', '09:40', 'BANKOMAT-PLEVEN-BG', 'Теглене в брой', '50,00', 'EUR', '19.11.2026', '50,00'),
    ('15.11.2026', '12:00', 'PLASHTANE PO KARTOVA SMETKA', 'Плащане към картата', '300,00', 'EUR', '15.11.2026', '300,00'),
    ('12.11.2026', '20:31', 'NETFLIX.COM-AMSTERDAM-NL', 'Покупка', '11,99', 'EUR', '13.11.2026', '11,99'),
]
c.setFont('Sans', 7.8)
for r in rows:
    for (left, right, _, align), text in zip(cols, r):
        if align == 'c':
            c.drawCentredString((left + right) / 2, y, text)
        elif align == 'r':
            c.drawRightString(right, y, text)
        else:
            c.drawString(left, y, text)
    y -= 15
y -= 8
c.setFont('Sans-Bold', 8)
c.drawString(146, y, 'Общо за периода')
c.drawRightString(800, y, '491,32')
c.setFont('Sans', 7)
c.drawString(40, 30, 'Страница 1 от 1')
c.save()
print(out)
