import { getAuthRequest } from "./requestHelper";

export const getQrCode = async (employeeCode) => {
  try {
    const message = await getAuthRequest(
      "/api/method/employee_app.attendance_api.qr_code",
      { employee: employeeCode }
    );

    if (!message || message.status !== "success") {
      throw new Error("Failed to fetch QR code");
    }

    return {
      employee: message.employee,
      imageUrl: message.image_url,
    };
  } catch (error) {
    console.error("❌ getQrCode error:", error.message);
    throw error;
  }
};
