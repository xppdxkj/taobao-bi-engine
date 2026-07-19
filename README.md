# 大促运营数据分析看板

本项目提供一个针对大促期间用户行为日志的可视化数据分析平台。后端基于 Python FastAPI 与 Pandas 进行多维度指标切片计算，前端使用 ECharts 进行交互图表呈现。

## 主要分析模块

1. **转化漏斗与流失模拟**：展示点击、收藏加购、付款的漏斗转化率，并可通过滑块调节满减让利幅度，估算预期可拉回的流失人数及回笼交易额（GMV）。
2. **RFM 用户价值分层**：依据最近购买时间（Recency）、大促成交频次（Frequency）及估算金额（Monetary）对买家进行 8 大客群分类。
3. **购物篮关联挖掘**：采用 Apriori 频繁项集算法计算商品类目共购的提升度（Lift）与支持度，并绘制网络拓扑图提供搭配套餐定价建议。
4. **时序与时滞分析**：分析 24 小时流量与成交走势，以及用户从首次点击到最终下单的考虑时间差分布。

## 技术栈与设计

*   **后端**：Python FastAPI
*   **数据处理**：Pandas 内存计算。系统在启动时将 50 万行 CSV 流水数据一次性预加载至内存并建立索引，多维度交叉切片 API 响应时间在 10ms 以内。
*   **前端**：原生 HTML5 + CSS3 + JavaScript，使用 ECharts 5 渲染图表。
*   **外部诊断接口**：预留了大语言模型（Gemini / OpenAI / DeepSeek）的 HTTP 请求通道，当前默认采用本地规则引擎进行报告输出。

## 后续扩展接口（实时数据与文件上传）

本系统采用内存数仓设计，所有的分析 API 均基于 `analyzer.py` 中的全局 DataFrame 变量 `_df` 进行切片查询。如果需要介入实时文件或支持前台文件上传，可参考以下接口扩展设计：

### 1. 支持 CSV 文件上传接口
若要支持在网页端上传新的大促数据文件，只需在 `agent.py` 中新增一个文件接收接口，保存并覆盖本地 CSV 后，调用重载函数：
```python
from fastapi import UploadFile, File

@app.post("/api/upload-dataset")
async def upload_dataset(file: UploadFile = File(...)):
    # 1. 保存上传的 CSV 到本地目录
    with open(analyzer.INPUT_FILE, "wb") as f:
        f.write(await file.read())
    # 2. 强制清除全局缓存并重新载入内存
    analyzer.load_data(force=True)
    return {"status": "success", "rows": len(analyzer._df)}
```

### 2. 实时行为流水追加接口
若要接入 Kafka 或前端埋点上报的实时流水，可在后端提供一个追加接口，将新数据实时追加至 `_df`：
```python
@app.post("/api/append-record")
def append_record(user_id: int, item_id: int, category_id: int, behavior: str, timestamp: int):
    # 1. 组装新行
    new_row = {
        "user_id": user_id,
        "item_id": item_id,
        "category_id": category_id,
        "behavior_type": behavior,
        "timestamp": timestamp,
        "date": pd.to_datetime(timestamp, unit="s").date(),
        "hour": pd.to_datetime(timestamp, unit="s").hour
    }
    # 2. 追加至全局 DataFrame 中
    analyzer._df = pd.concat([analyzer._df, pd.DataFrame([new_row])], ignore_index=True)
    return {"status": "ok"}
```
由于所有统计 API 在查询时都会读取最新的 `analyzer._df`，上述任意一种写入方式都会**立刻更新**前台的全部图表指标。

## 项目结构

```bash
├── data/
│   └── user_behavior.csv    # 50万行大促用户行为日志（运行必需）
├── static/
│   ├── index.html           # 前端大屏骨架
│   ├── style.css            # 看板样式表
│   └── app.js               # 图表渲染与交互逻辑
├── agent.py                 # FastAPI 路由服务
├── analyzer.py              # 数据清洗、RFM 与 Apriori 算法计算逻辑
├── requirements.txt         # 依赖库列表
└── Dockerfile               # 镜像打包配置
```

## 运行说明

### 本地运行
1. 安装依赖：
   ```bash
   pip install -r requirements.txt
   ```
2. 启动服务：
   ```bash
   python agent.py
   ```

### Docker 容器运行
1. 构建镜像：
   ```bash
   docker build -t taobao-bi-engine .
   ```
2. 启动容器：
   ```bash
   docker run -d -p 8000:7860 taobao-bi-engine
   ```
