import { beforeEach, describe, expect, it, vi } from "vitest";
import { browser } from "wxt/browser";
import { z } from "zod";

import { Settings, getValue } from "@/utils/settings";
import {
	appendSearchParams,
	buildLemmyApiUrl,
	buildLemmyUrl,
	convertRedditUserVotes,
	getLemmyAuthHeaders,
	getStoredLemmyAuthConfig,
	requestJson,
	requestText,
} from "@/utils/tools/request-tools";

const { mockedFetch } = vi.hoisted(() => ({
	mockedFetch: vi.fn<typeof fetch>(),
}));

vi.mock("@/utils/settings", () => ({
	Settings: {
		LEMMYDOMAIN: "lemmyDomain",
		LEMMYTOKEN: "lemmyToken",
	},
	getValue: vi.fn(),
}));

const mockedGetValue = vi.mocked(getValue);
const redditLoginRequiredErrorMessage = "translated reddit login message";

async function getMockSetting(name: Settings) {
	await Promise.resolve();

	if (name === Settings.LEMMYDOMAIN) {
		return "lemmy.example";
	}

	if (name === Settings.LEMMYTOKEN) {
		return "token-123";
	}

	return "";
}

beforeEach(() => {
	mockedFetch.mockReset();
	mockedGetValue.mockImplementation(getMockSetting);

	vi.stubGlobal("fetch", mockedFetch);
	vi.stubGlobal("navigator", { onLine: true });
	vi.spyOn(browser.i18n, "getMessage").mockImplementation((key: string) =>
		key === "redditLoginRequiredError" ? redditLoginRequiredErrorMessage : "",
	);
});

function getFirstFetchOptions() {
	const [, options] = mockedFetch.mock.calls[0] ?? [];

	if (!options) {
		throw new Error("Expected fetch to have been called.");
	}

	return options;
}

describe("Lemmy request helpers", () => {
	it("builds Lemmy URLs with normalised endpoints", async () => {
		await expect(buildLemmyUrl({ endpoint: "post/1" })).resolves.toBe(
			"https://lemmy.example/post/1",
		);
		await expect(
			buildLemmyUrl({ api: true, endpoint: "/post/list" }),
		).resolves.toBe("https://lemmy.example/api/v3/post/list");
	});

	it("builds API URLs with search params", async () => {
		const url = await buildLemmyApiUrl({
			endpoint: "post/list",
			searchParams: {
				community_name: "typescript",
				limit: 20,
				page: undefined,
				saved_only: false,
			},
		});

		expect(url.toString()).toBe(
			"https://lemmy.example/api/v3/post/list?community_name=typescript&limit=20&saved_only=false",
		);
	});

	it("appends defined search params and skips undefined values", () => {
		const url = appendSearchParams(new URL("https://example.test/"), {
			enabled: false,
			limit: 10,
			page: undefined,
			q: "test",
		});

		expect(url.toString()).toBe(
			"https://example.test/?enabled=false&limit=10&q=test",
		);
	});

	it("creates Lemmy auth headers", () => {
		expect(getLemmyAuthHeaders("abc")).toStrictEqual({
			Authorization: "Bearer abc",
		});
	});

	it("creates stored Lemmy auth config when a token exists", async () => {
		await expect(getStoredLemmyAuthConfig()).resolves.toStrictEqual({
			headers: {
				Authorization: "Bearer token-123",
			},
		});
	});

	it("omits stored Lemmy auth config when a token does not exist", async () => {
		mockedGetValue.mockResolvedValue("");

		await expect(getStoredLemmyAuthConfig()).resolves.toStrictEqual({});
	});
});

describe("Reddit vote conversion", () => {
	it("maps Reddit likes to local vote values", () => {
		expect(convertRedditUserVotes(true)).toBe(1);
		expect(convertRedditUserVotes(false)).toBe(-1);
		// oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- Reddit uses null for no vote.
		expect(convertRedditUserVotes(JSON.parse("null") as boolean | null)).toBe(
			0,
		);
	});
});

describe("requestJson", () => {
	it("returns successful JSON responses", async () => {
		mockedFetch.mockResolvedValueOnce(
			Response.json(
				{ ok: true },
				{
					headers: { "content-type": "application/json" },
					status: 200,
				},
			),
		);

		await expect(
			requestJson("https://example.test/api"),
		).resolves.toStrictEqual({
			success: true,
			value: { ok: true },
		});
	});

	it("validates responses against a schema", async () => {
		mockedFetch.mockResolvedValueOnce(
			Response.json(
				{ id: 1, title: "Hello" },
				{
					headers: { "content-type": "application/json" },
					status: 200,
				},
			),
		);

		await expect(
			requestJson("https://example.test/api", z.object({ id: z.number() })),
		).resolves.toStrictEqual({
			success: true,
			value: { id: 1 },
		});
	});

	it("returns an invalid-shape error when schema validation fails", async () => {
		mockedFetch.mockResolvedValueOnce(
			Response.json(
				{ id: "wrong" },
				{
					headers: { "content-type": "application/json" },
					status: 200,
				},
			),
		);
		vi.spyOn(console, "error").mockImplementation(() => {
			/* Empty */
		});

		await expect(
			requestJson("https://example.test/api", z.object({ id: z.number() })),
		).resolves.toStrictEqual({
			errorMessage: "Invalid response shape.",
			success: false,
		});
	});

	it("uses response status text for failed HTTP responses", async () => {
		mockedFetch.mockResolvedValueOnce(
			new Response("", {
				status: 429,
				statusText: "Too Many Requests",
			}),
		);

		await expect(
			requestJson("https://example.test/api"),
		).resolves.toStrictEqual({
			errorMessage: "429 Too Many Requests",
			success: false,
		});
	});

	it("suggests logging in for Reddit forbidden responses", async () => {
		mockedFetch.mockResolvedValueOnce(
			new Response("", {
				status: 403,
				statusText: "Forbidden",
			}),
		);

		await expect(
			requestJson("https://www.reddit.com/comments/thread-id"),
		).resolves.toStrictEqual({
			errorMessage: redditLoginRequiredErrorMessage,
			success: false,
		});
	});

	it("reports offline request failures", async () => {
		vi.stubGlobal("navigator", { onLine: false });
		mockedFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));

		await expect(
			requestJson("https://example.test/api"),
		).resolves.toStrictEqual({
			errorMessage: "Internet offline",
			success: false,
		});
	});

	it("sends object data as JSON", async () => {
		mockedFetch.mockResolvedValueOnce(Response.json({ ok: true }));

		await expect(
			requestJson("https://example.test/api", {
				data: { ok: true },
				method: "POST",
			}),
		).resolves.toStrictEqual({
			success: true,
			value: { ok: true },
		});

		const options = getFirstFetchOptions();

		expect(options.body).toBe(JSON.stringify({ ok: true }));
		expect(options.headers).toStrictEqual(
			new Headers({ "content-type": "application/json" }),
		);
		expect(options.method).toBe("POST");
	});

	it("sends URLSearchParams data as form data", async () => {
		const data = new URLSearchParams({ ok: "true" });
		mockedFetch.mockResolvedValueOnce(Response.json({ ok: true }));

		await expect(
			requestJson("https://example.test/api", {
				data,
				method: "POST",
			}),
		).resolves.toStrictEqual({
			success: true,
			value: { ok: true },
		});

		const options = getFirstFetchOptions();

		expect(options.body).toBe(data);
		expect(options.headers).toStrictEqual(new Headers());
		expect(options.method).toBe("POST");
	});

	it("uses text responseType for text requests", async () => {
		const url = new URL("https://example.test/text");
		mockedFetch.mockResolvedValueOnce(new Response("plain text"));

		await expect(requestText(url)).resolves.toStrictEqual({
			success: true,
			value: "plain text",
		});
		expect(mockedFetch).toHaveBeenCalledWith(url.toString(), {
			headers: new Headers(),
		});
	});
});
