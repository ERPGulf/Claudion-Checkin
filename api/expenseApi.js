// /api/expenseApi.js

// Mock or placeholder API call for fetching expense claims
export const getExpenseClaims = async (employeeCode, pageParam) => {
  await new Promise(resolve => setTimeout(resolve, 1000)); // simulate network delay

  const pageSize = 10;
  const start = pageParam * pageSize;
  const mockData = Array.from({ length: pageSize }, (_, index) => ({
    id: start + index + 1,
    title: `Expense Claim #${start + index + 1}`,
    amount: (Math.random() * 1000 + 500).toFixed(2),
    date: new Date().toISOString().split('T')[0],
    status: 'Pending', // or 'Approved', 'Rejected'
  }));

  if (pageParam >= 2) {
    return []; // simulate no more data after 3 pages
  }

  return mockData;
};

// Placeholder for creating a new expense claim
export const createExpenseClaim = async (employeeCode, claimData) => {
  await new Promise(resolve => setTimeout(resolve, 500)); // simulate network delay

  // Mock response as if the claim was successfully created
  return {
    id: Math.floor(Math.random() * 10000),
    title: claimData.title,
    amount: claimData.amount,
    date: new Date().toISOString().split('T')[0],
    status: 'Pending',
  };
};
