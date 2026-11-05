import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { AgentDefinition, PlaceDefinition, WorldData } from "./sim/types";

interface CurrentData {
  data: WorldData;
  agentById: Map<string, AgentDefinition>;
  placeById: Map<string, PlaceDefinition>;
}
const WorldDataContext = createContext<CurrentData | null>(null);

export function WorldDataProvider({
  data,
  children,
}: {
  data: WorldData;
  children: ReactNode;
}) {
  const value = useMemo(
    () => ({
      data,
      agentById: new Map(data.agents.map((a) => [a.id, a])),
      placeById: new Map(data.places.map((p) => [p.id, p])),
    }),
    [data],
  );
  return (
    <WorldDataContext.Provider value={value}>
      {children}
    </WorldDataContext.Provider>
  );
}
export function useWorldData() {
  const value = useContext(WorldDataContext);
  if (!value) throw new Error("缺少当前世界数据");
  return value;
}
