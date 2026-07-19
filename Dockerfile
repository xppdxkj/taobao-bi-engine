FROM python:3.11-slim

# 设置容器工作目录
WORKDIR /app

# 安装必要的 Python 库
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple

# 复制项目代码与 50万行数仓 csv 数据
COPY . .

# 暴露端口（Hugging Face 默认 7860）
EXPOSE 7860

# 智能兼容启动：如果环境变量有 $PORT 则使用，否则默认 7860
CMD ["sh", "-c", "uvicorn agent:app --host 0.0.0.0 --port ${PORT:-7860}"]
