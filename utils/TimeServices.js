import { format } from "date-fns";

export const updateDateTime = () => {
  const currentDate = new Date();
  const dateFormat = "d MMM yyyy @ hh:mm a"; 
  return format(currentDate, dateFormat);
};
