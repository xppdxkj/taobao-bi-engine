"""
淘宝双十二大促精细化运营决策系统 — FastAPI 后端服务
启动时一次性将样本数据加载至内存，按筛选条件计算分析指标
"""
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import uvicorn
import os
import analyzer


@asynccontextmanager
async def lifespan(app: FastAPI):
    """FastAPI Startup: 一次性加载当前 CSV 样本至内存。"""
    analyzer.load_data()
    yield


app = FastAPI(lifespan=lifespan)

# 启用 CORS 中间件，彻底防止跨域/安全机制拦截导致的 Failed to fetch 错误
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/")
def index():
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))


@app.get("/api/filters")
def api_filters():
    return JSONResponse(analyzer.get_filters())


@app.get("/api/meta")
def api_meta():
    return JSONResponse(analyzer.get_dataset_meta())


@app.get("/api/kpis")
def api_kpis(date: str = None, category_id: int = None):
    return JSONResponse(analyzer.get_kpis(date, category_id))


@app.get("/api/funnel")
def api_funnel(date: str = None, category_id: int = None):
    return JSONResponse(analyzer.get_funnel(date, category_id))


@app.get("/api/hourly")
def api_hourly(date: str = None, category_id: int = None):
    return JSONResponse(analyzer.get_hourly_trend(date, category_id))


@app.get("/api/cart-abandonment")
def api_cart_abandonment(date: str = None):
    return JSONResponse(analyzer.get_cart_abandonment(date))


@app.get("/api/rfm")
def api_rfm():
    return JSONResponse(analyzer.get_rfm_analysis())


@app.get("/api/association")
def api_association(date: str = None):
    return JSONResponse(analyzer.get_association(date))


@app.get("/api/latency")
def api_latency():
    return JSONResponse(analyzer.get_click_to_buy_latency())


@app.get("/api/ai-analyze")
def api_ai_analyze(chart_type: str = "funnel", date: str = None, category_id: int = None, 
                   api_key: str = None, api_base: str = None, model: str = None):
    analysis = analyzer.run_ai_attribution(chart_type, date, category_id, api_key, api_base, model)
    return JSONResponse({"analysis": analysis})


@app.post("/api/execute-pandas")
async def api_execute_pandas(request: dict):
    """数据沙箱：允许在内存数仓上执行任意 Pandas 代码"""
    from fastapi import Request
    code = request.get("code", "")
    try:
        df = analyzer._df.copy()
        local_vars = {"df": df, "pd": __import__("pandas"), "np": __import__("numpy")}
        exec(code, {}, local_vars)
        result = local_vars.get("result", None)
        if result is None:
            # 自动取最后一个变量
            for k, v in reversed(list(local_vars.items())):
                if k not in ("df", "pd", "np"):
                    result = v
                    break
        if hasattr(result, "to_dict"):
            result = result.reset_index().to_dict(orient="records")
        elif hasattr(result, "tolist"):
            result = result.tolist()
        return JSONResponse({"status": "ok", "result": result})
    except Exception as e:
        return JSONResponse({"status": "error", "error": str(e)})


if __name__ == "__main__":
    uvicorn.run("agent:app", host="127.0.0.1", port=8000, reload=False)
