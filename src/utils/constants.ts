const REDDIT_API_DOMAIN = "https://www.reddit.com";
const REDDIT_LINK_DOMAIN = "https://www.reddit.com";

const Interactions = {
	COMMENT: "comment",
	DELETE: "del",
	EDIT: "editusertext",
	VOTE: "vote",
} as const;

type Interactions = (typeof Interactions)[keyof typeof Interactions];

const Kind = {
	COMMENT: "t1",
	MORE: "more",
	SUBREDDIT: "t5",
	THREAD: "t3",
	USER: "t2",
} as const;

type Kind = (typeof Kind)[keyof typeof Kind];

const LemmyCommentSort = {
	HOT: "Hot",
	NEW: "New",
	TOP: "Top",
} as const;

type LemmyCommentSort =
	(typeof LemmyCommentSort)[keyof typeof LemmyCommentSort];

const LemmyCommentSortValues = new Set<string>(Object.values(LemmyCommentSort));

function isLemmyCommentSort(value: unknown): value is LemmyCommentSort {
	return typeof value === "string" && LemmyCommentSortValues.has(value);
}

const RedditCommentSort = {
	BEST: "best",
	CONTROVERSIAL: "controversial",
	NEW: "new",
	OLD: "old",
	QA: "qa",
	TOP: "top",
} as const;

type RedditCommentSort =
	(typeof RedditCommentSort)[keyof typeof RedditCommentSort];

const RedditCommentSortValues = new Set<string>(
	Object.values(RedditCommentSort),
);

function isRedditCommentSort(value: unknown): value is RedditCommentSort {
	return typeof value === "string" && RedditCommentSortValues.has(value);
}

type CommentSort = LemmyCommentSort | RedditCommentSort;

const SiteId = {
	NEBULA: "nebula",
	POPUP: "popup",
	YOUTUBE: "youtube",
} as const;

type SiteId = (typeof SiteId)[keyof typeof SiteId];

const ThreadSort = {
	COMMENTS: "comments",
	COMMUNITY: "community",
	NEWEST: "newest",
	SCORE: "score",
} as const;

type ThreadSort = (typeof ThreadSort)[keyof typeof ThreadSort];

const Website = {
	LEMMY: 1,
	REDDIT: 0,
} as const;

type Website = (typeof Website)[keyof typeof Website];

export {
	Interactions,
	isLemmyCommentSort,
	isRedditCommentSort,
	Kind,
	LemmyCommentSort,
	REDDIT_API_DOMAIN,
	RedditCommentSort,
	REDDIT_LINK_DOMAIN,
	SiteId,
	ThreadSort,
	Website,
};
export type { CommentSort };
