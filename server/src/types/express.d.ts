export {};

declare global {
  namespace Express {
    interface Request {
      actor: {
        type: "operator" | "agent" | "none";
        userId?: string;
        userName?: string | null;
        userEmail?: string | null;
        agentId?: string;
        squadId?: string;
        squadIds?: string[];
        memberships?: Array<{
          squadId: string;
          membershipRole?: string | null;
          status?: string;
        }>;
        isInstanceAdmin?: boolean;
        keyId?: string;
        runId?: string;
        source?: "local_implicit" | "session" | "operator_key" | "agent_key" | "agent_jwt" | "cloud_tenant" | "none";
      };
    }
  }
}
