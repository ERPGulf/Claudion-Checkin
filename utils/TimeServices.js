// import { format } from "date-fns";

// export const updateDateTime = () => {
//   const currentDate = new Date();
//   const dateFormat = "d MMM yyyy @ hh:mm a";
//   return format(currentDate, dateFormat);
// };
import { format } from "date-fns";

export const updateDateTime = (serverTimeString) => {
  const parsedDate = new Date(serverTimeString.replace(" ", "T"));
  return format(parsedDate, "d MMM yyyy @ hh:mm:ss a");
};
