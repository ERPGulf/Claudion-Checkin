export const getSanitizedTopics = (topics) => {
  if (!Array.isArray(topics)) {
    return [];
  }

  return topics
    .filter((topic) => typeof topic === "string")
    .map((topic) => topic.trim())
    .filter(Boolean);
};

export const getTopicSyncPlan = (currentTopics, nextTopics) => {
  const sanitizedCurrentTopics = getSanitizedTopics(currentTopics);
  const sanitizedNextTopics = getSanitizedTopics(nextTopics);
  const currentTopicSet = new Set(sanitizedCurrentTopics);
  const nextTopicSet = new Set(sanitizedNextTopics);

  return {
    topicsToSubscribe: [...nextTopicSet].filter(
      (topic) => !currentTopicSet.has(topic),
    ),
    topicsToUnsubscribe: [...currentTopicSet].filter(
      (topic) => !nextTopicSet.has(topic),
    ),
    syncedTopics: [...nextTopicSet],
  };
};
