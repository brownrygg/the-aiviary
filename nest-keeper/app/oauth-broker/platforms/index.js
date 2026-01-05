import meta from './meta.js';
import asana from './asana.js';
import google from './google.js';
import monday from './monday.js';
import slack from './slack.js';
import linkedin from './linkedin.js';
import tiktok from './tiktok.js';
import youtube from './youtube.js';

const platforms = {
  meta,
  asana,
  google,
  monday,
  slack,
  linkedin,
  tiktok,
  youtube
};

export function getPlatform(name) {
  const platform = platforms[name.toLowerCase()];
  if (!platform) {
    throw new Error(`Platform '${name}' not found`);
  }
  return platform;
}

export function listPlatforms() {
  return Object.keys(platforms);
}

export function validatePlatforms() {
  const errors = [];

  for (const [name, platform] of Object.entries(platforms)) {
    if (!platform.name) {
      errors.push(`Platform '${name}' missing 'name' property`);
    }
    if (typeof platform.getAuthUrl !== 'function') {
      errors.push(`Platform '${name}' missing 'getAuthUrl' function`);
    }
    if (typeof platform.handleCallback !== 'function') {
      errors.push(`Platform '${name}' missing 'handleCallback' function`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Platform validation failed:\n${errors.join('\n')}`);
  }

  console.log(`✅ Validated ${Object.keys(platforms).length} platform(s): ${Object.keys(platforms).join(', ')}`);
}
