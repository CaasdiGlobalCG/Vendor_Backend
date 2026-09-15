// ============================================================
// FILE: modules/ai/config/groqConfig.js
// PURPOSE: Shared Groq API configuration for AI services.
// ============================================================

const getGroqConfig = () => {
  const apiKey =
    process.env.GROQ_API_KEY ||
    process.env.GROQ_API_KEY_AI_HELPER ||
    process.env.ROQ_API_KEY ||
    process.env.GROQ_KEY ||
    process.env.GROQ_APIKEY ||
    '';

  const baseUrl = (process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1').replace(/\/$/, '');

  return {
    apiKey,
    baseUrl,
    apiUrl: `${baseUrl}/chat/completions`,
    // Task-specific models with sensible defaults
    chatModel: process.env.GROQ_CHAT_MODEL || 'llama-3.1-8b-instant',
    canvasModel: process.env.GROQ_CANVAS_MODEL || 'openai/gpt-oss-120b',
  };
};

export default getGroqConfig;
