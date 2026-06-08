#!/usr/bin/env node

const provider = (process.argv[2] || 'openrouter').toLowerCase();
const modelOverride = process.argv[3] || '';

const providers = {
  openai: {
    keyEnv: 'OPENAI_API_KEY',
    defaultModel: 'gpt-5.2'
  },
  google: {
    keyEnv: 'GEMINI_API_KEY',
    defaultModel: 'gemini-3.5-flash'
  },
  anthropic: {
    keyEnv: 'ANTHROPIC_API_KEY',
    defaultModel: 'claude-sonnet-4-20250514'
  },
  openrouter: {
    keyEnv: 'OPENROUTER_API_KEY',
    defaultModel: 'google/gemini-3.1-flash-lite'
  }
};

const config = providers[provider];
if (!config) {
  console.error('Usage: node script/verify_ai_screenshot_summary.mjs <openai|google|anthropic|openrouter> [model]');
  process.exit(1);
}

const apiKey = process.env[config.keyEnv];
if (!apiKey) {
  console.error(`Missing ${config.keyEnv}.`);
  process.exit(1);
}

const model = modelOverride || config.defaultModel;
const requiredStringFields = [
  'app',
  'bundle_id',
  'window_or_page',
  'project_or_context',
  'activity',
  'category',
  'action',
  'cloud_safe_summary',
  'sensitivity'
];
const requiredStringArrayFields = ['objects', 'evidence', 'uncertainties', 'metadata_conflicts'];
const tinyJpegBase64 = '/9j/2w==';
const metadata = {
  activity_id: 'manual-test',
  capture_timestamp_iso: new Date().toISOString(),
  duration_seconds: 90,
  frontmost_app_name: 'Oriel Manual Test',
  bundle_id: 'so.sil.oriel.manual-test',
  process_id: null,
  window_title: 'Manual verification',
  browser_url: null,
  browser_domain: null,
  project_name: null,
  input_state: 'hands_on',
  screenshot_width: 1,
  screenshot_height: 1,
  display_id: 'manual'
};

const jsonSchema = makeJSONSchema('string', 'array', 'number');
const geminiSchema = makeJSONSchema('STRING', 'ARRAY', 'NUMBER');
const instruction = `Analyze the screenshot using the metadata as source of truth for app identity.
Return only the required activity summary JSON.
Metadata JSON:
${JSON.stringify(metadata, null, 2)}`;

const request = buildRequest();
const response = await fetch(request.url, {
  method: 'POST',
  headers: request.headers,
  body: JSON.stringify(request.body)
});
const text = await response.text();
if (!response.ok) {
  console.error(`Provider returned HTTP ${response.status}.`);
  console.error(safeErrorMessage(text));
  process.exit(1);
}

let payload;
try {
  payload = JSON.parse(text);
} catch {
  console.error('Provider response was not JSON.');
  process.exit(1);
}

const summary = extractSummary(payload);
const validation = validateSummary(summary);
if (!validation.ok) {
  console.error(`Schema validation failed: ${validation.error}`);
  process.exit(1);
}

console.log(`OK: ${provider} ${model} returned a valid screenshot summary schema.`);
console.log(`Fields: ${Object.keys(summary).sort().join(', ')}`);

function buildRequest() {
  if (provider === 'openai') {
    return {
      url: 'https://api.openai.com/v1/responses',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: {
        model,
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: instruction },
              { type: 'input_image', image_url: `data:image/jpeg;base64,${tinyJpegBase64}` }
            ]
          }
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'activity_summary',
            strict: true,
            schema: jsonSchema
          }
        }
      }
    };
  }
  if (provider === 'google') {
    return {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      headers: {
        'x-goog-api-key': apiKey,
        'Content-Type': 'application/json'
      },
      body: {
        contents: [
          {
            role: 'user',
            parts: [
              { text: instruction },
              {
                inline_data: {
                  mime_type: 'image/jpeg',
                  data: tinyJpegBase64
                }
              }
            ]
          }
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: geminiSchema
        }
      }
    };
  }
  if (provider === 'anthropic') {
    return {
      url: 'https://api.anthropic.com/v1/messages',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: {
        model,
        max_tokens: 1000,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: instruction },
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/jpeg',
                  data: tinyJpegBase64
                }
              }
            ]
          }
        ],
        tools: [
          {
            name: 'record_activity_summary',
            description: 'Record the validated activity summary JSON for this screenshot.',
            input_schema: jsonSchema
          }
        ],
        tool_choice: {
          type: 'tool',
          name: 'record_activity_summary'
        }
      }
    };
  }
  return {
    url: 'https://openrouter.ai/api/v1/chat/completions',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'X-Title': 'Oriel'
    },
    body: {
      model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: instruction },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${tinyJpegBase64}` } }
          ]
        }
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'activity_summary',
          strict: true,
          schema: jsonSchema
        }
      },
      provider: {
        allow_fallbacks: false
      }
    }
  };
}

function makeJSONSchema(stringType, arrayType, numberType) {
  const properties = {};
  for (const field of requiredStringFields) properties[field] = { type: stringType };
  for (const field of requiredStringArrayFields) {
    properties[field] = { type: arrayType, items: { type: stringType } };
  }
  properties.confidence = { type: numberType, minimum: 0, maximum: 1 };
  return {
    type: stringType === 'STRING' ? 'OBJECT' : 'object',
    additionalProperties: false,
    required: [...requiredStringFields, ...requiredStringArrayFields, 'confidence'],
    properties
  };
}

function extractSummary(payload) {
  if (provider === 'openai') {
    const text = payload.output_text
      || payload.output?.flatMap(item => item.content || []).find(part => part.text)?.text;
    return parseJSONText(text);
  }
  if (provider === 'google') {
    return parseJSONText(payload.candidates?.[0]?.content?.parts?.find(part => part.text)?.text);
  }
  if (provider === 'anthropic') {
    const toolUse = payload.content?.find(part => part.type === 'tool_use');
    if (toolUse?.input && typeof toolUse.input === 'object') return toolUse.input;
    return parseJSONText(payload.content?.filter(part => part.text).map(part => part.text).join('\n'));
  }
  return parseJSONText(payload.choices?.[0]?.message?.content);
}

function parseJSONText(value) {
  if (!value || typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function validateSummary(summary) {
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) {
    return { ok: false, error: 'summary is not an object' };
  }
  for (const field of requiredStringFields) {
    if (typeof summary[field] !== 'string') return { ok: false, error: `${field} is not a string` };
  }
  for (const field of requiredStringArrayFields) {
    if (!Array.isArray(summary[field]) || summary[field].some(item => typeof item !== 'string')) {
      return { ok: false, error: `${field} is not a string array` };
    }
  }
  if (typeof summary.confidence !== 'number') return { ok: false, error: 'confidence is not a number' };
  return { ok: true };
}

function safeErrorMessage(value) {
  try {
    const parsed = JSON.parse(value);
    return parsed.error?.message || parsed.error?.status || 'Provider error.';
  } catch {
    return String(value || 'Provider error.').slice(0, 300);
  }
}
