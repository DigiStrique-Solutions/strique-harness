import type { Context } from '@deepseek-ai/cordis';
import type Schema from '@deepseek-ai/schemastery';
export interface Config {
  stateDir?: string;
  publicOrigin?: string;
  oauthClientIds?: Record<string, string>;
  maxBodyBytes?: number;
  maxResponseBytes?: number;
  maxTools?: number;
  requestTimeoutMs?: number;
  reconnectDelayMs?: number;
  reconnectMaxAttempts?: number;
  oauthTimeoutMs?: number;
  approvalTimeoutMs?: number;
}
export declare const name: string;
export declare const inject: string[];
export declare const Config: Schema<Config>;
export declare function apply(ctx: Context, options?: Config): Promise<void>;
