import * as Joi from 'joi';

export const validationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().default(4100),

  // Long and random: it is the only thing between the internet and a paid
  // model. `openssl rand -base64 48`.
  AI_SERVICE_TOKEN: Joi.string().min(32).required(),

  LLM_PROVIDER: Joi.string().valid('openai', 'fake').default('openai'),
  OPENAI_API_KEY: Joi.string()
    .allow('')
    .when('LLM_PROVIDER', {
      is: 'openai',
      then: Joi.string().required().messages({
        'any.required': 'OPENAI_API_KEY is required when LLM_PROVIDER=openai',
      }),
    }),
  OPENAI_MODEL: Joi.string().default('gpt-4.1-mini'),
  LLM_TIMEOUT_MS: Joi.number().integer().min(1000).default(60000),
  LLM_MAX_RETRIES: Joi.number().integer().min(0).max(5).default(2),
  AI_MAX_CONCURRENCY: Joi.number().integer().min(1).default(8),

  MAX_CV_BYTES: Joi.number()
    .integer()
    .min(1024)
    .default(10 * 1024 * 1024),
  MAX_CV_CHARS: Joi.number().integer().min(1000).default(30000),
});
