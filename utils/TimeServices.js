import { formatDate } from '../localization';

// Display only: Frappe's wall-clock value retains the original local interpretation.
export const updateDateTime = (serverTimeString) => {
  const parsedDate = new Date(serverTimeString.replace(" ", "T"));
  return formatDate(parsedDate, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
};
