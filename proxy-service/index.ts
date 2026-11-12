import { startServer } from "@idos/tee-common/start-server.ts";
import { startTelemetry } from "@idos/tee-common/telemetry.ts";
import app from "./server.ts";

startTelemetry("proxy");
startServer(app);
