import { CloudWatchLogsClient, PutLogEventsCommand, CreateLogStreamCommand } from "@aws-sdk/client-cloudwatch-logs";

const logGroupName = "EnclaveLogs";
const logStreamName = "agent-stream";
const cwLogs = new CloudWatchLogsClient({ region: "eu-west-1" });

let sequenceToken;

async function sendLog(message) {
  try {
    // Vytvoření log streamu, pokud neexistuje
    if (!sequenceToken) {
      try {
        await cwLogs.send(new CreateLogStreamCommand({
          logGroupName,
          logStreamName,
        }));
      } catch (e) {
        // ignoruj pokud už existuje
      }
    }

    const params = {
      logEvents: [
        { message: JSON.stringify(message), timestamp: Date.now() }
      ],
      logGroupName,
      logStreamName,
      sequenceToken
    };

    const res = await cwLogs.send(new PutLogEventsCommand(params));
    sequenceToken = res.nextSequenceToken;

  } catch (err) {
    console.error("CloudWatch Logs error:", err);
  }
}

export { sendLog };
