import AsyncStorage from "@react-native-async-storage/async-storage";
import apiClient from "./api/apiClient";

const LIST_MR_PATH =
  '/method/employee_app.material_request.list_material_requests';

export const listMaterialRequests = async (id) => {
  try {

    // get token from storage
    const access_token = await AsyncStorage.getItem('access_token');

    const body = new URLSearchParams();
    body.append("id", id);

    const response = await apiClient.post(
      LIST_MR_PATH,
      body.toString(),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Authorization": `Bearer ${access_token}`,
        },
      }
    );

    if (response?.data?.data) {
      return response.data.data;
    }

    return [];
  } catch (error) {
    console.error("Error listing material requests:", error);
    return [];
  }
};
