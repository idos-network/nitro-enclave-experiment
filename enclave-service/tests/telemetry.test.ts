import { withSpan } from "@idos/tee-common/telemetry.ts";
import { context, propagation, SpanStatusCode, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import {
  InMemorySpanExporter,
  ParentBasedSampler,
  SimpleSpanProcessor,
  TraceIdRatioBasedSampler,
  TracerProvider,
} from "@opentelemetry/sdk-trace";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { app, resetMocks } from "./app.ts";

const getAttestationDocument = vi.hoisted(() => vi.fn());
vi.mock("@idos/nitro-nsm/index.ts", () => ({ getAttestationDocument }));

const exporter = new InMemorySpanExporter();

describe("tracing", () => {
  beforeAll(() => {
    context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
    propagation.setGlobalPropagator(new W3CTraceContextPropagator());
    // ratio 0: only a sampled parent traceparent gets the request traced
    trace.setGlobalTracerProvider(
      new TracerProvider({
        sampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(0) }),
        spanProcessors: [new SimpleSpanProcessor({ exporter })],
      }),
    );
  });
  afterAll(() => {
    trace.disable();
    context.disable();
    propagation.disable();
  });
  beforeEach(() => {
    resetMocks();
    exporter.reset();
  });

  const traceId = "4bf92f3577b34da6a3ce929d0e0e4736";
  const nonce = Buffer.from("secret nonce").toString("base64url");

  it("continues a sampled caller trace with a route-named span and child spans", async () => {
    getAttestationDocument.mockReturnValue(Buffer.from("doc"));

    await request(app)
      .get(`/attestation?nonce=${nonce}`)
      .set("traceparent", `00-${traceId}-00f067aa0ba902b7-01`)
      .expect(200);
    await vi.waitFor(() => expect(exporter.getFinishedSpans()).toHaveLength(2));

    const spans = exporter.getFinishedSpans();
    const server = spans.find((s) => s.name === "GET /attestation");
    const nsm = spans.find((s) => s.name === "nsm.attestation");
    expect(server?.spanContext().traceId).toBe(traceId);
    expect(server?.attributes).toMatchObject({
      "http.route": "/attestation",
      "http.response.status_code": 200,
    });
    // the raw URL (with its query) must never reach a span
    expect(JSON.stringify(spans.map((s) => s.attributes))).not.toContain(nonce);
    expect(nsm?.parentSpanContext?.spanId).toBe(server?.spanContext().spanId);
  });

  it("records nothing without a sampled parent at ratio 0", async () => {
    await request(app).get("/health").expect(200);
    await request(app)
      .get("/health")
      .set("traceparent", `00-${traceId}-00f067aa0ba902b7-00`)
      .expect(200);

    expect(exporter.getFinishedSpans()).toHaveLength(0);
  });

  it("withSpan marks errors without recording their message", async () => {
    await context.with(
      trace.setSpanContext(context.active(), {
        traceId,
        spanId: "00f067aa0ba902b7",
        traceFlags: 1,
      }),
      async () => {
        await expect(
          withSpan("boom", async () => {
            throw new Error("secret payload");
          }),
        ).rejects.toThrow("secret payload");
        expect(() =>
          withSpan("boom-sync", () => {
            throw new Error("secret payload");
          }),
        ).toThrow("secret payload");
      },
    );

    const spans = exporter.getFinishedSpans();
    expect(spans.map((s) => s.status.code)).toEqual([SpanStatusCode.ERROR, SpanStatusCode.ERROR]);
    expect(JSON.stringify(spans.map((s) => [s.events, s.status]))).not.toContain("secret");
  });
});
