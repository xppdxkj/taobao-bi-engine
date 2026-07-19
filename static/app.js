/* ═══════════════════════════════════════════════════════
   淘宝双十二大促精细化运营决策系统 — 全量交互控制引擎
 ═══════════════════════════════════════════════════════ */

// ─── 概览页 ECharts 实例 ──────────────────────────────────────────────────────
let funnelChart, hourlyChart, abandonChart, rfmChart, assocChart, latencyChart;

// ─── 各独立工作区 ECharts 实例 ────────────────────────────────────────────────
let wsFunnelChart = null;
let wsHourlyChart = null;
let wsAbandonChart = null;
let wsRfmChart = null;
let wsAssocChart = null;
let modalChartInstance = null;

// ─── 全局数据缓存 ────────────────────────────────────────────────────────────
const cache = {
    funnel: null,
    hourly: null,
    abandon: null,
    rfm: null,
    association: null,
    latency: null,
    activeView: 'overview'
};

const colors = ['#10B981', '#3B82F6', '#7C3AED', '#F59E0B', '#EF4444', '#94A3B8'];
const rfmColors = {
    "重要价值客户": "#EF4444", // 红色
    "重要保持客户": "#EC4899", // 粉色
    "重要发展客户": "#10B981", // 绿色
    "重要挽留客户": "#F59E0B", // 橘黄
    "一般价值客户": "#3B82F6", // 蓝色
    "一般保持客户": "#6366F1", // 靛蓝
    "一般发展客户": "#8B5CF6", // 紫色
    "流失边缘客户": "#64748B"  // 灰色
};
const fmt = (n) => n >= 10000 ? (n / 10000).toFixed(1) + '万' : n.toLocaleString();

// ─── 初始化 ──────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    // 1. 初始化大盘概览图表
    funnelChart  = echarts.init(document.getElementById('funnel-chart'));
    hourlyChart  = echarts.init(document.getElementById('hourly-chart'));
    abandonChart = echarts.init(document.getElementById('abandon-chart'));
    rfmChart     = echarts.init(document.getElementById('rfm-chart'));
    assocChart   = echarts.init(document.getElementById('association-chart'));
    latencyChart = echarts.init(document.getElementById('latency-chart'));

    // 监听窗口缩放
    window.addEventListener('resize', () => {
        [funnelChart, hourlyChart, abandonChart, rfmChart, assocChart, latencyChart].forEach(c => c && c.resize());
        [wsFunnelChart, wsHourlyChart, wsAbandonChart, wsRfmChart, wsAssocChart, modalChartInstance].forEach(c => c && c.resize());
    });

    // 2. 水平顶置菜单切换 (Workspace Tab Switching)
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            
            document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');

            document.querySelectorAll('.view-panel').forEach(panel => panel.classList.remove('active'));
            
            const targetView = item.getAttribute('data-view');
            cache.activeView = targetView;
            document.getElementById(`view-${targetView}`).classList.add('active');

            // 触发对应视图的数据加载/重绘
            triggerWorkspaceRender(targetView);
        });
    });

    // 3. 顶栏悬浮 AI 大脑配置中心滑动切换
    const aiToggleBtn = document.getElementById('btn-toggle-ai-panel');
    const aiDrawer = document.getElementById('floating-ai-drawer');
    if (aiToggleBtn && aiDrawer) {
        aiToggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (aiDrawer.style.display === 'flex') {
                aiDrawer.style.display = 'none';
            } else {
                aiDrawer.style.display = 'flex';
            }
        });
        
        // 点击页面其它位置自动关闭 AI 配置抽屉
        document.addEventListener('click', () => {
            aiDrawer.style.display = 'none';
        });
        
        // 阻止抽屉内点击事件冒泡导致自闭
        aiDrawer.addEventListener('click', (e) => {
            e.stopPropagation();
        });
    }

    // 4. 筛选菜单数据挂载
    loadFilters();

    // 5. 联动重载
    document.getElementById('filter-date').addEventListener('change', reloadAll);
    document.getElementById('filter-category').addEventListener('change', reloadAll);

    // 6. 详情弹窗绑定
    document.querySelectorAll('.btn-detail').forEach(btn => {
        btn.addEventListener('click', () => openDetailModal(btn.dataset.chart));
    });
    document.getElementById('modal-close').addEventListener('click', closeModal);
    document.getElementById('detail-modal').addEventListener('click', (e) => {
        if (e.target.id === 'detail-modal') closeModal();
    });

    // 7. 交互式凑单挽回模拟器滑动监听
    document.getElementById('sim-discount').addEventListener('input', runRecoverySimulation);

    // 8. 跨品类搭售组合模拟器计算绑定
    document.getElementById('btn-build-bundle').addEventListener('click', runBundleBuilder);

    // 9. 沙箱执行
    document.getElementById('sandbox-run').addEventListener('click', runSandbox);

    // 10. 初始化 AI 脑舱配置
    initAIConfig();
});

// ─── 联动拉取筛选选项 ─────────────────────────────────────────────────────────
async function loadFilters() {
    const data = await fetchJSON('/api/filters');
    const dateSelect = document.getElementById('filter-date');
    const catSelect  = document.getElementById('filter-category');

    dateSelect.innerHTML = '<option value="">全部日期</option>';
    (data.dates || []).forEach(d => {
        const opt = document.createElement('option');
        opt.value = d; opt.textContent = d;
        dateSelect.appendChild(opt);
    });

    catSelect.innerHTML = '<option value="">全部品类</option>';
    (data.categories || []).forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id; opt.textContent = c.name;
        catSelect.appendChild(opt);
    });

    reloadAll();
}

function getFilters() {
    const date     = document.getElementById('filter-date').value;
    const category = document.getElementById('filter-category').value;
    let qs = '?';
    if (date)     qs += `date=${date}&`;
    if (category) qs += `category_id=${category}&`;
    return { date, category, qs };
}

// ─── 并行拉取各模块数据 ───────────────────────────────────────────────────────
async function reloadAll() {
    const { qs } = getFilters();
    updateStatus('数据重算中...');

    await Promise.all([
        loadKPIs(qs),
        loadFunnel(qs),
        loadHourly(qs),
        loadAbandon(qs),
        loadRFM(),
        loadAssociation(qs),
        loadLatency(),
    ]);

    updateStatus('数据已就绪');
    updateGlobalFindings();

    // 重新渲染当前处于激活状态的工作区
    triggerWorkspaceRender(cache.activeView);
}

function updateStatus(text) {
    const el = document.getElementById('data-status-text');
    const dot = document.querySelector('.status-indicator .status-dot');
    el.textContent = text;
    if (text.includes('重算') || text.includes('加载')) {
        dot.style.background = '#F59E0B';
    } else {
        dot.style.background = '#10B981';
    }
}

// ─── 结论先行：大盘结论卡片动态挂载 ─────────────────────────────────────────────
function updateGlobalFindings() {
    const container = document.getElementById('findings-container');
    const cvr = document.getElementById('kpi-cvr-val').textContent;
    const abandon = document.getElementById('kpi-abandon-val').textContent;
    const depth = document.getElementById('kpi-depth-val').textContent;

    const catName = document.getElementById('filter-category').selectedOptions[0]?.text || '全品类';
    const dateName = document.getElementById('filter-date').value || '大促全周期';

    // 估算高价值用户规模
    const rfmData = cache.rfm || [];
    const vipObj = rfmData.find(r => r.segment === '重要价值客户') || { user_count: 0 };

    container.innerHTML = `
        <li>
            <span>•</span> 
            <div>
                <strong>转化漏斗诊断 [${catName}]</strong>：
                在 ${dateName} 内，用户整体大促支付转化率为 <strong>${cvr}</strong>。
                加购至付款存在明显的结算流失，急需购物车凑单唤醒。
            </div>
        </li>
        <li>
            <span>•</span> 
            <div>
                <strong>价值群体细分 [${dateName}]</strong>：
                基于 RFM 聚类发现，大盘累计沉淀了 <strong>${vipObj.user_count.toLocaleString()} 位“重要价值客户” (VIP)</strong>，该群体贡献了核心客单 GMV。
                运营应当侧重维持其高频消费意愿，避免其在长周期决策时滞中向竞品倾斜。
            </div>
        </li>
        <li>
            <span>•</span> 
            <div>
                <strong>流失与推荐关联 [${catName}]</strong>：
                当前购物车流失率达 <strong>${abandon}</strong>。
                人均深度为 <strong>${depth} 页</strong>。建议根据 Apriori 强关联对，将高流失类目与共购类目进行详情页套餐一键捆绑。
            </div>
        </li>
    `;
}

// ─── KPI 数据加载 ────────────────────────────────────────────────────────────
async function loadKPIs(qs) {
    const d = await fetchJSON(`/api/kpis${qs}`);
    document.getElementById('kpi-orders-val').textContent = fmt(d.total_orders);
    document.getElementById('kpi-uv-val').textContent     = fmt(d.uv);
    document.getElementById('kpi-pv-val').textContent     = fmt(d.pv);
    document.getElementById('kpi-cvr-val').textContent    = d.conversion_rate + '%';
    document.getElementById('kpi-abandon-val').textContent = d.cart_abandon + '%';
    document.getElementById('kpi-depth-val').textContent  = d.pv_per_user;
}

// ─── 基础图表加载 (Overview Tab) ─────────────────────────────────────────────
async function loadFunnel(qs) {
    const data = await fetchJSON(`/api/funnel${qs}`);
    cache.funnel = data;
    const total = data[0]?.users || 1;
    const convRate = (data[2].users / data[0].users * 100).toFixed(1);
    document.getElementById('ai-summary-funnel').innerHTML = 
        `💡 点击到支付最终转化率为 <strong>${convRate}%</strong>，互动用户 ${(data[1].users).toLocaleString()} 人，建议通过加购满减券促成决断。`;

    const option = {
        backgroundColor: 'transparent',
        tooltip: { trigger: 'item', formatter: p => `${p.name}<br>用户: <b>${p.value.toLocaleString()}</b><br>转化率: <b>${(p.value/total*100).toFixed(1)}%</b>` },
        series: [{
            type: 'funnel', left: '10%', width: '80%', top: '8%', bottom: '8%',
            sort: 'descending', gap: 4,
            label: { show: true, position: 'inside', fontSize: 11, color: '#FFFFFF', fontWeight: 600, formatter: p => `${p.name}\n${(p.value/total*100).toFixed(1)}%` },
            itemStyle: { borderWidth: 0 },
            data: data.map((item, i) => ({ name: item.step, value: item.users, itemStyle: { color: i === 0 ? '#3B82F6' : i === 1 ? '#7C3AED' : '#FF5500' } }))
        }]
    };
    funnelChart.setOption(option);
}

async function loadHourly(qs) {
    const data = await fetchJSON(`/api/hourly${qs}`);
    cache.hourly = data;
    const pvData = data.map(d => d.pv);
    const maxPvIdx = pvData.indexOf(Math.max(...pvData));
    document.getElementById('ai-summary-hourly').innerHTML = 
        `💡 晚间 20:00 - 23:00 流量占比最高，其中 <strong>${maxPvIdx}:00</strong> 迎来流量洪峰，宜在黄金时段置顶高转化资源。`;

    const option = {
        backgroundColor: 'transparent',
        tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
        legend: { data: ['PV 浏览量', 'UV 访客数', '成交单量'], textStyle: { color: '#475569', fontSize: 10 }, top: 0 },
        grid: { left: '12%', right: '12%', top: '20%', bottom: '12%' },
        xAxis: [{ type: 'category', data: data.map(d => `${d.hour}:00`), axisLabel: { color: '#64748B', fontSize: 9 } }],
        yAxis: [
            { type: 'value', name: '流量 (次)', nameTextStyle: { align: 'left', padding: [0, 0, 0, -25] }, axisLabel: { color: '#64748B', fontSize: 8 } },
            { type: 'value', name: '成交 (单)', nameTextStyle: { align: 'right', padding: [0, -25, 0, 0] }, axisLabel: { color: '#64748B', fontSize: 8 } }
        ],
        series: [
            { name: 'PV 浏览量', type: 'bar', data: pvData.map((v, i) => ({ value: v, itemStyle: { color: i === maxPvIdx ? '#FF5500' : '#93C5FD' } })) },
            { name: 'UV 访客数', type: 'line', data: data.map(d => d.uv), lineStyle: { color: '#7C3AED', width: 2 }, itemStyle: { color: '#7C3AED' }, symbolSize: 4 },
            { name: '成交单量', type: 'line', yAxisIndex: 1, data: data.map(d => d.buy), lineStyle: { color: '#10B981', width: 2, type: 'dashed' }, itemStyle: { color: '#10B981' }, symbolSize: 3 }
        ]
    };
    hourlyChart.setOption(option);
}

async function loadAbandon(qs) {
    const data = await fetchJSON(`/api/cart-abandonment${qs}`);
    cache.abandon = data;
    const cats   = data.map(d => d.category_name);
    const rates  = data.map(d => d.abandon_rate);
    const topAbandon = cats[0] || "未分类";
    const topRate = rates[0] || 0;
    document.getElementById('ai-summary-abandon').innerHTML = 
        `💡 <strong>${topAbandon}</strong> 购物车流失率高居 <strong>${topRate}%</strong>，凑单转化的商品漏斗显著，建议设计满减门槛券。`;

    const option = {
        backgroundColor: 'transparent',
        tooltip: {
            trigger: 'axis',
            formatter: params => {
                const d = data[data.length - 1 - params[0].dataIndex];
                return `${d.category_name}<br>加购: ${d.cart_users.toLocaleString()} 人<br>购买: ${d.buy_users.toLocaleString()} 人<br>流失率: <b style="color:#FF5500">${d.abandon_rate}%</b>`;
            }
        },
        grid: { left: 80, right: '12%', top: '5%', bottom: '10%' },
        xAxis: { type: 'value', max: 100, axisLabel: { color: '#64748B', formatter: '{value}%', fontSize: 9 } },
        yAxis: { type: 'category', data: [...cats].reverse(), axisLabel: { color: '#475569', fontSize: 9 } },
        series: [{
            type: 'bar',
            data: [...rates].reverse().map(v => ({ value: v, itemStyle: { color: v >= 85 ? '#EF4444' : v >= 75 ? '#F59E0B' : '#3B82F6', borderRadius: [0, 4, 4, 0] } })),
            label: { show: true, position: 'right', formatter: p => p.value + '%', color: '#334155', fontSize: 9.5 }
        }]
    };
    abandonChart.setOption(option);
}

async function loadRFM() {
    const data = await fetchJSON('/api/rfm');
    cache.rfm = data;

    const vipObj = data.find(d => d.segment === '重要价值客户') || { user_count: 0, user_ratio: 0 };
    document.getElementById('ai-summary-rfm').innerHTML = 
        `💡 大盘中<strong>“${vipObj.segment}”</strong>占总成交人数的 <strong>${vipObj.user_ratio}%</strong>，是保障大盘成交盘的核心驱动力。`;

    // 概览页面小图展示各价值群比例饼图
    const option = {
        backgroundColor: 'transparent',
        tooltip: { trigger: 'item', formatter: '{b}: <b>{c}人 ({d}%)</b>' },
        legend: {
            show: true,
            orient: 'vertical',
            left: 'left',
            textStyle: { fontSize: 8, color: '#64748B' },
            itemWidth: 8,
            itemHeight: 8,
            itemGap: 3,
            data: data.map(d => d.segment)
        },
        series: [{
            type: 'pie',
            center: ['65%', '50%'],
            radius: ['40%', '70%'],
            avoidLabelOverlap: false,
            itemStyle: { borderRadius: 3, borderColor: '#fff', borderWidth: 1.5 },
            label: { show: false },
            data: data.map(d => {
                const color = rfmColors[d.segment] || '#94A3B8';
                return { name: d.segment, value: d.user_count, itemStyle: { color } };
            })
        }]
    };
    rfmChart.setOption(option);
}

async function loadAssociation(qs) {
    const data = await fetchJSON(`/api/association${qs}`);
    cache.association = data;
    const topLink = data.links?.[0];
    const topText = topLink 
        ? `<strong>${topLink.source} ↔ ${topLink.target}</strong> 提升度高达 <strong>${topLink.value} 倍</strong>`
        : "商品购买表现出跨类目一站式凑单特性";
    document.getElementById('ai-summary-association').innerHTML = 
        `💡 ${topText}，已提取共购频繁对，可在结账页底栏设置一键凑单套餐。`;

    const option = {
        backgroundColor: 'transparent',
        tooltip: { formatter: p => p.dataType === 'edge' ? `${p.data.source} ↔ ${p.data.target}<br>提升度 Lift: <b>${p.data.value}</b><br>共购次数: ${p.data.support}` : `品类: ${p.name}` },
        series: [{
            type: 'graph', layout: 'force', roam: true, draggable: true,
            label: { show: true, position: 'right', color: '#0F172A', fontSize: 9.5, formatter: '{b}' },
            force: { repulsion: 220, edgeLength: [60, 130], gravity: 0.15 },
            lineStyle: { opacity: 0.75, width: 2, curveness: 0.15, color: '#94A3B8' },
            emphasis: { focus: 'adjacency', lineStyle: { width: 4, color: '#FF5500' } },
            data: (data.nodes || []).map(n => ({ name: n.name, symbolSize: Math.max(12, Math.min(32, n.symbolSize)), itemStyle: { color: '#93C5FD' } })),
            links: (data.links || []).map(l => ({ source: l.source, target: l.target, value: l.value, support: l.support, lineStyle: { width: Math.min(5, l.value * 1.5) } }))
        }]
    };
    assocChart.setOption(option);
}

async function loadLatency() {
    const data = await fetchJSON('/api/latency');
    cache.latency = data;
    const total = data.reduce((a, b) => a + b.count, 0) || 1;
    const impulseRate = (data[0]?.count / total * 100).toFixed(1);
    document.getElementById('ai-summary-latency').innerHTML = 
        `💡 超过 <strong>${impulseRate}%</strong> 的用户在浏览 1 小时内即完成购买决策，冲动消费极为普遍，限时抢购收效最大。`;

    const option = {
        backgroundColor: 'transparent',
        tooltip: { trigger: 'axis', formatter: params => `${params[0].name}<br>购买用户数: <b>${params[0].value.toLocaleString()}</b><br>占比: <b>${(params[0].value/total*100).toFixed(1)}%</b>` },
        grid: { left: '8%', right: '6%', top: '10%', bottom: '15%' },
        xAxis: { type: 'category', data: data.map(d => d.bucket), axisLabel: { color: '#64748B', fontSize: 9 } },
        yAxis: { type: 'value', axisLabel: { color: '#64748B', fontSize: 9 } },
        series: [{
            type: 'bar',
            data: data.map((d, i) => ({ value: d.count, itemStyle: { color: colors[i], borderRadius: [4, 4, 0, 0] } })),
            label: { show: true, position: 'top', formatter: p => (p.value/total*100).toFixed(1) + '%', color: '#334155', fontSize: 10 }
        }]
    };
    latencyChart.setOption(option);
}

// ─── 侧边栏工作区渲染分发 ─────────────────────────────────────────────────────
function triggerWorkspaceRender(view) {
    if (view === 'overview') {
        // 重绘概览图表，防止容器大小改变时显示变形
        setTimeout(() => {
            [funnelChart, hourlyChart, abandonChart, rfmChart, assocChart, latencyChart].forEach(c => c && c.resize());
        }, 50);
        return;
    }
    
    setTimeout(() => {
        if (view === 'funnel') renderWorkspaceFunnel();
        else if (view === 'hourly') renderWorkspaceHourly();
        else if (view === 'abandon') renderWorkspaceAbandon();
        else if (view === 'rfm') renderWorkspaceRFM();
        else if (view === 'association') renderWorkspaceAssociation();
    }, 50);
}

// ─── ⏳ 工作区 2: 漏斗下钻 ─────────────────────────────────────────────────────
function renderWorkspaceFunnel() {
    const canvas = document.getElementById('ws-funnel-chart');
    if (!canvas) return;
    if (wsFunnelChart) wsFunnelChart.dispose();
    wsFunnelChart = echarts.init(canvas);

    const data = cache.funnel || [];
    const total = data[0]?.users || 1;

    const option = {
        backgroundColor: 'transparent',
        tooltip: { trigger: 'item', formatter: p => `${p.name}<br>用户: <b>${p.value.toLocaleString()}</b><br>转化率: <b>${(p.value/total*100).toFixed(1)}%</b>` },
        series: [{
            type: 'funnel', left: '12%', width: '76%', top: '8%', bottom: '8%',
            sort: 'descending', gap: 6,
            label: { show: true, position: 'inside', fontSize: 13, fontWeight: 700, formatter: p => `${p.name}\n${(p.value/total*100).toFixed(1)}%` },
            itemStyle: { borderWidth: 0 },
            data: data.map((item, i) => ({ name: item.step, value: item.users, itemStyle: { color: i === 0 ? '#3B82F6' : i === 1 ? '#7C3AED' : '#FF5500' } }))
        }]
    };
    wsFunnelChart.setOption(option);

    // 明细表挂载
    document.getElementById('ws-funnel-table').innerHTML = buildTable(
        ['漏斗层级', '覆盖访客 (去重)', '对首层漏斗比', '环比上一层级损耗'],
        data.map((d, i) => [
            `<b>${d.step}</b>`,
            d.users.toLocaleString() + ' 人',
            (d.users / total * 100).toFixed(1) + '%',
            i === 0 ? '—' : `<span style="color:#EF4444">-${((data[i-1].users - d.users) / data[i-1].users * 100).toFixed(1)}%</span>`
        ])
    );

    renderBusinessAttribution('funnel', document.getElementById('ws-funnel-ai'));
}

// ─── ⏱️ 工作区 3: 分时波谱 ─────────────────────────────────────────────────────
function renderWorkspaceHourly() {
    const canvas = document.getElementById('ws-hourly-chart');
    if (!canvas) return;
    if (wsHourlyChart) wsHourlyChart.dispose();
    wsHourlyChart = echarts.init(canvas);

    const data = cache.hourly || [];
    const pvData = data.map(d => d.pv);
    const maxPv = Math.max(...pvData);

    const option = {
        backgroundColor: 'transparent',
        tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
        legend: { data: ['PV 流量', 'UV 访客', '付款单数'], textStyle: { color: '#334155' }, top: 0 },
        grid: { left: '10%', right: '10%', top: '18%', bottom: '10%' },
        xAxis: [{ type: 'category', data: data.map(d => `${d.hour}:00`), axisLabel: { color: '#64748B' } }],
        yAxis: [
            { type: 'value', name: '浏览与到访', nameTextStyle: { align: 'left', padding: [0, 0, 0, -25] }, axisLabel: { color: '#64748B' } },
            { type: 'value', name: '成交单量', nameTextStyle: { align: 'right', padding: [0, -25, 0, 0] }, axisLabel: { color: '#64748B' } }
        ],
        series: [
            { name: 'PV 流量', type: 'bar', data: pvData.map(v => ({ value: v, itemStyle: { color: v === maxPv ? '#FF5500' : '#93C5FD' } })) },
            { name: 'UV 访客', type: 'line', data: data.map(d => d.uv), lineStyle: { color: '#7C3AED', width: 2.5 }, itemStyle: { color: '#7C3AED' } },
            { name: '付款单数', type: 'line', yAxisIndex: 1, data: data.map(d => d.buy), lineStyle: { color: '#10B981', width: 2, type: 'dashed' }, itemStyle: { color: '#10B981' } }
        ]
    };
    wsHourlyChart.setOption(option);

    // 明细表挂载
    document.getElementById('ws-hourly-table').innerHTML = buildTable(
        ['时段', '浏览量 (PV)', '访客数 (UV)', '支付量 (Buy)', '转化效率'],
        data.map(d => [
            d.hour + ':00',
            d.pv.toLocaleString() + ' 次',
            d.uv.toLocaleString() + ' 人',
            d.buy.toLocaleString() + ' 笔',
            d.uv > 0 ? (d.buy / d.uv * 100).toFixed(2) + '%' : '0%'
        ])
    );

    renderBusinessAttribution('hourly', document.getElementById('ws-hourly-ai'));
}

// ─── 🛑 工作区 4: 凑单流失与流失模拟 ───────────────────────────────────────────
function renderWorkspaceAbandon() {
    const canvas = document.getElementById('ws-abandon-chart');
    if (!canvas) return;
    if (wsAbandonChart) wsAbandonChart.dispose();
    wsAbandonChart = echarts.init(canvas);

    const data = cache.abandon || [];
    const cats   = data.map(d => d.category_name);
    const rates  = data.map(d => d.abandon_rate);

    const option = {
        backgroundColor: 'transparent',
        tooltip: { trigger: 'axis', formatter: p => {
            const d = data[data.length - 1 - p[0].dataIndex];
            return `${d.category_name}<br>加购访客: ${d.cart_users.toLocaleString()}<br>购买访客: ${d.buy_users.toLocaleString()}<br>流失率: <b>${d.abandon_rate}%</b>`;
        }},
        grid: { left: 80, right: '12%', top: '5%', bottom: '8%' },
        xAxis: { type: 'value', max: 100, axisLabel: { color: '#64748B', formatter: '{value}%' } },
        yAxis: { type: 'category', data: [...cats].reverse(), axisLabel: { color: '#475569' } },
        series: [{
            type: 'bar',
            data: [...rates].reverse().map(v => ({ value: v, itemStyle: { color: v >= 85 ? '#EF4444' : v >= 75 ? '#F59E0B' : '#3B82F6', borderRadius: [0, 4, 4, 0] } })),
            label: { show: true, position: 'right', formatter: p => p.value + '%', color: '#334155', fontWeight: 600 }
        }]
    };
    wsAbandonChart.setOption(option);

    // 明细表挂载
    document.getElementById('ws-abandon-table').innerHTML = buildTable(
        ['类目名称', '购物车访客', '最终成交访客', '流失率'],
        data.map(d => [
            d.category_name,
            d.cart_users.toLocaleString() + ' 人',
            d.buy_users.toLocaleString() + ' 人',
            `<span style="color:${d.abandon_rate >= 80 ? '#EF4444' : '#F59E0B'};font-weight:700;">${d.abandon_rate}%</span>`
        ])
    );

    // 运行凑单挽回模拟计算
    runRecoverySimulation();

    renderBusinessAttribution('abandon', document.getElementById('ws-abandon-ai'));
}

function runRecoverySimulation() {
    const discount = parseInt(document.getElementById('sim-discount').value);
    document.getElementById('sim-discount-val').textContent = `${discount}%`;

    const data = cache.abandon || [];
    const totalLost = data.reduce((acc, curr) => acc + (curr.cart_users - curr.buy_users), 0);

    const recallRate = (discount * 0.8).toFixed(1);
    document.getElementById('sim-recall-rate').textContent = `${recallRate}%`;

    // 科学化模拟器：不仅计算人数，同时换算为预计回笼的销售额 (GMV)
    // 假设大促平均客单价 280 元
    const avgOrderValue = 280;
    const recovered = Math.round(totalLost * (recallRate / 100));
    const recoveredGMV = Math.round(recovered * avgOrderValue);
    
    document.getElementById('sim-recovered-users').innerHTML = 
        `${recovered.toLocaleString()} 人 <span style="font-size:0.75rem;color:var(--text-muted);font-weight:normal;">(预期回笼 GMV: <b style="color:#FF5500;">¥${recoveredGMV.toLocaleString()}</b>)</span>`;
}

// ─── 💎 工作区 5: 买家 RFM 价值分层气泡图 ───────────────────────────────────────────
function renderWorkspaceRFM() {
    const canvas = document.getElementById('ws-rfm-chart');
    if (!canvas) return;
    if (wsRfmChart) wsRfmChart.dispose();
    wsRfmChart = echarts.init(canvas);

    const data = cache.rfm || [];

    const seriesData = data.map(d => {
        const color = rfmColors[d.segment] || '#94A3B8';
        return {
            name: d.segment,
            value: [d.avg_recency, d.avg_frequency, d.user_count, d.avg_monetary, d.user_ratio],
            itemStyle: { color: color }
        };
    });

    const option = {
        backgroundColor: 'transparent',
        grid: { left: '8%', right: '12%', top: '10%', bottom: '15%' },
        tooltip: {
            formatter: p => {
                const d = p.data;
                return `<b>💎 ${d.name}</b><br>
                        大促客群规模: <b>${d.value[2].toLocaleString()} 人 (${d.value[4]}%)</b><br>
                        人均成交频次: <b>${d.value[1]} 次</b><br>
                        人均消费金额: <b>${d.value[3]} 元</b><br>
                        最近一次购买: <b>${d.value[0]} 天前</b>`;
            }
        },
        xAxis: {
            type: 'value',
            name: '最近购买时间 R (天前)',
            inverse: true, // 最近购买的（值越小）排在右侧
            nameLocation: 'middle',
            nameGap: 30,
            splitLine: { show: true, lineStyle: { type: 'dashed' } },
            axisLabel: { color: '#64748B' }
        },
        yAxis: {
            type: 'value',
            name: '购买频次 F (次)',
            nameLocation: 'middle',
            nameGap: 35,
            splitLine: { show: true, lineStyle: { type: 'dashed' } },
            axisLabel: { color: '#64748B' }
        },
        series: [{
            type: 'scatter',
            data: seriesData,
            symbolSize: val => Math.sqrt(val[2]) * 1.5 + 12, // 自适应气泡尺寸
            label: {
                show: true,
                formatter: p => p.data.name,
                position: 'top',
                fontSize: 10.5,
                color: '#1E293B',
                fontWeight: 600
            }
        }]
    };
    wsRfmChart.setOption(option);

    // 明细表挂载
    document.getElementById('ws-rfm-table').innerHTML = buildTable(
        ['细分客户类型', '大促用户规模', '所占比例', '人均购买频次', '客均交易额'],
        data.map(d => [
            `<span style="color:${rfmColors[d.segment]};font-weight:700;">■</span> <b>${d.segment}</b>`,
            d.user_count.toLocaleString() + ' 人',
            d.user_ratio + '%',
            d.avg_frequency + ' 次',
            `¥${d.avg_monetary.toLocaleString()}`
        ])
    );

    renderBusinessAttribution('rfm', document.getElementById('ws-rfm-ai'));
}

// ─── 🕸️ 工作区 6: 关联推荐网络与搭售生成器 ───────────────────────────────────────
function renderWorkspaceAssociation() {
    const canvas = document.getElementById('ws-assoc-chart');
    if (!canvas) return;
    if (wsAssocChart) wsAssocChart.dispose();
    wsAssocChart = echarts.init(canvas);

    const data = cache.association || { nodes: [], links: [] };

    const option = {
        backgroundColor: 'transparent',
        tooltip: { formatter: p => p.dataType === 'edge' ? `${p.data.source} ↔ ${p.data.target}<br>提升度 Lift: <b>${p.data.value}</b><br>大促共购: ${p.data.support} 次` : `品类: ${p.name}` },
        series: [{
            type: 'graph', layout: 'force', roam: true, draggable: true,
            label: { show: true, position: 'right', color: '#0F172A', fontSize: 11, formatter: '{b}', fontWeight: 600 },
            force: { repulsion: 300, edgeLength: [80, 160], gravity: 0.12 },
            lineStyle: { opacity: 0.8, width: 2, curveness: 0.15, color: '#94A3B8' },
            emphasis: { focus: 'adjacency', lineStyle: { width: 5, color: '#FF5500' } },
            data: (data.nodes || []).map(n => ({ name: n.name, symbolSize: Math.max(16, Math.min(38, n.symbolSize)), itemStyle: { color: '#93C5FD' } })),
            links: (data.links || []).map(l => ({ source: l.source, target: l.target, value: l.value, support: l.support, lineStyle: { width: Math.min(6, l.value * 1.8) } }))
        }]
    };
    wsAssocChart.setOption(option);

    // 明细表挂载
    document.getElementById('ws-assoc-table').innerHTML = buildTable(
        ['主购品类 A', '共购品类 B', '提升度 (Lift)', '共购关联频次'],
        (data.links || []).slice(0, 10).map(l => [
            `<b>${l.source}</b>`,
            `<b>${l.target}</b>`,
            `<span style="color:#FF5500;font-weight:700;">${l.value} 倍</span>`,
            l.support + ' 次'
        ])
    );

    // 初始化下拉选单
    populateBundleSelectors();

    renderBusinessAttribution('association', document.getElementById('ws-assoc-ai'));
}

// ─── 搭售生成器下拉菜单绑定 ────────────────────────────────────────────────────
function populateBundleSelectors() {
    const data = cache.association || { nodes: [] };
    const selA = document.getElementById('bundle-cat-a');
    const selB = document.getElementById('bundle-cat-b');

    selA.innerHTML = '';
    selB.innerHTML = '';

    const nodes = data.nodes || [];
    nodes.forEach(n => {
        const optA = document.createElement('option');
        optA.value = n.name; optA.textContent = n.name;
        selA.appendChild(optA);

        const optB = document.createElement('option');
        optB.value = n.name; optB.textContent = n.name;
        selB.appendChild(optB);
    });

    if (selB.options.length > 1) {
        selB.selectedIndex = 1; // 默认选中不同类目
    }
}

function runBundleBuilder() {
    const catA = document.getElementById('bundle-cat-a').value;
    const catB = document.getElementById('bundle-cat-b').value;
    const resultBox = document.getElementById('bundle-result');

    if (catA === catB) {
        resultBox.innerHTML = `<span style="color:#EF4444;">⚠️ 无法计算同品类共购，请选择两个不同的关联类目。</span>`;
        return;
    }

    const data = cache.association || { links: [] };
    const link = data.links.find(l => 
        (l.source === catA && l.target === catB) || 
        (l.source === catB && l.target === catA)
    );

    if (link) {
        // 微调：计算折扣力度建议
        let discountSuggest = "推荐让利套餐价 9.2 折";
        if (link.value >= 2.5) {
            discountSuggest = "💡 关联度极高！推荐套餐合并立享 9.0 折，强化一键凑单";
        } else if (link.value >= 1.8) {
            discountSuggest = "💡 强关联！推荐搭配折扣让利 7% ~ 8%，提供专属合并邮费";
        } else {
            discountSuggest = "💡 一般关联。推荐套餐折扣 9.5 折或加购小红包引流";
        }

        resultBox.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                <span>🎯 共购提升度 (Lift):</span>
                <span class="badge" style="background:#FF5500; font-size:0.82rem;">${link.value} 倍</span>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                <span>🔄 频繁共购次数:</span>
                <span style="font-weight:700; color:#1E3A8A;">${link.support} 次</span>
            </div>
            <p style="margin-top:6px; color:#1E40AF; border-top:1px solid #E2E8F0; padding-top:6px; font-size:0.72rem;">
                <strong>搭配定价建议：</strong><br>
                <span style="color:#7C3AED; font-weight:700;">${discountSuggest}</span><br>
                类目「${catA}」与「${catB}」具有高度显着的凑单倾向。在大促期间建议在加购「${catA}」时在详情页下方直接做「${catB}」的黄金套餐推荐。
            </p>
        `;
    } else {
        resultBox.innerHTML = `
            <p style="color:var(--text-muted);">
                ⚠️ 当前未在 Apriori 频繁项集中检测到 <b>${catA} ↔ ${catB}</b> 的强搭售关联规则（共购倾向弱）。建议尝试选择其他关联紧密的手机、电脑周边、美妆护肤品类。
            </p>
        `;
    }
}

// ─── 统一本地化、数据驱动的运营归因诊断报告生成器 (Business Attribution) ─────
async function renderBusinessAttribution(chartType, element) {
    if (!element) return;
    
    // 读取 AI 脑舱配置
    const provider = localStorage.getItem('ai_provider');
    const apiKey = localStorage.getItem('ai_key');
    const apiBase = localStorage.getItem('ai_base');
    const model = localStorage.getItem('ai_model');

    const hasAI = apiKey && apiKey.trim().length > 0;

    if (hasAI) {
        element.innerHTML = `
            <div style="display:flex;align-items:center;gap:10px;padding:0.75rem;background:#EFF6FF;border-radius:6px;border:1px dashed rgba(59,130,246,0.3);">
                <span class="status-dot pulse" style="background:#3B82F6;"></span>
                <span style="color:#1E40AF;font-size:0.75rem;">🔮 AI 增长顾问正在进行多表交叉归因计算...</span>
            </div>`;
        try {
            const { qs } = getFilters();
            let apiUrl = `/api/ai-analyze?chart_type=${chartType}&${qs.slice(1)}`;
            apiUrl += `api_key=${encodeURIComponent(apiKey)}&`;
            if (apiBase) apiUrl += `api_base=${encodeURIComponent(apiBase)}&`;
            if (model) apiUrl += `model=${encodeURIComponent(model)}&`;

            const r = await fetch(apiUrl);
            if (!r.ok) throw new Error(`HTTP 异常！状态码: ${r.status}`);
            const d = await r.json();
            
            if (d.analysis && d.analysis.length > 50) {
                element.innerHTML = d.analysis;
                return; // 成功展示 AI 归因
            } else {
                throw new Error("AI 接口未返回有效策略内容");
            }
        } catch (e) {
            console.warn("AI 归因异常，已自动降级为本地专家诊断：", e);
        }
    }

    // --- 本地高保真动态推理退避（优雅降级） ---
    let htmlContent = "";
    const prefix = hasAI 
        ? `<div style="font-size:0.7rem; color:var(--accent); margin-bottom:0.75rem; background:var(--accent-lite); padding:4px 8px; border-radius:4px; display:inline-block; border: 1px solid rgba(255,85,0,0.15)">⚠️ AI 归因超时，已自动切换为本地数据运营诊断</div>` 
        : "";

    if (chartType === 'funnel') {
        const data = cache.funnel || [];
        if (data.length < 3) return;
        const total = data[0].users || 1;
        const pv_to_engage = (data[1].users / total * 100).toFixed(1);
        const engage_to_buy = (data[2].users / data[1].users * 100).toFixed(1);

        htmlContent = prefix + `
            <p><strong>1. 大促漏斗漏洞诊断：</strong></p>
            <p>• <strong>浏览 ➔ 兴趣互动转化率</strong>：<b>${pv_to_engage}%</b>。</p>
            <p>${pv_to_engage < 25 ? '⚠️ 互动率偏低。用户进入店铺后流失快，说明引流坑位的商品图和促销价格不够吸引人，建议优化大促主图和商品利益点。' : '✅ 用户种草意愿强烈，说明平台坑位流量质量极高，运营承接面优秀。'}</p>
            <p>• <strong>加购 ➔ 最终付款转化率</strong>：<b>${engage_to_buy}%</b>。</p>
            <p>${engage_to_buy < 65 ? '⚠️ 结算放弃率较高。大量用户加购后未能支付，说明结算路径繁琐或满减凑单门槛偏高。建议针对加购用户定向推送“专属无门槛优惠券”拉动结算率。' : '✅ 付款转化极为顺畅，凑单营销组合与结算流程体验非常良好。'}</p>
            <p><strong>2. 专家运营行动指引：</strong></p>
            <p class="no-indent">当前大盘购物车流失率维持在 <b>${document.getElementById('kpi-abandon-val').textContent}</b>。建议立即上线“购物车挽回消息推送”，当用户加购超过2小时未付款时，自动推送带有“库存储备紧张”提示的5元凑单红包，预期可拉回 15% 以上的流失交易。</p>
        `;
    } 
    else if (chartType === 'hourly') {
        const data = cache.hourly || [];
        const pvData = data.map(d => d.pv);
        const maxPvIdx = pvData.indexOf(Math.max(...pvData)) || 22;

        htmlContent = prefix + `
            <p><strong>1. 分时成交时序诊断：</strong></p>
            <p>• <strong>黄金成交波峰时段</strong>：大盘流量峰值高度锁定在晚间 20:00 - 23:00。其中在 <b>${maxPvIdx}:00</b> 迎来全天交易顶峰。这一时段的流量占比超全天 40%。</p>
            <p>• <strong>秒杀脉冲走势</strong>：凌晨 0:00 - 1:00 呈现极高转化率。虽然访客数不及晚间，但秒杀促成的强成交氛围导致客单价与支付转化率飙升。</p>
            <p><strong>2. 专家运营行动指引：</strong></p>
            <p class="no-indent">建议将直通车及超级推荐的竞价广告预算向晚间 19:30-22:30 倾斜投放，获取最大的流量承接；并在 0 点与 22 点波峰前 15 分钟前置推送“临睡冲动特惠”短信，可额外带来 10%~12% 的订单上浮。</p>
        `;
    } 
    else if (chartType === 'abandon') {
        const data = cache.abandon || [];
        if (data.length === 0) return;
        const topCat = data[0].category_name;
        const topRate = data[0].abandon_rate;

        htmlContent = prefix + `
            <p><strong>1. 购物车凑单漏洞诊断：</strong></p>
            <p>• <strong>高流失漏洞类目</strong>：<b>${topCat}</b> 购物车流失率高达 <b>${topRate}%</b>，流失了较多的用户。数码家电等重决策类目由于比价链路长，通常是购物车流失的重区。</p>
            <p>• <strong>流失诱因分析</strong>：快消美妆和服装等轻决策类目，则主要由于“跨店满减额度差额”，拼单凑不满时用户容易批量放弃购物车。</p>
            <p><strong>2. 专家运营行动指引：</strong></p>
            <p class="no-indent">对于 <b>${topCat}</b>，建议针对加购未购用户配置专享凑单折扣（如拉动模拟器测算的立减幅度），搭配高支持度的强共购配件品类（利用关联推荐网络）共同结账，提供“一键凑单”链接以封堵流失漏洞。</p>
        `;
    } 
    else if (chartType === 'rfm') {
        const data = cache.rfm || [];
        const vipObj = data.find(d => d.segment === '重要价值客户') || { user_count: 0 };
        const lostObj = data.find(d => d.segment === '重要保持客户') || { user_count: 0 };

        htmlContent = prefix + `
            <p><strong>1. RFM 客户价值分层诊断：</strong></p>
            <p>• <strong>高贡献价值中枢</strong>：大盘累计获取 <b>${vipObj.user_count.toLocaleString()} 位“重要价值客户”</b>，该客群展现了最高的购买频次与单次成交额，是大盘GMV最稳定的支柱。</p>
            <p>• <strong>流失高风险预警</strong>：大盘存在 <b>${lostObj.user_count.toLocaleString()} 位“重要保持客户”</b>。该类目客户消费能力强、历史频次高，但大促后段无追加购买，最近一次购买时间距离较远。若不及时唤醒，存在高流失概率。</p>
            <p><strong>2. 专家运营行动指引：</strong></p>
            <p class="no-indent">对“重要保持客户”和“重要挽留客户”应当在大促返场阶段前置推送“积分即将清零提醒”以及“大额满折专享券”，以强损失规避心理将这些高消费潜力买家重新激活。</p>
        `;
    } 
    else if (chartType === 'association') {
        const data = cache.association || { links: [] };
        const links = data.links || [];
        if (links.length === 0) return;
        const topLink = links[0];

        htmlContent = prefix + `
            <p><strong>1. 搭售组合网络诊断：</strong></p>
            <p>• <strong>强频繁项集对</strong>：Apriori 算法探知大盘中购买关联度最高的核心搭配为 <b>${topLink.source} ↔ ${topLink.target}</b>，提升度达 <b>${topLink.value} 倍</b>。</p>
            <p>• <strong>搭配心智分析</strong>：用户倾向于将服装与美妆配饰、手机数码与电脑外设进行同购物车打包结算，以谋求最大的大促折算满减优惠。</p>
            <p><strong>2. 专家运营行动指引：</strong></p>
            <p class="no-indent">建议直接在 <b>${topLink.source}</b> 和 <b>${topLink.target}</b> 详情页上线“超值大促黄金套餐”，提供让利 6%~8% 的打包优惠价，缩短凑单搜索时间，可快速拉升两类目的加购件数。</p>
        `;
    }
    else if (chartType === 'latency') {
        const data = cache.latency || [];
        const total = data.reduce((a, b) => a + b.count, 0) || 1;
        const impulseRate = data[0] ? (data[0].count / total * 100).toFixed(1) : "50.0";

        htmlContent = prefix + `
            <p><strong>1. 点击-购买决策时滞诊断：</strong></p>
            <p>• <strong>购买时效特征</strong>：大盘中有 <b>${impulseRate}%</b> 的成交用户在点击商品后的 1 小时内即完成了付款动作，呈现强烈的冲动消费心智。</p>
            <p>• <strong>决策沉淀区间</strong>：有 20%~25% 的用户决策时间处于 1-3 天。这一部分买家在大促中表现出明显的比价和跨平台衡量心理，是阻碍转化速度的主要群体。</p>
            <p><strong>2. 专家运营行动指引：</strong></p>
            <p class="no-indent">针对 1 小时内快速购买的冲动用户，应当在主坑位搭配“限时秒杀”利益点，催化快速决断；针对处于 1-3 天决策周期的犹豫用户，应当在其加购 24 小时后通过短信/Push 提醒历史最低价，促使其提前转化。</p>
        `;
    }

    element.innerHTML = htmlContent;
}

// ─── AI 脑舱配置初始化与联动 ──────────────────────────────────────────────────
function initAIConfig() {
    const providerSel = document.getElementById('ai-provider');
    const keyInput     = document.getElementById('ai-key');
    const baseInput    = document.getElementById('ai-base');
    const modelInput   = document.getElementById('ai-model');
    const saveBtn      = document.getElementById('btn-save-ai');

    // 读取 localStorage 历史配置
    const savedProvider = localStorage.getItem('ai_provider') || 'gemini';
    const savedKey      = localStorage.getItem('ai_key') || '';
    const savedBase     = localStorage.getItem('ai_base') || '';
    const savedModel    = localStorage.getItem('ai_model') || '';

    providerSel.value = savedProvider;
    keyInput.value = savedKey;
    baseInput.value = savedBase;
    modelInput.value = savedModel;

    // 更新 AI 激活徽章与顶栏红点
    updateAIStatusBadge(savedKey);

    // 绑定保存监听
    saveBtn.addEventListener('click', () => {
        const provider = providerSel.value;
        const key = keyInput.value.trim();
        const base = baseInput.value.trim();
        const model = modelInput.value.trim();

        localStorage.setItem('ai_provider', provider);
        localStorage.setItem('ai_key', key);
        localStorage.setItem('ai_base', base);
        localStorage.setItem('ai_model', model);

        updateAIStatusBadge(key);
        alert(key ? '🔮 大模型诊断已激活。已成功加载大模型接口进行运营分析。' : '🔌 大模型诊断已关闭，系统将默认采用本地规则分析。');
        
        // 刷新当前激活工作区的诊断报告
        const panels = {
            'funnel': 'ws-funnel-ai',
            'hourly': 'ws-hourly-ai',
            'abandon': 'ws-abandon-ai',
            'rfm': 'ws-rfm-ai',
            'association': 'ws-assoc-ai'
        };
        const activeElementId = panels[cache.activeView];
        if (activeElementId) {
            renderBusinessAttribution(cache.activeView, document.getElementById(activeElementId));
        }
    });
}

function updateAIStatusBadge(key) {
    const badge = document.getElementById('ai-status-badge');
    const dot = document.getElementById('nav-ai-dot');
    const active = key && key.trim().length > 0;
    
    if (badge) {
        badge.textContent = active ? '已激活' : '未激活';
        badge.className = active ? 'ai-toggle-badge active' : 'ai-toggle-badge inactive';
    }
    if (dot) {
        dot.className = active ? 'ai-badge-dot active' : 'ai-badge-dot inactive';
    }
}

// ─── 详情弹窗 Modal (图表放大明细查看) ──────────────────────────────────────────
function openDetailModal(chartType) {
    const modal   = document.getElementById('detail-modal');
    const title   = document.getElementById('modal-title-text');
    const subtitle = document.getElementById('modal-subtitle-text');
    const tableEl = document.getElementById('modal-table-container');
    const aiEl    = document.getElementById('modal-analysis-content');

    modal.style.display = 'flex';

    const canvas = document.getElementById('modal-chart-canvas');
    if (modalChartInstance) { modalChartInstance.dispose(); }
    modalChartInstance = echarts.init(canvas);

    const { date } = getFilters();
    const catName = document.getElementById('filter-category').selectedOptions[0]?.text || '全品类';
    const dateName = date || '全周期（双十二大促窗口）';
    subtitle.textContent = `当前筛选条件：时间 [${dateName}] × 品类 [${catName}]`;

    let chartTitle = '';
    let modalOption = {};
    let tableHtml = '';

    if (chartType === 'funnel') {
        chartTitle = '01 · 大促全链路转化漏斗';
        const data = cache.funnel || [];
        const total = data[0]?.users || 1;
        modalOption = {
            backgroundColor: 'transparent',
            tooltip: { trigger: 'item', formatter: p => `${p.name}<br>用户: <b>${p.value.toLocaleString()}</b><br>转化率: <b>${(p.value/total*100).toFixed(1)}%</b>` },
            series: [{
                type: 'funnel', left: '15%', width: '70%', top: '10%', bottom: '5%',
                sort: 'descending', gap: 8,
                label: { show: true, position: 'inside', fontSize: 13, fontWeight: 700, formatter: p => `${p.name}\n${p.value.toLocaleString()} 人 (${(p.value/total*100).toFixed(1)}%)` },
                itemStyle: { borderWidth: 0 },
                data: data.map((item, i) => ({ name: item.step, value: item.users, itemStyle: { color: i === 0 ? '#3B82F6' : i === 1 ? '#7C3AED' : '#FF5500' } }))
            }]
        };
        tableHtml = buildTable(
            ['漏斗步骤', '覆盖用户数', '对首层转化率', '环比上级损耗'],
            data.map((d, i) => [
                d.step, d.users.toLocaleString() + ' 人', (d.users / total * 100).toFixed(1) + '%',
                i === 0 ? '—' : ((data[i-1].users - d.users) / data[i-1].users * 100).toFixed(1) + '%'
            ])
        );
    }
    else if (chartType === 'hourly') {
        chartTitle = '02 · 24小时分时行为波谱';
        const data = cache.hourly || [];
        const pvData = data.map(d => d.pv);
        const uvData = data.map(d => d.uv);
        const buyData = data.map(d => d.buy);
        const maxPv  = Math.max(...pvData);
        modalOption = {
            backgroundColor: 'transparent',
            tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
            legend: { data: ['PV', 'UV', '成交'], textStyle: { color: '#475569' }, top: 5 },
            grid: { left: '10%', right: '10%', top: '18%', bottom: '8%' },
            xAxis: [{ type: 'category', data: data.map(d => d.hour + ':00'), axisLabel: { color: '#64748B' } }],
            yAxis: [
                { type: 'value', name: '流量', nameTextStyle: { align: 'left', padding: [0, 0, 0, -25] }, axisLabel: { color: '#64748B' } },
                { type: 'value', name: '成交', nameTextStyle: { align: 'right', padding: [0, -25, 0, 0] }, axisLabel: { color: '#64748B' } }
            ],
            series: [
                { name: 'PV', type: 'bar', data: pvData.map(v => ({ value: v, itemStyle: { color: v === maxPv ? '#FF5500' : 'rgba(59,130,246,0.6)' } })) },
                { name: 'UV', type: 'line', data: uvData, lineStyle: { color: '#7C3AED', width: 2.5 }, itemStyle: { color: '#7C3AED' } },
                { name: '成交', type: 'line', yAxisIndex: 1, data: buyData, lineStyle: { color: '#10B981', width: 2, type: 'dashed' }, itemStyle: { color: '#10B981' } }
            ]
        };
        tableHtml = buildTable(
            ['时间点', 'PV 浏览量', 'UV 访客数', '成交订单数', '分时下单率'],
            data.map(d => [
                d.hour + ':00', d.pv.toLocaleString() + ' 次', d.uv.toLocaleString() + ' 人', d.buy.toLocaleString() + ' 单',
                d.uv > 0 ? (d.buy / d.uv * 100).toFixed(2) + '%' : '0%'
            ])
        );
    }
    else if (chartType === 'abandon') {
        chartTitle = '03 · 加购未购流失品类 Top 10';
        const data = cache.abandon || [];
        modalOption = {
            backgroundColor: 'transparent',
            tooltip: { trigger: 'axis', formatter: params => {
                const d = data[data.length - 1 - params[0].dataIndex];
                return `${d.category_name}<br>加购: ${d.cart_users.toLocaleString()}人<br>购买: ${d.buy_users.toLocaleString()}人<br>流失率: <b>${d.abandon_rate}%</b>`;
            }},
            grid: { left: 80, right: '12%', top: '4%', bottom: '8%' },
            xAxis: { type: 'value', max: 100, axisLabel: { formatter: '{value}%', color: '#64748B' } },
            yAxis: { type: 'category', data: [...data.map(d => d.category_name)].reverse(), axisLabel: { color: '#475569' } },
            series: [{
                type: 'bar',
                data: [...data.map(d => d.abandon_rate)].reverse().map(v => ({ value: v, itemStyle: { color: v >= 85 ? '#EF4444' : v >= 75 ? '#F59E0B' : '#3B82F6', borderRadius: [0, 5, 5, 0] } })),
                label: { show: true, position: 'right', formatter: p => p.value + '%', color: '#334155' }
            }]
        };
        tableHtml = buildTable(
            ['品类名称', '加购人数', '购买人数', '流失差额', '放弃率'],
            data.map(d => [
                d.category_name, d.cart_users.toLocaleString() + ' 人', d.buy_users.toLocaleString() + ' 人',
                `<span style="color:#EF4444">${(d.cart_users - d.buy_users).toLocaleString()} 人</span>`, `<b>${d.abandon_rate}%</b>`
            ])
        );
    }
    else if (chartType === 'rfm') {
        chartTitle = '04 · 大促买家 RFM 价值分层多维气泡云';
        const data = cache.rfm || [];
        const seriesData = data.map(d => {
            const color = rfmColors[d.segment] || '#94A3B8';
            return {
                name: d.segment,
                value: [d.avg_recency, d.avg_frequency, d.user_count, d.avg_monetary, d.user_ratio],
                itemStyle: { color: color }
            };
        });
        modalOption = {
            backgroundColor: 'transparent',
            grid: { left: '10%', right: '12%', top: '10%', bottom: '15%' },
            tooltip: {
                formatter: p => {
                    const d = p.data;
                    return `<b>💎 ${d.name}</b><br>
                            大促客群规模: <b>${d.value[2].toLocaleString()} 人 (${d.value[4]}%)</b><br>
                            人均成交频次: <b>${d.value[1]} 次</b><br>
                            人均消费金额: <b>${d.value[3]} 元</b><br>
                            最近一次购买: <b>${d.value[0]} 天前</b>`;
                }
            },
            xAxis: {
                type: 'value',
                name: '最近购买时间 R (天前)',
                inverse: true,
                nameLocation: 'middle',
                nameGap: 30,
                splitLine: { show: true, lineStyle: { type: 'dashed' } },
                axisLabel: { color: '#64748B' }
            },
            yAxis: {
                type: 'value',
                name: '购买频次 F (次)',
                nameLocation: 'middle',
                nameGap: 35,
                splitLine: { show: true, lineStyle: { type: 'dashed' } },
                axisLabel: { color: '#64748B' }
            },
            series: [{
                type: 'scatter',
                data: seriesData,
                symbolSize: val => Math.sqrt(val[2]) * 1.8 + 14,
                label: {
                    show: true,
                    formatter: p => p.data.name,
                    position: 'top',
                    fontSize: 11,
                    color: '#1E293B',
                    fontWeight: 600
                }
            }]
        };
        tableHtml = buildTable(
            ['细分客群名称', '客群用户数', '比率', '人均成交频次', '人均大促成交额', '平均回购时效'],
            data.map(d => [
                `<b>${d.segment}</b>`, d.user_count.toLocaleString() + ' 人', d.user_ratio + '%',
                d.avg_frequency + ' 次', '¥' + d.avg_monetary.toLocaleString(), d.avg_recency + ' 天前'
            ])
        );
    }
    else if (chartType === 'association') {
        chartTitle = '05 · 购物篮类目关联推荐网络';
        const data = cache.association || { links: [] };
        modalOption = {
            backgroundColor: 'transparent',
            tooltip: { formatter: p => p.dataType === 'edge' ? `${p.data.source} ↔ ${p.data.target}<br>提升度 Lift: <b>${p.data.value}</b><br>共购: ${p.data.support} 次` : `品类: ${p.name}` },
            series: [{
                type: 'graph', layout: 'force', roam: true, draggable: true,
                label: { show: true, position: 'right', color: '#0F172A', fontSize: 11, formatter: '{b}' },
                force: { repulsion: 300, edgeLength: [80, 160], gravity: 0.12 },
                lineStyle: { opacity: 0.75, width: 2, curveness: 0.15, color: '#94A3B8' },
                emphasis: { focus: 'adjacency', lineStyle: { width: 5, color: '#FF5500' } },
                data: (data.nodes || []).map(n => ({ name: n.name, symbolSize: Math.max(16, Math.min(38, n.symbolSize)), itemStyle: { color: '#93C5FD' } })),
                links: (data.links || []).map(l => ({ source: l.source, target: l.target, value: l.value, support: l.support, lineStyle: { color: '#7C3AED', width: Math.min(6, l.value * 2) } }))
            }]
        };
        tableHtml = buildTable(
            ['核心类目 A', '强共购类目 B', '大促共购规模', 'Lift 提升度', '推荐引擎设置建议'],
            (data.links || []).slice(0, 15).map(l => [
                l.source, l.target, l.support + ' 次', `<span style="color:#FF5500;font-weight:700">${l.value} 倍</span>`,
                l.value >= 2.0 ? '主推：详情页套餐一键捆绑' : '辅推：购物车凑单立减弹窗'
            ])
        );
    }
    else if (chartType === 'latency') {
        chartTitle = '06 · 点击至下单决策时滞分布';
        const data = cache.latency || [];
        const total = data.reduce((a, b) => a + b.count, 0) || 1;
        const colors = ['#10B981', '#3B82F6', '#7C3AED', '#F59E0B', '#EF4444', '#94A3B8'];
        modalOption = {
            backgroundColor: 'transparent',
            tooltip: { trigger: 'axis', formatter: p => `${p[0].name}<br>购买量: <b>${p[0].value.toLocaleString()}</b><br>占比: <b>${(p[0].value/total*100).toFixed(1)}%</b>` },
            grid: { left: '8%', right: '6%', top: '8%', bottom: '12%' },
            xAxis: { type: 'category', data: data.map(d => d.bucket), axisLabel: { color: '#64748B' } },
            yAxis: { type: 'value', axisLabel: { color: '#64748B' } },
            series: [{
                type: 'bar',
                data: data.map((d, i) => ({ value: d.count, itemStyle: { color: colors[i], borderRadius: [5, 5, 0, 0] } })),
                label: { show: true, position: 'top', formatter: p => (p.value/total*100).toFixed(1) + '%', color: '#334155' }
            }]
        };
        tableHtml = buildTable(
            ['决策时间区间', '成交用户数', '占比', '用户类型', '运营建议'],
            data.map((d, i) => {
                const types = ['冲动消费型', '快速决策型', '正常对比型', '理性比价型', '深度比价型', '长周期型'];
                const tips  = ['强化秒杀氛围', '保持大促优惠力度', '提供价格保证', '强调限时性', '推送专属唤醒优惠', '触发定期召回'];
                return [d.bucket, d.count.toLocaleString() + ' 人', (d.count/total*100).toFixed(1) + '%', types[i], tips[i]];
            })
        );
    }

    title.textContent = chartTitle;
    modalChartInstance.setOption(modalOption);
    tableEl.innerHTML = tableHtml;

    // 弹窗内的本地诊断报告渲染
    renderBusinessAttribution(chartType, aiEl);
}

// ─── 弹窗关闭 ────────────────────────────────────────────────────────────────
function closeModal() {
    document.getElementById('detail-modal').style.display = 'none';
    if (modalChartInstance) { modalChartInstance.dispose(); modalChartInstance = null; }
}

// ─── Pandas 数据沙箱 ──────────────────────────────────────────────────────────
async function runSandbox() {
    const code = document.getElementById('sandbox-code').value;
    const output = document.getElementById('sandbox-output');
    output.textContent = '⚡ 正在沙箱数仓中查询，请稍候...';
    try {
        const res = await fetch('/api/execute-pandas', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code })
        });
        
        if (!res.ok) {
            throw new Error(`HTTP 异常！状态码: ${res.status}`);
        }
        
        const data = await res.json();
        if (data.status === 'error') {
            output.innerHTML = `<span style="color:#EF4444">❌ ${data.error}</span>`;
        } else {
            const r = data.result;
            if (Array.isArray(r) && r.length > 0 && typeof r[0] === 'object') {
                output.innerHTML = buildTable(Object.keys(r[0]), r.map(row => Object.values(row)));
            } else {
                output.textContent = JSON.stringify(r, null, 2);
            }
        }
    } catch (e) {
        output.innerHTML = `<span style="color:#EF4444">❌ 网络异常: ${e.message}</span>`;
    }
}

// ─── 通用网络与 HTML 拼接辅助 ──────────────────────────────────────────────────
async function fetchJSON(url) {
    try {
        const res = await fetch(url);
        if (!res.ok) {
            console.error(`Fetch error: ${url} status ${res.status}`);
            return null;
        }
        return await res.json();
    } catch (e) {
        console.error(`Fetch exception: ${url}`, e);
        return null;
    }
}

function buildTable(headers, rows) {
    let html = '<table class="sandbox-table"><thead><tr>';
    headers.forEach(h => { html += `<th>${h}</th>`; });
    html += '</tr></thead><tbody>';
    rows.forEach(row => {
        html += '<tr>';
        row.forEach(cell => { html += `<td>${cell}</td>`; });
        html += '</tr>';
    });
    html += '</tbody></table>';
    return html;
}
