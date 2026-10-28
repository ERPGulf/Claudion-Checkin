import * as Haptics from 'expo-haptics';

export const hapticsMessage = type => {
  let feedback;
  switch (type) {
    case 'success':
      feedback = Haptics.NotificationFeedbackType.Success;
      break;
    case 'error':
      feedback = Haptics.NotificationFeedbackType.Error;
      break;
    case 'warning':
      feedback = Haptics.NotificationFeedbackType.Warning;
      break;
    default:
      return;
  }

  // Optional feedback must never escape into an attendance/authentication flow.
  // Preserve the synchronous, fire-and-forget contract for every caller.
  try {
    Promise.resolve(Haptics.notificationAsync(feedback)).catch(() => {});
  } catch {
    // Older binaries or native failures may throw before returning a promise.
  }
};
