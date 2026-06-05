import type { GoalLevel, GoalStatus } from "../constants.js";

export interface Goal {
  id: string;
  squadId: string;
  title: string;
  description: string | null;
  level: GoalLevel;
  status: GoalStatus;
  parentId: string | null;
  ownerAgentId: string | null;
  createdAt: Date;
  updatedAt: Date;
}
