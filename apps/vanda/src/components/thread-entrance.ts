import { createContext, useContext, useState } from "react";

/** Animate only content mounted after the initial thread history has painted. */
export const EntranceReadyContext = createContext(false);

export function useEntranceOnMount(): boolean {
  const ready = useContext(EntranceReadyContext);
  return useState(ready)[0];
}
