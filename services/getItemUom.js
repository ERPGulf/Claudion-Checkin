import apiClient from "./api/apiClient";

const ITEM_UOM_PATH = '/method/employee_app.material_request.get_item_uom';

export const getItemUom = async (itemCode) => {
  try {
    const body = new URLSearchParams();
    body.append("item_code", itemCode);

    const response = await apiClient.post(
      ITEM_UOM_PATH,
      body.toString(),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    if (response.data && Array.isArray(response.data.data)) {
      return response.data.data;
    }

    return [];
  } catch (error) {
    console.error("Error fetching item UOMs:", error);
    return [];
  }
};
