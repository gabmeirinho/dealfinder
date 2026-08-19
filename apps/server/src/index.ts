export const workspaceName = "@dealfinder/server" as const;

export {
  ConfigValidationError,
  loadServerConfig,
  redactConfig,
  serializeRedacted
} from "./config/index.js";
export { createLogger } from "./logging/index.js";
