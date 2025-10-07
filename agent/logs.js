import { CloudWatchLogsClient, PutLogEventsCommand, CreateLogStreamCommand, CreateLogGroupCommand } from "@aws-sdk/client-cloudwatch-logs";

const logGroupName = "/ec2/nitro/facesign";
const logStreamName = "agent-stream";
const cwLogs = new CloudWatchLogsClient({ region: "eu-west-1" });

let sequenceToken;

async function sendLog(message) {
  try {
    if (!sequenceToken) {
      try {
        await cwLogs.send(new CreateLogGroupCommand({ logGroupName }));
      } catch (e) {
        // Ignore if already exists
      }

      try {
        await cwLogs.send(new CreateLogStreamCommand({
          logGroupName,
          logStreamName,
        }));
      } catch (e) {
        // Ignore if already exists
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
