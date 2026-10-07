import { createContext, useContext } from 'react';

export const MobileLoginContext = createContext(null);

export function useMobileLoginFlow() {
  return useContext(MobileLoginContext);
}
