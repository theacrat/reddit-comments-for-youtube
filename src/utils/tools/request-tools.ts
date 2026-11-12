import type { ZodType } from "zod";

import { Settings, getValue } from "@/utils/settings";
import type { FetchResponse } from "@/utils/types/network-responses";

type SearchParamValue = boolean | number | string | undefined;
type RequestData = URLSearchParams | object | string;

interface RequestConfig {
	data?: RequestData;
	headers?: HeadersInit;
	method?: string;
}

interface BuildLemmyUrlParams {
	api?: boolean;
	endpoint: string;
}

async function buildLemmyUrl({ api = false, endpoint }: BuildLemmyUrlParams) {
	const domain = await getValue(Settings.LEMMYDOMAIN);
	const normalisedEndpoint = endpoint.startsWith("/")
		? endpoint
		: `/${endpoint}`;

	return `https://${domain}${api ? "/api/v3" : ""}${normalisedEndpoint}`;
}

function appendSearchParams(
	url: URL,
	searchParams: Record<string, SearchParamValue>,
) {
	for (const [key, value] of Object.entries(searchParams)) {
		if (value === undefined) {
			continue;
		}

		url.searchParams.append(key, value.toString());
	}

	return url;
}

interface BuildLemmyApiUrlParams {
	endpoint: string;
	searchParams?: Record<string, SearchParamValue>;
}

async function buildLemmyApiUrl({
	endpoint,
	searchParams = {},
}: BuildLemmyApiUrlParams) {
	const url = new URL(await buildLemmyUrl({ api: true, endpoint }));

	return appendSearchParams(url, searchParams);
}

function getLemmyAuthHeaders(token: string) {
	return {
		Authorization: `Bearer ${token}`,
	};
}

async function getStoredLemmyAuthConfig(): Promise<RequestConfig> {
	const token = await getValue(Settings.LEMMYTOKEN);

	return token ? { headers: getLemmyAuthHeaders(token) } : {};
}

function convertRedditUserVotes(likes: boolean | null) {
	if (likes === null) {
		return 0;
	}

	return likes ? 1 : -1;
}

function getRequestErrorMessage(error: unknown) {
	if (error instanceof TypeError) {
		return navigator.onLine ? "Network error" : "Internet offline";
	}

	return error instanceof Error ? error.message : "Unknown request error";
}

function getRedditLoginRequiredErrorMessage() {
	return i18n.t("redditLoginRequiredError");
}

function getResponseErrorMessage(url: string, response: Response) {
	if (new URL(url).hostname === "www.reddit.com" && response.status === 403) {
		return getRedditLoginRequiredErrorMessage();
	}

	return `${response.status} ${response.statusText}`;
}

function getRequestBody(data: RequestConfig["data"]): BodyInit | undefined {
	if (data === undefined) {
		return;
	}

	if (data instanceof URLSearchParams || typeof data === "string") {
		return data;
	}

	return JSON.stringify(data);
}

function getRequestHeaders(config: RequestConfig) {
	const headers = new Headers(config.headers);

	if (
		config.data &&
		!(config.data instanceof URLSearchParams) &&
		typeof config.data !== "string" &&
		!headers.has("content-type")
	) {
		headers.set("content-type", "application/json");
	}

	return headers;
}

const parseJson = JSON.parse as (text: string) => unknown;

async function readJsonResponse(response: Response) {
	return parseJson(await response.text());
}

async function readTextResponse(response: Response) {
	return response.text();
}

async function requestCatch(
	url: string | URL,
	config?: RequestConfig,
): Promise<FetchResponse<unknown>>;
async function requestCatch<T>(
	url: string | URL,
	config: RequestConfig | undefined,
	readResponse: (response: Response) => Promise<T>,
): Promise<FetchResponse<T>>;
async function requestCatch(
	url: string | URL,
	config: RequestConfig = {},
	readResponse = readJsonResponse,
): Promise<FetchResponse<unknown>> {
	const requestInit: RequestInit = {
		headers: getRequestHeaders(config),
	};
	const body = getRequestBody(config.data);

	if (body !== undefined) {
		requestInit.body = body;
	}

	if (config.method) {
		requestInit.method = config.method;
	}

	const requestUrl = new URL(url);

	if (requestUrl.hostname === "www.reddit.com") {
		requestUrl.searchParams.set("app", "res");
	}

	try {
		const response = await fetch(requestUrl.toString(), requestInit);

		if (!response.ok) {
			return {
				errorMessage: getResponseErrorMessage(requestUrl.toString(), response),
				success: false,
			};
		}

		const value = await readResponse(response);

		return { success: true, value };
	} catch (error) {
		return {
			errorMessage: getRequestErrorMessage(error),
			success: false,
		};
	}
}

async function requestJson(
	url: string | URL,
	config?: RequestConfig,
): Promise<FetchResponse<unknown>>;
async function requestJson<T>(
	url: string | URL,
	schema: ZodType<T>,
	config?: RequestConfig,
): Promise<FetchResponse<T>>;
async function requestJson<T>(
	url: string | URL,
	schemaOrConfig?: RequestConfig | ZodType<T>,
	config?: RequestConfig,
): Promise<FetchResponse<T> | FetchResponse<unknown>> {
	if (!schemaOrConfig || !("safeParse" in schemaOrConfig)) {
		return requestCatch(url, schemaOrConfig);
	}

	const response = await requestCatch(url, config);

	if (!response.success) {
		return response;
	}

	const parsed = schemaOrConfig.safeParse(response.value);

	if (!parsed.success) {
		console.error(parsed.error);

		return {
			errorMessage: "Invalid response shape.",
			success: false,
		};
	}

	return { success: true, value: parsed.data };
}

async function requestText(url: string | URL, config?: RequestConfig) {
	return requestCatch(url, config, readTextResponse);
}

export {
	appendSearchParams,
	buildLemmyApiUrl,
	buildLemmyUrl,
	convertRedditUserVotes,
	getLemmyAuthHeaders,
	getRedditLoginRequiredErrorMessage,
	getStoredLemmyAuthConfig,
	requestCatch,
	requestJson,
	requestText,
};
