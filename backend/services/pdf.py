"""PDF export for reports: ReportLab for layout, Matplotlib for the chart."""
import datetime as dt
import io
import os
import tempfile
from pathlib import Path

os.environ.setdefault("MPLCONFIGDIR", str(Path(tempfile.gettempdir()) / "retailiq-mpl"))

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.ticker import FuncFormatter
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Image, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from services.inr import inr_short
from services.reports import format_value

GREEN = "#315C46"
INK = "#191919"
MUTED = "#85847F"
RULE = "#DDDDD5"
MAX_PDF_ROWS = 200

# Matplotlib's bundled DejaVu fonts cover the pound sign and arrows in all PDF viewers.
_font_dir = Path(matplotlib.get_data_path()) / "fonts" / "ttf"
pdfmetrics.registerFont(TTFont("Body", str(_font_dir / "DejaVuSans.ttf")))
pdfmetrics.registerFont(TTFont("Body-Bold", str(_font_dir / "DejaVuSans-Bold.ttf")))
pdfmetrics.registerFont(TTFont("Mono", str(_font_dir / "DejaVuSansMono.ttf")))


def _chart_png(report):
    chart = report["chart"]
    data = report["rows"][: chart.get("limit", len(report["rows"]))]
    if not data:
        return None
    labels = [str(r[chart["x"]]) for r in data]
    values = [r[chart["y"]] for r in data]
    fig, ax = plt.subplots(figsize=(10, 3.6 if chart["kind"] == "line" else min(3.3, max(2.2, 0.27 * len(data) + 0.5))), dpi=180)
    if chart["kind"] == "line":
        ax.plot(labels, values, color=GREEN, linewidth=2, marker="o", markersize=4)
        ax.tick_params(axis="x", labelsize=7.5, rotation=0 if len(labels) <= 14 else 45)
        ax.yaxis.grid(True, color=RULE, linewidth=0.6)
    else:
        short = [l if len(l) <= 58 else l[:56] + "…" for l in labels][::-1]
        ax.barh(short, values[::-1], color=GREEN, height=0.62)
        ax.xaxis.grid(True, color=RULE, linewidth=0.6)
        ax.tick_params(axis="y", labelsize=7.5)
    axis = ax.yaxis if chart["kind"] == "line" else ax.xaxis
    if chart["format"] == "money":
        axis.set_major_formatter(FuncFormatter(lambda v, _: inr_short(v)))
    ax.set_axisbelow(True)
    for side in ["top", "right", "left"]:
        ax.spines[side].set_visible(False)
    ax.spines["bottom"].set_color(RULE)
    ax.tick_params(colors=INK, length=0, labelsize=7.5)
    fig.tight_layout()
    buffer = io.BytesIO()
    fig.savefig(buffer, format="png")
    plt.close(fig)
    buffer.seek(0)
    return buffer


def build_pdf(report):
    buffer = io.BytesIO()
    page = landscape(A4)
    margin = 16 * mm
    width = page[0] - 2 * margin - 12  # SimpleDocTemplate frames add 6pt of padding each side

    def footer(canvas, doc):
        canvas.saveState()
        canvas.setFont("Mono", 7)
        canvas.setFillColor(colors.HexColor(MUTED))
        canvas.drawString(margin, 9 * mm, f"RETAILIQ / {report['title'].upper()}")
        canvas.drawRightString(page[0] - margin, 9 * mm, f"PAGE {doc.page}")
        canvas.restoreState()

    doc = SimpleDocTemplate(buffer, pagesize=page, leftMargin=margin, rightMargin=margin, topMargin=14 * mm,
                            bottomMargin=16 * mm, title=f"RetailIQ - {report['title']}", author="RetailIQ")
    label = ParagraphStyle("label", fontName="Mono", fontSize=7.5, textColor=colors.HexColor(MUTED), leading=11)
    title = ParagraphStyle("title", fontName="Body-Bold", fontSize=26, leading=31, textColor=colors.HexColor(INK), spaceAfter=4)
    heading = ParagraphStyle("heading", fontName="Body-Bold", fontSize=10.5, leading=14, textColor=colors.HexColor(INK), spaceBefore=10, spaceAfter=5)
    body = ParagraphStyle("body", fontName="Body", fontSize=9, leading=14, textColor=colors.HexColor(INK), spaceAfter=3)
    cell = ParagraphStyle("cell", fontName="Body", fontSize=7, leading=9)

    generated = dt.datetime.fromisoformat(report["generated_at"]).strftime("%d %B %Y, %H:%M")
    story = [
        Paragraph("RETAILIQ INDIA / ANALYTICAL REPORT", label),
        Paragraph(report["title"], title),
        Paragraph(_escape(report["data_notice"]), label),
        *([Paragraph(_escape("SOURCE " + report["data_source"]), label)] if report.get("data_source") else []),
        Paragraph(
            f"DATASET {_escape(report['dataset'].upper())} &nbsp;·&nbsp; RANGE {report['range']['from']} TO {report['range']['to']} "
            f"&nbsp;·&nbsp; GENERATED {generated.upper()}", label),
        Spacer(1, 8),
    ]

    summary = report["summary"]
    tile = Table(
        [[Paragraph(s["label"].upper(), label) for s in summary],
         [Paragraph(f"<font name='Mono' size='15'>{format_value(s['value'], s['format'], report['currency'])}</font>", body)
          for s in summary]],
        colWidths=[width / len(summary)] * len(summary), rowHeights=[12, 26],
    )
    tile.setStyle(TableStyle([
        ("LINEABOVE", (0, 0), (-1, 0), 0.6, colors.HexColor(INK)),
        ("LINEBELOW", (0, 1), (-1, 1), 0.4, colors.HexColor(RULE)),
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    story += [tile, Paragraph("Findings", heading)]
    story += [Paragraph(f"— {_escape(f)}", body) for f in report["findings"]] or [Paragraph("No findings for this selection.", body)]

    png = _chart_png(report)
    if png:
        story.append(Paragraph(report["chart"]["title"], heading))
        w, h = ImageReader(png).getSize()
        png.seek(0)
        # The chart shares page 1 with the summary and findings, so its height is capped.
        draw_width = min(width, 220 * w / h)
        story.append(Image(png, width=draw_width, height=draw_width * h / w, hAlign="LEFT"))
    if report.get("note"):
        story += [Spacer(1, 4), Paragraph(_escape(report["note"]), label)]

    story.append(PageBreak())
    shown = report["rows"][:MAX_PDF_ROWS]
    caption = "Detail"
    if len(report["rows"]) > MAX_PDF_ROWS:
        caption += f" (first {MAX_PDF_ROWS} of {len(report['rows']):,} rows; the CSV export has all rows)"
    story.append(Paragraph(caption, heading))
    columns = report["columns"]
    numeric = [i for i, c in enumerate(columns) if c.get("format")]
    text_count = max(len(columns) - len(numeric), 1)
    numeric_width = 26 * mm if numeric else 0
    text_width = (width - numeric_width * len(numeric)) / text_count
    widths = [numeric_width if i in numeric else text_width for i in range(len(columns))]
    header = [Paragraph(f"<font name='Mono' color='{MUTED}'>{c['label'].upper()}</font>", cell) for c in columns]
    lines = [header]
    for row in shown:
        lines.append([
            format_value(row.get(c["key"]), c["format"], report["currency"]) if c.get("format")
            else Paragraph(_escape(str(row.get(c["key"]) or "")), cell)
            for c in columns
        ])
    table = Table(lines, colWidths=widths, repeatRows=1)
    table.setStyle(TableStyle([
        ("FONT", (0, 1), (-1, -1), "Mono", 7), ("ALIGN", (0, 1), (-1, -1), "LEFT"),
        *[("ALIGN", (i, 1), (i, -1), "RIGHT") for i in numeric],
        ("LINEBELOW", (0, 0), (-1, 0), 0.6, colors.HexColor(INK)),
        ("LINEBELOW", (0, 1), (-1, -1), 0.25, colors.HexColor(RULE)),
        ("LEFTPADDING", (0, 0), (-1, -1), 2), ("RIGHTPADDING", (0, 0), (-1, -1), 2),
        ("TOPPADDING", (0, 0), (-1, -1), 2.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    story.append(table)
    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return buffer.getvalue()


def _escape(text):
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
