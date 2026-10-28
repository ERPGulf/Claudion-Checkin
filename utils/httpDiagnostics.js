/** HTTP diagnostics must never include request bodies, responses or error text. */
export const describeHttpFailure = (error) => ({
  code: typeof error?.code === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code)
    ? error.code : null,
  httpStatus: Number.isInteger(error?.response?.status) ? error.response.status : null,
});
