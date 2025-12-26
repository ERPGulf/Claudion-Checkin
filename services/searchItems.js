import apiClient from "./api/apiClient";

const LIST_ITEMS_SEARCH_PATH = 'method/employee_app.material_request.list_items_search';

export const searchItems = async (itemCode, limit = 1) => {
  try {
    const body = new URLSearchParams();
    body.append("item_code", itemCode);
    body.append("limit", String(limit));
    body.append("offset", 3);

    const response = await apiClient.post(
      LIST_ITEMS_SEARCH_PATH,
      body.toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );
    console.log("response", response.data.data);
    if (response?.data?.data && Array.isArray(response.data.data)) {
      return response.data.data;
    }

    return [];
  } catch (error) {
    console.error("Error fetching items:", error);
    return [];
  }
};
