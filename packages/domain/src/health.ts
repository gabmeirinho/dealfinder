export type ServiceHealth = "ok" | "unavailable";

export interface HealthResponse {
  status: "ok" | "degraded";
  database: {
    status: ServiceHealth;
    schemaVersion: number | null;
  };
  timestamp: string;
}
