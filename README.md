# 地震台站数据质量检测服务

纯后端 Node.js + TypeScript + Fastify 服务，面向地震台站观测数据接入与质量检测。

## 能力

- 台站档案管理
- 观测摘要批量接入
- 采样完整性、波形削顶、时间同步检测
- 质量评分与问题标签
- 按台站/分数查询观测记录
- 生成时间窗口质量报告

## 观测接入的统一状态规则

实时观测与断网补传观测可能交错、重复到达，`POST /api/observations/ingest` 统一按以下规则处理（结果通过响应头 `x-ingest-result` 返回）：

- `duplicate`：同一台站 + 同一观测时刻视为同一观测，幂等返回首条记录（HTTP 200），不重复入库、不影响台站状态与质量报告统计
- `fresh`：观测时刻晚于台站 `lastSeenAt`，入库并推进 `lastSeenAt`；非维护台站同时转为 `online`
- `late`：迟到/补传的旧观测，正常入库参与质量统计，但不回滚 `lastSeenAt`、不改变在线状态
- `maintained`：维护期（`maintenance`）台站收到观测，数据入库、`lastSeenAt` 照常推进，但维持维护状态，不被观测自动改成 `online`

观测时间统一归一化为 UTC ISO 存储，质量报告按时间戳数值比较窗口边界，不同时区写法不会影响判重与统计。

## 启动

```bash
npm install
npm run dev
```

默认端口：`4301`。当前使用内存存储，后续可替换 PostgreSQL/时序数据库，并接入 Kafka、SeedLink 或对象存储。
