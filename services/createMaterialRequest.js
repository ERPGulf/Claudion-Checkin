import apiClient from "./api/apiClient";
import AsyncStorage from "@react-native-async-storage/async-storage";

export const createMaterialRequest = async (date, warehouse, items) => {
  try {
    const token = await AsyncStorage.getItem("access_token");
    const body = new URLSearchParams();
    body.append("date", date);
    console.log("date",date);
    body.append("warehouse", warehouse);
    console.log("warehouse",warehouse);
    body.append("items", JSON.stringify(items)); 
    console.log("items",JSON.stringify(items));
    

    const response = await apiClient.post(
      "/method/employee_app.material_request.create_material_request",
      body.toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Bearer ${token}`,
        },
      }
    );
   console.log("response",response.data);
    if (response?.data) {
      return response.data;
    }

    return null;
  } catch (error) {
    console.error("Error creating material request:", error);
    return null;
  }
};
