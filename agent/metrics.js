import { CloudWatchClient, PutMetricDataCommand } from "@aws-sdk/client-cloudwatch";

const cw = new CloudWatchClient({ region: "eu-west-1" });
const namespace = "Enclave/Metrics";

// {"type":"os","data":{"loadavg":0,"memUsed":21461041152,"memTotal":37063122944}}
async function sendOsMetrics(item) {
  const metricData = [];

  // OS metriky
  metricData.push({
    MetricName: "MemoryUsed",
    Value: item.data.memUsed,
    Unit: "Bytes"
  });
  metricData.push({
    MetricName: "MemoryTotal",
    Value: item.data.memTotal,
    Unit: "Bytes"
  });
  metricData.push({
    MetricName: "LoadAvg",
    Value: item.data.loadavg,
    Unit: "Count"
  });

  try {
    await cw.send(new PutMetricDataCommand({
      Namespace: namespace,
      MetricData: metricData
    }));
  } catch (err) {
    console.error("CloudWatch metrics error:", err);
  }
}

// {"type":"pm2","data":[{"name":"ULS","pid":1030,"status":"online","cpu":0,"memory":85127168},{"name":"FaceSign-service","pid":4327,"status":"online","cpu":0,"memory":76365824},{"name":"FaceTec-Custom-Server","pid":1031,"status":"online","cpu":0,"memory":5065338880},{"name":"Caddy","pid":1072,"status":"online","cpu":0,"memory":43257856}]}
async function sendPm2Metrics(item) {
  const metricData = [];
  // PM2 metriky
  item.data.forEach(proc => {
    metricData.push({
      MetricName: `PM2_${proc.name}_CPU`,
      Value: proc.cpu,
      Unit: "Percent"
    });
    metricData.push({
      MetricName: `PM2_${proc.name}_Memory`,
      Value: proc.memory,
      Unit: "Bytes"
    });
  });

  try {
    await cw.send(new PutMetricDataCommand({
      Namespace: namespace,
      MetricData: metricData
    }));
  } catch (err) {
    console.error("CloudWatch metrics error:", err);
  }
}

export { sendOsMetrics, sendPm2Metrics };