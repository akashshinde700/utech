#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
UTech Automation ERP - Simple Flow Guide (body PDF, ReportLab).

Task ID: 8. Audience: factory staff / supervisors / managers (non-developers).
Language: simple English, short sentences, every term explained on first use.

Chapter Numbering Plan (Step 3.5 mapping):
| Outline | Type    | Chapter | Title                                   |
|---------|---------|---------|-----------------------------------------|
| 1       | cover   | -       | Cover (HTML/Playwright, merged later)   |
| 2       | toc     | -       | Contents                                |
| 3       | content | 1       | What is UTech ERP?                      |
| 4       | content | 2       | The Big Picture                         |
| 5       | content | 3       | The Sales Journey, Step by Step         |
| 6       | content | 4       | Buying from Vendors, Step by Step       |
| 7       | content | 5       | Keeping Stock Correct                   |
| 8       | content | 6       | Masters - The Foundation                |
| 9       | content | 7       | Who Can Do What - Roles & Permissions   |
| 10      | content | 8       | Reports & Tally Export                  |
| 11      | content | 9       | Glossary                                |
| 12      | content | 10      | Quick Start for a New User              |

Palette note: palette.cascade pins its base hue to 200 (blue) for every intent,
which cannot satisfy the mandated violet (#7c3aed family) accent. The cascade
below re-derives the SAME tier structure (area vs saturation caps: XL<=0.08,
L<=0.15, M<=0.30, S<=0.50, XS<=0.75) at hue ~257-262 (violet), keeping one
color family throughout; slate grays serve as the neutral series. This is the
product's real brand palette (docs/FORMS_UX_PLAN.md: brand-600 = #7c3aed).
"""
import hashlib
import os
import sys

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.pdfmetrics import registerFontFamily
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (CondPageBreak, Flowable, HRFlowable,
                                KeepTogether, PageBreak, Paragraph,
                                SimpleDocTemplate, Spacer, Table, TableStyle)
from reportlab.platypus.tableofcontents import TableOfContents

PDF_SKILL_DIR = '/home/z/my-project/skills/pdf'
sys.path.insert(0, os.path.join(PDF_SKILL_DIR, 'scripts'))
from pdf import install_font_fallback  # noqa: E402

OUT = '/home/z/my-project/task8-pdf/body.pdf'

# ---------------------------------------------------------------- fonts ----
FONT_DIR = '/usr/share/fonts'
pdfmetrics.registerFont(TTFont('FreeSerif', f'{FONT_DIR}/truetype/freefont/FreeSerif.ttf'))
pdfmetrics.registerFont(TTFont('FreeSerif-Bold', f'{FONT_DIR}/truetype/freefont/FreeSerifBold.ttf'))
pdfmetrics.registerFont(TTFont('FreeSerif-Italic', f'{FONT_DIR}/truetype/freefont/FreeSerifItalic.ttf'))
pdfmetrics.registerFont(TTFont('FreeSerif-BoldItalic', f'{FONT_DIR}/truetype/freefont/FreeSerifBoldItalic.ttf'))
pdfmetrics.registerFont(TTFont('NotoSerifSC', f'{FONT_DIR}/truetype/noto-serif-sc/NotoSerifSC-Regular.ttf'))
pdfmetrics.registerFont(TTFont('NotoSerifSC-Bold', f'{FONT_DIR}/truetype/noto-serif-sc/NotoSerifSC-Bold.ttf'))
pdfmetrics.registerFont(TTFont('DejaVuSans', f'{FONT_DIR}/truetype/dejavu/DejaVuSansMono.ttf'))
registerFontFamily('FreeSerif', normal='FreeSerif', bold='FreeSerif-Bold',
                   italic='FreeSerif-Italic', boldItalic='FreeSerif-BoldItalic')
registerFontFamily('NotoSerifSC', normal='NotoSerifSC', bold='NotoSerifSC-Bold')
registerFontFamily('DejaVuSans', normal='DejaVuSans', bold='DejaVuSans')
install_font_fallback()

# ------------------------------------------------- violet cascade palette --
PAGE_BG = colors.HexColor('#ffffff')      # XL tier (S=0.00)
SECTION_BG = colors.HexColor('#f5f3fa')   # XL tier (S~0.06)
CARD_BG = colors.HexColor('#f1eef8')      # L tier  (S~0.12)
TABLE_STRIPE = colors.HexColor('#f7f5fb')  # L tier (S~0.10)
HEADER_FILL = colors.HexColor('#4e4170')  # M tier  (S~0.25) - table headers
COVER_BLOCK = colors.HexColor('#5b4a8a')  # M tier  (S~0.30)
BORDER = colors.HexColor('#cdc4e0')       # S tier  (S~0.31) - light borders
ICON = colors.HexColor('#6d5aa8')         # S tier  (S~0.33)
ACCENT = colors.HexColor('#7c3aed')       # XS tier (S~0.72) - brand violet
ACCENT_DARK = colors.HexColor('#6d28d9')  # XS tier - heading violet
ACCENT_2 = colors.HexColor('#a78bfa')     # XS tier - light violet
TEXT_PRIMARY = colors.HexColor('#2b2a33')  # slate-dark body text
TEXT_MUTED = colors.HexColor('#64748b')   # slate-500
ARROW = colors.HexColor('#7d8698')        # slate arrows in diagram

TABLE_HEADER_COLOR = HEADER_FILL
TABLE_HEADER_TEXT = colors.white
TABLE_ROW_EVEN = colors.white
TABLE_ROW_ODD = TABLE_STRIPE

# ------------------------------------------------------------- geometry ----
PAGE_W, PAGE_H = A4
MARGIN = 62            # symmetric left/right (overflow.md 1.5)
TOP_MARGIN = 66
BOTTOM_MARGIN = 64
AVAIL_W = PAGE_W - 2 * MARGIN                      # ~471pt
AVAIL_H = PAGE_H - TOP_MARGIN - BOTTOM_MARGIN
H1_ORPHAN = AVAIL_H * 0.15

DOC_TITLE = 'UTech Automation ERP - Simple Flow Guide'

# ---------------------------------------------------------------- styles ---
body = ParagraphStyle('Body', fontName='FreeSerif', fontSize=10.5, leading=16.5,
                      alignment=TA_JUSTIFY, textColor=TEXT_PRIMARY,
                      spaceBefore=0, spaceAfter=8)
lead = ParagraphStyle('Lead', parent=body, fontSize=11, leading=17.5,
                      textColor=TEXT_PRIMARY, spaceAfter=10)
h1 = ParagraphStyle('H1x', fontName='FreeSerif', fontSize=19, leading=24,
                    textColor=ACCENT_DARK, spaceBefore=0, spaceAfter=4)
h2 = ParagraphStyle('H2x', fontName='FreeSerif', fontSize=13, leading=18,
                    textColor=TEXT_PRIMARY, spaceBefore=12, spaceAfter=6)
bullet = ParagraphStyle('Bul', parent=body, leftIndent=16, bulletIndent=4,
                        spaceAfter=4, alignment=TA_LEFT,
                        bulletFontName='FreeSerif')
step = ParagraphStyle('Step', parent=body, leftIndent=20, bulletIndent=4,
                      spaceAfter=5, alignment=TA_LEFT,
                      bulletFontName='FreeSerif')
caption = ParagraphStyle('Cap', fontName='FreeSerif', fontSize=8.5, leading=12,
                         alignment=TA_CENTER, textColor=TEXT_MUTED,
                         spaceBefore=3, spaceAfter=6)
cell = ParagraphStyle('Cell', fontName='FreeSerif', fontSize=9.5, leading=13,
                      alignment=TA_LEFT, textColor=TEXT_PRIMARY)
cell_c = ParagraphStyle('CellC', parent=cell, alignment=TA_CENTER)
head_cell = ParagraphStyle('HeadCell', fontName='FreeSerif', fontSize=9.5,
                           leading=13, alignment=TA_LEFT,
                           textColor=TABLE_HEADER_TEXT)
head_cell_c = ParagraphStyle('HeadCellC', parent=head_cell, alignment=TA_CENTER)
callout_txt = ParagraphStyle('CalloutTxt', parent=body, fontSize=10, leading=15,
                             alignment=TA_LEFT, spaceAfter=0)
toc_title_style = ParagraphStyle('TocTitle', parent=h1, spaceAfter=14)
toc_l0 = ParagraphStyle('TOC0', fontName='FreeSerif', fontSize=11, leading=20,
                        textColor=TEXT_PRIMARY, leftIndent=6)

# ------------------------------------------------------------- helpers -----
MAX_KEEP_HEIGHT = PAGE_H * 0.4


def safe_keep_together(elements):
    total_h = 0
    for el in elements:
        w, h = el.wrap(AVAIL_W, PAGE_H)
        total_h += h
    if total_h <= MAX_KEEP_HEIGHT:
        return [KeepTogether(elements)]
    if len(elements) >= 2:
        return [KeepTogether(elements[:2])] + list(elements[2:])
    return list(elements)


def add_heading(text, style, level=0):
    key = 'h_%s' % hashlib.md5(text.encode()).hexdigest()[:8]
    p = Paragraph('<a name="%s"/><b>%s</b>' % (key, text), style)
    p.bookmark_name = key
    p.bookmark_level = level
    p.bookmark_text = text
    p.bookmark_key = key
    return p


def chapter(story, num, title, first_block):
    """H1 with orphan prevention, accent underline, kept with first content."""
    story.append(CondPageBreak(H1_ORPHAN))
    story.append(Spacer(1, 14))
    head = add_heading('%d.  %s' % (num, title), h1, level=0)
    rule = HRFlowable(width='100%', thickness=1.0, color=BORDER,
                      spaceBefore=2, spaceAfter=10)
    story.extend(safe_keep_together([head, rule, first_block]))


def sub(story, title, first_block=None):
    hd = Paragraph('<b>%s</b>' % title, h2)
    if first_block is not None:
        story.extend(safe_keep_together([hd, first_block]))
    else:
        story.append(hd)


def P(text, style=None):
    return Paragraph(text, style or body)


def bullets(story, items):
    for it in items:
        story.append(Paragraph(it, bullet, bulletText='\u2022'))
    story.append(Spacer(1, 6))


def steps(story, items):
    for i, it in enumerate(items, 1):
        story.append(Paragraph(it, step, bulletText='%d.' % i))
    story.append(Spacer(1, 6))


def callout(text):
    tbl = Table([[Paragraph(text, callout_txt)]], colWidths=[AVAIL_W * 0.96])
    tbl.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), CARD_BG),
        ('LINEBEFORE', (0, 0), (0, -1), 3, ACCENT),
        ('TOPPADDING', (0, 0), (-1, -1), 9),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 9),
        ('LEFTPADDING', (0, 0), (-1, -1), 12),
        ('RIGHTPADDING', (0, 0), (-1, -1), 12),
    ]))
    tbl.hAlign = 'CENTER'
    return tbl


def make_table(headers, rows, ratios, align_center_cols=()):
    """Light-bordered table: violet-slate header, subtle stripe, all Paragraphs."""
    col_w = [r * AVAIL_W for r in ratios]
    assert abs(sum(ratios) - 1.0) < 0.001
    assert sum(col_w) <= AVAIL_W + 0.01
    data = []
    hc = [head_cell_c if i in align_center_cols else head_cell
          for i in range(len(headers))]
    data.append([Paragraph('<b>%s</b>' % h, s) for h, s in zip(headers, hc)])
    for row in rows:
        data.append([Paragraph(t, cell_c if i in align_center_cols else cell)
                     for i, t in enumerate(row)])
    tbl = Table(data, colWidths=col_w, hAlign='CENTER', repeatRows=1)
    style = [
        ('BACKGROUND', (0, 0), (-1, 0), TABLE_HEADER_COLOR),
        ('GRID', (0, 0), (-1, -1), 0.5, BORDER),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('LEFTPADDING', (0, 0), (-1, -1), 7),
        ('RIGHTPADDING', (0, 0), (-1, -1), 7),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
    ]
    for r in range(1, len(data)):
        style.append(('BACKGROUND', (0, r), (-1, r),
                      TABLE_ROW_EVEN if r % 2 == 1 else TABLE_ROW_ODD))
    tbl.setStyle(TableStyle(style))
    return tbl


# ----------------------------------------------------- flow diagram (SVG-free
# vector drawing: rounded boxes + arrows, ReportLab canvas primitives) -------
class FlowDiagram(Flowable):
    """Full-width 9-stage snake flow: 5 boxes on row 1 (L->R), 4 on row 2
    (R->L), a vertical connector joins them. Pure vector, violet/slate."""

    def __init__(self, width, stages):
        Flowable.__init__(self)
        self.width = width
        self.stages = stages
        self.box_w, self.box_h, self.gap = 86, 46, 7.75
        self.row_gap = 30
        self.height = 2 * self.box_h + self.row_gap

    def _box(self, c, x, y, num, label):
        c.saveState()
        c.setFillColor(SECTION_BG)
        c.setStrokeColor(ACCENT)
        c.setLineWidth(1.1)
        c.roundRect(x, y, self.box_w, self.box_h, 8, stroke=1, fill=1)
        c.setFillColor(ACCENT)
        c.setFont('FreeSerif-Bold', 7)
        c.drawCentredString(x + self.box_w / 2.0, y + self.box_h - 12, num)
        c.setFillColor(TEXT_PRIMARY)
        c.setFont('FreeSerif-Bold', 9.5)
        c.drawCentredString(x + self.box_w / 2.0,
                            y + self.box_h / 2.0 - 11, label)
        c.restoreState()

    def _arrow_h(self, c, x0, x1, y):
        """Horizontal arrow from x0 to x1 (x1 < x0 means leftward)."""
        c.saveState()
        c.setStrokeColor(ARROW)
        c.setFillColor(ARROW)
        c.setLineWidth(1.1)
        c.line(x0, y, x1, y)
        d = 4.2 if x1 > x0 else -4.2
        p = c.beginPath()
        p.moveTo(x1 + d, y + 3.2)
        p.lineTo(x1 + d, y - 3.2)
        p.lineTo(x1, y)
        p.close()
        c.drawPath(p, stroke=0, fill=1)
        c.restoreState()

    def _arrow_v(self, c, x, y0, y1):
        c.saveState()
        c.setStrokeColor(ARROW)
        c.setFillColor(ARROW)
        c.setLineWidth(1.1)
        c.line(x, y0, x, y1)
        p = c.beginPath()
        p.moveTo(x + 3.2, y1 + 4.2)
        p.lineTo(x - 3.2, y1 + 4.2)
        p.lineTo(x, y1)
        p.close()
        c.drawPath(p, stroke=0, fill=1)
        c.restoreState()

    def wrap(self, availWidth, availHeight):
        return (self.width, self.height + 4)

    def draw(self):
        c = self.canv
        bw, bh, gp, rg = self.box_w, self.box_h, self.gap, self.row_gap
        top_y = self.height - bh          # row 1 y
        bot_y = 0                          # row 2 y
        # flowable-local coordinates: origin is the left content edge,
        # so row 1 starts at x=0 (5 boxes: 5*86 + 4*7.75 = 461 <= AVAIL_W)
        row1_x = [i * (bw + gp) for i in range(5)]
        # snake: stage 6 sits directly under stage 5, then leftwards
        row2_x = [row1_x[1], row1_x[2], row1_x[3], row1_x[4]]
        stages = self.stages
        # row 1: stages 1..5, left to right
        for i in range(5):
            num, label = stages[i]
            self._box(c, row1_x[i], top_y, num, label)
            if i < 4:
                self._arrow_h(c, row1_x[i] + bw + 1.5,
                              row1_x[i + 1] - 1.5, top_y + bh / 2.0)
        # vertical connector stage 5 -> stage 6 (same column)
        self._arrow_v(c, row1_x[4] + bw / 2.0, top_y - 1.5, bot_y + bh + 1.5)
        # row 2: stages 6..9, right to left
        for i, col in enumerate([4, 3, 2, 1]):
            num, label = stages[5 + i]
            self._box(c, row2_x[col - 1], bot_y, num, label)
            if i < 3:
                nxt_col = [4, 3, 2, 1][i + 1]
                self._arrow_h(c, row2_x[col - 1] - 1.5,
                              row2_x[nxt_col - 1] + bw + 1.5,
                              bot_y + bh / 2.0)


# ------------------------------------------------------------ doc template -
class TocDocTemplate(SimpleDocTemplate):
    def afterFlowable(self, flowable):
        if hasattr(flowable, 'bookmark_name'):
            level = getattr(flowable, 'bookmark_level', 0)
            text = getattr(flowable, 'bookmark_text', '')
            key = getattr(flowable, 'bookmark_key', '')
            self.notify('TOCEntry', (level, text, self.page, key))


def draw_footer(canv, doc):
    canv.saveState()
    canv.setStrokeColor(BORDER)
    canv.setLineWidth(0.5)
    canv.line(MARGIN, 44, PAGE_W - MARGIN, 44)
    canv.setFont('FreeSerif', 7.5)
    canv.setFillColor(TEXT_MUTED)
    canv.drawString(MARGIN, 33, 'UTech Automation ERP  \u00b7  Simple Flow Guide')
    canv.drawRightString(PAGE_W - MARGIN, 33, 'Page %d' % doc.page)
    canv.restoreState()


# ---------------------------------------------------------------- story ----
story = []

# ----- Contents (unnumbered) -----
toc = TableOfContents()
toc.levelStyles = [toc_l0]
story.append(Paragraph('<b>Contents</b>', toc_title_style))
story.append(HRFlowable(width='100%', thickness=1.0, color=BORDER,
                        spaceBefore=0, spaceAfter=12))
story.append(toc)
story.append(Spacer(1, 18))
story.append(P('This guide uses only everyday words. Where a factory word is '
               'unavoidable - like <b>GRN</b> or <b>BOM</b> - it is explained '
               'the first time it appears, and again in the Glossary at the '
               'end.', body))
story.append(PageBreak())

# ----- 1. What is UTech ERP? -----
chapter(story, 1, 'What is UTech ERP?', P(
    'UTech ERP is one computer program that keeps all the factory\u2019s '
    'records in one place. You open it in your web browser, just like a '
    'website, so there is nothing to install on your computer. Instead of '
    'paper notebooks and separate spreadsheets, everyone works on the same '
    'records at the same time. When one person saves a change, the others '
    'see it straight away. The system also does the dull work for you: it '
    'gives every document its own number, adds up money and tax, and keeps '
    'stock counts correct.', lead))
story.append(P('Here is what you can do with it:'))
bullets(story, [
    'Write <b>quotations</b> (price offers) and <b>invoices</b> (bills) for customers.',
    'Plan work with <b>job cards</b> and follow progress on the shop floor.',
    'Send material out for work and receive it back with a <b>jobwork challan</b>.',
    'Record everything that comes into or goes out of <b>stock</b>.',
    'Check the <b>quality</b> of what you receive and what you make.',
    'Print <b>reports</b>, and hand the accounts over to <b>Tally</b>.',
    'Decide <b>who is allowed</b> to see and do what, with roles.',
])
story.append(Spacer(1, 4))
story.append(P('The rest of this guide walks through each of these in order, '
               'in the same sequence a real order follows.'))

# ----- 2. The Big Picture -----
chapter(story, 2, 'The Big Picture', P(
    'Every order in the factory follows the same path, from the first phone '
    'call to the money in the bank. The drawing below shows the nine stages '
    'and how one leads to the next. Follow the numbers: the top row goes left '
    'to right, then the flow continues on the second row.', lead))
diagram = FlowDiagram(AVAIL_W, [
    ('1', 'Enquiry'), ('2', 'Quotation'), ('3', 'Sales Order'),
    ('4', 'Job Card'), ('5', 'Jobwork'), ('6', 'Quality Check'),
    ('7', 'Dispatch'), ('8', 'Invoice'), ('9', 'Payment')])
story.append(Spacer(1, 8))
story.append(diagram)
story.append(Paragraph('The nine stages of an order, from first question to '
                       'final payment.', caption))
story.append(Spacer(1, 4))
bullets(story, [
    '<b>1. Enquiry</b> \u2014 a customer asks: \u201cCan you make this part, and what will it cost?\u201d',
    '<b>2. Quotation</b> \u2014 you write down what will be supplied and at what price, and send it (Masters \u2192 Quotations).',
    '<b>3. Sales Order</b> \u2014 the customer says yes. In UTech, the approved quotation is the agreed order.',
    '<b>4. Job Card</b> \u2014 the office plans the work: what to make, how many, which materials and machines (Masters \u2192 Jobcards).',
    '<b>5. Jobwork</b> \u2014 material moves to where the work happens: our shop floor, or a vendor who sends it back done.',
    '<b>6. Quality Check</b> \u2014 good pieces are counted into stock; rejected pieces are not.',
    '<b>7. Dispatch</b> \u2014 finished goods leave for the customer with a dispatch challan (Sales \u2192 Dispatch).',
    '<b>8. Invoice</b> \u2014 the bill, with tax added automatically (Sales \u2192 Invoices).',
    '<b>9. Payment</b> \u2014 money received is recorded on the invoice until it shows Paid.',
])
story.append(Spacer(1, 4))
story.append(P('A <b>challan</b> is simply the paper that travels with goods '
               'when they move. You will meet three of them: jobwork challan '
               '(material out to a vendor), dispatch challan (goods out to a '
               'customer) and GRN (goods in from a vendor).'))

# ----- 3. The Sales Journey -----
chapter(story, 3, 'The Sales Journey, Step by Step', P(
    'This chapter follows one order through the system. For each stage it '
    'says <b>who</b> usually does it, <b>what to click</b> (the menu names '
    'are the real ones in the program) and <b>what the system does by '
    'itself</b>. A small step list and a summary table close the chapter.', lead))

sub(story, '3.1  Write the quotation  \u2014  sales person')
steps(story, [
    'Go to <b>Masters \u2192 Quotations</b> and open a new quotation.',
    'Pick the customer, then add items, quantities and prices.',
    'Save. The system gives the quotation its own number, like '
    '<b>QT-26-00001</b> (QT for quotation, 26 for the year), and marks it <b>Draft</b>.',
    'When the customer receives it, mark it <b>Sent</b>. When they agree, '
    'mark it <b>Approved</b>. If they refuse, mark it <b>Rejected</b>.',
])
sub(story, '3.2  The customer says yes  \u2014  the sales order')
story.append(P('There is no separate \u201csales order\u201d paper to make. '
               'The approved quotation <b>is</b> the order, and work is '
               'planned from it. Later, when the bill is made, the quotation '
               'is marked <b>Converted</b> so nobody bills the same order '
               'twice.'))
sub(story, '3.3  Plan the work: the job card  \u2014  planner or supervisor')
steps(story, [
    'Go to <b>Masters \u2192 Jobcards</b> and open a new job card.',
    'Choose the customer and the item to make, add the materials and the '
    'operations (the steps of work), and set a due date and a priority.',
    'Save. The system gives it a number like <b>JC-26-00001</b> and marks '
    'it <b>Draft</b>.',
    'Start the job when work begins (<b>In Progress</b>), hold it if you '
    'must wait (<b>On Hold</b>), and complete it when done. Workers add '
    'short progress notes as they go.',
])
story.append(P('The <b>Assignments</b> page (Masters \u2192 Assignments) hands '
               'each task to a named person, so everyone knows their part.'))
sub(story, '3.4  Material moves: jobwork  \u2014  store and production')
story.append(P('If the work is done inside the factory, the job card guides '
               'the shop floor. If it is done by a vendor (an outside '
               'supplier who works for you), use a jobwork challan:'))
steps(story, [
    'Go to <b>Customer Inventory \u2192 Vendor Dispatch (Jobwork)</b> and open a new jobwork challan.',
    'List the material that travels to the vendor. The system gives it a '
    'number like <b>JW-26-00001</b> and marks it <b>Issued</b>.',
    'Stock goes <b>down</b> when the material leaves, and back <b>up</b> '
    'when it returns processed. The status moves from <b>Issued</b> to '
    '<b>Partly Received</b> to <b>Received</b>.',
])
sub(story, '3.5  Check quality  \u2014  quality or store person')
story.append(P('Before goods count as good stock, they are checked. When a '
               'delivery is received, the person receiving it enters '
               '<b>accepted</b> and <b>rejected</b> quantities. Full '
               'inspections with measurements can be recorded on the Quality '
               'page. The system only counts accepted pieces into stock, so '
               'bad material never hides on the shelves.'))
sub(story, '3.6  Send the goods: dispatch  \u2014  store or dispatch person')
steps(story, [
    'Go to <b>Sales \u2192 Dispatch</b> and open a new dispatch challan.',
    'Pick the customer, the items and the quantities leaving the gate.',
    'Save. The system gives a number like <b>DC-26-00001</b> and stock '
    'goes <b>down</b> at once \u2014 a draft challan holds the goods aside '
    'so nobody sells them twice.',
    'Mark the challan <b>Delivered</b> when the customer receives it.',
])
sub(story, '3.7  Make the bill: invoice  \u2014  accounts')
steps(story, [
    'Go to <b>Sales \u2192 Invoices</b> and open a new invoice.',
    'Pick the customer and the items with their rates. <b>GST</b> (the '
    'goods and services tax) is calculated for you, line by line.',
    'Save. The invoice gets a number like <b>INV-26-00001</b> and starts '
    'as <b>Draft</b>. Issue it when it is final.',
    'Shortcut: open an approved quotation and use <b>Convert</b> \u2014 the '
    'invoice is made from it with the items already filled in.',
])
sub(story, '3.8  Receive the money: payment  \u2014  accounts')
steps(story, [
    'Open the invoice and choose to add a payment. Enter the amount, the '
    'date and how the money came (cash, bank, and so on).',
    'The invoice status moves to <b>Partly Paid</b>, then <b>Paid</b>. '
    'Invoices left unpaid too long show as <b>Overdue</b> on the dashboard.',
])
story.append(Spacer(1, 4))
story.append(make_table(
    ['Stage', 'Where in the menu', 'Number given', 'System does automatically'],
    [
        ['Quotation', 'Masters \u2192 Quotations', 'QT-26-00001',
         'Numbering; status Draft \u2192 Sent \u2192 Approved'],
        ['Sales order', 'the approved quotation', 'n/a',
         'Marked Converted when billed'],
        ['Job card', 'Masters \u2192 Jobcards', 'JC-26-00001',
         'Numbering; status; progress notes'],
        ['Jobwork', 'Customer Inventory \u2192 Vendor Dispatch (Jobwork)',
         'JW-26-00001', 'Stock out and back in; status'],
        ['Dispatch', 'Sales \u2192 Dispatch', 'DC-26-00001',
         'Stock down; status \u2192 Delivered'],
        ['Invoice', 'Sales \u2192 Invoices', 'INV-26-00001',
         'GST and totals; status \u2192 Issued'],
        ['Payment', 'on the invoice page', 'n/a',
         'Status \u2192 Partly Paid \u2192 Paid'],
    ],
    [0.14, 0.32, 0.16, 0.38]))
story.append(Paragraph('The sales journey at a glance. Every document gets '
                       'its own number in the same way.', caption))

# ----- 4. Buying from Vendors -----
chapter(story, 4, 'Buying from Vendors, Step by Step', P(
    'Sometimes you buy material, or ask a vendor to do work for you. Four '
    'papers tell this story: the <b>vendor work order</b> (what you asked '
    'for), the <b>purchase order</b> (what you agreed to buy), the '
    '<b>GRN</b> (what actually arrived) and, if needed, the <b>purchase '
    'return</b> (what went back).', lead))
sub(story, '4.1  Tell the vendor what you need')
steps(story, [
    'Go to <b>Customer Inventory \u2192 Vendor Work Orders</b> and open a new one.',
    'Write what material or work you expect back, and from which vendor. '
    'It gets a number like <b>VWO-26-00001</b>. Mark it <b>Sent</b> when '
    'the vendor has it.',
    'As replies come in, the status moves to <b>Partly Received</b> or '
    '<b>Received</b>; when the job is finished for good, it is '
    '<b>Short Closed</b>.',
])
sub(story, '4.2  Make the purchase order (PO)')
steps(story, [
    'From the vendor work order, or from <b>Company Inventory \u2192 '
    'Purchase Orders</b>, create a purchase order. It gets a number like '
    '<b>PO-26-00001</b>.',
    'A new PO waits as <b>Pending Approval</b>. A manager approves or '
    'rejects it. Only an <b>Approved</b> PO can be received against.',
])
sub(story, '4.3  Material arrives: the GRN')
story.append(P('<b>GRN means Goods Received Note</b> \u2014 the record made '
               'every time a delivery comes in. It is the most-used paper in '
               'buying, so it is worth remembering.'))
steps(story, [
    'Go to <b>Company Inventory \u2192 GRN (Stock In)</b> and open a new GRN.',
    'Pick the purchase order, then enter what arrived: received quantity, '
    'how many pieces are <b>accepted</b>, how many <b>rejected</b>.',
    'Save. The GRN gets its own number and <b>stock goes up</b> by the '
    'accepted quantity, straight away.',
    'The purchase order now shows how much has arrived (<b>Partly '
    'Received</b>, then <b>Received</b>). If the PO came from a vendor '
    'work order, that work order moves ahead by itself too \u2014 nothing '
    'to link by hand.',
])
sub(story, '4.4  Something wrong? Send it back')
story.append(P('If material must go back to the vendor, make a purchase '
               'return: <b>Company Inventory \u2192 Purchase Returns</b>. '
               'List the items and quantities leaving, and get it approved. '
               'When the return is processed, <b>stock goes down</b> to '
               'match what physically left the store. Customer returns work '
               'the same way in reverse (Sales \u2192 Returns): goods come '
               'back and stock goes up.'))
story.append(Spacer(1, 2))
story.append(callout(
    '<b>Remember:</b> the GRN is where buying meets stock. No GRN, no stock '
    '\u2014 nothing counts as received until it is written down on one.'))

# ----- 5. Keeping Stock Correct -----
chapter(story, 5, 'Keeping Stock Correct', P(
    'Stock is the material and finished goods you hold right now. In UTech '
    'you never type a stock number by hand \u2014 the count changes by '
    'itself when documents are made. Every change is also written into a '
    'diary called the <b>stock ledger</b>, so you can always see who '
    'changed what, when, and why.', lead))
story.append(make_table(
    ['This happens\u2026', 'Stock', 'Because\u2026'],
    [
        ['A GRN is saved (accepted pieces)', 'goes UP',
         'material has physically arrived'],
        ['Processed material returns from a vendor jobwork', 'goes UP',
         'the challan is being received back'],
        ['A production batch is completed', 'goes UP',
         'finished goods have been made'],
        ['A customer returns goods (Sales \u2192 Returns)', 'goes UP',
         'goods came back into the store'],
        ['A dispatch challan is made', 'goes DOWN',
         'goods are held aside for the customer'],
        ['Material is issued on a jobwork challan', 'goes DOWN',
         'material left for the vendor'],
        ['A production batch uses material', 'goes DOWN',
         'consumption is booked at completion'],
        ['A purchase return is processed', 'goes DOWN',
         'goods went back to the vendor'],
    ],
    [0.44, 0.13, 0.43], align_center_cols=(1,)))
story.append(Paragraph('What moves stock up or down \u2014 and the simple '
                       'reason behind each move.', caption))
story.append(Spacer(1, 6))
story.append(P('Where to see live stock: open <b>Stock Management \u2192 '
               'Stock Overview & Ledger</b>. It shows the current '
               'quantity of every item, the full history of movements for '
               'each one, and it is also where reports of stock are '
               'downloaded. When an item runs low, the system raises a '
               'low-stock notification so you can reorder in time.'))
story.append(P('One careful point: material that belongs to a customer '
               '(given to us for processing) is counted separately, under '
               '<b>Customer Inventory \u2192 Customer Material</b>. It never '
               'mixes with our own stock.'))

# ----- 6. Masters -----
chapter(story, 6, 'Masters \u2014 The Foundation', P(
    'Masters are the fixed lists the whole factory shares: the customers, '
    'the items, the machines and so on. They are filled in once and used '
    'everywhere. A quotation, a job card and an invoice all pick the same '
    'customer and items from these lists \u2014 that is why names and '
    'spellings stay tidy. If something is missing on a screen, the fix is '
    'usually to add it to a master first.', lead))
story.append(make_table(
    ['Master', 'Where in the menu', 'What it holds'],
    [
        ['Parties', 'Masters \u2192 Parties',
         'Customers and vendors: address, phone, GSTIN (the tax number of a '
         'business) and their account balance'],
        ['Items', 'Company Inventory \u2192 Items',
         'Everything you buy, make or sell \u2014 with its unit (pieces, kg, '
         'metres) and its current stock'],
        ['Machines', 'Masters \u2192 Machines',
         'The machines in the factory that work can be planned on'],
        ['Processes', 'Masters \u2192 Processes',
         'The kinds of work a job can go through, like cutting or welding'],
        ['Departments', 'Admin \u2192 Departments',
         'The sections of the factory (and the Department Roles inside them)'],
        ['BOM', 'Company Inventory \u2192 BOMs',
         'Bill of Materials \u2014 the recipe of a product: every part and '
         'quantity needed to make one piece'],
        ['Users & Roles', 'Admin \u2192 Users / Roles',
         'The people who log in, and what each one is allowed to do'],
    ],
    [0.16, 0.28, 0.56]))
story.append(Paragraph('The master lists and where each one lives in the '
                       'menu.', caption))

# ----- 7. Roles & Permissions -----
chapter(story, 7, 'Who Can Do What \u2014 Roles & Permissions', P(
    'Think of a <b>permission</b> as one named right \u2014 for example, '
    '\u201ccreate an invoice\u201d. A <b>role</b> is a bundle of these '
    'rights given to a job title. Your role decides which menus and buttons '
    'you see at all: if a menu is missing, that is on purpose, not a fault. '
    'This keeps confidential pages (like costs and users) away from people '
    'who do not need them.', lead))
story.append(make_table(
    ['Role', 'In plain words'],
    [
        ['SUPERADMIN', 'Sees and does everything. One such account is set up '
         'when the system is installed.'],
        ['Admin', 'Creates users, gives out roles, and looks after the whole '
         'system.'],
        ['Plant Head', 'Sees the whole plant: all departments, all numbers.'],
        ['Manager', 'Runs day-to-day operations \u2014 sales, purchases, '
         'production pages.'],
        ['Project Engineer', 'Follows the projects assigned to them, nothing '
         'else.'],
        ['Department Head, Supervisor, Team Leader',
         'See and run the work inside their own department only.'],
        ['Operator', 'Sees only a personal dashboard and the assignments '
         'given to them.'],
    ],
    [0.30, 0.70]))
story.append(Paragraph('The seeded roles and what they may do. Your company '
                       'may use only some of them.', caption))
story.append(Spacer(1, 6))
story.append(P('Admins create accounts under <b>Admin \u2192 Users</b>: press '
               'New User, fill the name, email, role and department, and '
               'save. The new person receives a way to sign in and should '
               'set their own password at first login. A user can change '
               'their password any time from their profile menu.'))

# ----- 8. Reports & Tally Export -----
chapter(story, 8, 'Reports & Tally Export', P(
    'Reports turn your records into files you can read, print or email. '
    'Open <b>Analytics \u2192 Reports</b> and download a ready-made Excel '
    'file of what you need \u2014 no copy-pasting from screens. The three '
    'Analytics pages next to it draw the same numbers as charts: Sales '
    'Analytics, Production Analytics and Inventory Analytics.', lead))
bullets(story, [
    '<b>Invoices, Jobcards, Items, Expenses</b> \u2014 the full lists, for checking or meetings.',
    '<b>Party ledger</b> \u2014 every bill and payment of one customer or vendor, on one sheet.',
    '<b>Stock ledger</b> \u2014 every movement that changed stock, with dates.',
    '<b>Customer stock and vendor stock</b> \u2014 what material is lying with customers or at vendors.',
])
story.append(Spacer(1, 4))
story.append(P('<b>Tally export</b> is a bridge to the accountant. Tally is '
               'the accounting software most Indian accountants use. Instead '
               'of retyping invoices into Tally, UTech can export a file '
               'Tally understands: the <b>masters</b> (your parties and '
               'items) and the <b>vouchers</b> (invoices, receipts and '
               'payments) for any date range. Your admin sets it up once; '
               'after that it is a simple download-and-import job, and the '
               'account books match the factory records.'))

# ----- 9. Glossary -----
chapter(story, 9, 'Glossary', P(
    'Every special word used in this guide, in one place. If a word on a '
    'screen confuses you, look it up here.', lead))
story.append(make_table(
    ['Word', 'Simple meaning'],
    [
        ['Quotation', 'A written price offer to a customer: what will be '
         'supplied and for how much.'],
        ['Sales Order', 'A customer\u2019s confirmed order. In UTech it is '
         'the approved quotation.'],
        ['Job Card', 'The plan for one manufacturing job: item, materials, '
         'steps, due date, priority.'],
        ['Jobwork', 'Work sent out to a vendor, with a challan; the material '
         'goes out and comes back done.'],
        ['GRN', 'Goods Received Note \u2014 the record that a delivery has '
         'arrived; it raises stock.'],
        ['Dispatch', 'Goods sent to a customer, with a dispatch challan; it '
         'lowers stock.'],
        ['Invoice', 'The bill for goods or services, with GST added.'],
        ['Payment', 'Money received, recorded on an invoice until it shows '
         'Paid.'],
        ['BOM', 'Bill of Materials \u2014 the recipe of a product: all parts '
         'and quantities to make one.'],
        ['GST', 'Goods and Services Tax \u2014 the tax added to most sales in '
         'India.'],
        ['GSTIN', 'The tax registration number of a business (every registered '
         'company has one).'],
        ['HSN', 'A standard code that says what kind of product an item is; '
         'used on invoices.'],
        ['Party', 'Any business you deal with \u2014 a customer or a vendor.'],
        ['Master', 'A shared list everyone picks from, like Items or '
         'Parties.'],
    ],
    [0.20, 0.80]))

# ----- 10. Quick Start -----
chapter(story, 10, 'Quick Start for a New User', P(
    'New to UTech? This page is all you need for day one. First, ask your '
    'admin for your own user name (an email) and a starting password. Never '
    'use another person\u2019s login \u2014 your name is stamped on '
    'everything you do.', lead))
sub(story, '10.1  Sign in')
steps(story, [
    'Open the UTech web address in your browser (your admin will give you '
    'the link).',
    'Type your email and password, and press Sign in.',
    'You land on the <b>Dashboard</b> \u2014 the home screen.',
])
sub(story, '10.2  Change the password on day one')
story.append(P('The system comes with one ready-made admin account '
               '(<b>admin@utech.local</b>) \u2014 the person who installed '
               'the system knows its password. If you are that person, '
               'change this password the same day: open your profile menu '
               '(top-right corner) and choose the change-password option. '
               'Every other user should set a personal password at their '
               'first login too.'))
sub(story, '10.3  Read the dashboard')
story.append(P('The dashboard is the factory at a glance. The cards on top '
               'show recent sales, active job cards, pending jobwork, '
               'overdue invoices, and how many parties and items are on '
               'record. Below them, charts show sales month by month and '
               'how stock is spread across categories. If a number looks '
               'wrong, click it \u2014 it usually leads to the list behind '
               'it.'))
sub(story, '10.4  The first three things to try')
steps(story, [
    'Find yourself: go to <b>Admin \u2192 Users</b> and open your own name. '
    'Check your role \u2014 it decides what you can see.',
    'Open a customer: <b>Masters \u2192 Parties</b>, click any name, and '
    'look at the details and the ledger behind it.',
    'Watch stock move: <b>Stock Management \u2192 Stock Overview & '
    'Ledger</b>, pick an item, and read its diary of movements.',
])
story.append(Spacer(1, 4))
story.append(callout(
    '<b>Missing a menu?</b> Your role does not include it \u2014 ask your '
    'admin. <b>Stuck?</b> The Glossary on the previous pages explains every '
    'word the screens use.'))

# ---------------------------------------------------------------- build ----
doc = TocDocTemplate(
    OUT, pagesize=A4,
    leftMargin=MARGIN, rightMargin=MARGIN,
    topMargin=TOP_MARGIN, bottomMargin=BOTTOM_MARGIN,
    title=DOC_TITLE, author='Z.ai', creator='Z.ai',
    subject='Plain-language guide to the UTech Automation ERP flows')
doc.multiBuild(story, onFirstPage=draw_footer, onLaterPages=draw_footer)
print('built', OUT)
