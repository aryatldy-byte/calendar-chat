// Face ID / Touch ID / fingerprint via WebAuthn (platform authenticator, user verification required).
// This is a per-device lock for the UI: the OS only completes the prompt after a successful biometric/passcode check.
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (s) =>
  Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
const rand = (n) => crypto.getRandomValues(new Uint8Array(n));

export async function bioAvailable() {
  try {
    return !!window.PublicKeyCredential && (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
  } catch (_) { return false; }
}

export async function bioRegister() {
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: rand(32),
      rp: { name: 'Calendar' },
      user: { id: rand(16), name: 'calendar-user', displayName: 'Calendar' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      timeout: 60000,
      attestation: 'none',
    },
  });
  return b64(cred.rawId);
}

export async function bioVerify(credId) {
  await navigator.credentials.get({
    publicKey: {
      challenge: rand(32),
      allowCredentials: [{ type: 'public-key', id: unb64(credId), transports: ['internal'] }],
      userVerification: 'required',
      timeout: 60000,
    },
  });
  return true;
}
