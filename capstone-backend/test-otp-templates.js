require('dotenv').config();

const SERVICE_ID = process.env.EMAILJS_SERVICE_ID || "service_ur884qv";
const PUBLIC_KEY = process.env.EMAILJS_PUBLIC_KEY || "45tRyW8WG36pIFeBo";
const PRIVATE_KEY = process.env.EMAILJS_PRIVATE_KEY;

const TEMPLATES_TO_TEST = [
  { id: "template_65mdd0e", label: "KNOWN: Patients/Appointments" },
  { id: "template_zkps5b8", label: "KNOWN: Admin Staff (MOST LIKELY OTP)" },
  { id: "template_xyatwcf", label: "KNOWN: Password Recovery" },
];

const TEST_EMAIL = "pascualgenhospi@gmail.com";
const TEST_OTP = Math.floor(100000 + Math.random() * 900000).toString();
const expTime = new Date(Date.now() + 15 * 60000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

console.log("=== EMAILJS OTP TEMPLATE TEST ===");
console.log(`Private Key set: ${!!PRIVATE_KEY}`);
console.log(`Test OTP code: ${TEST_OTP}`);
console.log(`Test recipient: ${TEST_EMAIL}`);
console.log("");

async function testOne(tpl) {
  console.log(`[TEST] Template ${tpl.id} (${tpl.label})...`);
  try {
    const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service_id: SERVICE_ID,
        template_id: tpl.id,
        user_id: PUBLIC_KEY,
        accessToken: PRIVATE_KEY,
        template_params: {
          to_email: TEST_EMAIL,
          otp_code: TEST_OTP,
          otp: TEST_OTP,
          code: TEST_OTP,
          passcode: TEST_OTP,
          time: expTime,
          expiration_time: expTime,
          from_name: "Pascualinga Hospital",
          to_name: "Pascualinga Admin",
          patient_name: "TEST PATIENT",
          appointment_date: "TEST DATE",
          reset_link: "https://test-link.example.com"
        }
      })
    });
    const body = await res.text();
    if (res.ok) {
      console.log(`  ✅ PASS (HTTP ${res.status}) - EMAIL SENT! Check inbox for: [${tpl.label}]`);
      return true;
    } else {
      console.log(`  ❌ FAIL (HTTP ${res.status}) - ${body || "no body"}`);
      return false;
    }
  } catch (e) {
    console.log(`  ❌ NETWORK ERROR - ${e?.message || e}`);
    return false;
  }
}

(async () => {
  for (const tpl of TEMPLATES_TO_TEST) {
    await testOne(tpl);
    console.log("");
    await new Promise(r => setTimeout(r, 2000)); // Avoid rate limit
  }
  console.log("=== TEST COMPLETE ===");
  console.log(`All 3 emails should be in ${TEST_EMAIL} inbox NOW.`);
  console.log("Compare them to your OTP screenshot. Pick the one with PGH logo, ORANGE heading, dashed OTP box with 6 digits.");
})();
