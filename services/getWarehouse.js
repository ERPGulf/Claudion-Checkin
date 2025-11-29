import apiClient from "./api/apiClient";


export const getWarehouses = async (employeeCode) => {
  try {
    const body = new URLSearchParams();
    body.append('employee_code', employeeCode);
    const { data } = await apiClient.post(
      '/method/employee_app.material_request.warehouse_list',
      body,
    );

    return data?.data || data?.message || [];
  } catch (error) {
    console.error('Warehouse error:', error);
    throw new Error('Failed to fetch warehouses');
  }
};
