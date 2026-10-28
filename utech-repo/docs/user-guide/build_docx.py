#!/usr/bin/env python3
"""Build the Hinglish user manual (DOCX) for the U-Tech ERP.

The screenshots come from the Playwright walkthrough in
frontend/e2e/user-guide-capture.spec.js, which writes docs/user-guide/screenshots/
plus a manifest.json. This script turns those screenshots + the text below into
docs/user-guide/Utech-ERP-User-Guide-Hinglish.docx.

Regenerate:
    cd frontend && SHOTS_DIR=../docs/user-guide/screenshots \
      E2E_USE_DEMO=1 VERCEL=1 npx playwright test user-guide-capture.spec.js
    python3 docs/user-guide/build_docx.py      # needs: pip install python-docx pillow
"""

import json
import os
from pathlib import Path

from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor
from docx.enum.text import WD_LINE_SPACING

HERE = Path(__file__).resolve().parent
SHOT_DIR = HERE / "screenshots"
OUT = HERE / "Utech-ERP-User-Guide-Hinglish.docx"

BRAND = RGBColor(0x4C, 0x1D, 0x95)
BRAND_LIGHT = RGBColor(0x6D, 0x28, 0xD9)
INK = RGBColor(0x1F, 0x29, 0x37)
MUTED = RGBColor(0x5B, 0x64, 0x72)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)

FILL_BRAND = "4C1D95"
FILL_HEAD = "EDE9FE"
FILL_ZEBRA = "F8FAFC"
FILL_TIP = "F5F3FF"
FILL_WARN = "FFF7ED"
FILL_STOP = "FEF2F2"
FILL_NOTE = "EFF6FF"

BODY_FONT = "Calibri"

# ---------------------------------------------------------------------------
# low level helpers
# ---------------------------------------------------------------------------


# OOXML requires a fixed child order inside tcPr / pPr / trPr. Word can refuse
# a file whose elements are merely appended at the end, so every helper below
# inserts its element at the schema position.
TCPR_ORDER = [
    "w:cnfStyle", "w:tcW", "w:gridSpan", "w:hMerge", "w:vMerge", "w:tcBorders",
    "w:shd", "w:noWrap", "w:tcMar", "w:textDirection", "w:tcFitText", "w:vAlign",
    "w:hideMark", "w:headers", "w:cellIns", "w:cellDel", "w:cellMerge", "w:tcPrChange",
]
PPR_ORDER = [
    "w:pStyle", "w:keepNext", "w:keepLines", "w:pageBreakBefore", "w:framePr",
    "w:widowControl", "w:numPr", "w:suppressLineNumbers", "w:pBdr", "w:shd",
    "w:tabs", "w:suppressAutoHyphens", "w:kinsoku", "w:wordWrap",
    "w:overflowPunct", "w:topLinePunct", "w:autoSpaceDE", "w:autoSpaceDN",
    "w:bidi", "w:adjustRightInd", "w:snapToGrid", "w:spacing", "w:ind",
    "w:contextualSpacing", "w:mirrorIndents", "w:suppressOverlap", "w:jc",
    "w:textDirection", "w:textAlignment", "w:textboxTightWrap", "w:outlineLvl",
    "w:divId", "w:cnfStyle", "w:rPr", "w:sectPr", "w:pPrChange",
]
TRPR_ORDER = ["w:cnfStyle", "w:divId", "w:gridBefore", "w:gridAfter", "w:wBefore",
              "w:wAfter", "w:cantSplit", "w:trHeight", "w:tblHeader", "w:tblCellSpacing",
              "w:jc", "w:hidden", "w:ins", "w:del", "w:trPrChange"]


def _localname(element):
    return element.tag.split("}")[-1]


def _strip_prefix(order):
    return [name.split(":")[-1] for name in order]


def _insert_ordered(parent, element, order, replace_existing=True):
    """Insert `element` at its schema position among `parent`'s children."""
    order = _strip_prefix(order)
    name = _localname(element)
    if replace_existing:
        for child in list(parent):
            if _localname(child) == name:
                parent.remove(child)
    my_pos = order.index(name) if name in order else len(order)
    index = len(parent)
    for i, child in enumerate(parent):
        cname = _localname(child)
        cpos = order.index(cname) if cname in order else len(order)
        if cpos > my_pos:
            index = i
            break
    parent.insert(index, element)


def shade(cell_or_par, hex_fill):
    if hasattr(cell_or_par, "_tc"):
        pr = cell_or_par._tc.get_or_add_tcPr()
        order = TCPR_ORDER
    else:
        pr = cell_or_par._p.get_or_add_pPr()
        order = PPR_ORDER
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), hex_fill)
    _insert_ordered(pr, shd, order)


def cell_borders(cell, color="E2E8F0", size="6", sides=("top", "left", "bottom", "right")):
    tcPr = cell._tc.get_or_add_tcPr()
    borders = OxmlElement("w:tcBorders")
    for side in sides:
        el = OxmlElement(f"w:{side}")
        el.set(qn("w:val"), "single")
        el.set(qn("w:sz"), size)
        el.set(qn("w:space"), "0")
        el.set(qn("w:color"), color)
        borders.append(el)
    _insert_ordered(tcPr, borders, TCPR_ORDER)


def cell_margins(cell, top=80, bottom=80, left=110, right=110):
    tcPr = cell._tc.get_or_add_tcPr()
    mar = OxmlElement("w:tcMar")
    for name, val in (("top", top), ("bottom", bottom), ("start", left), ("end", right)):
        el = OxmlElement(f"w:{name}")
        el.set(qn("w:w"), str(val))
        el.set(qn("w:type"), "dxa")
        mar.append(el)
    _insert_ordered(tcPr, mar, TCPR_ORDER)


def table_fixed(table, widths_cm):
    table.autofit = False
    tblPr = table._tbl.tblPr
    layout = OxmlElement("w:tblLayout")
    layout.set(qn("w:type"), "fixed")
    tblPr.append(layout)
    for row in table.rows:
        for idx, width in enumerate(widths_cm):
            row.cells[idx].width = Cm(width)
    for idx, width in enumerate(widths_cm):
        table.columns[idx].width = Cm(width)


def repeat_header(row):
    trPr = row._tr.get_or_add_trPr()
    el = OxmlElement("w:tblHeader")
    el.set(qn("w:val"), "true")
    _insert_ordered(trPr, el, TRPR_ORDER)


def keep_with_next(par):
    par.paragraph_format.keep_with_next = True


def add_field(par, instr):
    run = par.add_run()
    fld_begin = OxmlElement("w:fldChar")
    fld_begin.set(qn("w:fldCharType"), "begin")
    instr_el = OxmlElement("w:instrText")
    instr_el.set(qn("xml:space"), "preserve")
    instr_el.text = instr
    fld_sep = OxmlElement("w:fldChar")
    fld_sep.set(qn("w:fldCharType"), "separate")
    fld_text = OxmlElement("w:t")
    fld_text.text = "1"
    fld_end = OxmlElement("w:fldChar")
    fld_end.set(qn("w:fldCharType"), "end")
    run._r.append(fld_begin)
    run._r.append(instr_el)
    run._r.append(fld_sep)
    run._r.append(fld_text)
    run._r.append(fld_end)


def par_border_bottom(par, color="C4B5FD", size="8"):
    pPr = par._p.get_or_add_pPr()
    borders = OxmlElement("w:pBdr")
    bottom = OxmlElement("w:bottom")
    bottom.set(qn("w:val"), "single")
    bottom.set(qn("w:sz"), size)
    bottom.set(qn("w:space"), "4")
    bottom.set(qn("w:color"), color)
    borders.append(bottom)
    _insert_ordered(pPr, borders, PPR_ORDER)


def page_break(doc):
    doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)


# ---------------------------------------------------------------------------
# document scaffolding
# ---------------------------------------------------------------------------

doc = Document()

# base style
normal = doc.styles["Normal"]
normal.font.name = BODY_FONT
normal.font.size = Pt(10.5)
normal.font.color.rgb = INK
normal.paragraph_format.space_after = Pt(5)
normal.paragraph_format.line_spacing = 1.12
rpr = normal.element.get_or_add_rPr()
fonts = OxmlElement("w:rFonts")
for attr in ("w:ascii", "w:hAnsi", "w:cs", "w:eastAsia"):
    fonts.set(qn(attr), BODY_FONT)
rpr.append(fonts)

section = doc.sections[0]
section.page_width = Cm(21)
section.page_height = Cm(29.7)
section.left_margin = Cm(2.0)
section.right_margin = Cm(2.0)
section.top_margin = Cm(1.9)
section.bottom_margin = Cm(1.8)
section.header_distance = Cm(0.9)
section.footer_distance = Cm(0.9)

USABLE = 17.0  # cm between margins

# heading styles
for name, size, color, before, after in (
    ("Heading 1", 19, BRAND, 0, 10),
    ("Heading 2", 13.5, BRAND_LIGHT, 14, 5),
    ("Heading 3", 11.5, INK, 10, 3),
):
    st = doc.styles[name]
    st.font.name = BODY_FONT
    st.font.size = Pt(size)
    st.font.bold = True
    st.font.color.rgb = color
    st.paragraph_format.space_before = Pt(before)
    st.paragraph_format.space_after = Pt(after)
    st.paragraph_format.keep_with_next = True
    st.font.italic = False


def h1(text, page_break_before=True):
    if page_break_before:
        page_break(doc)
    par = doc.add_heading(text, level=1)
    par.paragraph_format.space_before = Pt(0)
    par_border_bottom(par)
    return par


def h2(text):
    return doc.add_heading(text, level=2)


def h3(text):
    return doc.add_heading(text, level=3)


def p(text="", bold=False, italic=False, color=None, size=None, align=None, space_after=None):
    par = doc.add_paragraph()
    run = par.add_run(text)
    run.bold = bold
    run.italic = italic
    if color is not None:
        run.font.color.rgb = color
    if size is not None:
        run.font.size = Pt(size)
    if align is not None:
        par.alignment = align
    if space_after is not None:
        par.paragraph_format.space_after = Pt(space_after)
    return par


def rich(parts, align=None, space_after=None, indent=0.0, size=None):
    """parts = list of (text, style) where style in {'', 'b', 'i', 'bi', 'code'}"""
    par = doc.add_paragraph()
    for text, style in parts:
        run = par.add_run(text)
        run.bold = "b" in style
        run.italic = "i" in style
        if style == "code":
            run.font.name = "Consolas"
            run.font.size = Pt(9.5)
            run.font.color.rgb = BRAND
        elif size:
            run.font.size = Pt(size)
    if align is not None:
        par.alignment = align
    if space_after is not None:
        par.paragraph_format.space_after = Pt(space_after)
    if indent:
        par.paragraph_format.left_indent = Cm(indent)
    return par


def bullets(items, indent=0.6):
    for item in items:
        par = doc.add_paragraph(style="List Bullet")
        par.paragraph_format.left_indent = Cm(indent)
        par.paragraph_format.space_after = Pt(3)
        if isinstance(item, tuple):
            head, rest = item
            run = par.add_run(head)
            run.bold = True
            par.add_run(rest)
        else:
            par.add_run(item)


def steps(items, start=1):
    """Hinglish numbered steps with a bold number, hanging indent."""
    for i, item in enumerate(items, start=start):
        par = doc.add_paragraph()
        pf = par.paragraph_format
        pf.left_indent = Cm(0.85)
        pf.first_line_indent = Cm(-0.85)
        pf.space_after = Pt(4)
        num = par.add_run(f"{i}.  ")
        num.bold = True
        num.font.color.rgb = BRAND_LIGHT
        if isinstance(item, tuple):
            head, rest = item
            run = par.add_run(head)
            run.bold = True
            par.add_run(rest)
        else:
            par.add_run(item)


def callout(kind, title, text):
    fills = {
        "tip": (FILL_TIP, "8B5CF6"),
        "warn": (FILL_WARN, "F59E0B"),
        "stop": (FILL_STOP, "EF4444"),
        "note": (FILL_NOTE, "3B82F6"),
    }
    fill, border = fills[kind]
    table = doc.add_table(rows=1, cols=1)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    cell = table.cell(0, 0)
    cell_borders(cell, color=border, size="10")
    cell_margins(cell, top=120, bottom=120, left=160, right=160)
    shade(cell, fill)
    par = cell.paragraphs[0]
    par.paragraph_format.space_after = Pt(2)
    run = par.add_run(title)
    run.bold = True
    run.font.size = Pt(10.5)
    run.font.color.rgb = INK
    body = cell.add_paragraph()
    body.paragraph_format.space_after = Pt(0)
    r = body.add_run(text)
    r.font.size = Pt(10)
    r.font.color.rgb = INK
    doc.add_paragraph().paragraph_format.space_after = Pt(2)
    return table


def table(headers, rows, widths, header_fill=FILL_BRAND, font_size=9.5, zebra=True, first_col_bold=False):
    t = doc.add_table(rows=1, cols=len(headers))
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    table_fixed(t, widths)
    hdr = t.rows[0]
    repeat_header(hdr)
    for idx, text in enumerate(headers):
        cell = hdr.cells[idx]
        shade(cell, header_fill)
        cell_borders(cell, color=header_fill)
        cell_margins(cell)
        par = cell.paragraphs[0]
        par.paragraph_format.space_after = Pt(0)
        run = par.add_run(text)
        run.bold = True
        run.font.size = Pt(font_size)
        run.font.color.rgb = WHITE
    for r_idx, row in enumerate(rows):
        cells = t.add_row().cells
        for c_idx, text in enumerate(row):
            cell = cells[c_idx]
            cell_borders(cell)
            cell_margins(cell)
            if zebra and r_idx % 2 == 1:
                shade(cell, FILL_ZEBRA)
            lines = str(text).split("\n")
            for l_idx, line in enumerate(lines):
                par = cell.paragraphs[0] if l_idx == 0 else cell.add_paragraph()
                par.paragraph_format.space_after = Pt(0)
                par.paragraph_format.line_spacing = 1.0
                run = par.add_run(line)
                run.font.size = Pt(font_size)
                if c_idx == 0 and first_col_bold:
                    run.bold = True
    doc.add_paragraph().paragraph_format.space_after = Pt(2)
    return t


SHOT_INDEX = {}
MANIFEST = []
if (SHOT_DIR / "manifest.json").exists():
    MANIFEST = json.loads((SHOT_DIR / "manifest.json").read_text())
    for row in MANIFEST:
        SHOT_INDEX[Path(row["file"]).stem.split("-", 1)[1]] = row["file"]

CHITRA = 0


def chitra(number):
    """Number of the Chitra that a screenshot with this step number gets."""
    return number


def fit_width(path, max_width=16.3, max_height=17.2):
    """Keep a screenshot inside the page: cap by width and by height."""
    from PIL import Image

    with Image.open(path) as im:
        w_px, h_px = im.size
    ratio = h_px / w_px
    width = max_width
    if width * ratio > max_height:
        width = max_height / ratio
    return width


def shot(slug, title, legend=None, caption=None, width=16.4):
    """Screenshot inside a light frame + numbered caption."""
    global CHITRA
    CHITRA += 1
    file = SHOT_INDEX.get(slug)
    if not file:
        raise SystemExit(f"screenshot not found: {slug}. Run the capture spec first.")
    path = SHOT_DIR / file
    width = min(width, fit_width(path))

    frame = doc.add_table(rows=1, cols=1)
    frame.alignment = WD_TABLE_ALIGNMENT.CENTER
    table_fixed(frame, [width + 0.35])
    cell = frame.cell(0, 0)
    cell_borders(cell, color="D8DEE9", size="8")
    cell_margins(cell, top=40, bottom=40, left=40, right=40)
    par = cell.paragraphs[0]
    par.alignment = WD_ALIGN_PARAGRAPH.CENTER
    par.paragraph_format.space_after = Pt(0)
    par.add_run().add_picture(str(path), width=Cm(width))

    cap = doc.add_paragraph()
    cap.alignment = WD_ALIGN_PARAGRAPH.LEFT
    cap.paragraph_format.space_before = Pt(4)
    cap.paragraph_format.space_after = Pt(2)
    cap.paragraph_format.keep_with_next = True
    label = cap.add_run(f"Chitra {CHITRA} — ")
    label.bold = True
    label.font.size = Pt(9.5)
    label.font.color.rgb = BRAND_LIGHT
    title_run = cap.add_run(title)
    title_run.bold = True
    title_run.font.size = Pt(9.5)
    title_run.font.color.rgb = INK

    if legend:
        leg = doc.add_paragraph()
        leg.paragraph_format.space_after = Pt(2)
        leg.paragraph_format.left_indent = Cm(0)
        head = leg.add_run("Screenshot me numbers: ")
        head.font.size = Pt(9)
        head.font.color.rgb = MUTED
        for i, item in enumerate(legend):
            run = leg.add_run(f"{i + 1} = {item}")
            run.font.size = Pt(9)
            run.font.color.rgb = MUTED
            if i < len(legend) - 1:
                sep = leg.add_run("   ·   ")
                sep.font.size = Pt(9)
                sep.font.color.rgb = MUTED

    if caption:
        body = doc.add_paragraph()
        body.paragraph_format.space_after = Pt(10)
        run = body.add_run(caption)
        run.font.size = Pt(9.5)
        run.italic = True
        run.font.color.rgb = MUTED
    else:
        doc.add_paragraph().paragraph_format.space_after = Pt(6)


# ---------------------------------------------------------------------------
# header / footer
# ---------------------------------------------------------------------------

hdr = section.header
hp = hdr.paragraphs[0]
hp.text = ""
hr = hp.add_run("U-Tech ERP  ·  Software chalane ki complete guide (Hinglish)")
hr.font.size = Pt(8.5)
hr.font.color.rgb = MUTED
hp.alignment = WD_ALIGN_PARAGRAPH.RIGHT
par_border_bottom(hp, color="E2E8F0", size="4")

ftr = section.footer
fp = ftr.paragraphs[0]
fp.text = ""
fp.alignment = WD_ALIGN_PARAGRAPH.CENTER
r1 = fp.add_run("Page ")
r1.font.size = Pt(8.5)
r1.font.color.rgb = MUTED
add_field(fp, "PAGE")
r2 = fp.add_run(" / ")
r2.font.size = Pt(8.5)
r2.font.color.rgb = MUTED
add_field(fp, "NUMPAGES")
r3 = fp.add_run("   ·   U-Tech Automation Industries, Chikhali, Pune 411062")
r3.font.size = Pt(8.5)
r3.font.color.rgb = MUTED
for run in fp.runs:
    run.font.size = Pt(8.5)
    run.font.color.rgb = MUTED

# ---------------------------------------------------------------------------
# cover
# ---------------------------------------------------------------------------

cover = doc.add_table(rows=1, cols=1)
cover.alignment = WD_TABLE_ALIGNMENT.CENTER
table_fixed(cover, [USABLE])
ccell = cover.cell(0, 0)
shade(ccell, FILL_BRAND)
cell_margins(ccell, top=520, bottom=520, left=420, right=420)
cp = ccell.paragraphs[0]
cp.paragraph_format.space_after = Pt(4)
r = cp.add_run("U-TECH  ERP")
r.bold = True
r.font.size = Pt(15)
r.font.color.rgb = RGBColor(0xC4, 0xB5, 0xFD)
r2 = ccell.add_paragraph()
r2.paragraph_format.space_after = Pt(2)
r3 = r2.add_run("Manufacturing Workspace")
r3.font.size = Pt(10)
r3.font.color.rgb = RGBColor(0xDD, 0xD6, 0xFE)

title = ccell.add_paragraph()
title.paragraph_format.space_before = Pt(26)
title.paragraph_format.space_after = Pt(6)
t1 = title.add_run("Software kaise chalayein?")
t1.bold = True
t1.font.size = Pt(30)
t1.font.color.rgb = WHITE

sub = ccell.add_paragraph()
sub.paragraph_format.space_after = Pt(22)
s1 = sub.add_run("Bilkul shuru se, screenshot ke saath — poora Hinglish guide")
s1.font.size = Pt(13)
s1.font.color.rgb = RGBColor(0xED, 0xE9, 0xFE)

meta = ccell.add_paragraph()
meta.paragraph_format.space_after = Pt(0)
m = meta.add_run("Customer se maal lena → stock → production → dispatch → bill → payment\n"
                 "Office ka pehla din, store ka pehla din, accounts ka pehla din")
m.font.size = Pt(10)
m.font.color.rgb = RGBColor(0xDD, 0xD6, 0xFE)

doc.add_paragraph()

info = table(
    ["Detail", "Jaankari"],
    [
        ["Yeh guide kis ke liye hai", "Jo pehli baar yeh software use kar rahe hain — koi ERP ka knowledge zaroori nahi."],
        ["Kitna time lagega", "Poora padhne me 1–2 ghante. Sirf apna kaam ka chapter padhein to 10–15 minute."],
        ["Version / date", "28 October 2026"],
        ["Company", "U-Tech Automation Industries, Chikhali, Pune 411062 (GST state code 27 — Maharashtra)"],
        ["Screenshots", "Asli software se liye gaye 50 screenshots, demo (practice) data ke saath"],
        ["Important", "Guide ka demo data sirf practice ke liye hai. Asli company ke data par pehle practice na karein."],
    ],
    [5.4, 11.6],
    font_size=9.5,
    first_col_bold=True,
)

callout(
    "warn",
    "Sabse pehle yeh 3 baatein yaad rakhein",
    "1) Invoice (bill) banane se stock NAHI ghatta — maal bhejne ke liye Dispatch/Challan banana padta hai.   "
    "2) Customer ka diya hua maal company ke stock se alag hota hai (Customer Inventory).   "
    "3) Stock sirf GRN (maal aaya), Dispatch (maal gaya), Production complete aur Stock Adjustment se badalta hai.",
)

# ---------------------------------------------------------------------------
# contents
# ---------------------------------------------------------------------------

page_break(doc)
toc_head = doc.add_paragraph()
toc_head.paragraph_format.space_after = Pt(10)
tt = toc_head.add_run("Is guide me kya-kya hai")
tt.bold = True
tt.font.size = Pt(20)
tt.font.color.rgb = BRAND
par_border_bottom(toc_head)

contents = [
    ("0", "Shuru karne se pehle — software kya karta hai", "ERP ka matlab, kaun kya karega, 5 golden rules"),
    ("1", "Login karna aur screen samajhna", "Email/password, dashboard, left menu, search"),
    ("2", "Master data banana — customer, vendor, item", "Pehla kaam: party aur item ki entry"),
    ("3", "Stock dekhna aur correction karna", "Ledger padhna, manual adjustment, kaunsa kaam stock badalta hai"),
    ("4", "Maal kharidna — Purchase Order se GRN tak", "PO banana, approve karna, maal receive karna"),
    ("5", "Maal bhejna — Dispatch / Delivery Challan", "Challan banana, stock kam hona, cancel karna"),
    ("6", "Bill banana aur payment lena", "Invoice, GST, PDF, payment record"),
    ("7", "Production — BOM aur batch", "Recipe banana, batch start/complete"),
    ("8", "Customer ka maal aur jobwork", "Customer material, vendor ko bhejna, wapas lena"),
    ("9", "Return ka case — sales return aur purchase return", "Maal wapas aane par kya karein"),
    ("10", "Reports aur Analytics", "Business reports, Excel/PDF download, graphs"),
    ("11", "Users, Roles aur permissions", "Naya user, role, permission ka chakkar"),
    ("12", "Metal Calculator", "Weight aur price nikaalna"),
    ("13", "Search shortcut aur mobile", "Ctrl+K, phone par use, app install"),
    ("14", "Roz ka routine — kis role ko kya karna hai", "Store, accounts, production, admin ke checklists"),
    ("15", "Poora practice example (numbers ke saath)", "Ek item par A se Z tak — 50 → 55 → 52 → 60 → 56"),
    ("16", "Galtiyan aur unka hal (FAQ)", "20 common problem aur seedha solution"),
    ("17", "Safety rules — kya kabhi na karein", "Data, password, backup, GST"),
    ("18", "Agar phir bhi samajh na aaye", "Kis se kya poochhein"),
]
t = doc.add_table(rows=0, cols=3)
t.alignment = WD_TABLE_ALIGNMENT.CENTER
table_fixed(t, [1.3, 9.0, 6.7])
for num, title_txt, sub_txt in contents:
    cells = t.add_row().cells
    for idx in range(3):
        cell_borders(cells[idx], color="E2E8F0", size="4", sides=("bottom",))
        cell_margins(cells[idx], top=70, bottom=70)
    pn = cells[0].paragraphs[0]
    pn.paragraph_format.space_after = Pt(0)
    rn = pn.add_run(num)
    rn.bold = True
    rn.font.size = Pt(11)
    rn.font.color.rgb = BRAND_LIGHT

    pt = cells[1].paragraphs[0]
    pt.paragraph_format.space_after = Pt(0)
    rt = pt.add_run(title_txt)
    rt.bold = True
    rt.font.size = Pt(10)

    ps = cells[2].paragraphs[0]
    ps.paragraph_format.space_after = Pt(0)
    rs = ps.add_run(sub_txt)
    rs.font.size = Pt(9)
    rs.font.color.rgb = MUTED

doc.add_paragraph()
callout(
    "tip",
    "Guide ko kaise padhein",
    "Har chapter me: (a) 'Is chapter me' — kya seekhenge, (b) step-by-step numbered steps, "
    "(c) screenshot jisme orange box aur number batate hain ki kaunsa field/button dabana hai, "
    "(d) 'Yaad rakhein' box. Screen par button ke naam English me likhe hain (jaise Save, Cancel) — "
    "guide me wahi naam use kiye gaye hain, taaki aapko screen par pehchanne me dikkat na ho.",
)

# ===========================================================================
# CHAPTER 0
# ===========================================================================

h1("0.  Shuru karne se pehle — software kya karta hai")

h2("Is chapter me")
bullets([
    "ERP ka matlab kya hai aur yeh software aapki company me kya karta hai",
    "Kaun sa kaam kis department ka hai (kaun kya karega)",
    "5 golden rules — inhe galat kiya to stock aur hisaab bigad jayega",
])

h2("ERP kya hota hai? (ek minute me)")
p("Socho ki aapki company me 4 register chalte hain: (1) kaun sa maal godown me hai, "
  "(2) kis customer ko kitna maal gaya aur kitna paisa aana hai, (3) kis vendor se kitna maal aaya aur kitna dena hai, "
  "(4) production me kya bana. ERP yani yeh chaaron register ek hi software me, ek dusre se jude hue. "
  "Isi wajah se jab aap maal receive karte hain to stock apne aap badh jata hai, aur jab maal bhejte hain to apne aap kam ho jata hai.")
p("U-Tech ERP me yeh hisse hain: ")
bullets([
    ("Masters — ", "customer, vendor, item, machine, jobcard jaise base records."),
    ("Company Inventory — ", "company ka apna maal: items, BOM, production, purchase order, GRN, purchase return."),
    ("Customer Inventory — ", "customer ka diya hua maal aur vendor ko jobwork ke liye bheja gaya maal."),
    ("Stock Management — ", "stock ka summary aur ledger (history), aur correction ka form."),
    ("Sales — ", "invoice (bill), dispatch (maal bhejna), sales return."),
    ("Task Management — ", "department wise process, task aur progress."),
    ("Analytics — ", "reports, sales/production/inventory ke graph."),
    ("Admin — ", "users (logins), roles (permission), departments, projects, expenses."),
])

h2("Kaun kya karega — duty ka batwara")
p("Ek hi login se sab kuch ho sakta hai, lekin asli company me kaam baantna behtar hota hai. "
  "Yeh salah hai — apni company ke hisaab se badal lein:")
table(
    ["Kaam", "Kaun karega", "Is software me kaun sa screen"],
    [
        ["Naya customer/vendor/item banana, rate-GST set karna", "Admin / office", "Masters, Company Inventory → Items"],
        ["Maal aaya — GRN banana", "Store", "Company Inventory → GRN (Stock In)"],
        ["Maal bheja — challan banana", "Store / dispatch", "Sales → Dispatch"],
        ["Bill banana aur payment lena", "Accounts", "Sales → Invoices"],
        ["Vendor ko PO bhejna", "Purchase / office", "Company Inventory → Purchase Orders"],
        ["Production banana, material consumption dena", "Production supervisor", "Company Inventory → Production Batches"],
        ["Customer ka maal inward karna, jobwork bhejna", "Store", "Customer Inventory"],
        ["Physical ginti ka farak theek karna", "Store (permission ke saath)", "Stock Management → Manual Adjustment"],
        ["User banana, permission dena", "Admin", "Admin → Users, Admin → Roles"],
    ],
    [6.4, 4.0, 6.6],
    first_col_bold=True,
)

h2("5 golden rules — inhe yaad kar lein")
steps([
    ("Bill banane se stock nahi ghatta. ", "Invoice GST/billing ka document hai. Maal physically bheja to alag se Dispatch (Delivery Challan) banana padega — wahi stock ghatata hai."),
    ("Maal aane par GRN banayein. ", "Vendor ka bill aaya ho ya na aaya ho, jab maal godown me aaya to GRN banega — sirf tab stock badhega."),
    ("Stock ko adjustment se nahi, asli document se badlein. ", "GRN/dispatch/production ka document banayein. Manual Adjustment sirf ginti ka farak theek karne ke liye hai — usme reason likhna zaroori hai."),
    ("Customer ka maal alag hai. ", "Customer apna raw material de to woh Customer Inventory me jayega, company ke item stock me nahi milayenge."),
    ("Galti ho jaye to document cancel karein, delete nahi. ", "GRN/dispatch cancel karne par stock apne aap wapas theek ho jata hai, aur history me record rehta hai ki kya hua."),
])
callout(
    "note",
    "Naya user ho to pehle practice karein",
    "Company ke asli data par seedha kaam shuru na karein. Admin se 'practice' ke liye demo login maangein "
    "(ya testing server) aur chapter 15 ka poora example do baar chalayein. Jab haath baith jaye, tab asli data par jayein.",
)

# ===========================================================================
# CHAPTER 1
# ===========================================================================

h1("1.  Login karna aur screen samajhna")

h2("Is chapter me")
bullets([
    "App kholna aur login karna",
    "Dashboard (ghar ka panna) par kya-kya dikhta hai",
    "Left menu ka structure, search aur account menu",
])

h2("Step 1 — app kholein")
p("Browser (Chrome) me company ka address kholein jo admin ne diya hai. Login screen aayegi. "
  "Mobile par bhi wahi address chalega, ya home screen par app install kar sakte hain (chapter 13).")

shot("login-screen", "Login screen",
     ["Email", "Password", "Sign in button"],
     "Email aur password bharein. Password typing ke waqt dots dikhte hain — sahi hai, yeh chhupane ke liye hota hai. "
     "Eye icon dabakar password dekh sakte hain. Teeno field theek bhare bina button nahi chalega.")

h2("Step 2 — login karein")
steps([
    "Email field me apna email daalein (jaise admin@utech.local — yeh demo login hai).",
    "Password daalein. Pehli baar login kar rahe hain to admin se temporary password lijiye.",
    "Sign in dabayein. Sahi hone par dashboard khul jayega.",
])
callout(
    "tip",
    "Password bhool gaye?",
    "Software me password khud reset karne ka option nahi hai — admin se kahein ki woh Admin → Users me aapka password reset kare. "
    "Pehli baar login karne ke baad apna password badal lein: upar right corner me apne naam par click → Change Password.",
)

shot("dashboard", "Dashboard — login ke baad pehla screen",
     ["Left ka dark menu (poore software ka rasta)", "Dashboard ka data area"],
     "Upar ke 6 box batate hain: pichhle 30 din ki sales, active jobcards, pending jobwork, overdue invoices, total parties aur total items. "
     "Neeche Quick Actions (New Invoice, New Quotation, Add Customer, Add Vendor) aur 3 graph (sales, production efficiency, inventory distribution) hain.")

h2("Step 3 — left menu (sidebar) samjhein")
p("Left ka dark menu 8 section me bata hua hai. Section ke naam par click karne se uske pages khulte hain, page par click karne se woh screen khulti hai. "
  "Section ka arrow upar/neeche hota hai — woh batata hai ki section khula hai ya band.")
shot("sidebar-sections", "Left menu ke 8 section",
     ["Menu section (Company Inventory khula hua)"],
     "Sections: Dashboard, Masters, Task Management, Sales, Company Inventory, Customer Inventory, Stock Management, Analytics, Admin. "
     "Kisi item ka naam yaad na ho to upar ke search box (Ctrl + K) se seedha page khol sakte hain.")
table(
    ["Section", "Andar kya hai", "Kab use karein"],
    [
        ["Dashboard → Overview", "Aaj ka summary, quick actions, graph", "Din ki shuruaat me"],
        ["Masters", "Customer Quotations, Vendor Quotations, Customers, Vendors, Jobcards, Assignments, Machines, Metal Calculator", "Naya party/item ya rate ka kaam"],
        ["Task Management", "My Tasks, Task Progress, Process Master", "Department ke task aur progress"],
        ["Sales", "Invoices, Returns, Dispatch", "Bill, maal bhejna, return"],
        ["Company Inventory", "Items, BOMs, Production Batches, Shifts, Purchase Orders, GRN (Stock In), Purchase Returns, Back Orders", "Company ka apna stock aur purchase"],
        ["Customer Inventory", "Customer Material, Vendor Dispatch (Jobwork), Vendor Work Orders", "Customer ka maal"],
        ["Stock Management", "Stock Overview & Ledger", "Stock check aur correction"],
        ["Analytics", "Reports, Sales/Production/Inventory Analytics", "Mahine ke report"],
        ["Admin", "Users, Roles, Departments, Department Roles, Projects, Expenses", "Login aur permission ka kaam"],
    ],
    [4.2, 8.4, 4.4],
    first_col_bold=True,
    font_size=9,
)

h2("Upar ka header — 4 kaam ki cheezein")
bullets([
    ("Search box (Ctrl + K) — ", "kisi bhi page ya action ka naam likhkar seedha wahan jayein (chapter 13)."),
    ("Bell icon — ", "notification (jaise low stock ya due invoice ki khabar)."),
    ("Apna naam / avatar — ", "yahan click karne par Change Password aur Sign Out milta hai."),
    ("Collapse button — ", "menu ko chhota (icons only) kar deta hai; bade screen par kaam ki jagah badh jati hai."),
])
callout(
    "warn",
    "Kaam khatam hone par Sign Out karein",
    "Shared computer par apna login khula na chhodein. Sign Out: apne naam par click → Sign Out. "
    "Sirf browser band karna kaafi nahi hota.")
page_break(doc)

# ===========================================================================
# CHAPTER 2
# ===========================================================================

h1("2.  Master data banana — customer, vendor, item")

h2("Is chapter me")
bullets([
    "Naya customer (jise maal bechna hai) banana",
    "Naya vendor (jisse maal lena hai / jobwork karwana hai) banana",
    "Naya item banana — rate, GST aur opening stock ke saath",
])

callout(
    "note",
    "Master data pehle, gawahi baad me",
    "Koi bhi document (PO, GRN, dispatch, invoice) banane se pehle party aur item ban chuke hone chahiye. "
    "Party = customer ya vendor. Ek party dono ho sakti hai, lekin shuru me alag-alag banayein — hisaab saaf rehta hai.",
)

h2("2.1  Naya customer banana")
steps([
    "Left menu me Masters → Customers kholein.",
    "Upar right me New customer dabayein.",
    "Party Name likhein (GST record ke hisaab se poora naam, jaise 'Shree Ganesh Engineering Pvt Ltd').",
    "Phone, email, address bharein. GST wala customer ho to GSTIN daalein — state code aur PAN apne aap bhar jate hain.",
    "Type me CUSTOMER chuna hua hona chahiye (Masters → Customers se aaye to by default wahi aata hai).",
    "Save dabayein. Customer list me aa jayega.",
])
shot("customers-list", "Masters → Customers — customer list",
     ["New customer button"],
     "List me har customer ka code, naam, phone, GST aur balance dikhta hai. Search box se naam/phone/code type karke dhoondh sakte hain. "
     "Row par click karne se customer ki detail aur uska ledger (kitna dena hai) khulta hai.")
shot("customer-form", "Naya customer — form",
     ["Party Name (zaroori)", "Type", "GSTIN (GST wale customer ke liye)", "City"],
     "Sirf Party Name zaroori hai. Baaki detail jab mile tab bhar sakte hain — baad me edit ho sakti hai. "
     "Save ke baad screen customer list par wapas aa jati hai.")
shot("customer-saved", "Save ke baad — list me naya customer",
     ["Naya customer list me sabse upar"],
     "Yahan tasdeeq kar lein ki naam sahi bana hai. Galat spelling ho to row par click karke Edit se theek karein.")

h2("2.2  Naya vendor banana")
steps([
    "Masters → Vendors kholein → New vendor dabayein.",
    "Type me VENDOR select karein (Masters → Vendors se aane par default Vendor hi hota hai).",
    "Naam, phone, address bharein. Maal vendor se aata hai to GSTIN zaroor daalein — purchase me kaam aayega.",
    "Bank detail ho to IFSC daalein, bank ka naam aur branch apne aap aa jate hain.",
    "Save dabayein.",
])
shot("vendor-form", "Naya vendor — form",
     ["Type = Vendor", "Party Name", "Phone"],
     "Vendor ka naam aisa likhein jise aap pehchan sakein — jaise 'Bharat Steel Traders, Chikhali'. "
     "Jobwork karwane wale vendor bhi yahin bante hain; farak sirf document me padta hai.")

h2("2.3  Naya item banana")
steps([
    "Left menu me Company Inventory → Items kholein.",
    "New item dabayein.",
    "Item Name likhein — jaise 'MS Round Bar 25mm'. Saath me size likh dein (OD 25 x 6 mtr) taaki dhoondhna aasan ho.",
    "UoM (unit) choose karein — PCS, KG, MTR, etc.",
    "Purchase Rate aur Sale Rate bharein (₹ per unit).",
    "GST % bharein — jaise 18. Galat GST sabse aam galti hai, isliye dhyan se.",
    "Opening Stock me aaj godown me physically jitna maal hai woh daalein (jaise 50).",
    "Min Stock me woh level daalein jiske neeche aane par low-stock alert chahiye (jaise 10).",
    "Save dabayein.",
])
shot("items-list", "Company Inventory → Items — item list",
     ["New item button", "Item table (stock aur min stock ke saath)"],
     "Yahan 73 company inventory items pehle se bhare hue hain (RB-, PP-, PL-, FL- codes ke saath) — inke naam/rate badalne ki zaroorat nahi, "
     "sirf naya maal aaye tab naya item banayein. 'Low stock' button dabakar sirf khatam hone wale item dekh sakte hain.")
shot("item-form", "Naya item — form",
     ["Item Name", "UoM (unit)", "GST %", "Opening Stock", "Min Stock"],
     "Pricing & Stock section me rate aur GST hai. Purchase rate vendor se kharidne ka rate, sale rate customer ko bechne ka rate hai. "
     "Metal aur Material Size bharein to software item ka weight bhi nikaal deta hai (Metal Calculator wale formula se).")
shot("item-detail", "Item ki detail — stock kitna hai",
     None,
     "Row par click karne se detail khulti hai: Current Stock 50 (jo opening stock tha), min stock, rate aur neeche stock ledger me OPENING ki entry. "
     "Rate/GST yahan se badal sakte hain. " + "Opening stock save hone ke baad lock ho jata hai — usi liye pehli baar dhyan se bharein.")
callout(
    "stop",
    "Item banate waqt 3 galtiyan jo sabse zyada hoti hain",
    "(1) UoM galat — KG ki jagah PCS chun liya, phir quantity ka matlab hi badal jayega. "
    "(2) GST 18 ki jagah 0 — bill me tax kam lagega. "
    "(3) Opening stock dobara daalna — item ka opening lock hai, isliye jab naya maal aaye to GRN banayein, item dobara na banayein.",
)

# ===========================================================================
# CHAPTER 3
# ===========================================================================

h1("3.  Stock dekhna aur correction karna")

h2("Is chapter me")
bullets([
    "Stock Overview aur Stock Ledger padhna",
    "Physical ginti me farak mile to Manual Adjustment karna",
    "Kaun sa kaam stock badalta hai aur kaun sa nahi — poori list",
])

h2("3.1  Stock Overview kholna")
p("Left menu me Stock Management → Stock Overview & Ledger kholein. "
  "Upar 8 box summary dete hain, neeche do hisse hain: Stock Ledger (history) aur Manual Adjustment (correction ka form).")
shot("stock-overview", "Stock Management → Stock Overview & Ledger",
     None,
     "Summary boxes: company items, customer lots, at vendor (jobwork), in process (batch/lot), low stock, finished item types, aaj ke inward/outward documents. "
     "Company inventory line me kul stock ki value bhi dikhti hai (purchase rate par).")

h3("Stock Ledger ki har column ka matlab")
table(
    ["Column", "Matlab"],
    [
        ["POSTED", "Entry kab system me lagi (date + time). Yeh posting order dikhata hai."],
        ["OWNER", "Company = apna maal, Customer = customer ka maal (alag ledger)."],
        ["ITEM / LOT", "Kis item ya lot ka movement hai."],
        ["TYPE", "Movement ka karan: OPENING, GRN, DISPATCH, ADJUSTMENT, PRODUCTION, JOBWORK, RETURN, etc."],
        ["IN", "Stock me aaya kitna."],
        ["OUT", "Stock se gaya kitna."],
        ["BALANCE", "Us entry ke baad kitna bacha. Yahi number aapke godown ke hisaab se milna chahiye."],
    ],
    [3.2, 13.8],
    first_col_bold=True,
)
callout(
    "tip",
    "Ledger padhne ka simple tareeka",
    "Upar se neeche padhein aur sirf BALANCE column dekhein. Naya balance = purana balance + IN − OUT. "
    "Agar do entry ke beech balance ka hisaab match na ho, to usi jagah par kuch galat hua hai — admin ko dikhayein. "
    "Ledger latest 500 movement dikhata hai; purana record chahiye to Owner/Item/Date filter lagayein.",
)

h2("3.2  Manual Adjustment — ginti ka farak theek karna")
p("Maan lijiye godown me physically 55 piece hain, par software 50 dikha raha hai. Farak 5 ka hai. "
  "Yeh entry adjustment se hoti hai — aur reason likhna zaroori hai, kyunki woh audit log me jata hai.")
steps([
    "Stock Management → Stock Overview & Ledger kholein.",
    "Right side ke Manual Adjustment box me Item choose karein (naam ya code type karke).",
    "Quantity me signed number daalein: zyada hai to +5, kam hai to −3. Zero nahi chalega.",
    "Reason likhein — jaise 'Physical count me 5 zyada mile, 28 Oct ginti'.",
    "Apply Adjustment dabayein.",
    "Confirm dialog me item aur quantity check karke Apply adjustment dabayein.",
    "Neeche ledger me ADJUSTMENT ki nayi row dekh lein — IN 5 aur balance 55.",
])
shot("stock-adjustment-form", "Manual Adjustment form bharna",
     ["Item (naam/code se search)", "Quantity (+ zyada / − kam)", "Reason (audit log me jata hai)"],
     "Yeh form sirf correction ke liye hai. Do item ke beech farak theek karne ke liye do alag adjustment lagayenge (ek minus, ek plus).")
shot("stock-adjustment-confirm", "Confirm dialog",
     ["Confirmation box"],
     "System ek baar phir poochhta hai, taaki galti se quantity na lag jaye. Yahan item ka naam aur quantity dhyan se padhein; "
     "galat lage to Cancel dabayein aur form dobara bharein.")
shot("stock-ledger-after-adjustment", "Adjustment ke baad ledger",
     ["Ledger table — sabse upar nayi ADJUSTMENT row"],
     "IN = 5, BALANCE = 55 (50 + 5). Har entry ka balance uske saamne hota hai, isliye check karna aasan hai. "
     "Agar stock 0 se neeche jayega to normal OUT entry reject ho jati hai — matlab system galat entry hone nahi deta.")

h2("3.3  Kaun sa kaam stock badalta hai — poori list")
table(
    ["Aap kaun sa kaam kar rahe hain", "Company stock par asar"],
    [
        ["Item me opening stock daalna", "Badhta hai (OPENING entry banti hai)"],
        ["Manual adjustment (+5 / −3)", "Utna badhta / ghatta hai"],
        ["Purchase Order banana ya approve karna", "Koi asar nahi"],
        ["GRN save karna", "Sirf ACCEPTED quantity badhti hai (rejected nahi)"],
        ["GRN cancel karna", "Accepted quantity wapas ghatti hai; agar woh maal use ho gaya to cancel refuse ho jata hai"],
        ["Production batch complete karna", "Actual consumption ghatta hai, produced quantity badhti hai"],
        ["Production batch sirf plan karna / start karna", "Koi asar nahi"],
        ["Delivery challan (dispatch) banana", "Challan ki quantity ghatti hai"],
        ["Challan cancel karna", "Quantity wapas badhti hai"],
        ["Invoice banana ya payment lena", "Koi asar nahi — sirf billing"],
        ["Company material jobwork bhejna", "Bheji quantity ghatti hai; wapas receive hone par badhti hai"],
        ["Customer material inward / consume / dispatch / return", "Company stock par koi asar nahi — customer lot ledger badalta hai"],
        ["Sales return process karna", "Sirf tab badhta hai jab Physical Receipt record ho chuka ho"],
        ["Purchase return process karna", "Stock ghat sakta hai (document process hone par)"],
    ],
    [9.4, 7.6],
    first_col_bold=True,
    font_size=9,
)

# ===========================================================================
# CHAPTER 4
# ===========================================================================

h1("4.  Maal kharidna — Purchase Order se GRN tak")

h2("Is chapter me")
bullets([
    "Vendor ko Purchase Order (PO) bhejna aur approve karana",
    "Maal aane par GRN banana — rejected quantity ka hisaab",
    "Galat GRN cancel karna",
])

h2("4.1  Purchase Order (PO) banana")
p("PO yani vendor ko likhit order: 'itna maal, itne rate par, itni date tak chahiye'. PO banane se stock nahi badhta — stock GRN se badhta hai.")
steps([
    "Company Inventory → Purchase Orders kholein → New PO dabayein.",
    "Date check karein (aaj ki date by default aati hai) aur chahein to Expected Delivery daalein.",
    "Vendor choose karein — naam type karke list se select karein.",
    "Item line me item choose karein; rate aur GST apne aap aa jate hain. Qty daalein.",
    "Zaroorat ho to Add line se doosra item jodein, ya free-text line (bina item) likhein — jaise 'Custom tooling work'.",
    "Neeche subtotal, GST aur total check karein.",
    "Save dabayein. PO PENDING_APPROVAL status me chali jayegi.",
])
shot("po-list", "Company Inventory → Purchase Orders",
     ["New PO button"],
     "List me PO number, date, vendor, total aur status dikhta hai. Filter se status ke hisaab se PO dekh sakte hain.")
shot("po-form", "Naya Purchase Order bharna",
     ["Vendor", "Item", "Quantity", "Subtotal / GST / Amount"],
     "Item choose karte hi rate aur GST bhar jate hain — phir bhi ek baar check karein, kyunki galat rate aage GRN aur bill me chala jayega. "
     "Yahan 20 pcs × ₹72 + 18% GST = ₹1,699.20.")
shot("po-detail-pending", "PO detail — approve karna baaki hai",
     ["Status PENDING_APPROVAL", "Approve button"],
     "Save hone par PO khud approve nahi hoti. Jis user ke paas approve karne ki permission hai wahi Approve/Reject kar sakta hai (maker-checker rule). "
     "Agar aapke paas permission nahi hai to admin se approve karwayein.")
shot("po-approve-dialog", "Approve ki confirmation",
     ["Confirmation box"],
     "Approve dabane par confirm poochha jata hai. Approval ke baad hi PO ke aage GRN banane ka rasta khulta hai.")
shot("po-approved", "PO approve ho gayi",
     ["Status APPROVED"],
     "Ab status APPROVED hai. Vendor ko PO ki copy/PDF bhej dein. Maal aane par isi PO se GRN banayein — to PO ki quantity khud track hogi.")

h3("PO ke status ka matlab")
table(
    ["Status", "Matlab"],
    [
        ["PENDING_APPROVAL", "Ban gayi hai, approval baaki hai."],
        ["APPROVED", "Approved — vendor ko bhej sakte hain, GRN ban sakta hai."],
        ["REJECTED", "Reject ho gayi — naya PO banayein."],
        ["PARTIALLY_RECEIVED / RECEIVED", "Maal aane ke baad GRN se khud update hota hai."],
    ],
    [5.0, 12.0],
    first_col_bold=True,
)

h2("4.2  GRN — maal aaya (Stock In)")
p("GRN (Goods Receipt Note) yani 'maal mil gaya' ka record. Yahi document stock badhata hai.")
steps([
    "Company Inventory → GRN (Stock In) kholein → New GRN dabayein.",
    "PO se aaya maal hai to Purchase Order choose karein — vendor aur lines apne aap bhar jati hain, remaining quantity bhi dikhti hai.",
    "Vendor verify karein (PO choose karne par woh badal nahi sakta) aur vehicle number likhein.",
    "Item line me Qty (jo physically mila) daalein.",
    "Rejected me kharab/short maal ki quantity daalein — Accepted apne aap banega: Accepted = Qty − Rejected.",
    "Lines ek baar check karein, phir Save dabayein.",
    "Item detail ya stock ledger me GRN ki entry aur naya balance check karein.",
])
shot("grn-form", "New GRN — maal receive karna",
     ["Vendor", "Item", "Qty (jo mila)", "Accepted (apne aap banta hai)", "Rejected"],
     "Yahan 10 aaye, 2 reject hue, to Accepted 8 hai — sirf 8 hi stock me judega. PO se aane par PO quantity se zyada accept nahi kar sakte, "
     "aur partial receipt ke baad remaining quantity PO me dikhti rehti hai.")
shot("grn-saved", "GRN save — list me dikh raha hai",
     ["Naya GRN row (status ACCEPTED)"],
     "GRN number note kar lein. Yeh number vendor bill, transport aur audit ke liye kaam aata hai.")
shot("grn-detail", "GRN detail",
     None,
     "Detail me accepted quantity, vendor, date aur status dikhta hai. Yahan se PDF ban sakta hai aur Cancel GRN bhi hota hai. "
     "Cancel karne par accepted quantity wapas kam ho jayegi, par agar woh maal already dispatch/production me use ho gaya hai to system cancel refuse karega "
     "aur batayega kaun sa item short hai.")

callout(
    "warn",
    "GRN cancel karne se pehle soch lein",
    "Agar maal aage use ho chuka hai (dispatch/production), to GRN cancel nahi hoga. Aise case me pehle un documents ko theek karein, "
    "ya admin/accounts se stock adjustment karwayein. Cancel karna hamesha reason ke saath karein — history me record rehta hai.",
)
callout(
    "tip",
    "GRN aur vendor bill alag cheez hain",
    "GRN maal aane ka record hai (stock ke liye), vendor bill/expense payment ka record hai (accounts ke liye). "
    "Kabhi GRN ko bill ki tarah use na karein, aur bill na aane par bhi GRN banayein — warna stock galat rahega.",
)

# ===========================================================================
# CHAPTER 5
# ===========================================================================

h1("5.  Maal bhejna — Dispatch / Delivery Challan")

h2("Is chapter me")
bullets([
    "Customer ko maal bhejne ka challan banana",
    "Challan banane par stock kam hona",
    "Galat challan cancel karna",
])

p("Delivery Challan yani 'maal is gaadi se, is customer ko, itna bhej diya'. Yahi document stock ghatata hai. "
  "Bill (invoice) isse alag cheez hai — woh paisa/GST ka document hai.")
steps([
    "Sales → Dispatch kholein → New dispatch dabayein.",
    "Date check karein aur Customer choose karein (sirf customer party dikhegi, vendor nahi).",
    "Item choose karein aur jo quantity bhej rahe hain woh daalein.",
    "Vehicle No, Driver Name/Phone aur E-way Bill No bharein (optional hain, par transport ke liye kaam ke hain).",
    "Stock available hai ya nahi — check karein. Available se zyada quantity save nahi hogi.",
    "Save dabayein. Stock turant kam ho jayega.",
])
shot("dispatch-list", "Sales → Dispatch",
     ["New dispatch button"],
     "Har challan ka number, customer, date, status aur total dikhta hai. Status se pata chalta hai maal raste me hai ya pahunch gaya.")
shot("dispatch-form", "Naya Delivery Challan",
     ["Customer", "Item", "Quantity", "Vehicle No"],
     "Yahan 4 pcs bhej rahe hain — Save karte hi stock me 4 kam ho jayenge. Challan me galat item/quantity daalna sabse aam galti hai, "
     "isliye Save se pehle ek baar line check karein.")
shot("dispatch-saved", "Challan ban gaya — stock kam",
     ["Naya challan row"],
     "Challan ka number customer ko / transporter ko de dein. Galti ho to isi row ke Cancel dispatch se cancel karein — stock wapas jud jayega. "
     "Dhyan: Delivered challan ko is button se cancel nahi kar sakte — us case me sales return ka process use hota hai.")
callout(
    "stop",
    "Invoice ≠ dispatch, yeh galti sabse mehngi hoti hai",
    "Bill bana diya aur socha ki stock kam ho gaya — aisa nahi hota. Jis din maal godown se nikle, usi din dispatch banana chahiye. "
    "Bill uske baad ya pehle ban sakta hai, par stock ka hisaab dispatch/production se banta hai.",
)

# ===========================================================================
# CHAPTER 6
# ===========================================================================

h1("6.  Bill banana aur payment lena")

h2("Is chapter me")
bullets([
    "Naya invoice banana — GST ke saath",
    "CGST/SGST aur IGST kab lagta hai",
    "Payment record karna aur PAID status",
    "PDF nikalna",
])

h2("6.1  Naya invoice banana")
steps([
    "Sales → Invoices kholein → New Invoice dabayein.",
    "Date check karein; Due Date daalein (customer ko kitni date tak paisa dena hai).",
    "Party (customer) choose karein.",
    "GST Type check karein — same state (Intra-state: CGST + SGST) ya doosre state (Inter-state: IGST). GSTIN bhara hai to software khud sahi chunta hai.",
    "Line me item choose karein — description, rate aur GST% apne aap bharte hain. Manual line chahiye to item khali chhod kar description likh dein.",
    "Qty daalein. Discount dena hai to upar Discount field me rupaye likhein (GST net amount par lagta hai).",
    "Notes/Terms me woh baatein likhein jo bill par chhapi chahiye (delivery, warranty, payment terms).",
    "Neeche Summary check karein: subtotal, CGST/SGST ya IGST, round off, total.",
    "Save dabayein. Invoice save hote hi stock par koi asar nahi hota.",
])
shot("invoices-list", "Sales → Invoices",
     ["New Invoice button"],
     "List me invoice number, party, date, total, paid aur balance dikhta hai. Status se pata chalta hai bill bhara hai ya baaki hai.")
shot("invoice-form", "Naya Invoice bharna",
     ["Party", "Line row (item, description, qty, rate, GST%)", "GST Type"],
     "Header me hi likha hai: 'Billing does not move stock' — yani bill se stock nahi ghatta. "
     "Yahan 4 pcs × ₹95 = ₹380 par 18% GST lagakar total ₹448 banta hai.")
shot("invoice-view", "Banaya hua invoice",
     None,
     "Detail me bill-to address, line items, subtotal, CGST/SGST, round off aur total dikhta hai. Upar PDF, Edit aur Record payment ke button hain. "
     "Round off software khud lagata hai (₹448.40 → ₹448).")

h3("GST ka simple hisaab")
table(
    ["Supply kis state me", "Kya lagta hai", "Example (₹380 par 18%)"],
    [
        ["Maharashtra → Maharashtra (same state)", "CGST 9% + SGST 9%", "CGST ₹34.20 + SGST ₹34.20 = ₹68.40"],
        ["Maharashtra → doosra state", "IGST 18%", "IGST ₹68.40"],
        ["GST/GSTIN nahi hai (jaisa case ho)", "Tax advisor se confirm karein", "0% ya applied rate — setting par nirbhar"],
    ],
    [5.0, 5.4, 6.6],
    font_size=9,
)
p("Company ka state code (27 — Maharashtra) aur customer ka state/GSTIN sahi hona chahiye, warna tax ka batwara galat ho sakta hai. "
  "Yeh software ka hisaab hai — final GST treatment apne CA se confirm karein.", italic=True, color=MUTED, size=9.5)

h2("6.2  Payment record karna")
steps([
    "Invoices list me invoice par click karein (detail khulegi).",
    "Record payment dabayein.",
    "Amount daalein — balance se zyada nahi. 100 rupaye partial payment bhi record ho sakta hai.",
    "Date aur Mode (Cash / Bank / UPI / Cheque) choose karein, reference likhein.",
    "Save payment dabayein.",
    "Bheja hua payment list me dikhega; Paid badhega, Balance ghatega. Poora paisa aane par status PAID ho jayega.",
])
shot("payment-form", "Payment record karna",
     ["Amount (balance due se zyada nahi)", "Mode"],
     "Partial payment bhi chalega — customer 500 ka bill me se 200 de de to 200 record karein. Baaki balance dikhta rahega. "
     "Payment ke baad invoice edit/cancel par rok lag jati hai, isliye amount-pehle-verify karein.")
shot("payment-saved", "Payment jud gaya",
     None,
     "Yahan Paid ₹100 aur Balance ₹348 hai. Puri payment hone par status PAID dikhega. Invoice ka PDF customer/CA ko bhejne ke liye upar PDF se download karein.")
callout(
    "warn",
    "Payment ke baad bill badalna mushkil hota hai",
    "Payment lagne ke baad invoice ka amount/detail edit nahi hoga. Galti ho gayi ho to accounts team se credit note / correction ka rasta poochhein — "
    "khud se delete karne ki koshish na karein.",
)

# ===========================================================================
# CHAPTER 7
# ===========================================================================

h1("7.  Production — BOM aur batch")

h2("Is chapter me")
bullets([
    "BOM (recipe) banana",
    "Production batch banana, start karna aur complete karna",
    "Batch complete hone par stock ka hisaab",
])

h2("7.1  BOM — kya banane me kya lagega")
p("BOM (Bill of Materials) ek recipe hai: '1 bracket banane ke liye 0.5 kg MS bar chahiye'. "
  "BOM banane se stock par koi asar nahi hota — yeh sirf plan hai jise batch banate waqt use karte hain.")
steps([
    "Company Inventory → BOMs kholein → New BOM dabayein.",
    "Code aur Name dein — jaise BOM-7465 / Bracket Assembly BOM.",
    "Finished Item choose karein (jo banta hai).",
    "Add Component dabayein, raw material choose karein aur uski quantity daalein (per piece).",
    "Zaroorat ho to aur components jodein. Save BOM dabayein.",
])
shot("bom-list", "Company Inventory → BOMs",
     None,
     "Yahan har recipe ki list hai. Purani recipe edit karke quantity theek ki ja sakti hai — lekin already complete ho chuke batch par purani recipe ka asar nahi padta.")
shot("bom-form", "Naya BOM",
     ["Code", "Name", "Finished Item", "Component (raw material)", "Quantity"],
     "Component ki quantity per 1 finished piece hoti hai. Yahan 1 bracket = 0.5 kg bar. 10 bracket banane par system 5 kg ka plan dikhayega.")
shot("bom-saved", "BOM save ho gaya",
     ["BOM list me nayi recipe"],
     "Recipe save ho gayi. Ab production batch banate waqt isi BOM ko choose karenge aur material lines apne aap aa jayengi.")

h2("7.2  Production batch — asli utpadan")
steps([
    "Company Inventory → Production Batches kholein → New Batch dabayein.",
    "Shift choose karein (Morning/Evening/Night), date check karein.",
    "Item choose karein (jo banana hai) aur BOM choose karein — material lines apne aap aa jati hain.",
    "Planned Quantity daalein (kitne banane hain) aur Save dabayein.",
    "Batch detail kholein → Start dabayein → confirm me Start batch dabayein.",
    "Material Consumption me ACTUAL quantity bharein (kitna material sach me laga). Jo material use nahi hua uski quantity 0 kar dein.",
    "Save Changes dabayein — actual quantity pehle save honi chahiye.",
    "Complete dabayein, produced quantity (aur rejected ho to rejection) daalein, phir Complete batch confirm karein.",
    "Item aur ledger me dono taraf check karein: raw material ghata, finished item badha.",
])
shot("production-list", "Production Batches",
     ["New Batch button", "Batch list (status ke saath)"],
     "Status PLANNED → IN_PROGRESS → COMPLETED. Planned aur produced quantity saath me dikhti hai, isliye pata chalta hai kitna banne wala tha aur kitna bana.")
shot("production-form", "Naya production batch",
     ["Shift", "Item", "BOM (material lines apne aap)", "Planned Quantity"],
     "BOM choose karte hi neeche Material Consumption table aa jata hai. Planned quantity ke hisaab se material ki zaroorat dikhti hai — "
     "lekin system khud se quantity scale karke stock nahi ghatata; actual quantity aapko bharni hoti hai.")
shot("production-batch-open", "Batch detail (PLANNED)",
     None,
     "Batch abhi PLANNED hai — abhi tak stock par koi asar nahi hua. Neeche Start button se batch shuru hota hai.")
shot("production-start-confirm", "Start ki confirmation",
     ["Confirmation box"],
     "Start batch dabane par batch IN_PROGRESS ho jata hai aur material consumption record ho sakti hai.")
shot("production-batch-started", "Batch IN_PROGRESS — actual material bharna",
     None,
     "Ab actual consumed quantity edit hoti hai. Yahan sach likhein — jo material sach me laga wahi, kyunki Complete karte waqt isi ke hisaab se stock ghatega. "
     "Save Changes karne ke baad hi Complete karein.")
callout(
    "note",
    "Complete karte waqt 3 baatein",
    "(1) Produced quantity sirf achha maal hai — rejected alag likhein. (2) Complete hote hi raw material ghatta hai aur finished item badhta hai. "
    "(3) Complete batch ki consumption baad me edit nahi hoti — isliye quantity do baar check karein.",
)
callout(
    "tip",
    "Shift pehle se bani hui hai",
    "Morning Shift, Evening Shift aur Night Shift software me pehle se hain. Naya shift chahiye to Company Inventory → Shifts me banayein.",
)

# ===========================================================================
# CHAPTER 8
# ===========================================================================

h1("8.  Customer ka maal aur jobwork")

h2("Is chapter me")
bullets([
    "Customer ka diya hua maal inward karna (Customer Material)",
    "Us maal ko consume / dispatch / return karna",
    "Vendor ko jobwork ke liye bhejna aur wapas receive karna",
])
callout(
    "note",
    "Customer ka maal company ka maal nahi hai",
    "Customer apna raw material de (jobwork ke liye) to woh Customer Inventory me alag lot ke roop me rakha jata hai. "
    "Yeh quantity company ke item stock me NAHI judegi — iska apna alag ledger hai.",
)

h2("8.1  Customer material inward")
steps([
    "Customer Inventory → Customer Material kholein → New inward dabayein.",
    "Customer choose karein aur Received Date daalein.",
    "Material Description likhein (jaise 'Customer ke forging blanks, 40 pcs'). Item catalog me ho to Catalog Item bhi choose kar sakte hain.",
    "Lot Number aur Heat Number likhein (traceability ke liye), Location likhein (jaise Store-A).",
    "Quantity aur UoM daalein. Save dabayein.",
    "Lot detail me available quantity dekh lein.",
])
shot("customer-material-list", "Customer Inventory → Customer Material",
     None,
     "List me har customer lot, uska available quantity aur location dikhta hai. Lot detail me Consume / Dispatch / Return ke action milte hain.")
shot("customer-material-form", "Customer ka maal inward karna",
     ["Customer", "Material Description", "Quantity", "Lot Number"],
     "Yeh 40 pcs company stock me nahi judengi — alag customer lot ledger me jayengi. Lot number likhna acchi practice hai, warna baad me pata nahi chalega kaunsa maal kis customer ka hai.")
p("Lot detail se jo action milte hain:")
bullets([
    ("Consume — ", "customer ke maal me se kuch process/use ho gaya."),
    ("Dispatch — ", "customer ka maal wapas ya aage bhej diya."),
    ("Return — ", "customer ko wapas kar diya."),
])
p("Teeno action lot ka balance ghatate hain, company stock ko chhoote nahi. Action tabhi karein jab woh kaam physically ho chuka ho.", size=10)

h2("8.2  Jobwork — vendor ko maal bhejna")
steps([
    "Customer Inventory → Vendor Dispatch (Jobwork) kholein → New jobwork dabayein.",
    "Date, Vendor aur Material Owner choose karein — company ka maal ho to Company, customer ka ho to Customer (aur sahi lot choose karein).",
    "Expected Return date daalein (vendor kab tak wapas karega).",
    "Line me item aur bheji ja rahi quantity daalein. Save dabayein.",
    "Vendor se maal wapas aane par jobwork list me us challan ke saamne Receive dabayein.",
    "Received aur rejected quantity bharein — partial receive bhi chalta hai.",
])
shot("jobwork-list", "Customer Inventory → Vendor Dispatch (Jobwork)",
     None,
     "Har jobwork challan ka vendor, material owner, bheji quantity aur status dikhta hai. "
     "Receive karne par quantity wapas stock/lot me jud jati hai; total bheje se zyada receive ya reject nahi kar sakte.")

# ===========================================================================
# CHAPTER 9
# ===========================================================================

h1("9.  Return ka case — sales return aur purchase return")

h2("Is chapter me")
bullets([
    "Customer se maal wapas aaya to kya karein",
    "Vendor ko kharab maal wapas bhejna",
])

h2("9.1  Sales return (customer se maal wapas)")
steps([
    "Sales → Returns kholein → New return dabayein.",
    "Customer aur original invoice/challan ka reference choose karein.",
    "Return ki quantity aur reason likhein.",
    "Physical Receipt record karein — return challan number aur received date (aur ho to dispatch challan) bharein.",
    "Save dabayein. Stock sirf Physical Receipt hone ke baad badhta hai.",
])
shot("sales-returns", "Sales → Returns",
     None,
     "Return ki list status ke saath. Dhyan rakhein: agar Physical Receipt nahi bharte to system return process nahi karega — "
     "matlab maal godown me aaya hi nahi, isliye stock nahi badhega.")

h2("9.2  Purchase return (vendor ko maal wapas)")
steps([
    "Company Inventory → Purchase Returns kholein → New return dabayein.",
    "Vendor aur related GRN/PO ka reference choose karein.",
    "Item, quantity aur reason likhein. Save/process dabayein.",
    "Stock aur vendor ledger dono check karein.",
])
shot("purchase-returns", "Company Inventory → Purchase Returns",
     None,
     "Kharab/short maal vendor ko wapas bhejne ka record. Return process hone par stock ghatta hai — isliye process karne se pehle quantity confirm karein.")
callout(
    "warn",
    "Return ka rasta cancel se alag hai",
    "Maal godown se bahar ja chuka aur wapas aa raha hai to return process use karein, purana challan cancel na karein. "
    "Cancel sirf usi document ke liye hai jo galti se bana aur uska kaam shuru hi nahi hua.",
)

# ===========================================================================
# CHAPTER 10
# ===========================================================================

h1("10.  Reports aur Analytics")

h2("Is chapter me")
bullets([
    "Business reports kahan se nikalti hain",
    "Excel/PDF download",
    "Graph se kya samajh aata hai",
])
steps([
    "Analytics → Reports kholein.",
    "Report type aur date range choose karein.",
    "Screen par data dekhein, phir download/export dabayein.",
    "File Excel ya PDF me khul jayegi — CA, management ya bank ko bhej sakte hain.",
])
shot("reports", "Analytics → Reports",
     None,
     "Sales, purchase, stock aur party-wise report yahin se milti hai. Har report me date range ka filter hota hai — mahine ke hisaab se nikaalna sabse aam tareeka hai.")
shot("inventory-analytics", "Inventory Analytics",
     None,
     "Graph se pata chalta hai kaunsa maal zyada pada hai, kaunsa khatam ho raha hai, aur kitna paisa stock me fasa hai. "
     "Yeh graph har hafte dekhna achhi aadat hai.")

# ===========================================================================
# CHAPTER 11
# ===========================================================================

h1("11.  Users, Roles aur permissions")

h2("Is chapter me")
bullets([
    "Naya user (login) banana",
    "Role me permission set karna",
    "Kisi ko button/link na dikhe to kya karein",
])
steps([
    "Admin → Users kholein → naya user banayein: naam, email, role, department.",
    "Temporary password set karein aur user ko dein — user pehle login par apna password badle.",
    "Admin → Roles me role kholkar permission tick karein: read (dekhna), create (naya banana), update (badalna), delete (cancel/delete).",
    "Save karein. User ko dobara login karne par nayi permission lagu hogi.",
])
shot("users", "Admin → Users",
     None,
     "Yahan saare logins hain. Ek user ko deactivate karna ho to uski detail me active off kar dein — delete se history par asar padta hai, isliye deactivate behtar hai.")
shot("roles", "Admin → Roles",
     None,
     "Role me permissions ka group hota hai. Ek hi role ke saare user ka access ek saath badalta hai — isliye role ke naam clear rakhein: Store, Accounts, Production, Admin.")
callout(
    "tip",
    "Button ya page nahi dikh raha?",
    "99% case me permission ki baat hai. Admin se poochhein ki aapke role me us page ki read aur us action ki permission hai ya nahi. "
    "Browser me URL type karke bhi permission bypass nahi hoti — server khud rok deta hai.",
)

# ===========================================================================
# CHAPTER 12
# ===========================================================================

h1("12.  Metal Calculator — weight aur price")

h2("Is chapter me")
bullets([
    "Round bar, pipe, plate jaise shapes ka weight nikalna",
    "Metal choose karke price nikalna",
])
steps([
    "Masters → Metal Calculator kholein.",
    "Shape choose karein (round bar, pipe, square bar/tube, flat bar, hexagon, plate, angle, beam, channel, T-profile).",
    "Dimensions (diameter, thickness, length) aur unit (mm / inch / mtr) bharein.",
    "Metal choose karein — density ke hisaab se weight aata hai.",
    "Rate per kg daalein to price bhi aa jayega.",
    "Result copy karke apne quotation/bill me use karein.",
])
shot("metal-calculator", "Masters → Metal Calculator",
     None,
     "Yeh sirf calculator hai — stock, invoice ya quotation par koi asar nahi. Result copy karke apne document me paste karein. "
     "Standard profile table me kuch purani entries ki kg/m value sahi nahi ho sakti, isliye screen par 'manual kg/m' ka option bhi diya gaya hai — "
     "bharosa na ho to khud ka kg/m daal dein.")
callout(
    "note",
    "Rate ka dhyan rakhein",
    "Calculator ka price sirf calculation hai. Customer ko bhejne se pehle rate apne purchase/current market rate se mila lein — "
    "galat rate se quotation dena nuksan ka karan banta hai.",
)

# ===========================================================================
# CHAPTER 13
# ===========================================================================

h1("13.  Search shortcut aur mobile")

h2("13.1  Ctrl + K — seedha page par")
p("Poore software me kahin bhi Ctrl + K (Mac par Command + Shift + K) dabayein — search box khulega. "
  "Page ka naam ya kaam type karein, jaise 'invoice', 'grn', 'new item'. Arrow key se choose karein aur Enter dabayein.")
shot("global-search", "Global search (Ctrl + K)",
     ["Search box — page ya action ka naam likhein"],
     "Yeh search sirf wahi options dikhata hai jinki aapke role me permission hai. Isliye list chhoti lage to permission ka issue ho sakta hai.")

h2("13.2  Mobile par use karna")
steps([
    "Phone ke browser (Chrome) me wahi address kholein jo computer par khulta hai.",
    "Login karein — dashboard mobile layout me khul jayega.",
    "Upar left ka ☰ button dabayein — sidebar khulega, wahan se page choose karein.",
    "Form me field ek ke neeche ek aayengi; table ko side me scroll karke poore column dekh sakte hain.",
    "Chrome menu → 'Add to Home screen' / 'Install app' se app ki tarah install kar lein — agli baar icon se seedha khulega.",
])
shot("mobile-dashboard", "Mobile par dashboard",
     ["Upar ka ☰ menu button"],
     "Mobile par bhi sab screens chalti hain, par bade report/table dekhna computer par aasan hota hai. "
     "Store me ginti karte waqt phone par stock ledger kholna kaafi kaam ka hai. Internet na ho to upar ek patti dikhegi — us waqt save na karein.")
callout(
    "tip",
    "Phone par kaam karte waqt",
    "Photo/measurement ke saath entry karni ho to pehle kagaz par likh lein, phir phone me daalein — galti kam hoti hai. "
    "Bade document (invoice, PO) computer par banana behtar hai.",
)

# ===========================================================================
# CHAPTER 14
# ===========================================================================

h1("14.  Roz ka routine — kis role ko kya karna hai")

p("Software sirf tab kaam aata hai jab roz kaam usme ho. Yeh simple routine follow karein:")

h2("Har din — subah (5 minute)")
bullets([
    "Dashboard kholein: sales, pending jobwork, overdue invoices dekh lein.",
    "Analytics → Inventory Analytics me low stock wale item dekh lein — jo khatam ho rahe hain unki PO ka soch lein.",
    "Notification bell me koi alert ho to dekh lein.",
])

h2("Store / godown wale ka checklist")
table(
    ["Kaam", "Screen", "Kab"],
    [
        ["Maal aaya — GRN banaya?", "Company Inventory → GRN (Stock In)", "Maal aane ke turant baad"],
        ["Kharab maal reject mark kiya?", "Usi GRN me Rejected column", "Receipt ke waqt"],
        ["Maal bheja — challan banaya?", "Sales → Dispatch", "Gaadi nikalne se pehle"],
        ["Vehicle/driver detail bhara?", "Dispatch form", "Challan banate waqt"],
        ["Customer ka maal alag lot me daala?", "Customer Inventory → Customer Material", "Inward ke din"],
        ["Ginti ka farak mila — adjustment + reason?", "Stock Management", "Ginti ke baad"],
        ["Jobwork wapas aaya — receive kiya?", "Customer Inventory → Vendor Dispatch", "Maal aane par"],
    ],
    [7.4, 6.2, 3.4],
    font_size=9,
)

h2("Accounts wale ka checklist")
table(
    ["Kaam", "Screen", "Kab"],
    [
        ["Maal gaya par bill nahi bana — invoice banaya?", "Sales → Invoices", "Dispatch ke baad"],
        ["GST type sahi hai (CGST/SGST ya IGST)?", "Invoice form", "Bill banate waqt"],
        ["Paisa aaya — payment record kiya?", "Invoice detail → Record payment", "Paisa aane par"],
        ["Overdue invoice dekh liye?", "Invoices list", "Har hafte"],
        ["Mahine ki report nikaali?", "Analytics → Reports", "Har mahine"],
    ],
    [7.4, 6.2, 3.4],
    font_size=9,
)

h2("Production wale ka checklist")
bullets([
    "Batch PLANNED se IN_PROGRESS kiya, phir actual material consumption bhara?",
    "Complete karte waqt produced aur rejected quantity alag-alag likhi?",
    "BOM me component quantity sahi hai (per 1 piece)?",
])

h2("Admin ka checklist")
bullets([
    "Naye employee ka login banaya, role diya, aur purane inactive login band kiye?",
    "Permission review ki — kis role ko kya dikhna chahiye?",
    "Backup / server ki jaankari vendor se confirm hai?",
])

# ===========================================================================
# CHAPTER 15
# ===========================================================================

h1("15.  Poora practice example (numbers ke saath)")

p("Pehli baar practice karte waqt is example ko exactly isi order me chalayein. Har step ke baad stock check karein. "
  "Yeh example demo/practice data par karein, asli company data par nahi.")
p("Practice ke liye ek naya item banayein: naam 'TEST Round Bar 25mm', UoM PCS, purchase rate ₹70, sale rate ₹95, GST 18%, opening stock 50, min stock 10.")

table(
    ["Step", "Aap kya karenge", "Expected stock", "Kahan check karein"],
    [
        ["1", "Item banaya, opening stock 50", "50", "Items list → stock"],
        ["2", "Manual adjustment +5 (ginti me zyada mile)", "55", "Stock ledger → ADJUSTMENT row"],
        ["3", "Manual adjustment −3 (ginti me kam mile)", "52", "Stock ledger → BALANCE column"],
        ["4", "GRN: qty 10, rejected 2 (accepted 8)", "60", "GRN detail + item stock"],
        ["5", "Delivery challan 4 pcs customer ko", "56", "Dispatch list + stock ledger"],
        ["6", "Invoice 4 pcs × ₹95 + 18% GST = ₹448.40 → round off ₹448", "56 (koi change nahi)", "Invoice detail → total"],
        ["7", "Payment ₹200 record", "56 (koi change nahi)", "Invoice → Paid ₹200, Balance baaki"],
        ["8", "Production batch 10 pcs (BOM me 0.5 kg/pc), material used 5 kg, produced 10", "Raw −5, finished +10", "Batch detail + ledger"],
        ["9", "Galat challan Cancel dispatch", "Wapas +quantity", "Dispatch list status CANCELLED"],
        ["10", "GRN cancel (agar maal use nahi hua)", "Accepted 8 wapas kam", "GRN status CANCELLED"],
    ],
    [1.2, 7.6, 4.0, 4.2],
    font_size=9,
)

h2("Is example me kya seekhne ko mila")
bullets([
    "Invoice aur payment se stock par koi asar nahi padta.",
    "GRN me sirf accepted quantity judti hai.",
    "Dispatch se stock ghatta hai, cancel se wapas aata hai.",
    "Production complete hone par raw material ghatta hai aur finished item badhta hai.",
    "Har movement ledger me TYPE ke saath dikhti hai — yahi aapka proof hai.",
])
callout(
    "stop",
    "Practice ke baad",
    "Practice item aur practice customer/vendor ko deactivate kar dein (delete nahi), aur asli data par kaam shuru karein. "
    "Practice ke dauraan bane GRN/challan/invoice cancel kar dein taaki hisaab saaf rahe.",
)

# ===========================================================================
# CHAPTER 16
# ===========================================================================

h1("16.  Galtiyan aur unka hal (FAQ)")

faq = [
    ("Save button dabaya par kuch nahi hua",
     "Zaroori field khali hai ya galat hai. Laal message dekhein — woh field ke neeche likha hota hai. Sabse aam: party/item select nahi kiya, ya quantity 0 hai."),
    ("Item list me item nahi mil raha",
     "Search box me poora naam na likhein — 3-4 letter likhkar Enter dabayein. Ya All types filter check karein. Naya item ho to page refresh karein."),
    ("Stock 0 se neeche ja raha hai / dispatch save nahi ho raha",
     "System galat stock nahi banata. Pehle stock ledger dekhein ki stock kahan gaya, phir GRN ya adjustment se stock theek karein. Available se zyada dispatch kabhi save nahi hoga."),
    ("GRN cancel nahi ho raha",
     "Us GRN ka maal aage use ho chuka hai (dispatch/production/return). Pehle woh document theek karein. Zaroorat ho to admin se 'reverse anyway' ka rasta poochhein — woh ledger me forced reversal ke roop me dikhta hai."),
    ("Invoice banaya par stock nahi ghata",
     "Yeh galti nahi, design hai. Maal bhejne ke liye Sales → Dispatch me challan banayein."),
    ("Bill me GST galat lag raha hai",
     "GST Type (Intra/Inter) aur line ka GST % check karein. Company state code (27) aur customer GSTIN/state sahi hona chahiye. Final treatment CA se confirm karein."),
    ("Payment save nahi ho raha — 'exceeds balance' likha hai",
     "Amount balance se zyada daal diya hai, ya 2 decimal se zyada (jaise 100.001). Amount theek karke dobara save karein."),
    ("Payment ke baad invoice edit nahi ho raha",
     "Payment lagne ke baad invoice lock ho jati hai. Accounts se credit note / correction ka rasta poochhein."),
    ("Delivered challan cancel nahi ho raha",
     "Delivered challan cancel nahi hota. Customer se maal wapas aaya ho to Sales → Returns (Physical Receipt ke saath) use karein."),
    ("Kisi page ka link hi nahi dikh raha",
     "Permission ki baat hai. Admin se role me read/create permission add karwayein."),
    ("Login nahi ho raha / password yaad nahi",
     "Admin → Users se password reset karwayein. Email/password me aage-peeche space na ho — copy-paste ke waqt dhyan rakhein."),
    ("'Session expired' ya baar-baar logout ho raha hai",
     "Lambey samay tak tab khula chhoda tha. Dobara login karein. Bar-bar ho to admin se token/session setting check karwayein."),
    ("Quantity 2.125 KG daalna hai, 0.0033 nahi",
     "Stock quantity 3 decimal tak hi chalti hai (2.125 theek, 2.1254 nahi). Paisa 2 decimal tak."),
    ("Mobile par table cut raha hai",
     "Table ko side me scroll karein, ya woh screen computer par kholein. Sabse aasan: sheet ko rotate (landscape) karein."),
    ("Do baar entry ban gayi (duplicate GRN/challan)",
     "Galat wala cancel karein (reason ke saath). Delete se stock ka hisaab bigad sakta hai — cancel zyada safe hai."),
    ("Backdated entry karni hai",
     "Document date field me purani date daal sakte hain. Lekin ledger me POSTED (kab lagi) aur document date alag hote hain — isliye dono check karein."),
    ("Report me data nahi aa raha",
     "Date range check karein — default range me aaj ka data na aaye. Range bada karke dobara chalayein."),
    ("Customer ka maal company stock me nahi dikh raha",
     "Sahi hai — woh Customer Inventory me lot ke roop me hai, company items me nahi. Stock Management me Owner = Customer filter lagayein."),
    ("Page bahut slow hai",
     "Bahut bada list load ho raha hoga. Filter lagayein, page chhota karein, aur ek saath bahut se tab band karein."),
    ("'Error 500' ya 'Network error' aaya",
     "Ek baar page refresh karein aur dobara koshish karein. Phir bhi aaye to screenshot lein aur admin/IT ko bhejein — usi screenshot se problem jaldi milegi."),
]
table(
    ["Problem", "Hal"],
    [[q, a] for q, a in faq],
    [6.4, 10.6],
    font_size=9,
)

# ===========================================================================
# CHAPTER 17
# ===========================================================================

h1("17.  Safety rules — kya kabhi na karein")

h2("Kya na karein")
bullets([
    ("Apna password kisi ko na dein. ", "Zaroorat ho to naya user banwayein. Ek login = ek insaan."),
    ("Test entry asli data me na karein. ", "Practice ke liye alag demo/test login lein."),
    ("Delete ki jagah Cancel use karein. ", "Cancel se stock apne aap theek hota hai aur history bachti hai."),
    ("Purane document ko 'theek' karne ke liye adjustment ka dher na banayein. ", "Pehle root cause dhoondhein — ledger me saaf dikhta hai kahan galti hui."),
    ("Customer/vendor/item duplicate na banayein. ", "Pehle search karein — duplicate se report aur balance dono galat ho jate hain."),
    ("Screenshot/photo me customer ka rate/paisa social media par share na karein. ", "Company data confidential hota hai."),
])

h2("Kya zaroor karein")
bullets([
    "Din ke end me apne banaye document ek baar check karein (GRN, challan, invoice).",
    "Mahine ke end me stock ledger aur physical stock mila lein.",
    "Galti ho jaye to turant senior/admin ko batayein — chhupane se hisaab bigadta hai.",
    "Report/backup ki jaankari admin se lein: server ka backup kaun leta hai, kitne din ka rakhta hai.",
    "Document print/PDF banakar file me rakhein (GST audit ke liye).",
])

callout(
    "note",
    "Demo data vs asli data",
    "Is guide ke screenshots demo (practice) data se liye gaye hain — yahan 'Shree Ganesh Engineering' jaise dummy naam hain. "
    "Demo server restart hone par data reset ho sakta hai. Asli kaam company ke apne server/login par hi karein.",
)
callout(
    "warn",
    "GST aur legal",
    "Software GST ka hisaab dikhata hai, par final tax treatment (HSN, rate, place of supply, e-way bill) aapke CA/tax advisor se confirm karein. "
    "Invoice cancel/credit note ke rules company ke accountant ke hisaab se follow karein.",
)

# ===========================================================================
# CHAPTER 18
# ===========================================================================

h1("18.  Agar phir bhi samajh na aaye")

p("Yeh guide padhne ke baad bhi koi screen samajh na aaye to is order me madad lein:")
steps([
    ("Pehle is guide me dhoondhein. ", "Chapter 16 (FAQ) me 20 common problem hain — 90% sawal wahin hal ho jate hain."),
    ("Apne senior / store in-charge se poochhein. ", "Woh aapko company ka process bata payenge (kis document ka kya naam hai)."),
    ("Admin se poochhein. ", "Login, permission, role, password reset, backup — sab admin ka kaam hai."),
    ("Screenshot ke saath likhein. ", "Problem aaye to screen ka screenshot lein (galat message ke saath) aur admin/IT ko bhejein. Usme date, document number aur item ka naam likhein."),
])
h2("Madad maangte waqt yeh 5 baatein likhein")
bullets([
    "Kis screen par problem hai (jaise 'GRN form')",
    "Kya karna chahte the aur kya hua (error message ka text)",
    "Document number (agar ban gaya ho)",
    "Date aur time",
    "Screenshot (screen ka photo ya screenshot)",
])

h2("Aakhri baat")
p("Shuru me har cheez yaad nahi rahegi — yeh normal hai. Pehle hafte sirf 4 kaam par dhyan dein: "
  "1) party aur item banana, 2) GRN, 3) dispatch, 4) invoice + payment. "
  "Baaki (production, jobwork, return, reports) dheere-dheere aapki zaroorat ke hisaab se seekh lenge. "
  "Aur sabse important: maal aaye to GRN, maal jaye to Dispatch — yahi do entry software ko sach rakhti hain.")

# ---------------------------------------------------------------------------
# appendix
# ---------------------------------------------------------------------------

h1("Appendix A — Screen ka naksha (kahan se kya kholein)")
table(
    ["Kaam", "Rasta (menu → page)", "URL ka hissa"],
    [
        ["Dashboard", "Dashboard → Overview", "/"],
        ["Customer list / naya customer", "Masters → Customers", "/parties?type=CUSTOMER"],
        ["Vendor list / naya vendor", "Masters → Vendors", "/parties?type=VENDOR"],
        ["Item list / naya item", "Company Inventory → Items", "/items"],
        ["BOM", "Company Inventory → BOMs", "/boms"],
        ["Production batch", "Company Inventory → Production Batches", "/production/batches"],
        ["Shift", "Company Inventory → Shifts", "/production/shifts"],
        ["Purchase Order", "Company Inventory → Purchase Orders", "/purchase-orders"],
        ["GRN (maal aaya)", "Company Inventory → GRN (Stock In)", "/grns"],
        ["Purchase return", "Company Inventory → Purchase Returns", "/purchase-returns"],
        ["Back order", "Company Inventory → Back Orders", "/back-orders"],
        ["Invoice (bill)", "Sales → Invoices", "/invoices"],
        ["Dispatch (challan)", "Sales → Dispatch", "/dispatch"],
        ["Sales return", "Sales → Returns", "/sales-returns"],
        ["Customer ka maal", "Customer Inventory → Customer Material", "/customer-material"],
        ["Jobwork", "Customer Inventory → Vendor Dispatch (Jobwork)", "/jobwork"],
        ["Vendor work order", "Customer Inventory → Vendor Work Orders", "/vendor-work-orders"],
        ["Stock overview / ledger / adjustment", "Stock Management → Stock Overview & Ledger", "/stock"],
        ["Task progress", "Task Management → Task Progress", "/tasks"],
        ["Mera task", "Task Management → My Tasks", "/my-tasks"],
        ["Jobcard", "Masters → Jobcards", "/jobcards"],
        ["Machine", "Masters → Machines", "/machines"],
        ["Metal Calculator", "Masters → Metal Calculator", "/metal-calculator"],
        ["Quotation", "Masters → Customer Quotations / Vendor Quotations", "/quotations"],
        ["Reports", "Analytics → Reports", "/reports"],
        ["Analytics", "Analytics → Sales / Production / Inventory Analytics", "/analytics/…"],
        ["Users", "Admin → Users", "/users"],
        ["Roles", "Admin → Roles", "/roles"],
        ["Departments", "Admin → Departments", "/departments"],
        ["Projects", "Admin → Projects", "/projects"],
        ["Expenses", "Admin → Expenses", "/expenses"],
    ],
    [6.0, 7.6, 3.4],
    font_size=8.5,
)

h1("Appendix B — Shabd-kosh (glossary)")
table(
    ["Shabd", "Seedha matlab"],
    [
        ["Item", "Company ka maal — raw material, consumable ya finished product."],
        ["Party", "Customer (maal lene wala) ya vendor (maal dene/kaam karne wala)."],
        ["UoM", "Quantity ki unit — PCS, KG, MTR, LTR."],
        ["Opening stock", "System shuru karte waqt godown me jo maal tha."],
        ["Min stock", "Low-stock alert ka level (order karne ki guarantee nahi)."],
        ["PO (Purchase Order)", "Vendor ko maal mangwane ka order. Stock nahi badhata."],
        ["GRN", "Goods Receipt Note — maal aaya ka record. Accepted quantity stock badhati hai."],
        ["Dispatch / Delivery Challan", "Maal bhejne ka record — stock ghatata hai."],
        ["Invoice", "Bill / GST document — stock par asar nahi."],
        ["BOM", "Bill of Materials — ek product ki recipe (kaun sa material, kitna)."],
        ["Production batch", "Ek shift me bane maal ka record; complete par stock badalta hai."],
        ["Jobwork", "Maal vendor ko process ke liye bhejna aur wapas lena."],
        ["Customer material lot", "Customer ka apna maal jo aapke paas kaam ke liye hai — alag ledger."],
        ["Stock ledger", "Har movement ki history — In, Out aur Balance ke saath."],
        ["Manual Adjustment", "Ginti ka farak theek karne ki entry (+/−), reason ke saath."],
        ["CGST / SGST", "Same state ki supply par lagne wale do tax (aadha-aadha)."],
        ["IGST", "Doosre state ki supply par lagne wala tax."],
        ["E-way bill", "Bade maal ki transport ke liye sarkari document (dispatch me number likh sakte hain)."],
        ["Maker-checker", "Ek user banaye, doosra approve kare — PO me lagu."],
        ["Low stock", "Min stock se neeche chala gaya item."],
    ],
    [5.0, 12.0],
    font_size=9,
)

h1("Appendix C — Screenshot list")
p("Is guide me 50 screenshots hain. Neeche list se seedha woh screenshot dhoondh sakte hain jo aapko chahiye. "
  "Roz ka kaam inhi 4 screen par hota hai: GRN, Dispatch, Invoice aur Stock Ledger.")
rows = []
half = (len(MANIFEST) + 1) // 2
left = MANIFEST[:half]
right = MANIFEST[half:]
for i in range(half):
    a = f"Chitra {left[i]['step']} — {left[i]['title']}"
    b = f"Chitra {right[i]['step']} — {right[i]['title']}" if i < len(right) else ""
    rows.append([a, b])
table(["Screenshot", "Screenshot"], rows, [8.5, 8.5], font_size=8)

# caption numbers must line up with the screenshot steps in the manifest
assert CHITRA == len(MANIFEST), f"{CHITRA} pictures placed but {len(MANIFEST)} captured"

doc.save(OUT)
print(f"written: {OUT}  ({OUT.stat().st_size / 1e6:.1f} MB, {CHITRA} screenshots)")
