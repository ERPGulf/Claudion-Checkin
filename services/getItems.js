import apiClient from "./api/apiClient";


const GET_ITEMS_PATH = 'method/employee_app.material_request.get_items';

export const getItem = async (barcode, warehouse) => {
  try {
    const body = new URLSearchParams();
    body.append("barcode", barcode);
    console.log("barcode", barcode);
    body.append("warehouse", warehouse);
    console.log("warehouse", warehouse);

    const response = await apiClient.post(
      GET_ITEMS_PATH,
      body.toString(),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    if (response.data && response.data.data) {
      return response.data.data;
    }

    return null;
  } catch (error) {
    console.error("Error fetching item by barcode:", error);
    return null;
  }
};
