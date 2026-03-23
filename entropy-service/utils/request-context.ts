import { AsyncLocalStorage } from "node:async_hooks";

export type RequestContext = {
	requestId: string;
	remoteIp?: string;
};

const requestContextStorage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(
	context: RequestContext,
	callback: () => T,
) {
	return requestContextStorage.run(context, callback);
}

export function getRequestContext() {
	return requestContextStorage.getStore();
}

export function getRequestId() {
	return getRequestContext()?.requestId;
}

export function getRemoteIp() {
	return getRequestContext()?.remoteIp;
}
