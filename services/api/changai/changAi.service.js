import changAiClient from "./changAiClient";

export const sendChangAiMessage = async (question, chatId = "mobile_user") => {
  try {
    const form = new URLSearchParams();
    form.append("user_question", question);
    form.append("chat_id", chatId);

    const response = await changAiClient.post(
      "/method/changai.changai.api.v2.text2sql_pipeline_v2.run_text2sql_pipeline",
      form.toString(),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      },
    );

    return response?.data;
  } catch (error) {
    console.log("ERROR MESSAGE:", error.message);
    console.log("ERROR CODE:", error.code);
    console.log("ERROR RESPONSE:", error.response);
    console.log("FULL ERROR:", JSON.stringify(error, null, 2));

   
  }
};
