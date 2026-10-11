/**
 * WhatsApp Business Platform Cloud API Core Client
 * Location: lib/whatsapp/client.js
 */

import prisma from '@/lib/db';

/**
 * Resolves the correct language code for a template by checking the local DB cache.
 * Meta requires an exact language match — sending 'en' when the template was registered
 * as 'en_US' (or vice versa) will cause a 'template not found' error (132000).
 */
async function resolveTemplateLanguage(templateName, fallbackCode = 'en_US') {
  try {
    const dbTemplate = await prisma.whatsAppTemplate.findUnique({
      where: { name: templateName },
      select: { language: true }
    });
    if (dbTemplate?.language) {
      return dbTemplate.language;
    }
  } catch (err) {
    console.warn(`[WhatsApp Client] Failed to resolve language for template ${templateName}:`, err.message);
  }
  return fallbackCode || 'en_US';
}

const API_VERSION = process.env.WHATSAPP_API_VERSION || 'v23.0';
const BASE_URL = `https://graph.facebook.com/${API_VERSION}`;

/**
 * Verifies that the configured access token is valid and contains the required permissions.
 */
export async function verifyTokenAndPermissions() {
  const config = await getConfig();
  if (!config.configured) throw new Error(config.error);

  const { accessToken } = config;
  const version = 'v23.0';

  try {
    // 1. Verify Access Token
    let meRes;
    try {
      meRes = await fetch(`https://graph.facebook.com/${version}/me?access_token=${accessToken}`, { cache: 'no-store' });
    } catch (err) {
      console.warn('[WhatsApp verifyTokenAndPermissions] Network failure checking token:', err.message);
      return; // Non-blocking fallback
    }

    const meData = await meRes.json();
    if (!meRes.ok || meData.error) {
      console.warn('[WhatsApp verifyTokenAndPermissions] Invalid access token response:', meData.error?.message);
      return; // Non-blocking fallback
    }

    // 2. Verify Required Permissions
    let permRes;
    try {
      permRes = await fetch(`https://graph.facebook.com/${version}/me/permissions?access_token=${accessToken}`, { cache: 'no-store' });
    } catch (err) {
      console.warn('[WhatsApp verifyTokenAndPermissions] Network failure checking permissions:', err.message);
      return; // Non-blocking fallback
    }

    const permData = await permRes.json();
    if (!permRes.ok || permData.error) {
      console.warn('[WhatsApp verifyTokenAndPermissions] Failed to retrieve permissions payload:', permData.error?.message);
      return; // Non-blocking fallback
    }

    const permissions = permData.data || [];
    const grantedPermissions = new Set(
      permissions.filter(p => p.status === 'granted').map(p => p.permission)
    );

    const required = ['whatsapp_business_management', 'whatsapp_business_messaging', 'business_management'];
    const missing = required.filter(p => !grantedPermissions.has(p));
    if (missing.length > 0) {
      console.warn(`[WhatsApp verifyTokenAndPermissions] Warning: Missing Meta app permissions: ${missing.join(', ')}`);
    }
  } catch (err) {
    console.warn('[WhatsApp verifyTokenAndPermissions] Unexpected warning during checks:', err.message);
  }
}

/**
 * Helper to get active configuration and assert env vars.
 * If config is missing, returns an object detailing the failure instead of crashing.
 */
export async function getConfig() {
  let dbSettings = {};
  try {
    const list = await prisma.whatsAppSetting.findMany();
    dbSettings = Object.fromEntries(list.map(s => [s.key, s.value]));
  } catch (err) {
    console.warn('[WhatsApp Client Config] Failed to fetch settings from whatsapp_settings table:', err.message);
  }

  let dbPhoneId = dbSettings['whatsapp_phone_number_id'];
  let dbAccessToken = dbSettings['whatsapp_access_token'];
  let dbWabaId = dbSettings['whatsapp_business_account_id'];
  let dbAppId = dbSettings['whatsapp_app_id'];
  let dbAppSecret = dbSettings['whatsapp_app_secret'];
  let dbVerifyToken = dbSettings['whatsapp_webhook_verify_token'];

  // Fallback to Shop table if not set in whatsapp_settings
  if (!dbPhoneId || !dbAccessToken) {
    try {
      const shop = await prisma.shop.findFirst();
      if (shop) {
        dbPhoneId = dbPhoneId || shop.whatsappPhoneId;
        dbAccessToken = dbAccessToken || shop.whatsappToken;
      }
    } catch (err) {
      console.warn('[WhatsApp Client Config] Shop table lookup failed:', err.message);
    }
  }

  const phoneId = dbPhoneId || process.env.WHATSAPP_PHONE_NUMBER_ID;
  const wabaId = dbWabaId || process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
  const accessToken = dbAccessToken || process.env.WHATSAPP_TOKEN || process.env.WHATSAPP_ACCESS_TOKEN || process.env.WHATSAPP_API_TOKEN;
  const appId = dbAppId || process.env.WHATSAPP_APP_ID;
  const appSecret = dbAppSecret || process.env.WHATSAPP_APP_SECRET;
  const verifyToken = dbVerifyToken || process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || process.env.WHATSAPP_VERIFY_TOKEN || 'zicabella_whatsapp_2026';

  const configured = !!(phoneId && wabaId && accessToken);

  return {
    configured,
    phoneId,
    wabaId,
    accessToken,
    appId,
    appSecret,
    verifyToken,
    error: configured ? null : 'WhatsApp configuration is incomplete. Missing: ' +
      [
        !phoneId && 'WHATSAPP_PHONE_NUMBER_ID',
        !wabaId && 'WHATSAPP_BUSINESS_ACCOUNT_ID',
        !accessToken && 'WHATSAPP_TOKEN'
      ].filter(Boolean).join(', ')
  };
}


/**
 * Formats a phone number: strips non-digits, removes leading 0, 
 * and prepends country code 91 for Indian numbers (10 digits).
 */
export function formatPhone(phone) {
  if (!phone) return '';
  // Strip all non-digits
  let cleaned = phone.toString().replace(/\D/g, '');
  // Remove leading zeros
  cleaned = cleaned.replace(/^0+/, '');
  // Prepend 91 for Indian numbers if it's 10 digits
  if (cleaned.length === 10) {
    cleaned = '91' + cleaned;
  }
  // Validate length for WhatsApp (7 to 15 digits including country code)
  if (cleaned.length < 7 || cleaned.length > 15) {
    return '';
  }
  return cleaned;
}

/**
 * Makes an authorized POST or GET request to the Meta Graph API.
 */
async function graphRequest({ endpoint, method = 'GET', payload = null }) {
  const config = await getConfig();
  if (!config.configured) {
    throw new Error(config.error);
  }

  const url = `${BASE_URL}${endpoint}`;
  const options = {
    method,
    headers: {
      'Authorization': `Bearer ${config.accessToken}`,
      'Content-Type': 'application/json'
    }
  };

  if (payload && method !== 'GET') {
    options.body = JSON.stringify(payload);
  }

  const response = await fetch(url, options);
  const data = await response.json();

  if (!response.ok || data.error) {
    const errMsg = data.error?.message || response.statusText || 'GraphQL request failed';
    console.error(`[WhatsApp API Error] Endpoint: ${endpoint}, Status: ${response.status}`, data);
    const err = new Error(errMsg);
    err.code = data.error?.code;
    err.subcode = data.error?.error_subcode || data.error?.subcode;
    err.fbtrace_id = data.error?.fbtrace_id;
    throw err;
  }

  return data;
}

/**
 * 1A — sendTemplate
 * Sends a pre-approved template message to a specific number.
 * @param {Object} options
 * @param {string} options.to
 * @param {string} options.templateName
 * @param {string} [options.languageCode]
 * @param {Array<any>} [options.components]
 */
export async function sendTemplate({ to, templateName, languageCode = 'en', components = [] }) {
  const config = await getConfig();
  if (!config.configured) throw new Error(config.error);

  const resolvedLanguage = await resolveTemplateLanguage(templateName, languageCode);
  const formattedPhone = formatPhone(to);
  const endpoint = `/${config.phoneId}/messages`;
  
  const payload = {
    messaging_product: 'whatsapp',
    to: formattedPhone,
    type: 'template',
    template: {
      name: templateName,
      language: { code: resolvedLanguage },
    }
  };

  if (components && components.length > 0) {
    payload.template.components = components;
  }

  console.log(`[WhatsApp sendTemplate] Sending template "${templateName}" to ${formattedPhone} (lang: ${resolvedLanguage}, components: ${components.length})`);

  try {
    return await graphRequest({ endpoint, method: 'POST', payload });
  } catch (error) {
    // Check if error is missing parameter_name (Error 100: Parameter name is missing or empty)
    const isParamNameError = error.code === 100 && (
      String(error.message || '').includes('Parameter name is missing') ||
      String(error.message || '').includes('parameter_name') ||
      String(error.details || '').includes('Parameter name is missing')
    );

    if (isParamNameError && payload.template?.components) {
      try {
        const dbTemplate = await prisma.whatsAppTemplate.findUnique({
          where: { name: templateName }
        });
        const bodyComp = dbTemplate?.components?.find((c) => c.type === 'BODY');
        if (bodyComp && bodyComp.text) {
          const varNames = Array.from(bodyComp.text.matchAll(/\{\{([a-zA-Z0-9_]+)\}\}/g)).map(m => m[1]);
          const payloadBody = payload.template.components.find((c) => c.type === 'body' || c.type === 'BODY');
          if (payloadBody && Array.isArray(payloadBody.parameters)) {
            payloadBody.parameters.forEach((param, idx) => {
              const vKey = varNames[idx];
              if (vKey && !/^\d+$/.test(vKey)) {
                param.parameter_name = vKey;
              }
            });
            console.warn(`[WhatsApp sendTemplate] Parameter name error for "${templateName}". Retrying with parameter_name fields...`);
            return await graphRequest({ endpoint, method: 'POST', payload });
          }
        }
      } catch (retryParamErr) {
        console.warn(`[WhatsApp sendTemplate] Parameter name retry failed:`, retryParamErr.message);
      }
    }

    // If Meta returns language mismatch error (132001, 132000, or translation error), retry with alternate language codes
    const isLangError = 
      error.code === 132001 || 
      error.code === 132000 || 
      (error.message && (
        error.message.includes('translation') || 
        error.message.includes('language') || 
        error.message.includes('does not exist')
      ));

    if (isLangError) {
      const candidates = resolvedLanguage === 'en'
        ? ['en_US', 'en_GB', 'hi']
        : (resolvedLanguage === 'en_US' ? ['en', 'en_GB', 'hi'] : ['en', 'en_US', 'hi']);

      // Throttle: missing/unapproved templates (132001) spam every recovery cron tick
      const { shouldLogThrottled } = await import('@/lib/log-throttle');
      if (shouldLogThrottled(`wa:template:${templateName}:${error.code || 'lang'}`, 300_000)) {
        console.warn(
          `[WhatsApp sendTemplate] Template "${templateName}" language/lookup failed (${error.code || ''}: ${error.message}). Trying alternates…`
        );
      }

      for (const altLanguage of candidates) {
        payload.template.language.code = altLanguage;
        try {
          const res = await graphRequest({ endpoint, method: 'POST', payload });
          // Persist working language in DB for future calls
          prisma.whatsAppTemplate.update({
            where: { name: templateName },
            data: { language: altLanguage }
          }).catch(() => {});
          return res;
        } catch {
          // Continue to next candidate
        }
      }
    }
    throw error;
  }
}

/**
 * 1B — sendText
 * Sends a free-form customer service text message (valid within 24h window).
 */
export async function sendText({ to, message }) {
  const config = await getConfig();
  if (!config.configured) throw new Error(config.error);

  const formattedPhone = formatPhone(to);
  const endpoint = `/${config.phoneId}/messages`;

  const payload = {
    messaging_product: 'whatsapp',
    to: formattedPhone,
    type: 'text',
    text: { body: message }
  };

  return graphRequest({ endpoint, method: 'POST', payload });
}

/**
 * 1C — createTemplate
 * Registers a new template in Meta for approval.
 */
export async function createTemplate({ name, category, language = 'en', components }) {
  // Verify token status and required permissions first
  await verifyTokenAndPermissions();

  const config = await getConfig();
  if (!config.configured) throw new Error(config.error);

  const endpoint = `/${config.wabaId}/message_templates`;
  const url = `https://graph.facebook.com/v23.0${endpoint}`;

  const payload = {
    name,
    language,
    category, // UTILITY | MARKETING | AUTHENTICATION
    components
  };

  const headers = {
    'Authorization': `Bearer ${config.accessToken}`,
    'Content-Type': 'application/json'
  };

  // Mask token for secure logging
  const maskedToken = config.accessToken ? (config.accessToken.substring(0, 15) + '...') : 'null';
  console.log("META TEMPLATE REQUEST", {
    url,
    method: 'POST',
    headers: {
      ...headers,
      'Authorization': `Bearer ${maskedToken}`
    },
    payload
  });

  let responseBody = null;
  let responseStatus = null;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      cache: 'no-store'
    });

    responseStatus = response.status;
    responseBody = await response.json();

    console.log("META TEMPLATE RESPONSE", {
      status: responseStatus,
      response: responseBody,
      metaErrorCode: responseBody?.error?.code || null,
      metaErrorSubcode: responseBody?.error?.error_subcode || responseBody?.error?.subcode || null
    });

    if (!response.ok) {
      const errorMsg = responseBody?.error?.message || responseBody?.error?.error_user_msg || `Template creation failed with status ${responseStatus}`;
      const err = new Error(errorMsg);
      // Attach details to return structured error info to caller
      err.code = responseBody?.error?.code;
      err.subcode = responseBody?.error?.error_subcode || responseBody?.error?.subcode;
      err.fbtrace_id = responseBody?.error?.fbtrace_id;
      throw err;
    }

    return responseBody;
  } catch (error) {
    if (!responseBody) {
      console.log("META TEMPLATE RESPONSE (NETWORK ERROR)", error.message);
    }
    throw error;
  }
}

/**
 * 1D — listTemplates
 * Fetches WABA registered templates and their approval status.
 */
export async function listTemplates() {
  const config = await getConfig();
  if (!config.configured) throw new Error(config.error);

  const endpoint = `/${config.wabaId}/message_templates?fields=id,name,status,category,language,components&limit=1000`;
  const result = await graphRequest({ endpoint, method: 'GET' });
  return result.data || [];
}

/**
 * 1E — deleteTemplate
 * Deletes a template from the WABA account by name.
 */
export async function deleteTemplate(name) {
  const config = await getConfig();
  if (!config.configured) throw new Error(config.error);

  const endpoint = `/${config.wabaId}/message_templates?name=${encodeURIComponent(name)}`;
  return graphRequest({ endpoint, method: 'DELETE' });
}

/**
 * 1F — markAsRead
 * Marks a received message as read to acknowledge receipt to Meta.
 */
export async function markAsRead(messageId) {
  const config = await getConfig();
  if (!config.configured) throw new Error(config.error);

  const endpoint = `/${config.phoneId}/messages`;
  
  const payload = {
    messaging_product: 'whatsapp',
    status: 'read',
    message_id: messageId
  };

  return graphRequest({ endpoint, method: 'POST', payload });
}

/**
 * 1G — uploadMedia
 * Uploads a media file (image, video, document) to Meta for use as template header example.
 * Returns a media handle that can be used when creating templates.
 */
export async function uploadMedia({ url, type = 'image' }) {
  const config = await getConfig();
  if (!config.configured) throw new Error(config.error);

  // For template header examples, we use the resumable upload API
  // First, download the image and upload it as a file
  const endpoint = `/${config.phoneId}/media`;

  const payload = {
    messaging_product: 'whatsapp',
    type: type === 'image' ? 'image/jpeg' : type === 'video' ? 'video/mp4' : 'application/pdf',
    url
  };

  return graphRequest({ endpoint, method: 'POST', payload });
}

/**
 * Downloads a media file from a public URL and uploads it to Meta's Media API.
 * Returns the generated Media ID to be used in message templates.
 */
export async function uploadMediaFromUrl(url) {
  const config = await getConfig();
  if (!config.configured) throw new Error(config.error);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch media from URL: ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const contentType = response.headers.get('content-type') || 'image/jpeg';

  const formData = new FormData();
  formData.append('messaging_product', 'whatsapp');
  formData.append('type', contentType);

  const blob = new Blob([buffer], { type: contentType });
  formData.append('file', blob, 'image.jpg');

  const uploadUrl = `${BASE_URL}/${config.phoneId}/media`;
  const metaRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.accessToken}`
    },
    body: formData
  });

  const resText = await metaRes.text();
  let resData;
  try {
    resData = JSON.parse(resText);
  } catch {
    throw new Error(`Invalid JSON response from Meta media upload API: ${resText}`);
  }

  if (!metaRes.ok) {
    throw new Error(resData?.error?.message || 'Meta media upload failed');
  }

  return resData.id;
}


/**
 * 1H — getMediaUrl
 * Retrieves the download URL for an uploaded media asset by its ID.
 */
export async function getMediaUrl(mediaId) {
  const config = await getConfig();
  if (!config.configured) throw new Error(config.error);

  return graphRequest({ endpoint: `/${mediaId}`, method: 'GET' });
}

/**
 * 1I — editTemplate
 * Edits an existing template's components (only allowed for APPROVED or REJECTED templates).
 */
export async function editTemplate({ templateId, components }) {
  const config = await getConfig();
  if (!config.configured) throw new Error(config.error);

  const endpoint = `/${templateId}`;
  const url = `https://graph.facebook.com/v23.0${endpoint}`;

  const payload = { components };

  const headers = {
    'Authorization': `Bearer ${config.accessToken}`,
    'Content-Type': 'application/json'
  };

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    cache: 'no-store'
  });

  const data = await response.json();
  if (!response.ok) {
    const errMsg = data?.error?.message || `Template edit failed with status ${response.status}`;
    throw new Error(errMsg);
  }
  return data;
}
