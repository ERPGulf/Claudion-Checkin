import { getTopicSyncPlan } from "../utils/fcmTopics";

describe("FCM topic sync planning", () => {
  it("keeps shared topics subscribed and only syncs actual changes", () => {
    expect(
      getTopicSyncPlan(["alertMessage", "General"], ["General", "News"]),
    ).toEqual({
      topicsToSubscribe: ["News"],
      topicsToUnsubscribe: ["alertMessage"],
      syncedTopics: ["General", "News"],
    });
  });

  it("deduplicates and avoids churn for unchanged topics", () => {
    expect(
      getTopicSyncPlan(
        [" alertMessage ", "General", "General"],
        ["alertMessage", "General", "", "General"],
      ),
    ).toEqual({
      topicsToSubscribe: [],
      topicsToUnsubscribe: [],
      syncedTopics: ["alertMessage", "General"],
    });
  });
});
