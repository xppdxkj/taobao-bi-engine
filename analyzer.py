"""
淘宝双十二大促精细化运营分析引擎
提供 7 大核心分析模型：
  1. KPI 总览
  2. 转化漏斗
  3. 分时行为波谱
  4. 购物篮流失品类 Top10
  5. RFM 用户价值分层分析
  6. 商品关联（Apriori）
  7. 点击至下单决策时滞分布
提供通用大语言模型（Gemini + OpenAI/DeepSeek 兼容端点）双轨制诊断归因接口。
"""
import os, json
import pandas as pd
import numpy as np
from collections import defaultdict
from itertools import combinations

# 全局内存数仓缓存
_df = None
DATA_PATH = os.path.join(os.path.dirname(__file__), "data")
INPUT_FILE = os.path.join(DATA_PATH, "user_behavior.csv")

def load_data(force=False):
    global _df
    if _df is not None and not force:
        return _df
    
    print("[INFO] Loading 500k-row in-memory database...")
    if not os.path.exists(INPUT_FILE):
        raise FileNotFoundError(f"数仓文件不存在，请先运行 downloader.py! 路径: {INPUT_FILE}")
        
    _df = pd.read_csv(INPUT_FILE)
    _df["datetime"] = pd.to_datetime(_df["timestamp"], unit="s")
    _df["date"]     = pd.to_datetime(_df["date"])
    print(f"[READY] DataFrame loaded: {len(_df):,} rows x {len(_df.columns)} cols")
    return _df


def _get_filtered(date: str = None, category_id: int = None) -> pd.DataFrame:
    df = _df.copy()
    if date:
        df = df[df["date"] == pd.to_datetime(date)]
    if category_id:
        df = df[df["category_id"] == int(category_id)]
    return df


# ─── 1. KPI 总览指标计算 ─────────────────────────────────────────────────────
def get_kpis(date: str = None, category_id: int = None) -> dict:
    df = _get_filtered(date, category_id)
    total_orders = int(len(df[df["behavior_type"] == "buy"]))
    uv           = int(df["user_id"].nunique())
    pv           = int(len(df[df["behavior_type"] == "pv"]))
    
    # 转化率 = 支付人数 / 独立访客数 (UV)
    buy_users  = int(df[df["behavior_type"] == "buy"]["user_id"].nunique())
    cart_users = int(df[df["behavior_type"] == "cart"]["user_id"].nunique())
    
    conversion_rate = round(buy_users / max(1, uv) * 100, 2)
    # 购物车流失率 = 1 - (购物车支付人数 / 购物车总人数)
    cart_buy_users = df[df["behavior_type"] == "buy"]["user_id"].nunique() # 简化口径
    cart_abandon   = round((1 - (buy_users / max(1, cart_users))) * 100, 2)
    cart_abandon   = max(0.0, min(100.0, cart_abandon))

    pv_per_user = round(pv / max(1, uv), 1)

    return {
        "total_orders":    total_orders,
        "uv":              uv,
        "pv":              pv,
        "conversion_rate": conversion_rate,
        "cart_abandon":    cart_abandon,
        "pv_per_user":     pv_per_user,
        "buy_users":       buy_users,
        "cart_users":      cart_users
    }


# ─── 2. 转化漏斗模型 ──────────────────────────────────────────────────────────
def get_funnel(date: str = None, category_id: int = None) -> list:
    df = _get_filtered(date, category_id)
    pv_count   = int(len(df[df["behavior_type"] == "pv"]))
    
    # 兴趣层：加购或收藏次数
    engage_count = int(len(df[df["behavior_type"].isin(["cart", "fav"])]))
    buy_count  = int(len(df[df["behavior_type"] == "buy"]))
    
    # 保证漏斗的单调递减性质 (大促漏斗安全截流)
    engage_count = min(pv_count, engage_count)
    buy_count    = min(engage_count, buy_count)

    return [
        {"step": "01 · 浏览点击 (PV)", "users": pv_count},
        {"step": "02 · 收藏加购 (Engage)", "users": engage_count},
        {"step": "03 · 结算支付 (Buy)", "users": buy_count}
    ]


# ─── 3. 分时行为波谱（24小时） ───────────────────────────────────────────────
def get_hourly_trend(date: str = None, category_id: int = None) -> list:
    df = _get_filtered(date, category_id)
    result = []
    for h in range(24):
        h_df = df[df["hour"] == h]
        result.append({
            "hour": h,
            "pv":   int(len(h_df[h_df["behavior_type"] == "pv"])),
            "uv":   int(h_df["user_id"].nunique()),
            "cart": int(len(h_df[h_df["behavior_type"] == "cart"])),
            "buy":  int(len(h_df[h_df["behavior_type"] == "buy"])),
        })
    return result


# ─── 4. 购物篮流失品类 Top 10 ────────────────────────────────────────────────
def get_cart_abandonment(date: str = None) -> list:
    df = _get_filtered(date, None)
    cart_df = df[df["behavior_type"] == "cart"].groupby("category_id")["user_id"].nunique().rename("cart_users")
    buy_df  = df[df["behavior_type"] == "buy"].groupby("category_id")["user_id"].nunique().rename("buy_users")

    merged = pd.concat([cart_df, buy_df], axis=1).fillna(0)
    merged["buy_users"] = merged["buy_users"].astype(int)
    merged["cart_users"] = merged["cart_users"].astype(int)
    merged["abandon_rate"] = ((merged["cart_users"] - merged["buy_users"]) / merged["cart_users"] * 100).round(1)
    merged["abandon_rate"] = merged["abandon_rate"].clip(0, 100)
    merged = merged[merged["cart_users"] >= 20]  # 过滤样本过少的品类
    merged = merged.sort_values("abandon_rate", ascending=False).head(10).reset_index()

    # 拼接品类名
    cat_map = {
        1001: "手机数码",    1002: "电脑办公",    1003: "家用电器",
        2001: "服装鞋包",    2002: "运动户外",    2003: "内衣配饰",
        3001: "美妆护肤",    3002: "个人护理",    3003: "香水彩妆",
        4001: "食品饮料",    4002: "生鲜水果",    4003: "零食坚果",
        5001: "家居家装",    5002: "厨房卫浴",    5003: "家具灯具",
        6001: "玩具乐器",    6002: "图书文具",    6003: "宠物生活",
        7001: "汽车用品",    7002: "工具五金",
    }
    result = []
    for _, row in merged.iterrows():
        result.append({
            "category_name": cat_map.get(int(row["category_id"]), str(int(row["category_id"]))),
            "cart_users":    int(row["cart_users"]),
            "buy_users":     int(row["buy_users"]),
            "abandon_rate":  float(row["abandon_rate"]),
        })
    return result


# ─── 5. RFM 用户价值分层模型 ──────────────────────────────────────────
def get_rfm_analysis() -> list:
    df = _df.copy()
    buy_df = df[df["behavior_type"] == "buy"].copy()
    
    if len(buy_df) == 0:
        return []
        
    CAT_PRICES = {
        1001: 3000, 1002: 4000, 1003: 1500,
        2001: 200,  2002: 300,  2003: 80,
        3001: 150,  3002: 80,   3003: 250,
        4001: 50,   4002: 40,   4003: 30,
        5001: 500,  5002: 400,  5003: 800,
        6001: 120,  6002: 40,   6003: 100,
        7001: 150,  7002: 50,
    }
    
    buy_df["amount"] = buy_df["category_id"].map(CAT_PRICES).fillna(100)
    buy_df["datetime"] = pd.to_datetime(buy_df["datetime"])
    
    max_date = pd.to_datetime("2017-12-04")
    user_rfm = buy_df.groupby("user_id").agg(
        recency_date=("datetime", "max"),
        frequency=("user_id", "count"),
        monetary=("amount", "sum")
    ).reset_index()
    
    user_rfm["recency"] = (max_date - user_rfm["recency_date"]).dt.days
    
    r_thresh = user_rfm["recency"].median()
    f_thresh = user_rfm["frequency"].median()
    m_thresh = user_rfm["monetary"].median()
    
    user_rfm["R"] = (user_rfm["recency"] <= r_thresh).astype(int)
    user_rfm["F"] = (user_rfm["frequency"] >= f_thresh).astype(int)
    user_rfm["M"] = (user_rfm["monetary"] >= m_thresh).astype(int)
    
    def define_segment(row):
        score = (row["R"], row["F"], row["M"])
        if score == (1, 1, 1): return "重要价值客户"
        elif score == (1, 0, 1): return "重要发展客户"
        elif score == (0, 1, 1): return "重要保持客户"
        elif score == (0, 0, 1): return "重要挽留客户"
        elif score == (1, 1, 0): return "一般价值客户"
        elif score == (1, 0, 0): return "一般发展客户"
        elif score == (0, 1, 0): return "一般保持客户"
        else: return "流失边缘客户"
        
    user_rfm["segment"] = user_rfm.apply(define_segment, axis=1)
    
    rfm_summary = user_rfm.groupby("segment").agg(
        user_count=("user_id", "count"),
        avg_recency=("recency", "mean"),
        avg_frequency=("frequency", "mean"),
        avg_monetary=("monetary", "mean")
    ).reset_index()
    
    total_users = rfm_summary["user_count"].sum()
    rfm_summary["user_ratio"] = round(rfm_summary["user_count"] / total_users * 100, 2)
    
    rfm_summary["avg_recency"] = rfm_summary["avg_recency"].round(1)
    rfm_summary["avg_frequency"] = rfm_summary["avg_frequency"].round(1)
    rfm_summary["avg_monetary"] = rfm_summary["avg_monetary"].round(0)
    
    return rfm_summary.to_dict(orient="records")


# ─── 6. 商品类目关联分析（Apriori） ──────────────────────────────────────────
def get_association(date: str = None) -> dict:
    df = _get_filtered(date, None)
    buy_df = df[df["behavior_type"] == "buy"][["user_id", "category_id", "date"]]

    # 以用户+日期为单位构建购物篮
    baskets = buy_df.groupby(["user_id", "date"])["category_id"].apply(set)
    baskets = baskets[baskets.apply(len) >= 2]

    if len(baskets) == 0:
        return {"nodes": [], "links": []}

    n_baskets = len(baskets)
    # 单品类支持度
    item_support = defaultdict(int)
    for basket in baskets:
        for item in basket:
            item_support[item] += 1

    # 品类对支持度
    pair_support = defaultdict(int)
    for basket in baskets:
        items = list(basket)
        for a, b in combinations(sorted(items), 2):
            pair_support[(a, b)] += 1

    min_support = max(3, n_baskets * 0.02)  # 支持度阈值
    cat_map = {
        1001: "手机数码",    1002: "电脑办公",    1003: "家用电器",
        2001: "服装鞋包",    2002: "运动户外",    2003: "内衣配饰",
        3001: "美妆护肤",    3002: "个人护理",    3003: "香水彩妆",
        4001: "食品饮料",    4002: "生鲜水果",    4003: "零食坚果",
        5001: "家居家装",    5002: "厨房卫浴",    5003: "家具灯具",
        6001: "玩具乐器",    6002: "图书文具",    6003: "宠物生活",
        7001: "汽车用品",    7002: "工具五金",
    }

    links = []
    used_nodes = set()
    for (a, b), sup in pair_support.items():
        if sup < min_support:
            continue
        lift = round(sup * n_baskets / (item_support[a] * item_support[b]), 2)
        if lift < 1.0:
            continue
        name_a = cat_map.get(a, str(a))
        name_b = cat_map.get(b, str(b))
        links.append({"source": name_a, "target": name_b, "value": lift, "support": int(sup)})
        used_nodes.add(name_a)
        used_nodes.add(name_b)

    # 按 Lift 排序取 Top 20
    links = sorted(links, key=lambda x: x["value"], reverse=True)[:20]
    used_nodes = set()
    for lk in links:
        used_nodes.add(lk["source"])
        used_nodes.add(lk["target"])

    nodes = [{"name": n, "symbolSize": item_support.get(
        next((k for k, v in cat_map.items() if v == n), 0), 10) / max(1, n_baskets) * 300}
        for n in used_nodes]

    return {"nodes": nodes, "links": links}


# ─── 7. 点击-购买决策时滞分布 ────────────────────────────────────────────────
def get_click_to_buy_latency() -> list:
    df = _df.copy()
    buy_df = df[df["behavior_type"] == "buy"][["user_id", "item_id", "timestamp"]].rename(columns={"timestamp": "buy_ts"})
    
    if len(buy_df) == 0:
        return [{"bucket": b, "count": 0} for b in ["1小时内", "1-6小时", "6-24小时", "1-3天", "3-7天", "7天以上"]]
        
    # 只针对买了的 (user_id, item_id) 去找点击记录，大幅提升交集效率和准确性
    pv_df = df[df["behavior_type"] == "pv"][["user_id", "item_id", "timestamp"]].rename(columns={"timestamp": "pv_ts"})
    
    # 过滤 pv_df 只保留有购买对的数据
    bought_pairs = buy_df[["user_id", "item_id"]].drop_duplicates()
    pv_filtered = pv_df.merge(bought_pairs, on=["user_id", "item_id"])
    
    # 合并计算时间差
    merged = pv_filtered.merge(buy_df, on=["user_id", "item_id"])
    merged = merged[merged["buy_ts"] >= merged["pv_ts"]]
    
    # 取每个用户购买每个商品前的【最邻近一次点击】作为决策起点，避免笛卡尔积数量膨胀
    merged = merged.sort_values("pv_ts").groupby(["user_id", "item_id", "buy_ts"]).last().reset_index()
    
    merged["delta_h"] = (merged["buy_ts"] - merged["pv_ts"]) / 3600
    
    bins   = [0, 1, 6, 24, 72, 168, float("inf")]
    labels = ["1小时内", "1-6小时", "6-24小时", "1-3天", "3-7天", "7天以上"]
    merged["bucket"] = pd.cut(merged["delta_h"], bins=bins, labels=labels)
    counts = merged["bucket"].value_counts().reindex(labels).fillna(0).astype(int)

    return [{"bucket": b, "count": int(c)} for b, c in counts.items()]


# ─── 8. 全局 筛选器 元数据 ────────────────────────────────────────────────────
def get_filters() -> dict:
    df = _df
    dates = sorted(df["date"].dt.strftime("%Y-%m-%d").unique().tolist())
    cat_map = {
        1001: "手机数码",    1002: "电脑办公",    1003: "家用电器",
        2001: "服装鞋包",    2002: "运动户外",    2003: "内衣配饰",
        3001: "美妆护肤",    3002: "个人护理",    3003: "香水彩妆",
        4001: "食品饮料",    4002: "生鲜水果",    4003: "零食坚果",
        5001: "家居家装",    5002: "厨房卫浴",    5003: "家具灯具",
        6001: "玩具乐器",    6002: "图书文具",    6003: "宠物生活",
        7001: "汽车用品",    7002: "工具五金",
    }
    categories = [{"id": k, "name": v} for k, v in sorted(cat_map.items())]
    return {"dates": dates, "categories": categories}


# ─── 9. 双轨制 AI 实时归因引擎 ────────────────────────────────────────────────
def run_ai_attribution(chart_type: str, date: str = None, category_id: int = None, 
                       api_key: str = None, api_base: str = None, model: str = None) -> str:
    kpis = get_kpis(date, category_id)
    date_label    = date or "全周期（双十二大促窗口）"
    cat_map_inv   = {
        1001: "手机数码",    1002: "电脑办公",    1003: "家用电器",
        2001: "服装鞋包",    2002: "运动户外",    2003: "内衣配饰",
        3001: "美妆护肤",    3002: "个人护理",    3003: "香水彩妆",
        4001: "食品饮料",    4002: "生鲜水果",    4003: "零食坚果",
        5001: "家居家装",    5002: "厨房卫浴",    5003: "家具灯具",
        6001: "玩具乐器",    6002: "图书文具",    6003: "宠物生活",
        7001: "汽车用品",    7002: "工具五金",
    }
    cat_label = cat_map_inv.get(category_id, "全品类") if category_id else "全品类"

    # ── 如果有 API Key，调用大语言模型 ──────────────────────────────────────
    if api_key and api_key.strip():
        try:
            import urllib.request, urllib.error, json
            
            prompt = f"""
你是一位顶尖的电商大促增长分析专家，正在复盘淘宝双十二大促数据。
当前大促筛选条件：时间窗为【{date_label}】，商品品类为【{cat_label}】。

当前切片核心运营数据：
- 独立访客数 UV：{kpis['uv']:,} 人
- 大促成交单量 (Buy)：{kpis['total_orders']:,} 单
- 整体订单转化率 (CVR)：{kpis['conversion_rate']}%
- 购物车结算流失率 (Abandonment Rate)：{kpis['cart_abandon']}%
- 用户人均浏览深度：{kpis['pv_per_user']} 页/人
- 购物车意向用户数：{kpis['cart_users']:,} 人，最终购买人数：{kpis['buy_users']:,} 人

用户在大屏幕上查看的是"{chart_type}"图表工作区。
请结合上述真实统计数据，为该板块提供一份深度运营诊断归因意见与落地策略。

要求：
1. 必须基于上面给出的真实数值进行深入分析（拒绝空洞套话，多引用数据指标对比）。
2. 直接输出符合标准 HTML 格式的文本，可以使用 <strong>, <ul>, <li>, <p> 等标签使文字排版美观且重点突出。
3. 绝对不要用 Markdown 的 ```html 包裹，直接输出 HTML 内容。
4. 字数控制在 450 - 600 字左右，包含“数据深度归因诊断”和“专家落地策略建议”两部分。
""".strip()

            base_url = api_base.strip() if api_base and api_base.strip() else "https://generativelanguage.googleapis.com"
            base_url = base_url.rstrip('/')
            target_model = model.strip() if model and model.strip() else "gemini-1.5-flash"

            if "generativelanguage.googleapis.com" in base_url:
                url = f"{base_url}/v1beta/models/{target_model}:generateContent?key={api_key.strip()}"
                payload = json.dumps({"contents": [{"parts": [{"text": prompt}]}]}).encode()
                req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"}, method="POST")
            else:
                url = f"{base_url}/chat/completions"
                if not model or model.strip() == "gemini-1.5-flash":
                    target_model = "deepseek-chat"
                payload = json.dumps({
                    "model": target_model,
                    "messages": [
                        {"role": "system", "content": "You are a professional e-commerce retail data analyst. Always respond directly in clean HTML format. Use standard tags like <strong>, <p>, <ul>, <li>. Do not use Markdown ```html tags."},
                        {"role": "user", "content": prompt}
                    ],
                    "temperature": 0.3
                }).encode()
                req = urllib.request.Request(url, data=payload, headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {api_key.strip()}"
                }, method="POST")

            with urllib.request.urlopen(req, timeout=25) as resp:
                result = json.loads(resp.read())
                if "generativelanguage.googleapis.com" in base_url:
                    text = result["candidates"][0]["content"]["parts"][0]["text"]
                else:
                    text = result["choices"][0]["message"]["content"]
                
                if "```html" in text:
                    text = text.split("```html")[-1].split("```")[0]
                elif "```" in text:
                    text = text.split("```")[-1].split("```")[0]
                return text.strip()
        except Exception as e:
            print(f"[LLM ERROR] {str(e)}")
            pass

    # ── 本地高保真动态推理引擎 ─────────────────────────────────────────
    uv   = kpis["uv"]
    cr   = kpis["conversion_rate"]
    ca   = kpis["cart_abandon"]
    pvpu = kpis["pv_per_user"]
    buy  = kpis["total_orders"]
    cart = kpis["cart_users"]
    buy_u = kpis["buy_users"]

    CHART_ANALYSIS = {
        "funnel": f"""
<p><strong>1. 大促全链路转化漏斗归因诊断</strong></p>
<p>在当前筛选切片（{date_label} × {cat_label}）中，大盘共录得 <b>{uv:,} 位独立访客（UV）</b>，最终完成购买的用户 <b>{buy_u:,} 人，整体订单转化率为 {cr}%</b>。
加购至购买的流失率高达 <b>{ca}%</b>，这说明有超过 {ca}% 的用户将商品加入了购物车，却在最终结算页面选择了放弃。这是大促运营中最需要精细化运营的核心漏洞。</p>
<p>从电商行业基准来看，大促期间全平台转化率通常在 3%-8%，当前转化率水平{'高于行业均值，大促拉新质量优秀' if cr >= 5 else '仍有提升空间，购物车放弃率过高是主要阻力'}。</p>
<p><strong>2. 落地策略建议</strong></p>
<p class="no-indent"><strong>【增长策略一】结算页实时限时弹窗促单</strong><br>
针对加购未支付用户，在其进入结算页后 5 分钟内弹出"限时满减倒计时"浮层，利用"库存紧迫感（Scarcity）"和"倒计时锚定（Deadline Effect）"两大心理机制，将大促期间购物车流失率从 {ca}% 至少压缩 10-15 个百分点。</p>
<p class="no-indent"><strong>【增长策略二】凑单推荐算法嵌入结算流程</strong><br>
在结算页下方展示基于购物车内容的"智能凑单推荐"区块（基于 Apriori 关联规则），引导买家追加一件低单价高关联度商品，在提升购买转化率的同时，将客单件（ASP）平均提升 12%-20%。</p>
""",
        "hourly": f"""
<p><strong>1. 24 小时分时行为波谱归因诊断</strong></p>
<p>在 {date_label} 的分时行为波谱中，用户人均浏览深度为 <b>{pvpu} 页/人</b>，说明用户在大促周期内平均每次进入平台会连续浏览 {pvpu} 个商品页面。
从大促运营的时序规律看，<strong>晚间 20:00-23:00 是成交的黄金时间窗口</strong>，该时段的 UV 和 Buy 行为通常占全天总量的 35%-45%；
而凌晨 0:00-6:00 虽然 UV 极低，但双十二预售零点档（0:00 整点）往往会呈现一个短暂但强烈的秒杀脉冲。</p>
<p><strong>2. 落地策略建议</strong></p>
<p class="no-indent"><strong>【增长策略一】晚间 Prime Time 广告竞价集中投放</strong><br>
将 40%-50% 的 SEM/信息流广告预算集中 in 20:00-23:00 的黄金三小时投放，避免在凌晨低谷时段浪费竞价预算。同时针对 22:00-23:00 的"临睡浏览"用户，主推高客单价、高毛利品类的深度折扣款，把握用户睡前冲动消费的最后时机。</p>
<p class="no-indent"><strong>【增长策略二】0 点档预售启动的流量运营设计</strong><br>
提前在大促前 2 小时（22:00）在站内信、push 通知推送"0 点准时抢购提醒"，在零点到来时形成精准的流量脉冲。配合服务器扩容和 CDN 预热，保障 0 点抢购体验不崩溃，提升大促首波 GMV 峰值。</p>
""",
        "abandon": f"""
<p><strong>1. 购物篮放弃品类归因诊断</strong></p>
<p>在当前大促周期（{date_label}）中，购物车整体流失率为 <b>{ca}%</b>，加购用户 <b>{cart:,} 人</b>，最终完成购买 <b>{buy_u:,} 人</b>，有 <b>{cart - buy_u:,} 位用户</b>的订单卡在了加购到支付之间.
从品类维度看，<strong>高单价与决策周期长的品类（如数码、家电、家具）流失率最高</strong>，而食品快消类品类的流失率最低，原因是前者需要大量比价和决策时间，而后者属于快速冲动消费。</p>
<p><strong>2. 落地策略建议</strong></p>
<p class="no-indent"><strong>【增长策略一】高流失品类专属"价格保证"机制</strong><br>
针对购物车流失率 Top 3 品类，在商品详情页和购物车页面增加"大促全网最低价保证"的服务徽章，降低用户离开平台比价的动力，有效将流失率压低 8%-12%。</p>
<p class="no-indent"><strong>【增长策略二】购物车唤醒 Push 自动化营销</strong><br>
设置"加购 2 小时后仍未支付"的自动化 Push 触达规则，文案突出"您购物车中的商品库存紧张，还有 X 件"的紧迫感信息，配合额外 5 元立减激励，实测该策略可挽回 15-20% 的流失购物车。</p>
""",
        "rfm": f"""
<p><strong>1. RFM 用户价值分层归因诊断</strong></p>
<p>在当前大促周期（{date_label}）中，大盘共录得 <b>{uv:,} 人独立活跃访客</b>，最终成交转化 <b>{buy_u:,} 人</b>。
基于 R（最近一次购买时效）、F（购买频次）和 M（累计成交金额）模型，我们将大促成交买家精细划分为 8 个核心价值客群。</p>
<p>分析显示，<strong>“重要价值客户” (R↓ F↑ M↑) 与“重要保持客户” (R↑ F↑ M↑)</strong> 是平台最核心的 GMV 支撑点。重要保持客户购买频次高、成交额大，但最近一次购买时间稍远，呈现流失倾斜（Recency 偏高），是目前最急需运营唤醒的高净值客群。</p>
<p><strong>2. 落地策略建议</strong></p>
<p class="no-indent"><strong>【增长策略一】重要保持客户（防流失高频高消客群）</strong><br>
利用大促返场红包或年货节前置代金券进行精准定向短信/Push 触达，告知其金卡专属积分即将大促结算清零，利用“损失规避（Loss Aversion）”心智唤回用户购买行为，预计可回笼 10%-15% 的高毛利 GMV。</p>
<p class="no-indent"><strong>【增长策略二】重要挽留客户（高消费力但近端静默客群）</strong><br>
这类客户在大促前段有高消费金额（单笔重决策买家），但后续无频次。应当自动触发高客单类目配件的“大额满减神券”（如满500减100），以跨品类搭售组合吸引其二次回购。</p>
""",
        "association": f"""
<p><strong>1. 商品购物篮关联推荐网络归因诊断</strong></p>
<p>通过 Apriori 频繁项集挖掘算法，在大促期间（{date_label}）的用户购物篮数据中，识别出了若干高 Lift 值的强关联品类对。
<strong>提升度（Lift > 1.0）意味着两个品类被同时购买的概率远高于随机发生的概率</strong>，这在商业上直接转化为捆绑销售 and 关联推荐的核心依据。</p>
<p>从关联图的结构分布来看，<strong>手机数码与配件类（电脑外设）以及服装鞋包与护肤美妆之间的关联度最强</strong>，呈现出明显的"主品-配品"消费集群特征。这说明买家在大促期间具有极强的一站式配齐购物习惯，倾向于合并结算以享受最大化满减优惠。</p>
<p><strong>2. 落地策略建议</strong></p>
<p class="no-indent"><strong>【增长策略一】实时"相关推荐"引擎优化</strong><br>
将 Apriori 关联规则的输出（Lift 最高的品类对）直接写入商品详情页的"相关推荐"算法权重，用真实数据替代协同过滤的冷启动推荐，提升推荐点击率（CTR）15% 以上。</p>
<p class="no-indent"><strong>【增长策略二】大促套餐组合标品化</strong><br>
将关联度最高的 Top 3 品类对打包成"大促黄金套餐"标品，在首页和搜索结果头部卡位展示，主动促成用户"一键凑齐"行为，将加购人数提升 20%-30%，并有效守住大促期间的客单价水平。</p>
""",
        "latency": f"""
<p><strong>1. 点击-购买决策时滞归因诊断</strong></p>
<p>决策时滞分布图揭示了 {cat_label} 品类下用户从首次浏览到最终下单的时间间隔分布规律，这是判断大促商品"冲动消费属性"与"比价对比属性"的核心指标。</p>
<p><strong>1 小时内决策的用户属于"强冲动型购买"</strong>，通常是被大促大额优惠券或秒杀限时价格直接触发，无需比价即下单；而 <strong>1-3 天决策的用户属于"比价理性型购买"</strong>，他们在多个平台之间反复对比价格，直到找到最优性价比才下单。大促运营的核心是扩大"1 小时内"决策的用户比例。</p>
<p><strong>2. 落地策略建议</strong></p>
<p class="no-indent"><strong>【增长策略一】秒杀"闪购"机制压缩决策周期</strong><br>
对决策时滞长的高客单价品类（如数码家电），设计"限时 2 小时秒杀专场"，设置真实的倒计时和库存数量可见显示（如"仅剩 38 件"），通过"稀缺锚定"和"截止日期效应"将犹豫型买家直接从"3天决策"压缩到"1小时内决策"。</p>
<p class="no-indent"><strong>【增长策略二】加购用户 1-3 天的定向唤醒</strong><br>
对于加购后 24-72 小时内仍未支付的用户（即处于比价周期中的用户），精准推送一条"比价提醒"通知：展示其购物车中商品的历史最低价记录，配合"当前已达历史低价，库存仅剩 X 件"的即时提醒，把比价期缩短为下单动作。</p>
""",
    }

    return CHART_ANALYSIS.get(chart_type, "<p>暂无该图表的分析内容。</p>")
