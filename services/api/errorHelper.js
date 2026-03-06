export const parseError = (
  error,
  fallbackMessage = "Something went wrong"
) => {
  const status = error?.response?.status;
  if (status === 400) {
    return (
      error?.response?.data?._error_message ||
      "Invalid request. Please check your input."
    );
  }

  if (status === 401) {
    return "Session expired. Please login again.";
  }

  if (status === 403) {
    return "You are not authorized for this action.";
  }

  // 🔹 Backend message
  if (error?.response?.data?.message) {
    return error.response.data.message;
  }

  if (error?.response?.data?.error) {
    return error.response.data.error;
  }

  if (error?.message) {
    return error.message;
  }

  return fallbackMessage;
};