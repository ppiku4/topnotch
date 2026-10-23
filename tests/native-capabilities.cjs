// Opt in on hardware-less CI hosts. Do not waive arbitrary COM failures or
// missing samples on machines that successfully initialize an audio endpoint.
function isMissingAudio(message, allow = process.env.TOPNOTCH_ALLOW_MISSING_AUDIO === '1') {
  return allow && /^(?:\[system-helper\] )?(?:audio endpoint|mixer): .*\b0x80070490\b/i.test(String(message));
}

module.exports = { isMissingAudio };
