"""
Indian number formatting, used for every monetary value the backend writes.

The Indian system groups the last three digits, then every two: 12,50,000 and 1,00,00,000.
1 lakh = 1,00,000 and 1 crore = 1,00,00,000. Python's format() cannot do this grouping.
"""


def group_indian(whole):
    digits = str(whole)
    if len(digits) <= 3:
        return digits
    last_three, rest = digits[-3:], digits[:-3]
    pairs = []
    while rest:
        pairs.insert(0, rest[-2:])
        rest = rest[:-2]
    return ",".join(pairs + [last_three])


def format_number(value, decimals=0):
    value = round(float(value), decimals)
    sign = "-" if value < 0 else ""
    whole = int(abs(value))
    text = sign + group_indian(whole)
    if decimals:
        fraction = f"{abs(value) - whole:.{decimals}f}"[1:]
        text += fraction
    return text


def format_inr(value, decimals=0):
    text = format_number(value, decimals)
    return f"-₹{text[1:]}" if text.startswith("-") else f"₹{text}"


def inr_short(value):
    """₹1.25 Cr, ₹8.75 L, or the full figure below a lakh."""
    amount = abs(float(value))
    sign = "-" if value < 0 else ""
    if amount >= 1_00_00_000:
        return f"{sign}₹{amount / 1_00_00_000:.2f} Cr"
    if amount >= 1_00_000:
        return f"{sign}₹{amount / 1_00_000:.2f} L"
    return format_inr(value)
