import { z } from "zod";

import { REDDIT_API_DOMAIN, SiteId } from "@/utils/constants";
import {
	lemmyThreadToThread,
	redditThreadToThread,
} from "@/utils/mappers/thread-mapper";
import { Settings, getValue } from "@/utils/settings";
import {
	buildLemmyApiUrl,
	getRedditLoginRequiredErrorMessage,
	getStoredLemmyAuthConfig,
	requestJson,
} from "@/utils/tools/request-tools";
import {
	lemmyThreadResponseSchema,
	redditThreadResponseSchema,
} from "@/utils/types/api-reponses";
import type { Thread } from "@/utils/types/elements";
import type { GetThreadsRequest } from "@/utils/types/network-requests";
import type { FetchResponse } from "@/utils/types/network-responses";
import { getSiteById } from "@/utils/types/site";
import type { Site } from "@/utils/types/site";

import { resetUser } from "./get-user";

interface LemmySearchParams {
	// oxlint-disable-next-line id-length
	q: string;
	sort: "TopAll";
	type_: "Url";
}

interface RedditSearchParams {
	include_over_18: string;
	limit: string;
	// oxlint-disable-next-line id-length
	q: string;
	raw_json: string;
	sort: "top";
}

const redditSearchResponseSchema = z.object({
	data: z.object({
		after: z.string().nullable().optional(),
		children: z.array(redditThreadResponseSchema),
	}),
});

const lemmySearchResponseSchema = z.object({
	posts: z.array(lemmyThreadResponseSchema),
});

async function getRedditPage(url: URL): Promise<FetchResponse<Thread[]>> {
	const response = await requestJson(url, redditSearchResponseSchema);

	if (!response.success) {
		return response;
	}

	const nextPage = response.value.data.after;
	const threads = response.value.data.children.map((thread) =>
		redditThreadToThread(thread),
	);

	if (!nextPage) {
		return { success: true, value: threads };
	}

	url.searchParams.set("after", nextPage);

	const moreThreads = await getRedditPage(url);

	if (moreThreads.success) {
		threads.push(...moreThreads.value);
	}

	return { success: true, value: threads };
}

interface GetLemmyPageParams {
	page: number;
	url: URL;
}

async function getLemmyPage({
	page,
	url,
}: GetLemmyPageParams): Promise<FetchResponse<Thread[]>> {
	url.searchParams.set("page", page.toString());

	const response = await requestJson(
		url,
		lemmySearchResponseSchema,
		await getStoredLemmyAuthConfig(),
	);

	if (!response.success) {
		return response;
	}

	const threads = await Promise.all(
		response.value.posts.map(async (thread) => lemmyThreadToThread(thread)),
	);

	if (response.value.posts.length === 0) {
		return { success: true, value: threads };
	}

	const moreThreads = await getLemmyPage({ page: page + 1, url });

	if (moreThreads.success) {
		threads.push(...moreThreads.value);
	}

	return { success: true, value: threads };
}

type MapRedditQueriesParams = MapLemmyQueriesParams & {
	includeNSFW: boolean;
};

async function mapRedditQueries({
	includeNSFW,
	site,
	videoId,
}: MapRedditQueriesParams) {
	if (
		!(await getValue(Settings.SHOWREDDITRESULTS)) &&
		(await getValue(Settings.LEMMYDOMAIN))
	) {
		return [];
	}

	return site.domains.flatMap((domain, domainIndex) => {
		const template = site.templates[domainIndex];

		let query = `url:${videoId} site:${domain}`;

		if (site.id === SiteId.POPUP) {
			if (!template) {
				return [];
			}

			query = `url:${template.replace("videoId", videoId)} site:${domain}`;
		}

		const searchParams = new URLSearchParams({
			include_over_18: includeNSFW.toString(),
			limit: "100",
			q: query,
			raw_json: "1",
			sort: "top",
		} satisfies RedditSearchParams);

		return new URL(`${REDDIT_API_DOMAIN}/search.json?${searchParams}`);
	});
}

interface MapLemmyQueriesParams {
	site: Site;
	videoId: string;
}

async function mapLemmyQueries({ site, videoId }: MapLemmyQueriesParams) {
	if (!(await getValue(Settings.LEMMYDOMAIN))) {
		return [];
	}

	const urls = site.templates.map((template) =>
		template.replace("videoId", videoId),
	);

	return Promise.all(
		urls.flatMap(async (templateUrl) => {
			const url = await buildLemmyApiUrl({
				endpoint: "search",
				searchParams: {
					q: templateUrl,
					sort: "TopAll",
					type_: "Url",
				} satisfies LemmySearchParams,
			});

			return url;
		}),
	);
}

interface AppendMatchedYouTubeQueriesParams {
	includeNSFW: boolean;
	lemmyUrls: URL[];
	request: GetThreadsRequest;
	urls: URL[];
}

async function appendMatchedYouTubeQueries({
	includeNSFW,
	lemmyUrls,
	request,
	urls,
}: AppendMatchedYouTubeQueriesParams) {
	if (!request.site.canMatchYouTube || !request.youtubeId) {
		return { lemmyUrls, urls };
	}

	const youtube = getSiteById(SiteId.YOUTUBE);

	if (!youtube) {
		return;
	}

	const youtubeSearchUrls = await mapRedditQueries({
		includeNSFW,
		site: youtube,
		videoId: request.youtubeId,
	});

	const youtubeLemmyUrls = await mapLemmyQueries({
		site: youtube,
		videoId: request.youtubeId,
	});

	return {
		lemmyUrls: [...lemmyUrls, ...youtubeLemmyUrls],
		urls: [...urls, ...youtubeSearchUrls],
	};
}

async function dedupeThreads(threads: FetchResponse<Thread[]>[]) {
	const threadIds = new Set<string>();
	const communityBlacklist = await getValue(Settings.COMMUNITYBLACKLIST);
	const lowerCaseCommunityBlacklist = new Set(
		communityBlacklist.map((community) => community.toLowerCase()),
	);

	return threads.flatMap((entry) => {
		if (!entry.success) {
			return [];
		}

		return entry.value.filter((thread) => {
			if (
				threadIds.has(thread.fullId) ||
				lowerCaseCommunityBlacklist.has(thread.community.toLowerCase())
			) {
				return false;
			}

			threadIds.add(thread.fullId);
			return true;
		});
	});
}

function getThreadErrorMessage(threads: FetchResponse<Thread[]>[]) {
	const redditLoginRequiredErrorMessage = getRedditLoginRequiredErrorMessage();

	for (const threadResponse of threads) {
		if (
			!threadResponse.success &&
			threadResponse.errorMessage === redditLoginRequiredErrorMessage
		) {
			return threadResponse.errorMessage;
		}
	}

	return i18n.t("threadError");
}

async function getThreads(
	request: GetThreadsRequest,
): Promise<FetchResponse<Thread[]>> {
	resetUser();

	const includeNSFW = await getValue(Settings.INCLUDENSFW);

	const urls = await mapRedditQueries({
		includeNSFW,
		site: request.site,
		videoId: request.url,
	});

	const lemmyUrls = await mapLemmyQueries({
		site: request.site,
		videoId: request.url,
	});

	const matchedQueries = await appendMatchedYouTubeQueries({
		includeNSFW,
		lemmyUrls,
		request,
		urls,
	});

	if (matchedQueries === undefined) {
		return { errorMessage: i18n.t("threadError"), success: false };
	}

	const threads = await Promise.all(
		[
			(matchedQueries?.urls ?? urls).map(async (url) => getRedditPage(url)),
			(matchedQueries?.lemmyUrls ?? lemmyUrls).map(async (url) =>
				getLemmyPage({ page: 1, url }),
			),
		].flat(),
	);

	if (!threads.some((threadResponse) => threadResponse.success)) {
		return { errorMessage: getThreadErrorMessage(threads), success: false };
	}

	const response = await dedupeThreads(threads);

	return { success: true, value: response };
}

export { getThreads };
