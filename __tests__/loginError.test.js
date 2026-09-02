import { getLoginErrorMessage } from "../utils/loginError";

describe("getLoginErrorMessage", () => {
  it("returns a setup/rescan message when provisioning is missing", () => {
    const result = getLoginErrorMessage(
      new Error("Base URL not found. Please scan QR code first."),
    );
    expect(result.text1).toBe("Setup expired");
    expect(result.text2).toMatch(/Rescan QR Code/i);
  });

  // These two errors are thrown after a 200, so they carry no `error.response`
  // and used to fall into the connectivity branch below — telling an employee
  // to check their internet about a server that had just answered them.
  it("names the missing refresh token rather than blaming the connection", () => {
    const result = getLoginErrorMessage(
      new Error(
        "Sign-in incomplete: the server did not issue a refresh token. Please contact your administrator.",
      ),
    );
    expect(result.text1).toBe("Sign-in incomplete");
    expect(result.text2).toMatch(/administrator/i);
    expect(result.text2).not.toMatch(/internet/i);
  });

  it("treats a missing access token the same way", () => {
    const result = getLoginErrorMessage(
      new Error("Token not returned from server"),
    );
    expect(result.text1).toBe("Sign-in incomplete");
  });

  it("returns a connectivity message when there is no server response", () => {
    const networkError = Object.assign(new Error("Network Error"), {
      code: "ERR_NETWORK",
    });
    const result = getLoginErrorMessage(networkError);
    expect(result.text1).toBe("Can't reach the server");
    expect(result.text2).toMatch(/date & time/i);
  });

  it("treats a request timeout as a connectivity problem", () => {
    const timeout = Object.assign(new Error("timeout of 30000ms exceeded"), {
      code: "ECONNABORTED",
    });
    expect(getLoginErrorMessage(timeout).text1).toBe("Can't reach the server");
  });

  it("returns an incorrect-password message on HTTP 401", () => {
    const authError = Object.assign(
      new Error("Request failed with status code 401"),
      { response: { status: 401, data: { message: "Invalid login" } } },
    );
    expect(getLoginErrorMessage(authError).text1).toBe("Incorrect password");
  });

  it("surfaces the server message for other HTTP errors", () => {
    const serverError = Object.assign(
      new Error("Request failed with status code 500"),
      { response: { status: 500, data: { message: "Internal Server Error" } } },
    );
    const result = getLoginErrorMessage(serverError);
    expect(result.text1).toBe("Login failed");
    expect(result.text2).toMatch(/Internal Server Error/);
  });
});
