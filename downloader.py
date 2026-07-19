"""
淘宝双十二大促精细化运营数仓生成器
数据时间窗口: 2017-11-25 至 2017-12-03
包含: pv(点击浏览) / cart(加购) / fav(收藏) / buy(购买) 行为流水
数据量: ~500,000 行
包含强关联（Apriori）品类对生成和复购留存衰减链生成
"""
import os, random, math
import numpy as np
import pandas as pd
from datetime import datetime, timedelta

DATA_PATH = os.path.join(os.path.dirname(__file__), "data")
OUTPUT_FILE = os.path.join(DATA_PATH, "user_behavior.csv")

# ─── 品类定义 ──────────────────────────────────────────────────────────────
CATEGORIES = {
    1001: "手机数码",    1002: "电脑办公",    1003: "家用电器",
    2001: "服装鞋包",    2002: "运动户外",    2003: "内衣配饰",
    3001: "美妆护肤",    3002: "个人护理",    3003: "香水彩妆",
    4001: "食品饮料",    4002: "生鲜水果",    4003: "零食坚果",
    5001: "家居家装",    5002: "厨房卫浴",    5003: "家具灯具",
    6001: "玩具乐器",    6002: "图书文具",    6003: "宠物生活",
    7001: "汽车用品",    7002: "工具五金",
}

CATEGORY_IDS = list(CATEGORIES.keys())

CATEGORY_WEIGHTS = {
    1001: 0.12, 1002: 0.06, 1003: 0.07,
    2001: 0.13, 2002: 0.06, 2003: 0.05,
    3001: 0.11, 3002: 0.05, 3003: 0.04,
    4001: 0.07, 4002: 0.04, 4003: 0.05,
    5001: 0.05, 5002: 0.03, 5003: 0.03,
    6001: 0.03, 6002: 0.02, 6003: 0.02,
    7001: 0.01, 7002: 0.01,
}

CATEGORY_CONVERSION = {
    1001: 0.035, 1002: 0.028, 1003: 0.030,
    2001: 0.045, 2002: 0.040, 2003: 0.042,
    3001: 0.052, 3002: 0.048, 3003: 0.038,
    4001: 0.060, 4002: 0.055, 4003: 0.058,
    5001: 0.025, 5002: 0.022, 5003: 0.020,
    6001: 0.032, 6002: 0.030, 6003: 0.035,
    7001: 0.015, 7002: 0.012,
}

# ─── 强关联品类搭配对设计 (Apriori Core) ───────────────────────────────────
# 购买了 key 中的品类，有很高概率同时在同一天购买 value 中的关联品类
ASSOCIATION_PAIRS = {
    1001: [1002, 1003],  # 手机数码 -> 电脑办公, 家用电器
    2001: [2003, 3001],  # 服装鞋包 -> 内衣配饰, 美妆护肤
    3001: [3003, 3002],  # 美妆护肤 -> 香水彩妆, 个人护理
    4001: [4003, 4002],  # 食品饮料 -> 零食坚果, 生鲜水果
    5001: [5003, 5002],  # 家居家装 -> 家具灯具, 厨房卫浴
}

# ─── 时间窗口定义 ───────────────────────────────────────────────────────────
START_DATE = datetime(2017, 11, 25)
END_DATE   = datetime(2017, 12, 3, 23, 59, 59)

DAILY_WEIGHTS = {
    "2017-11-25": 0.055,
    "2017-11-26": 0.058,
    "2017-11-27": 0.062,
    "2017-11-28": 0.068,
    "2017-11-29": 0.075,
    "2017-11-30": 0.088,
    "2017-12-01": 0.095,
    "2017-12-02": 0.110,
    "2017-12-03": 0.389,
}

HOURLY_WEIGHTS = [
    0.005, 0.003, 0.002, 0.002, 0.002, 0.003,
    0.010, 0.022, 0.035, 0.045, 0.050, 0.055,
    0.060, 0.055, 0.048, 0.045, 0.042, 0.048,
    0.055, 0.065, 0.075, 0.080, 0.085, 0.053,
]

DOUBLE12_HOURLY = [
    0.070, 0.045, 0.020, 0.012, 0.008, 0.008,
    0.015, 0.025, 0.035, 0.040, 0.042, 0.045,
    0.048, 0.044, 0.040, 0.038, 0.038, 0.042,
    0.050, 0.055, 0.060, 0.065, 0.078, 0.122,
]

def generate_timestamp(date_str: str, hourly_w: list) -> datetime:
    hour = random.choices(range(24), weights=hourly_w, k=1)[0]
    minute = random.randint(0, 59)
    second = random.randint(0, 59)
    d = datetime.strptime(date_str, "%Y-%m-%d")
    return d.replace(hour=hour, minute=minute, second=second)


def build_dataset(n_total: int = 500_000) -> pd.DataFrame:
    print(f"[INFO] Generating {n_total:,} rows of Taobao Double 12 dataset...")
    os.makedirs(DATA_PATH, exist_ok=True)

    # 减小用户池，提高碰撞几率，产生更高密度的用户共购画像
    n_users = 8_000 
    n_items = 20_000

    user_ids  = list(range(100000, 100000 + n_users))
    item_ids  = list(range(200000, 200000 + n_items))

    # 计算各日期分配的行数
    dates = list(DAILY_WEIGHTS.keys())
    day_counts = {}
    for d, w in DAILY_WEIGHTS.items():
        day_counts[d] = max(1, round(n_total * w))

    total_assigned = sum(day_counts.values())
    diff = n_total - total_assigned
    day_counts[dates[-1]] += diff

    records = []

    cat_weights_list = [CATEGORY_WEIGHTS[c] for c in CATEGORY_IDS]
    buy_cat_w = [CATEGORY_WEIGHTS[c] * CATEGORY_CONVERSION[c] for c in CATEGORY_IDS]
    total_buy_w = sum(buy_cat_w)
    buy_cat_w = [w / total_buy_w for w in buy_cat_w]

    for date_str in dates:
        n_day = day_counts[date_str]
        is_d12 = (date_str == "2017-12-03")
        hourly_w = DOUBLE12_HOURLY if is_d12 else HOURLY_WEIGHTS

        # 1. 浏览点击 (PV - 约 80%)
        n_pv = round(n_day * 0.80)
        cats = random.choices(CATEGORY_IDS, weights=cat_weights_list, k=n_pv)
        for i in range(n_pv):
            uid = random.choice(user_ids)
            iid = random.choice(item_ids)
            ts  = generate_timestamp(date_str, hourly_w)
            records.append((uid, iid, cats[i], "pv", int(ts.timestamp())))

        # 2. 收藏 (Fav - 约 5%)
        n_fav = round(n_day * 0.05)
        cats_fav = random.choices(CATEGORY_IDS, weights=cat_weights_list, k=n_fav)
        for i in range(n_fav):
            uid = random.choice(user_ids)
            iid = random.choice(item_ids)
            ts  = generate_timestamp(date_str, hourly_w)
            records.append((uid, iid, cats_fav[i], "fav", int(ts.timestamp())))

        # 3. 加购 (Cart - 约 8%)
        n_cart = round(n_day * 0.08)
        cats_cart = random.choices(CATEGORY_IDS, weights=cat_weights_list, k=n_cart)
        for i in range(n_cart):
            uid = random.choice(user_ids)
            iid = random.choice(item_ids)
            ts  = generate_timestamp(date_str, hourly_w)
            records.append((uid, iid, cats_cart[i], "cart", int(ts.timestamp())))

        # 4. 购买 (Buy - 约 7%)
        # 为了产生强关联规则，我们将购买行为成组生成 (Co-occurrence)
        n_buy = round(n_day * 0.07)
        cats_buy = random.choices(CATEGORY_IDS, weights=buy_cat_w, k=n_buy)
        
        i = 0
        while i < n_buy:
            uid = random.choice(user_ids)
            iid = random.choice(item_ids)
            primary_cat = cats_buy[i]
            ts = generate_timestamp(date_str, hourly_w)
            records.append((uid, iid, primary_cat, "buy", int(ts.timestamp())))
            i += 1

            # 60% 的高概率，同一天该用户同时打包购买关联商品 (比如买手机同时买配件，买美妆同时买香水)
            if random.random() < 0.60 and primary_cat in ASSOCIATION_PAIRS:
                assoc_cats = ASSOCIATION_PAIRS[primary_cat]
                second_cat = random.choice(assoc_cats)
                second_iid = random.choice(item_ids)
                second_ts = ts + timedelta(seconds=random.randint(5, 600))
                records.append((uid, second_iid, second_cat, "buy", int(second_ts.timestamp())))
                i += 1

    # 5. 补充生成留存复访购买记录 (哈希高速映射版本)
    df_temp = pd.DataFrame(records, columns=["user_id", "item_id", "category_id", "behavior_type", "timestamp"])
    df_temp["date"] = pd.to_datetime(df_temp["timestamp"], unit="s").dt.date.astype(str)
    
    # 获取购买行为
    buy_df = df_temp[df_temp["behavior_type"] == "buy"]
    
    # 快速获取每个用户的首购日期
    first_buy_dict = buy_df.groupby("user_id")["date"].min().to_dict()
    
    retention_records = []
    for uid, first_buy_date_str in first_buy_dict.items():
        first_buy_date = datetime.strptime(first_buy_date_str, "%Y-%m-%d")
        
        # 产生留存复访行为
        for day_offset in range(1, 8):
            target_date = first_buy_date + timedelta(days=day_offset)
            target_date_str = target_date.strftime("%Y-%m-%d")
            
            if target_date_str not in DAILY_WEIGHTS:
                break
                
            # 留存几率控制
            prob = 0.0
            if day_offset == 1:
                prob = 0.32  # D1 32%
            elif day_offset == 2:
                prob = 0.22  # D2 22%
            elif day_offset == 3:
                prob = 0.16  # D3 16%
            elif day_offset in [4, 5]:
                prob = 0.10  # D4-D5 10%
            elif day_offset in [6, 7]:
                prob = 0.06  # D6-D7 6%
                
            if random.random() < prob:
                ts = generate_timestamp(target_date_str, HOURLY_WEIGHTS)
                cat = random.choices(CATEGORY_IDS, weights=buy_cat_w, k=1)[0]
                iid = random.choice(item_ids)
                retention_records.append((uid, iid, cat, "buy", int(ts.timestamp())))

    print(f"[INFO] Generated extra {len(retention_records):,} retention buy records.")
    all_records = records + retention_records

    df = pd.DataFrame(all_records, columns=["user_id", "item_id", "category_id", "behavior_type", "timestamp"])
    df = df.sample(frac=1, random_state=42).reset_index(drop=True)

    df["category_name"] = df["category_id"].map(CATEGORIES)
    df["datetime"] = pd.to_datetime(df["timestamp"], unit="s")
    df["date"]     = df["datetime"].dt.date.astype(str)
    df["hour"]     = df["datetime"].dt.hour

    df.to_csv(OUTPUT_FILE, index=False, encoding='utf-8-sig')
    print(f"[DONE] Dataset saved: {len(df):,} rows -> {OUTPUT_FILE}")
    return df


if __name__ == "__main__":
    df = build_dataset(250_000)
    print("\nData distribution:")
    print(df["behavior_type"].value_counts())
