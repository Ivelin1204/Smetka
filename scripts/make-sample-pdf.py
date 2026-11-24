"""Generates public/sample-statement.pdf — a fictional bank statement used to demo PDF import.

Laid out the way real Bulgarian statements are: a preamble, a table header repeated on every page,
wrapped multi-line descriptions, separate debit/credit/balance columns, an opening balance row,
page footers and totals. Amounts are in leva (Oct–Dec 2025, before the euro switch).

    python3 scripts/make-sample-pdf.py
"""
import random
from pathlib import Path

from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import simpleSplit
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

FONT_DIR = Path('/usr/share/fonts/truetype/dejavu')
pdfmetrics.registerFont(TTFont('Sans', FONT_DIR / 'DejaVuSans.ttf'))
pdfmetrics.registerFont(TTFont('Sans-Bold', FONT_DIR / 'DejaVuSans-Bold.ttf'))

OUT = Path(__file__).resolve().parent.parent / 'public' / 'sample-statement.pdf'
rnd = random.Random(2025)
CARD = '4567XXXXXX1234'


def money(n: float) -> str:
    s = f'{abs(n):,.2f}'.replace(',', ' ').replace('.', ',')
    return s


def build_rows():
    rows = []
    for month, days in ((10, 31), (11, 30), (12, 31)):
        def add(day, desc, amount):
            rows.append((f'{day:02d}.{month:02d}.2025', desc, round(amount, 2)))

        add(1, 'ИЗХОДЯЩ ПРЕВОД КЪМ ИВАН ПЕТРОВ НАЕМ АПАРТАМЕНТ ЗА МЕСЕЦ ' + str(month), -1200)
        add(3, 'ПЛАЩАНЕ СОФИЙСКА ВОДА АД ПО ФАКТУРА 0000' + str(rnd.randint(100000, 999999)), -rnd.uniform(32, 48))
        add(5, 'ЕЛЕКТРОХОЛД ПРОДАЖБИ ЕАД ФАКТУРА ЗА ЕЛЕКТРОЕНЕРГИЯ', -rnd.uniform(70, 170))
        add(6, 'ТОПЛОФИКАЦИЯ СОФИЯ ЕАД', -rnd.uniform(90, 220))
        add(8, 'A1 BULGARIA EAD MOBILE SERVICES', -48.88)
        add(10, 'ВХОДЯЩ ПРЕВОД ЗАПЛАТА ЗА МЕСЕЦА ОТ ТЕХНО СОФТ ООД ПО ТРУДОВ ДОГОВОР', 3814.0)
        add(11, 'ПРЕВОД КЪМ СОБСТВЕНА СМЕТКА СПЕСТОВНА', -600)
        add(12, f'NETFLIX.COM AMSTERDAM NL {CARD}', -23.45)
        add(14, f'SPOTIFY P2F8A9 STOCKHOLM SE {CARD}', -13.67)
        add(days, 'ТАКСА ОБСЛУЖВАНЕ НА СМЕТКА', -4.89)
        for _ in range(10):
            shop = rnd.choice(['LIDL BULGARIA EOOD SOFIA BGR', 'KAUFLAND BULGARIA SOFIA', 'BILLA BULGARIA EOOD', 'FANTASTICO 23 SOFIA BGR'])
            add(rnd.randint(1, days), f'POS ПЛАЩАНЕ {shop} {CARD}', -rnd.uniform(12, 150))
        for _ in range(5):
            place = rnd.choice(['GLOVO SOFIA BGR', 'COSTA COFFEE MALL SOFIA', 'HAPPY BAR & GRILL SOFIA'])
            add(rnd.randint(1, days), f'POS ПЛАЩАНЕ {place} {CARD}', -rnd.uniform(6, 80))
        for _ in range(4):
            add(rnd.randint(1, days), f'BOLT.EU/R TALLINN EE {CARD}', -rnd.uniform(9, 26))
        add(rnd.randint(1, days), f'POS ПЛАЩАНЕ SHELL BULGARIA EAD {CARD}', -rnd.uniform(85, 140))
        add(rnd.randint(1, days), 'ТЕГЛЕНЕ НА ПАРИ ОТ БАНКОМАТ ДСК СОФИЯ', -rnd.choice([100, 200]))
        if month == 12:
            add(18, f'POS ПЛАЩАНЕ EMAG.BG КОЛЕДНИ ПОДАРЪЦИ {CARD}', -318.40)
            add(20, 'ВХОДЯЩ ПРЕВОД ОТ ГЕОРГИ ДИМИТРОВ ХОНОРАР ИЗРАБОТКА НА УЕБСАЙТ', 900)
    rows.sort(key=lambda r: (r[0][6:], r[0][3:5], r[0][:2]))
    return rows


W, H = A4
LEFT, RIGHT = 40, W - 40
COLS = {'date': LEFT, 'valor': LEFT + 62, 'desc': LEFT + 124, 'debit': 404, 'credit': 470, 'balance': RIGHT}
DESC_W = 205
LINE = 10.5


def header(c: canvas.Canvas, page: int, first: bool):
    y = H - 50
    if first:
        c.setFont('Sans-Bold', 15)
        c.drawString(LEFT, y, 'ДЕМО БАНК АД')
        c.setFont('Sans', 9)
        c.drawRightString(RIGHT, y, 'Извлечение по сметка')
        y -= 26
        for label, value in (('Титуляр:', 'ДЕМО ПОТРЕБИТЕЛ'), ('IBAN:', 'BG00 DEMO 0000 0000 0000 00'), ('Период:', '01.10.2025 – 31.12.2025'), ('Валута:', 'BGN')):
            c.setFont('Sans', 8.5)
            c.drawString(LEFT, y, label)
            c.setFont('Sans-Bold', 8.5)
            c.drawString(LEFT + 60, y, value)
            y -= 13
        y -= 12
    else:
        c.setFont('Sans', 8)
        c.drawString(LEFT, y, 'ДЕМО БАНК АД · Извлечение по сметка BG00 DEMO 0000 0000 0000 00')
        y -= 26
    c.setFillGray(0.93)
    c.rect(LEFT - 4, y - 5, RIGHT - LEFT + 8, 17, stroke=0, fill=1)
    c.setFillGray(0)
    c.setFont('Sans-Bold', 8)
    c.drawString(COLS['date'], y, 'Дата')
    c.drawString(COLS['valor'], y, 'Вальор')
    c.drawString(COLS['desc'], y, 'Основание на плащането')
    c.drawRightString(COLS['debit'], y, 'Дебит')
    c.drawRightString(COLS['credit'], y, 'Кредит')
    c.drawRightString(COLS['balance'], y, 'Салдо')
    return y - 20


def footer(c: canvas.Canvas, page: int):
    c.setFont('Sans', 7.5)
    c.setFillGray(0.45)
    c.drawString(LEFT, 30, 'Документът е генериран електронно и е валиден без подпис и печат.')
    c.drawRightString(RIGHT, 30, f'Страница {page}')
    c.setFillGray(0)


def main():
    rows = build_rows()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(OUT), pagesize=A4)
    c.setTitle('Извлечение по сметка — Демо Банк')
    page = 1
    y = header(c, page, True)
    balance = 2450.00
    c.setFont('Sans-Bold', 8)
    c.drawString(COLS['desc'], y, 'Начално салдо')
    c.drawRightString(COLS['balance'], y, money(balance))
    y -= LINE + 6
    debit_total = credit_total = 0.0
    for date, desc, amount in rows:
        lines = simpleSplit(desc, 'Sans', 8, DESC_W)
        need = len(lines) * LINE + 6
        if y - need < 60:
            footer(c, page)
            c.showPage()
            page += 1
            y = header(c, page, False)
        balance += amount
        c.setFont('Sans', 8)
        c.drawString(COLS['date'], y, date)
        c.drawString(COLS['valor'], y, date)
        for i, ln in enumerate(lines):
            c.drawString(COLS['desc'], y - i * LINE, ln)
        if amount < 0:
            c.drawRightString(COLS['debit'], y, money(amount))
            debit_total -= amount
        else:
            c.drawRightString(COLS['credit'], y, money(amount))
            credit_total += amount
        c.drawRightString(COLS['balance'], y, money(balance))
        y -= len(lines) * LINE
        c.setStrokeGray(0.88)
        c.line(LEFT - 4, y + 3, RIGHT + 4, y + 3)
        y -= 6
    y -= 8
    c.setFont('Sans-Bold', 8)
    c.drawString(COLS['desc'], y, 'Обороти за периода')
    c.drawRightString(COLS['debit'], y, money(debit_total))
    c.drawRightString(COLS['credit'], y, money(credit_total))
    y -= LINE + 2
    c.drawString(COLS['desc'], y, 'Крайно салдо')
    c.drawRightString(COLS['balance'], y, money(balance))
    footer(c, page)
    c.save()
    print(f'{OUT} — {len(rows)} transactions, {page} pages')


if __name__ == '__main__':
    main()
