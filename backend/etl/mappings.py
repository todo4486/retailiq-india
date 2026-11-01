"""
Reference data used by the Transform stage: column aliases, geography regions,
non-merchandise codes and rule-based product categories.

The UCI file has no Category or Region column and its customers are anonymous numbers.
Those attributes are DERIVED here with explicit, inspectable rules. A CSV that does
contain them (see the optional roles below) keeps its own values.
"""
import re

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
    "city": ["city", "cityname", "town", "storecity", "storelocation", "location"],
    "state": ["state", "statename", "province", "stateut"],
    "country": ["country", "countryname", "market", "nation"],
    "region": ["region", "territory", "salesregion"],
    "category": ["category", "productcategory", "productline", "department", "categoryname"],
}
REQUIRED_ROLES = ["invoice", "quantity", "date", "unit_price"]
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


def non_merchandise_mask(codes: pd.Series, descriptions: pd.Series) -> pd.Series:
    certain = codes.str.fullmatch(NON_MERCHANDISE_CODE.pattern, case=False)
    short = codes.str.fullmatch(SHORT_CODE.pattern, case=False)
    confirmed = descriptions.str.contains(NON_MERCHANDISE_TEXT.pattern, case=False, regex=True)
    return certain | (short & confirmed)


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


def geography_for(place):
    """(state, region) for a city, or for a country when the dataset is not Indian."""
    if place in INDIAN_CITIES:
        return INDIAN_CITIES[place]
    if place == "Unspecified":
        return "Unspecified", "Unspecified"
    # Outside India the "city" holds the country name, so state repeats it.
    return place, COUNTRY_REGION.get(place, "Other")
