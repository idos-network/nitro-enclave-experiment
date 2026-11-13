import {
  type Attributes,
  context,
  propagation,
  SpanKind,
  SpanStatusCode,
  trace,
} from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  BatchSpanProcessor,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
  TracerProvider,
} from "@opentelemetry/sdk-trace";
import Pyroscope from "@pyroscope/nodejs";
import type { RequestHandler } from "express";
import { getLogger } from "./logger.ts";
import { getRequestId } from "./request-context.ts";

// A no-op until startTelemetry registers a provider, so spans cost nothing with tracing off.
const tracer = trace.getTracer("@idos/tee-common");

/**
 * Both are off unless config.env (S3, host-controlled, outside the PCRs) turns them on, so
 * nothing below may put user data on a span: only names, routes, status codes, request ids.
 * - OTEL_TRACES_SAMPLE_RATE (0..1]: share of requests traced, unless the caller's
 *   traceparent already decided (relay samples, enclave follows it).
 * - PYROSCOPE_URL: continuous profiling of the whole process; keep it to staging/sandbox.
 */
export function startTelemetry(defaultService: string, env: NodeJS.ProcessEnv = process.env) {
  const environment = env.OTEL_ENVIRONMENT ?? "unknown";
  const service = env.OTEL_SERVICE ?? defaultService;
  const auth = { user: env.OTEL_USER ?? "", password: env.OTEL_PASSWORD ?? "" };

  const sampleRate = Number(env.OTEL_TRACES_SAMPLE_RATE ?? 0);
  if (sampleRate > 0 && env.OTEL_BASE_URL) {
    context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
    propagation.setGlobalPropagator(new W3CTraceContextPropagator());
    trace.setGlobalTracerProvider(
      new TracerProvider({
        resource: resourceFromAttributes({
          "service.name": `${service}-${environment}`,
          "deployment.environment.name": environment,
        }),
        sampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(sampleRate) }),
        spanProcessors: [
          new BatchSpanProcessor({
            exporter: new OTLPTraceExporter({
              // the monitoring Caddy rewrites this to VictoriaTraces' OTLP insert endpoint
              url: `${env.OTEL_BASE_URL}/traces/otlp/v1/traces`,
              headers: {
                Authorization: `Basic ${Buffer.from(`${auth.user}:${auth.password}`).toString("base64")}`,
              },
            }),
          }),
        ],
      }),
    );
    // shortcut: spans still queued at shutdown are dropped; flush in startServer if that matters.
    getLogger().info({ sampleRate }, "tracing enabled");
  }

  if (env.PYROSCOPE_URL) {
    Pyroscope.init({
      serverAddress: env.PYROSCOPE_URL,
      appName: `${service}-${environment}`,
      basicAuthUser: auth.user,
      basicAuthPassword: auth.password,
    });
    Pyroscope.start();
    getLogger().info("profiling enabled");
  }
}

/** Server span per request, continuing the caller's trace from its traceparent header. */
export const tracingMiddleware: RequestHandler = (req, res, next) => {
  const parent = propagation.extract(context.active(), req.headers);
  const span = tracer.startSpan(
    req.method,
    { kind: SpanKind.SERVER, attributes: { "http.request.method": req.method } },
    parent,
  );
  const requestId = getRequestId();
  if (requestId) span.setAttribute("request.id", requestId);

  // 'close' fires after 'finish' and also on aborted requests, so the span always ends.
  res.once("close", () => {
    // route template (/session/decrypt), never the raw URL: no query strings on spans
    const route: string | undefined = req.route?.path;
    if (route) {
      span.updateName(`${req.method} ${route}`);
      span.setAttribute("http.route", route);
    }
    span.setAttribute("http.response.status_code", res.statusCode);
    if (res.statusCode >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
    span.end();
  });

  context.with(trace.setSpan(parent, span), next);
};

/** Runs fn in a child span. Errors only mark the span: their messages can carry request data. */
export function withSpan<T>(name: string, fn: () => T): T {
  return tracer.startActiveSpan(name, (span) => {
    const fail = (error: unknown): never => {
      span.setStatus({ code: SpanStatusCode.ERROR });
      span.end();
      throw error;
    };
    try {
      const result = fn();
      if (result instanceof Promise) {
        return result.then((value) => {
          span.end();
          return value;
        }, fail) as T;
      }
      span.end();
      return result;
    } catch (error) {
      return fail(error);
    }
  });
}

/** fn with every call in a span named name; wrap at the definition so all callers are traced. */
export function traced<A extends unknown[], R>(name: string, fn: (...args: A) => R) {
  return (...args: A): R => withSpan(name, () => fn(...args));
}

/** Adds attributes to the current span (no-op untraced). Only fixed, non-user values. */
export function annotateSpan(attributes: Attributes) {
  trace.getActiveSpan()?.setAttributes(attributes);
}
