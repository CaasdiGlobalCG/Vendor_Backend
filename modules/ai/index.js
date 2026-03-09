// ============================================================
// AI Module — Local AI assistant with Ollama + LangChain
// Provides vendor-scoped chat with DynamoDB data tools
// and DynamoDB-backed conversation memory.
// ============================================================

export { default as aiRoutes } from './routes/aiRoutes.js';

export * as agentService from './services/agentService.js';
export * as memoryService from './services/memoryService.js';
