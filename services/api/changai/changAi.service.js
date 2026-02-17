import changAiClient from "./changAiClient";

export const sendChangAiMessage = async (message) => {
  try {
    const form = new URLSearchParams();
    form.append("user_query", message);

    const response = await changAiClient.post(
      "/method/changai.changai.api.v2.auto_gen_api.generate_response",
      form.toString(),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    return response.data?.message;
  } catch (error) {
    console.log(
      "❌ ChangAI Chat Error:",
      error?.response?.data || error.message
    );
    throw error;
  }
};
