import {
  CloudWatchClient,
  type MetricDatum,
  PutMetricDataCommand,
} from "@aws-sdk/client-cloudwatch";

const cw = new CloudWatchClient({ region: "eu-west-1" });
const namespace = `Enclave${process.env.PREFIX}/Metrics`;

const debugEnabled = process.env.DEBUG === "true";

// {"type":"os","data":{"loadavg":0,"memUsed":21461041152,"memTotal":37063122944}}

export interface OsMetrics {
  type: "os";
  data: {
    loadavg: number;
    memUsed: number;
    memTotal: number;
  };
}

async function sendOsMetrics(item: OsMetrics) {
  const metricData: MetricDatum[] = [];

  metricData.push({
    MetricName: "MemoryUsed",
    Value: item.data.memUsed,
    Unit: "Megabytes",
  });

  metricData.push({
    MetricName: "MemoryTotal",
    Value: item.data.memTotal,
    Unit: "Megabytes",
  });

  metricData.push({
    MetricName: "MemoryUtilization",
    Value: (item.data.memUsed / item.data.memTotal) * 100,
    Unit: "Percent",
  });

  metricData.push({
    MetricName: "CPUUtilization",
    Value: item.data.loadavg,
    Unit: "Percent",
  });

  if (debugEnabled) {
    console.log("-> [AGENT] Sending OS metrics to CloudWatch:");
    console.log("--> Namespace:", namespace);
    console.log(JSON.stringify(metricData, null, 2));
  }

  try {
    const response = await cw.send(
      new PutMetricDataCommand({
        Namespace: namespace,
        MetricData: metricData,
      }),
    );

    if (debugEnabled) {
      console.log("-> [AGENT] CloudWatch response:", response);
    }
  } catch (err) {
    console.error("CloudWatch metrics error:", err);
  }
}

// {"type":"pm2","data":[{"name":"ULS","pid":1030,"status":"online","cpu":0,"memory":85127168},{"name":"FaceSign-service","pid":4327,"status":"online","cpu":0,"memory":76365824},{"name":"FaceTec-Custom-Server","pid":1031,"status":"online","cpu":0,"memory":5065338880},{"name":"Caddy","pid":1072,"status":"online","cpu":0,"memory":43257856}]}

export interface Pm2Metrics {
  type: "pm2";
  data: Array<{
    name: string;
    pid: number;
    status: string;
    cpu: number;
    memory: number;
  }>;
}

async function sendPm2Metrics(item: Pm2Metrics) {
  const metricData: MetricDatum[] = [];

  // PM2 metrics
  item.data.forEach((proc) => {
    metricData.push({
      MetricName: `PM2_${proc.name}_CPU`,
      Value: proc.cpu,
      Unit: "Percent",
    });
    metricData.push({
      MetricName: `PM2_${proc.name}_Memory`,
      Value: proc.memory,
      Unit: "Bytes",
    });
  });

  if (debugEnabled) {
    console.log("-> [AGENT] Sending PM2 metrics to CloudWatch:");
    console.log("--> Namespace:", namespace);
    console.log(JSON.stringify(metricData, null, 2));
  }

  try {
    const response = await cw.send(
      new PutMetricDataCommand({
        Namespace: namespace,
        MetricData: metricData,
      }),
    );

    if (debugEnabled) {
      console.log("-> [AGENT] CloudWatch response:", response);
    }
  } catch (err) {
    console.error("CloudWatch metrics error:", err);
  }
}

export { sendOsMetrics, sendPm2Metrics };
