#!/usr/bin/env python3
"""Merge cover (page 0) + body -> final guide PDF, normalized to A4."""
from pypdf import PdfReader, PdfWriter

A4_W, A4_H = 595.28, 841.89
COVER = '/home/z/my-project/task8-pdf/cover.pdf'
BODY = '/home/z/my-project/task8-pdf/body.pdf'
OUT = '/home/z/my-project/task8-pdf/UTech_ERP_Flow_Guide.pdf'


def normalize(page):
    box = page.mediabox
    w, h = float(box.width), float(box.height)
    if abs(w - A4_W) > 0.1 or abs(h - A4_H) > 0.1:
        page.scale_to(A4_W, A4_H)
    return page


writer = PdfWriter()
writer.add_page(normalize(PdfReader(COVER).pages[0]))
for p in PdfReader(BODY).pages:
    writer.add_page(normalize(p))
writer.add_metadata({
    '/Title': 'UTech Automation ERP - Simple Flow Guide',
    '/Author': 'Z.ai',
    '/Creator': 'Z.ai',
    '/Subject': 'Plain-language guide to the UTech Automation ERP flows',
})
with open(OUT, 'wb') as f:
    writer.write(f)
print('merged ->', OUT, 'pages:', len(writer.pages))
