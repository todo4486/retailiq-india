"""
Generate the SYNTHETIC Indian retail demo dataset: data/retailiq_india_synthetic.csv

This is simulated data. It does not represent the sales of any real company. It is built
from a fixed random seed, so every run produces the same file.

How the simulation works, so its patterns can be explained:
  * Customers have a hidden behaviour type (frequent, regular, new, lapsing, one-off).
    K-Means never sees this type: it has to rediscover the groups from RFM values alone.
  * Each invoice is a "shopping mission" such as monthly staples or a phone purchase, and each
    mission lists products with inclusion probabilities. Those are the associations Apriori
    has to find.
  * Mission choice depends on the month (Diwali, summer, monsoon, winter), which is the
    seasonality the Signals section detects.
  * The raw file is deliberately dirty, so the ETL has real work to do: duplicates, walk-in
    customers with no ID, mixed date formats, prices like "Rs. 1,299", credit notes, invalid rows.

Usage: python scripts/generate_india_data.py <output.csv>
"""
import csv
import datetime as dt
import random
import sys

SEED = 20260930
START = dt.date(2024, 1, 1)
END = dt.date(2026, 9, 30)
CUSTOMERS = 6000

CITIES = {  # city: (state, region, share of customers)
    "Mumbai": ("Maharashtra", "West", 0.18),
    "Delhi": ("Delhi", "North", 0.16),
    "Bengaluru": ("Karnataka", "South", 0.14),
    "Hyderabad": ("Telangana", "South", 0.09),
    "Chennai": ("Tamil Nadu", "South", 0.08),
    "Pune": ("Maharashtra", "West", 0.08),
    "Kolkata": ("West Bengal", "East", 0.07),
    "Ahmedabad": ("Gujarat", "West", 0.06),
    "Jaipur": ("Rajasthan", "North", 0.04),
    "Lucknow": ("Uttar Pradesh", "North", 0.04),
    "Surat": ("Gujarat", "West", 0.03),
    "Nagpur": ("Maharashtra", "Central", 0.03),
}

FIRST_NAMES = """Aarav Vivaan Aditya Arjun Rohan Karan Rahul Amit Sandeep Vikram Nikhil Siddharth Harsh Pranav Manish
Rajesh Suresh Ramesh Anil Deepak Gaurav Varun Kunal Tarun Abhishek Imran Farhan Joseph Thomas Gurpreet Harpreet Venkatesh
Karthik Srinivas Naveen Arvind Subhash Debashish Sourav Ananya Diya Isha Kavya Priya Neha Pooja Riya Sneha Shreya Meera
Lakshmi Divya Swati Nandini Aditi Tanvi Anjali Rekha Sunita Kiran Fatima Ayesha Mary Simran Jaspreet Padma Revathi Bhavana
Shalini Madhuri Payal Moumita Rupali Ishita""".split()
LAST_NAMES = """Sharma Verma Gupta Agarwal Singh Yadav Mishra Pandey Tiwari Joshi Kulkarni Deshpande Patil Jadhav Shinde
Patel Shah Mehta Desai Parmar Iyer Iyengar Nair Menon Pillai Reddy Rao Naidu Krishnan Subramanian Banerjee Chatterjee
Mukherjee Das Ghosh Sen Khan Ansari Sheikh Fernandes DSouza Kaur Gill Chauhan Rathore Meena""".split()

# code: (name, category, price in rupees)
PRODUCTS = {
    "GR01": ("Whole Wheat Atta 5 kg", "Grocery", 285), "GR02": ("Basmati Rice 5 kg", "Grocery", 620),
    "GR03": ("Sona Masoori Rice 10 kg", "Grocery", 690), "GR04": ("Refined Sunflower Oil 1 L", "Grocery", 165),
    "GR05": ("Mustard Oil 1 L", "Grocery", 180), "GR06": ("Toor Dal 1 kg", "Grocery", 170),
    "GR07": ("Moong Dal 1 kg", "Grocery", 145), "GR08": ("Sugar 1 kg", "Grocery", 48),
    "GR09": ("Iodised Salt 1 kg", "Grocery", 28), "GR10": ("Tea Leaves 500 g", "Grocery", 265),
    "GR11": ("Toned Milk 1 L", "Grocery", 62), "GR12": ("Curd 400 g", "Grocery", 40),
    "GR13": ("Paneer 200 g", "Grocery", 90), "GR14": ("Brown Bread 400 g", "Grocery", 50),
    "GR15": ("Farm Eggs 12 pack", "Grocery", 90), "GR16": ("Desi Ghee 1 L", "Grocery", 640),
    "GR17": ("Dry Fruit Mix 500 g", "Grocery", 520), "GR18": ("Mithai Gift Box 1 kg", "Grocery", 680),
    "FM01": ("Glucose Biscuits 800 g", "FMCG", 85), "FM02": ("Cream Biscuits 300 g", "FMCG", 60),
    "FM03": ("Aloo Bhujia Namkeen 400 g", "FMCG", 110), "FM04": ("Instant Noodles 12 pack", "FMCG", 168),
    "FM05": ("Tomato Ketchup 1 kg", "FMCG", 145), "FM06": ("Mango Drink 1.2 L", "FMCG", 75),
    "FM07": ("Cola 2 L", "FMCG", 95), "FM08": ("Detergent Powder 4 kg", "FMCG", 460),
    "FM09": ("Dishwash Liquid 750 ml", "FMCG", 135), "FM10": ("Floor Cleaner 1 L", "FMCG", 180),
    "FM11": ("Toilet Cleaner 1 L", "FMCG", 125), "FM12": ("Mosquito Repellent Refill", "FMCG", 85),
    "PC01": ("Anti-Dandruff Shampoo 650 ml", "Personal Care", 480), "PC02": ("Hair Conditioner 340 ml", "Personal Care", 320),
    "PC03": ("Bathing Soap 4 pack", "Personal Care", 170), "PC04": ("Toothpaste 300 g", "Personal Care", 135),
    "PC05": ("Toothbrush 4 pack", "Personal Care", 140), "PC06": ("Face Wash 150 ml", "Personal Care", 230),
    "PC07": ("Sunscreen SPF 50", "Personal Care", 549), "PC08": ("Moisturising Lotion 400 ml", "Personal Care", 365),
    "PC09": ("Deodorant 150 ml", "Personal Care", 220), "PC10": ("Coconut Hair Oil 500 ml", "Personal Care", 210),
    "PH01": ("Paracetamol 650 mg Strip", "Pharmaceuticals", 32), "PH02": ("ORS Sachets 10 pack", "Pharmaceuticals", 210),
    "PH03": ("Cough Syrup 100 ml", "Pharmaceuticals", 125), "PH04": ("Antiseptic Liquid 500 ml", "Pharmaceuticals", 240),
    "PH05": ("Vitamin C Tablets 60", "Pharmaceuticals", 390), "PH06": ("Digital Thermometer", "Pharmaceuticals", 275),
    "PH07": ("Digital BP Monitor", "Pharmaceuticals", 1899), "PH08": ("Glucometer Kit", "Pharmaceuticals", 1299),
    "EL01": ("Smartphone 5G 128 GB", "Electronics", 18999), "EL02": ("Smartphone Pro 256 GB", "Electronics", 54999),
    "EL03": ("Budget Smartphone 64 GB", "Electronics", 8999), "EL04": ("Phone Back Cover", "Electronics", 399),
    "EL05": ("Tempered Glass Guard", "Electronics", 249), "EL06": ("Wireless Earbuds", "Electronics", 1999),
    "EL07": ("Fast Charger 33 W", "Electronics", 899), "EL08": ("Thin Laptop 14 inch i5", "Electronics", 58990),
    "EL09": ("Student Laptop 15 inch", "Electronics", 38990), "EL10": ("Wireless Mouse", "Electronics", 699),
    "EL11": ("Laptop Backpack", "Electronics", 1299), "EL12": ("Smart TV 43 inch", "Electronics", 27990),
    "EL13": ("Smart Watch", "Electronics", 2999), "EL14": ("Bluetooth Speaker", "Electronics", 2499),
    "HA01": ("Mixer Grinder 750 W", "Home Appliances", 3499), "HA02": ("Induction Cooktop", "Home Appliances", 2299),
    "HA03": ("Water Purifier RO", "Home Appliances", 12499), "HA04": ("Ceiling Fan 1200 mm", "Home Appliances", 2299),
    "HA05": ("Split AC 1.5 Ton", "Home Appliances", 36990), "HA06": ("Air Cooler 40 L", "Home Appliances", 8499),
    "HA07": ("Voltage Stabiliser", "Home Appliances", 2499), "HA08": ("Front Load Washer 7 kg", "Home Appliances", 29990),
    "HA09": ("Refrigerator 250 L", "Home Appliances", 26990), "HA10": ("Room Heater", "Home Appliances", 2199),
    "HA11": ("Electric Kettle", "Home Appliances", 899), "HA12": ("LED Diwali Lights", "Home Appliances", 349),
    "FA01": ("Cotton Formal Shirt", "Fashion", 1299), "FA02": ("Slim Fit Trousers", "Fashion", 1599),
    "FA03": ("Leather Belt", "Fashion", 699), "FA04": ("Denim Jeans", "Fashion", 1899),
    "FA05": ("Graphic T-Shirt", "Fashion", 599), "FA06": ("Women's Kurta", "Fashion", 1199),
    "FA07": ("Printed Dupatta", "Fashion", 549), "FA08": ("Silk Saree", "Fashion", 4499),
    "FA09": ("Men's Kurta Set", "Fashion", 2499), "FA10": ("Running Shoes", "Fashion", 2999),
    "FA11": ("Cotton Socks 3 pack", "Fashion", 299), "FA12": ("Leather Formal Shoes", "Fashion", 3299),
    "FA13": ("Kolhapuri Sandals", "Fashion", 899), "FA14": ("Woollen Sweater", "Fashion", 1799),
    "FA15": ("Monsoon Umbrella", "Fashion", 449), "FA16": ("Rain Jacket", "Fashion", 1299),
}

# mission: (base weight, [(product, probability it joins the basket)])
MISSIONS = {
    "monthly_staples": (20, [("GR01", .85), ("GR04", .72), ("GR06", .6), ("GR02", .45), ("GR08", .55), ("GR09", .35), ("GR10", .4), ("GR07", .3), ("FM08", .2)]),
    "south_staples": (5, [("GR03", .9), ("GR04", .55), ("GR06", .6), ("PC10", .35), ("GR10", .4), ("GR08", .4)]),
    "daily_fresh": (24, [("GR11", .95), ("GR14", .62), ("GR15", .5), ("GR12", .45), ("GR13", .25), ("FM01", .2)]),
    "chai_snacks": (12, [("GR10", .7), ("FM01", .78), ("FM02", .35), ("FM03", .5), ("GR08", .4), ("FM04", .3)]),
    "home_care": (8, [("FM08", .75), ("FM09", .7), ("FM10", .55), ("FM11", .5), ("FM12", .25)]),
    "bath_care": (9, [("PC01", .7), ("PC02", .52), ("PC03", .6), ("PC04", .5), ("PC05", .3), ("PC10", .2)]),
    "skin_care": (4, [("PC06", .7), ("PC08", .55), ("PC07", .45), ("PC09", .4)]),
    "pharmacy": (6, [("PH01", .7), ("PH03", .4), ("PH04", .35), ("PH05", .35), ("PH02", .3), ("PH06", .15)]),
    "health_devices": (.7, [("PH07", .6), ("PH08", .55), ("PH05", .3)]),
    "phone_mid": (2.2, [("EL01", 1), ("EL04", .68), ("EL05", .62), ("EL07", .35), ("EL06", .3)]),
    "phone_budget": (1.6, [("EL03", 1), ("EL04", .6), ("EL05", .55)]),
    "phone_pro": (.5, [("EL02", 1), ("EL04", .7), ("EL05", .65), ("EL06", .55), ("EL13", .3)]),
    "laptop": (.8, [("EL08", .45), ("EL09", .6), ("EL10", .7), ("EL11", .65)]),
    "audio_gadgets": (1.6, [("EL06", .6), ("EL13", .35), ("EL14", .4), ("EL07", .2)]),
    "tv": (.6, [("EL12", 1), ("HA07", .35), ("EL14", .2)]),
    "kitchen_appliance": (1.4, [("HA01", .55), ("HA02", .35), ("HA11", .4), ("HA03", .12)]),
    "large_appliance": (.45, [("HA08", .5), ("HA09", .55), ("HA07", .55)]),
    "office_wear": (4.5, [("FA01", .8), ("FA02", .62), ("FA03", .32), ("FA12", .18)]),
    "casual_wear": (4.5, [("FA04", .65), ("FA05", .8), ("FA11", .2), ("FA10", .15)]),
    "ethnic_wear": (3, [("FA06", .65), ("FA07", .6), ("FA13", .3), ("FA08", .15)]),
    "footwear": (2.5, [("FA10", .7), ("FA11", .66), ("FA13", .2)]),
    "festive": (0, [("GR17", .7), ("GR18", .72), ("GR16", .5), ("HA12", .6), ("FA09", .25), ("FA08", .2)]),
    "summer": (0, [("FM06", .7), ("FM07", .65), ("PC07", .4), ("PH02", .3)]),
    "summer_cooling": (0, [("HA05", .4), ("HA06", .55), ("HA04", .4), ("HA07", .3)]),
    "monsoon": (0, [("FA15", .75), ("FA16", .45), ("PH03", .35), ("PH01", .4), ("FM12", .45)]),
    "winter": (0, [("FA14", .8), ("HA10", .3), ("PC08", .4)]),
}

# mission: {month: extra or multiplied weight}. Festive demand follows Diwali (Oct to Nov).
SEASON_MULTIPLY = {
    "phone_mid": {10: 2.6, 11: 2.2}, "phone_budget": {10: 2.4, 11: 2}, "phone_pro": {9: 1.6, 10: 3, 11: 2},
    "laptop": {6: 1.7, 7: 1.8, 10: 2.2}, "tv": {10: 3, 11: 2.4}, "large_appliance": {10: 2.8, 11: 2.2},
    "kitchen_appliance": {10: 2, 11: 1.8}, "audio_gadgets": {10: 2, 11: 1.8},
    "ethnic_wear": {10: 2.8, 11: 2.4, 2: 1.4, 3: 1.3}, "casual_wear": {10: 1.5, 11: 1.4}, "office_wear": {10: 1.4},
    "pharmacy": {7: 1.7, 8: 1.8, 9: 1.5, 12: 1.3, 1: 1.3}, "skin_care": {4: 1.5, 5: 1.5, 12: 1.2},
}
SEASON_ADD = {
    "festive": {10: 12, 11: 10, 9: 1}, "summer": {3: 3, 4: 9, 5: 11, 6: 7},
    "summer_cooling": {3: 1, 4: 3.2, 5: 3.8, 6: 2}, "monsoon": {6: 3, 7: 8, 8: 8, 9: 4}, "winter": {11: 1.5, 12: 6, 1: 6, 2: 1},
}

# behaviour: (share, orders per month, start window, end window as fractions of the period).
# An end beyond 1 means the customer is still active when the data stops.
BEHAVIOURS = {
    "frequent": (.08, 3.4, (0, .15), (1.03, 1.08)),
    "regular": (.22, 1.15, (0, .45), (.9, 1.06)),
    "new": (.2, .75, (.8, .97), (1.03, 1.08)),
    "lapsing": (.25, .8, (0, .35), (.45, .75)),
    "one_off": (.25, .1, (0, .9), None),
}


def weighted_month(rng, month):
    names, weights = [], []
    for name, (base, _items) in MISSIONS.items():
        weight = base * SEASON_MULTIPLY.get(name, {}).get(month, 1) + SEASON_ADD.get(name, {}).get(month, 0)
        if weight > 0:
            names.append(name)
            weights.append(weight)
    return rng.choices(names, weights)[0]


def quantity_for(rng, category):
    if category in ("Electronics", "Home Appliances"):
        return 1
    if category == "Fashion":
        return rng.choices([1, 2], [.82, .18])[0]
    return rng.choices([1, 2, 3, 4], [.55, .28, .12, .05])[0]


def format_date(rng, day):
    # Most rows are ISO. Others use the day-first formats common in Indian exports.
    roll = rng.random()
    if roll < .78:
        return day.isoformat()
    return day.strftime("%d-%m-%Y") if roll < .92 else day.strftime("%d/%m/%Y")


def format_price(rng, price):
    roll = rng.random()
    if roll < .96:
        return f"{price:.2f}"
    return f"Rs. {price:,.2f}" if roll < .98 else f"₹{price:,.2f}"


def build_customers(rng):
    city_names = list(CITIES)
    city_weights = [CITIES[c][2] for c in city_names]
    kinds = list(BEHAVIOURS)
    kind_weights = [BEHAVIOURS[k][0] for k in kinds]
    customers = []
    for number in range(1, CUSTOMERS + 1):
        customers.append({
            "id": f"CUST-{number:05d}",
            "name": f"{rng.choice(FIRST_NAMES)} {rng.choice(LAST_NAMES)}",
            "city": rng.choices(city_names, city_weights)[0],
            "kind": rng.choices(kinds, kind_weights)[0],
        })
    return customers


def main(output):
    rng = random.Random(SEED)
    span = (END - START).days
    months = span / 30.4
    invoice = 100000
    lines = []

    for customer in build_customers(rng):
        _share, rate, start_window, end_window = BEHAVIOURS[customer["kind"]]
        start = rng.uniform(*start_window) * span
        end = rng.uniform(*end_window) * span if end_window else None
        if customer["kind"] == "one_off":
            count = rng.choices([1, 2], [.8, .2])[0]
            days = [start + rng.uniform(0, 45) for _ in range(count)]
        else:
            active = max(end - start, 20)
            count = max(1, int(rng.gauss(rate * active / 30.4, rate * active / 30.4 * .28)))
            days = [start + rng.uniform(0, active) for _ in range(count)]
        state, region, _ = CITIES[customer["city"]]
        for offset in days:
            # The simulated business grows: earlier invoices are thinned out, so later years are bigger.
            if offset > span or rng.random() > .55 + .45 * offset / span:
                continue
            day = START + dt.timedelta(days=int(offset))
            mission = weighted_month(rng, day.month)
            items = [code for code, chance in MISSIONS[mission][1] if rng.random() < chance]
            if not items:
                items = [MISSIONS[mission][1][0][0]]
            # Some basket noise, so that associations are not unrealistically clean.
            if rng.random() < .18:
                items.append(rng.choice(list(PRODUCTS)))
            invoice += 1
            channel = rng.choices(["In-store", "Online"], [.62, .38])[0]
            # About 6% annual price inflation, and small differences between cities.
            inflation = 1.06 ** ((day - START).days / 365)
            walk_in = rng.random() < .06
            date_text = format_date(rng, day)
            for code in dict.fromkeys(items):
                name, category, price = PRODUCTS[code]
                unit = round(price * inflation * rng.uniform(.97, 1.03), 0)
                lines.append([
                    f"RIQ-{invoice}", date_text, "" if walk_in else customer["id"], "" if walk_in else customer["name"],
                    customer["city"], state, region, code, name, category, quantity_for(rng, category), format_price(rng, unit), channel,
                ])

    # Dirty the raw file. Every one of these is something Transform must deal with.
    dirty = []
    for line in lines:
        dirty.append(line)
        roll = rng.random()
        if roll < .015:  # exact duplicate export
            dirty.append(list(line))
        elif roll < .023 and line[2]:  # credit note reversing the whole line
            credit = list(line)
            credit[0] = "CN-" + line[0]
            credit[10] = -int(line[10])
            dirty.append(credit)
    for line in rng.sample(dirty, int(len(dirty) * .002)):
        line[11] = "0.00"  # free or mis-keyed price
    for line in rng.sample(dirty, int(len(dirty) * .001)):
        line[1] = rng.choice(["not recorded", "32/13/2025", ""])
    for line in rng.sample(dirty, int(len(dirty) * .004)):
        line[8] = ""  # product name lost: recoverable from the code
    for line in rng.sample(dirty, int(len(dirty) * .0005)):
        line[10] = "abc"  # non-numeric quantity
    rng.shuffle(dirty)
    dirty.sort(key=lambda row: row[0].replace("CN-", ""))

    with open(output, "w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(["Invoice_No", "Invoice_Date", "Customer_ID", "Customer_Name", "City", "State", "Region",
                         "Product_Code", "Product_Name", "Category", "Quantity", "Unit_Price", "Channel"])
        writer.writerows(dirty)
    print(f"{len(dirty)} rows written to {output}")


if __name__ == "__main__":
    main(sys.argv[1])
