"""
Reference data used by the Transform stage: column aliases, geography regions,
non-merchandise codes and rule-based product categories.

The UCI file has no Category or Region column and its customers are anonymous numbers.
Those attributes are DERIVED here with explicit, inspectable rules. A CSV that does
contain them (see the optional roles below) keeps its own values.
"""
import re
import unicodedata

import pandas as pd

# role -> column names recognised automatically (compared lower-case, alphanumerics only)
ROLE_ALIASES = {
    "invoice": ["invoiceno", "invoice", "invoicenumber", "invoiceid", "orderid", "orderno", "ordernumber", "transactionid", "transactionno", "transaction", "billno"],
    "stock_code": ["stockcode", "productid", "productcode", "sku", "itemcode", "itemid"],
    "description": ["description", "productname", "product", "itemname", "item", "itemdescription", "productdescription"],
    "quantity": ["quantity", "qty", "units", "unitssold", "quantityordered"],
    "date": ["invoicedate", "orderdate", "date", "transactiondate", "purchasedate", "saledate", "datetime"],
    "unit_price": ["unitprice", "price", "priceeach", "unitcost", "price_per_unit", "priceperunit"],
    "customer_id": ["customerid", "customerno", "customernumber", "customer", "clientid", "customercode", "custid"],
    "customer_name": ["customername", "clientname", "fullname"],
    "city": ["city", "cityname", "town", "storecity", "storelocation", "location", "shipcity", "deliverycity", "billingcity", "customercity"],
    "state": ["state", "statename", "province", "stateut", "shipstate", "deliverystate", "billingstate", "customerstate"],
    "country": ["country", "countryname", "market", "nation"],
    "region": ["region", "territory", "salesregion"],
    "category": ["category", "productcategory", "productline", "department", "categoryname"],
    # A line total (quantity x price) for sources with no unit price, such as marketplace reports.
    "line_amount": ["amount", "lineamount", "linetotal", "totalamount", "salesamount", "grossamt", "grossamount",
                    "netamount", "orderamount", "totalprice", "sales"],
    # Order status: cancelled, returned and similar orders are not sales.
    "status": ["status", "orderstatus", "transactionstatus", "deliverystatus"],
}
REQUIRED_ROLES = ["invoice", "quantity", "date"]
ROLE_LABELS = {
    "invoice": "Invoice / transaction ID",
    "stock_code": "Product code",
    "description": "Product name",
    "quantity": "Quantity",
    "date": "Transaction date",
    "unit_price": "Unit price",
    "customer_id": "Customer ID",
    "customer_name": "Customer name",
    "city": "City",
    "state": "State",
    "country": "Country (used if no city)",
    "region": "Region",
    "category": "Category",
    "line_amount": "Line amount (if no unit price)",
    "status": "Order status",
}


def _norm(name):
    return re.sub(r"[^a-z0-9]", "", str(name).lower())


def detect_roles(columns):
    """Match CSV headers to warehouse roles, so other retail datasets work unchanged."""
    by_norm = {_norm(c): c for c in columns}
    roles = {}
    for role, aliases in ROLE_ALIASES.items():
        for alias in aliases:
            if _norm(alias) in by_norm:
                roles[role] = by_norm[_norm(alias)]
                break
    return roles


def missing_roles(roles):
    missing = [r for r in REQUIRED_ROLES if not roles.get(r)]
    if not roles.get("unit_price") and not roles.get("line_amount"):
        missing.append("unit_price or line_amount")
    if not roles.get("stock_code") and not roles.get("description"):
        missing.append("stock_code or description")
    return missing


COUNTRY_REGION = {
    "United Kingdom": "UK & Ireland", "UK": "UK & Ireland", "EIRE": "UK & Ireland", "Ireland": "UK & Ireland",
    "Channel Islands": "UK & Ireland",
    "France": "Western Europe", "Germany": "Western Europe", "Netherlands": "Western Europe",
    "Belgium": "Western Europe", "Switzerland": "Western Europe", "Austria": "Western Europe",
    "Luxembourg": "Western Europe",
    "Norway": "Northern Europe", "Sweden": "Northern Europe", "Finland": "Northern Europe",
    "Denmark": "Northern Europe", "Iceland": "Northern Europe",
    "Spain": "Southern Europe", "Portugal": "Southern Europe", "Italy": "Southern Europe",
    "Greece": "Southern Europe", "Malta": "Southern Europe", "Cyprus": "Southern Europe",
    "Poland": "Central & Eastern Europe", "Czech Republic": "Central & Eastern Europe",
    "Lithuania": "Central & Eastern Europe", "Hungary": "Central & Eastern Europe",
    "Romania": "Central & Eastern Europe", "European Community": "Central & Eastern Europe",
    "Israel": "Middle East", "Bahrain": "Middle East", "United Arab Emirates": "Middle East",
    "Lebanon": "Middle East", "Saudi Arabia": "Middle East",
    "Japan": "Asia-Pacific", "Australia": "Asia-Pacific", "Singapore": "Asia-Pacific",
    "Hong Kong": "Asia-Pacific", "India": "Asia-Pacific", "China": "Asia-Pacific", "New Zealand": "Asia-Pacific",
    "USA": "Americas", "United States": "Americas", "Canada": "Americas", "Brazil": "Americas", "Mexico": "Americas",
    "RSA": "Africa", "South Africa": "Africa", "Nigeria": "Africa", "Kenya": "Africa",
}

# Lines that are not goods: postage, fees, manual adjustments and vouchers. Unambiguous codes
# match alone. Very short codes could be real SKUs in another dataset, so those must also
# have a description that confirms it.
NON_MERCHANDISE_CODE = re.compile(r"^(POST|DOT|BANK CHARGES|AMAZONFEE|CRUK|PADS|ADJUST\d*|GIFT_.*|DCGS.*|TEST\d*)$", re.I)
SHORT_CODE = re.compile(r"^(M|D|C2|S|B)$", re.I)
NON_MERCHANDISE_TEXT = re.compile(r"MANUAL|DISCOUNT|SAMPLES?|ADJUST|CARRIAGE", re.I)


# Supermarket lines that are not merchandise: fuel (quantities in thousandths of a gallon),
# coupons and gift-card activations. Matched on the whole product name or department.
NON_MERCHANDISE_NAME = re.compile(r"^gasoline\b|^coupons?\b|gift cards? activ", re.I)
NON_MERCHANDISE_DEPARTMENT = re.compile(r"^(fuel|kiosk-gas|coupon)$", re.I)


def non_merchandise_mask(codes: pd.Series, descriptions: pd.Series, categories: pd.Series = None) -> pd.Series:
    certain = codes.str.fullmatch(NON_MERCHANDISE_CODE.pattern, case=False)
    short = codes.str.fullmatch(SHORT_CODE.pattern, case=False)
    confirmed = descriptions.str.contains(NON_MERCHANDISE_TEXT.pattern, case=False, regex=True)
    named = descriptions.str.contains(NON_MERCHANDISE_NAME.pattern, case=False, regex=True)
    mask = certain | (short & confirmed) | named
    if categories is not None:
        mask |= categories.str.fullmatch(NON_MERCHANDISE_DEPARTMENT.pattern, case=False)
    return mask.fillna(False)


# First matching rule wins, so seasonal and specific families precede broad ones.
CATEGORY_RULES = [
    ("Christmas & Seasonal", "CHRISTMAS|XMAS|ADVENT|SANTA|REINDEER|EASTER|HALLOWEEN|BAUBLE|NATIVITY|SNOWMAN|STOCKING|WREATH"),
    ("Candles & Fragrance", "CANDLE|CANDLEPOT|CANDLEHOLDER|T-LIGHT|TEA LIGHT|TLIGHT|INCENSE|OIL BURNER|FRAGRANCE|WAX|SCENT"),
    ("Garden & Outdoor", "GARDEN|PLANT|WATERING|FLOWER POT|SEED|PICNIC|PARASOL|BIRD FEEDER|BIRDHOUSE|TROWEL|DIBBER|SHED"),
    ("Toys & Games", "GLIDER|PAINT SET|BABUSHKA|COLOURING|TOY|GAME|FELTCRAFT|KNITTING|NAUGHTS|TIARA|FELT FARM|BIB|BABY|DOLL|DOLLY|DOMINO|PUZZLE|JIGSAW|SKITTLE|SOLDIER|TEDDY|SPACEBOY|PLAYHOUSE|BLOCK WORD|BOOM BOX|KIT|SKIPPING ROPE|MAGIC|HELICOPTER|NINJA|SPINNING TOP|BALLOON"),
    ("Jewellery & Accessories", "HAND WARMER|KEYRING|HAIRBAND|LUGGAGE TAG|FAN|NECKLACE|BRACELET|EARRING|RING|JEWEL|BROOCH|CHARM|BEAD|HAIR|SCARF|UMBRELLA|PURSE|WALLET|GLOVE|HAT|DIAMANTE|BANGLE|PENDANT|SHAWL|SLIPPER|HANDBAG|PASSPORT COVER|MIRROR|LIP GLOSS|SUNGLASSES|PONCHO|RAINCOAT"),
    ("Kitchen & Dining", "MUG|CUP|CAKESTAND|CAKE STAND|SNACK BOX|WINE|GOBLET|SQUEEZER|LOLLY|SAUCER|PLATE|BOWL|TEAPOT|CAKE|BAKING|BAKE|NAPKIN|JUG|LUNCH|SPOON|FORK|CUTLERY|KITCHEN|TEA TOWEL|APRON|JAR|RECIPE|BOTTLE|TRAY|DOILY|DOILIES|COASTER|GLASS|OVEN|PANTRY|BISCUIT|JAM|BREAD|TOAST|EGG|CHOPSTICK|PLACEMAT|STRAW|ICE LOLLY|SWEETHEART RECIPE|POPCORN|COOK|COOKIE|COFFEE|TEA SET|SUGAR|MILK|TUMBLER|CUTTER|BUNTING CAKE|DISH"),
    ("Stationery & Paper", "STATIONERY|CARD|GIFT WRAP|WRAP|PAPER|NOTEBOOK|NOTE ?PAD|PEN|PENCIL|STICKER|RIBBON|TAPE|JOURNAL|ENVELOPE|CHALK|DIARY|ERASER|RULER|CRAYON|CALENDAR|LABEL|STAMP|BOOK|TISSUE|POSTAGE STAMP|SKETCHBOOK|ORIGAMI|CONFETTI"),
    ("Bags & Storage", "BAG|BAGS|CHEST|STORAGE|BASKET|BOX|TIN|TRUG|BUCKET|CRATE|CASE|HOLDER|DRAWER|RACK|SHOPPER|TOTE|BACKPACK|LAUNDRY|PEG"),
    ("Home Decor", "MEMO ?BOARD|BLACK ?BOARD|PHOTOFRAME|DOORSIGN|MAGNET|WASHBAG|FLANNEL|SPONGE|BATH|BATHROOM|FRAME|SIGN|CUSHION|CLOCK|LANTERN|LIGHT|LAMP|DOORMAT|DOORSTOP|DOOR MAT|VASE|HOOK|WALL|ORNAMENT|DECORATION|HEART|THROW|QUILT|CABINET|SHELF|BIRD|BUNTING|GARLAND|CHANDELIER|HANGER|HANGING|KNOB|PLAQUE|BLANKET|FLOWER|CANVAS|PICTURE|BELL|STAND|WICKER|MAT|CURTAIN|DRESSER|TILE|WINDMILL|CHIME|ROSE|STAR|POMPOM|TABLE|CHAIR|STOOL|HOME"),
]
_COMPILED_RULES = [(name, re.compile(rf"\b(?:{pattern})(?:E?S)?\b")) for name, pattern in CATEGORY_RULES]


def categorize(description):
    upper = str(description).upper()
    for name, pattern in _COMPILED_RULES:
        if pattern.search(upper):
            return name
    return "Other Gifts"


def categorize_series(descriptions: pd.Series) -> pd.Series:
    """Apply the rules once per distinct description, which is far faster than per row."""
    lookup = {d: categorize(d) for d in descriptions.dropna().unique()}
    return descriptions.map(lookup)


# Used when an Indian dataset has a city column but no state or region.
INDIAN_CITIES = {
    "Mumbai": ("Maharashtra", "West"), "Pune": ("Maharashtra", "West"), "Nagpur": ("Maharashtra", "Central"),
    "Nashik": ("Maharashtra", "West"), "Thane": ("Maharashtra", "West"), "Delhi": ("Delhi", "North"),
    "New Delhi": ("Delhi", "North"), "Gurugram": ("Haryana", "North"), "Noida": ("Uttar Pradesh", "North"),
    "Lucknow": ("Uttar Pradesh", "North"), "Kanpur": ("Uttar Pradesh", "North"), "Jaipur": ("Rajasthan", "North"),
    "Chandigarh": ("Chandigarh", "North"), "Ludhiana": ("Punjab", "North"), "Bengaluru": ("Karnataka", "South"),
    "Bangalore": ("Karnataka", "South"), "Mysuru": ("Karnataka", "South"), "Hyderabad": ("Telangana", "South"),
    "Chennai": ("Tamil Nadu", "South"), "Coimbatore": ("Tamil Nadu", "South"), "Kochi": ("Kerala", "South"),
    "Thiruvananthapuram": ("Kerala", "South"), "Visakhapatnam": ("Andhra Pradesh", "South"),
    "Kolkata": ("West Bengal", "East"), "Bhubaneswar": ("Odisha", "East"), "Patna": ("Bihar", "East"),
    "Guwahati": ("Assam", "North East"), "Ahmedabad": ("Gujarat", "West"), "Surat": ("Gujarat", "West"),
    "Vadodara": ("Gujarat", "West"), "Indore": ("Madhya Pradesh", "Central"), "Bhopal": ("Madhya Pradesh", "Central"),
    "Raipur": ("Chhattisgarh", "Central"),
}


# Statuses meaning the goods were not sold: cancelled, returned, rejected, lost or damaged.
NOT_SOLD_STATUS = re.compile(r"cancel|return|reject|refund|lost|damage", re.I)

# Indian states and union territories, with RetailIQ's five regions plus North East.
STATE_REGION = {
    "Delhi": "North", "Haryana": "North", "Punjab": "North", "Himachal Pradesh": "North", "Jammu & Kashmir": "North",
    "Ladakh": "North", "Uttar Pradesh": "North", "Uttarakhand": "North", "Rajasthan": "North", "Chandigarh": "North",
    "Maharashtra": "West", "Gujarat": "West", "Goa": "West", "Dadra & Nagar Haveli and Daman & Diu": "West",
    "Karnataka": "South", "Kerala": "South", "Tamil Nadu": "South", "Telangana": "South", "Andhra Pradesh": "South",
    "Puducherry": "South", "Lakshadweep": "South", "Andaman & Nicobar Islands": "South",
    "West Bengal": "East", "Odisha": "East", "Bihar": "East", "Jharkhand": "East",
    "Assam": "North East", "Arunachal Pradesh": "North East", "Manipur": "North East", "Meghalaya": "North East",
    "Mizoram": "North East", "Nagaland": "North East", "Sikkim": "North East", "Tripura": "North East",
    "Madhya Pradesh": "Central", "Chhattisgarh": "Central",
}
# Spellings and abbreviations seen in real exports, compared on letters only.
_STATE_ALIASES = {
    "ORISSA": "Odisha", "RAJSTHAN": "Rajasthan", "RAJSHTHAN": "Rajasthan", "RJ": "Rajasthan", "PB": "Punjab",
    "PUNJABMOHALIZIRAKPUR": "Punjab", "NL": "Nagaland", "AR": "Arunachal Pradesh", "NEWDELHI": "Delhi", "DL": "Delhi",
    "NCTOFDELHI": "Delhi", "PONDICHERRY": "Puducherry", "DADRAANDNAGAR": "Dadra & Nagar Haveli and Daman & Diu",
    "DADRAANDNAGARHAVELI": "Dadra & Nagar Haveli and Daman & Diu", "DAMANANDDIU": "Dadra & Nagar Haveli and Daman & Diu",
    "ANDAMANNICOBAR": "Andaman & Nicobar Islands", "ANDAMANANDNICOBARISLANDS": "Andaman & Nicobar Islands",
    "JAMMUANDKASHMIR": "Jammu & Kashmir", "JK": "Jammu & Kashmir", "UTTARANCHAL": "Uttarakhand", "UK": "Uttarakhand",
    "MH": "Maharashtra", "KA": "Karnataka", "TN": "Tamil Nadu", "UP": "Uttar Pradesh", "GJ": "Gujarat", "WB": "West Bengal",
    "TS": "Telangana", "AP": "Andhra Pradesh", "KL": "Kerala", "HR": "Haryana", "MP": "Madhya Pradesh", "OR": "Odisha",
    "OD": "Odisha", "CG": "Chhattisgarh", "HP": "Himachal Pradesh", "BR": "Bihar", "JH": "Jharkhand", "GA": "Goa",
    "APO": "Army Post Office",
}
_STATE_BY_LETTERS = {re.sub(r"[^A-Z]", "", s.upper()): s for s in STATE_REGION}
_STATE_BY_LETTERS.update({k: v for k, v in _STATE_ALIASES.items()})
_STATE_BY_LETTERS["ANDAMANNICOBARISLANDS"] = "Andaman & Nicobar Islands"
_STATE_BY_LETTERS["DADRANAGARHAVELIANDDAMANDIU"] = "Dadra & Nagar Haveli and Daman & Diu"

# Old and alternative city names, merged so one city is one member of the dimension.
CITY_ALIASES = {"Bangalore": "Bengaluru", "Bangaluru": "Bengaluru", "Bengaluru Urban": "Bengaluru", "Gurgaon": "Gurugram",
                "Bombay": "Mumbai", "Calcutta": "Kolkata", "Madras": "Chennai", "Poona": "Pune", "Mysore": "Mysuru",
                "Trivandrum": "Thiruvananthapuram", "लखनऊ": "Lucknow", "Cochin": "Kochi", "Vizag": "Visakhapatnam", "Baroda": "Vadodara"}


def clean_state(name):
    """Canonical state name for Indian spellings; other values are tidied but kept."""
    if not isinstance(name, str) or not name.strip():
        return None
    letters = re.sub(r"[^A-Z]", "", name.upper())
    if letters in _STATE_BY_LETTERS:
        return _STATE_BY_LETTERS[letters]
    return re.sub(r"\s+", " ", name).strip(" .,").title()


def clean_city(name):
    if not isinstance(name, str) or not name.strip():
        return None
    # Accents are dropped (Talegàon and Talegaon are one town), then spacing and case are tidied.
    plain = "".join(c for c in unicodedata.normalize("NFKD", name) if not unicodedata.combining(c))
    tidy = re.sub(r"\s+", " ", plain).strip(" .,;-").title()
    return CITY_ALIASES.get(tidy, tidy) or None


def geography_for(place):
    """(state, region) for a city, or for a country when the dataset is not Indian."""
    if place in INDIAN_CITIES:
        return INDIAN_CITIES[place]
    if place == "Unspecified":
        return "Unspecified", "Unspecified"
    # Outside India the "city" holds the country name, so state repeats it.
    return place, COUNTRY_REGION.get(place, "Other")
