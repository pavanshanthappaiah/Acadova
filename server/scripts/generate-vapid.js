// One-off helper: generate a VAPID keypair for web push and print it as .env lines.
// Usage: node scripts/generate-vapid.js
import webpush from 'web-push';

const keys = webpush.generateVAPIDKeys();
console.log('Add these to server/.env:\n');
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log(`VAPID_SUBJECT=mailto:you@example.com`);
