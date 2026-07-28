require('dotenv').config();

const SERVICE_ID = process.env.EMAILJS_SERVICE_ID || "service_ur884qv";
const PUBLIC_KEY = process.env.EMAILJS_PUBLIC_KEY || "45tRyW8WG36pIFeBo";
const PRIVATE_KEY = process.env.EMAILJS_PRIVATE_KEY;
const OTP_TPL = "template_x8k19wl";
const TEST_EMAIL = "pascualgenhospi@gmail.com";

const otp = Math.floor(100000 + Math.random() * 900000).toString();
const expTime = new Date(Date.now() + 15 * 60000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

console.log(`=== VALIDATION TEST for ${OTP_TPL} ===`);
console.log(`OTP code: ${otp}`);
console.log(`Expires at: ${expTime}`);
console.log("Sending...");

(async () => {
  try {
    const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service_id: SERVICE_ID,
        template_id: OTP_TPL,
        user_id: PUBLIC_KEY,
        accessToken: PRIVATE_KEY,
        template_params: {
          to_email: TEST_EMAIL,
          otp_code: otp,
          otp: otp,
          code: otp,
          passcode: otp,
          verification_code: otp,
          time: expTime,
          expiration_time: expTime,
          expiry: expTime,
          from_name: "Pascualinga Hospital"
        }
      })
    });
    const body = await res.text();
    if (res.ok) {
      console.log(`✅ SUCCESS (HTTP ${res.status}) — OTP EMAIL SENT!`);
      console.log(`Check ${TEST_EMAIL} inbox. It should show:`);
      console.log(`  - Subject: "OTP for your Pascual General Hospital authentication"`);
      console.log(`  - Orange "SECURITY VERIFICATION" heading`);
      console.log(`  - Orange dashed box with LARGE ORANGE code: ${otp}`);
      console.log(`  - "This OTP is valid for 15 minutes and will expire at ${expTime}"`);
      console.log(`  - "Pascualinga Administration Team" footer`);
    } else {
      console.log(`❌ FAILED (HTTP ${res.status}) — ${body}`);
    }
  } catch (e) {
    console.log(`❌ NETWORK ERROR: ${e?.message || e}`);
  }
})();
