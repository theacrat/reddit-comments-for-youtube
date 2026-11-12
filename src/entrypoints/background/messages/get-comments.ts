import { z } from "zod";

import {
	isLemmyCommentSort,
	isRedditCommentSort,
	REDDIT_API_DOMAIN,
	Website,
} from "@/utils/constants";
import {
	lemmyCommentsToComments,
	redditCommentsToComments,
} from "@/utils/mappers/comment-mapper";
import {
	buildLemmyApiUrl,
	getStoredLemmyAuthConfig,
	requestJson,
} from "@/utils/tools/request-tools";
import {
	lemmyCommentResponseSchema,
	redditReplyResponseSchema,
} from "@/utils/types/api-reponses";
import type { Replies } from "@/utils/types/elements";
import type { GetCommentsRequest } from "@/utils/types/network-requests";
import type {
	CommentResponse,
	FetchResponse,
} from "@/utils/types/network-responses";

import { getUser } from "./get-user";

interface LemmyCommentListBody {
	limit: number;
	post_id: string;
	sort: string;
	type_: "All";
}

const redditCommentsResponseSchema = z.tuple([
	z.unknown(),
	z.object({
		data: z.object({
			children: z.array(redditReplyResponseSchema),
		}),
	}),
]);

const lemmyCommentsResponseSchema = z.object({
	comments: z.array(lemmyCommentResponseSchema),
});

const redditBannedResponseSchema = z.object({
	data: z.object({
		user_is_banned: z.boolean().nullable(),
	}),
});

async function getRedditThread(
	threadId: string,
	sort: string,
): Promise<FetchResponse<Replies>> {
	const response = await requestJson(
		`${REDDIT_API_DOMAIN}/comments/${threadId}.json?sort=${sort}&raw_json=1`,
		redditCommentsResponseSchema,
	);

	if (!response.success) {
		return response;
	}

	const mappedThreads = await redditCommentsToComments({
		threadId,
		threads: response.value[1].data.children,
	});

	return { success: true, value: mappedThreads };
}

async function getLemmyThread(
	threadId: string,
	sort: string,
): Promise<FetchResponse<Replies>> {
	const url = await buildLemmyApiUrl({
		endpoint: "comment/list",
		searchParams: {
			limit: 50,
			post_id: threadId,
			sort,
			type_: "All",
		} satisfies LemmyCommentListBody,
	});

	const response = await requestJson(
		url,
		lemmyCommentsResponseSchema,
		await getStoredLemmyAuthConfig(),
	);

	if (!response.success) {
		return response;
	}

	const mappedThreads = await lemmyCommentsToComments({
		parentString: "0",
		threadId,
		threads: response.value.comments,
	});

	return { success: true, value: mappedThreads };
}

async function getBannedStatus(
	subreddit: string,
): Promise<FetchResponse<boolean>> {
	const response = await requestJson(
		`${REDDIT_API_DOMAIN}/${subreddit}/about.json`,
		redditBannedResponseSchema,
	);

	if (!response.success) {
		return response;
	}

	const isBanned = response.value.data?.user_is_banned !== false;

	return { success: true, value: isBanned };
}

async function getRedditComments({
	sort,
	thread,
}: GetCommentsRequest): Promise<FetchResponse<CommentResponse>> {
	if (!isRedditCommentSort(sort)) {
		return { errorMessage: "Invalid Reddit comment sort.", success: false };
	}

	const [comments, me, isBanned] = await Promise.all([
		getRedditThread(thread.id, sort),
		getUser(Website.REDDIT),
		getBannedStatus(thread.community),
	]);

	if (!comments.success) {
		return comments;
	}

	const response: CommentResponse = {
		isBanned: isBanned.success ? isBanned.value : undefined,
		replies: comments.value,
		user: me.success ? me.value : undefined,
	};

	return { success: true, value: response };
}

async function getLemmyComments({
	sort,
	thread,
}: GetCommentsRequest): Promise<FetchResponse<CommentResponse>> {
	if (!isLemmyCommentSort(sort)) {
		return { errorMessage: "Invalid Lemmy comment sort.", success: false };
	}

	const [comments, me] = await Promise.all([
		getLemmyThread(thread.id, sort),
		getUser(Website.LEMMY),
	]);

	if (!comments.success) {
		return comments;
	}

	// Lemmy's API does not currently expose a comparable banned status here.
	const response: CommentResponse = {
		isBanned: false,
		replies: comments.value,
		user: me.success ? me.value : undefined,
	};

	return { success: true, value: response };
}

async function getComments(
	request: GetCommentsRequest,
): Promise<FetchResponse<CommentResponse>> {
	switch (request.thread.website) {
		case Website.REDDIT: {
			return getRedditComments(request);
		}

		case Website.LEMMY: {
			return getLemmyComments(request);
		}
	}
}

export { getComments };
