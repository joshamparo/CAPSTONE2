require('dotenv').config();

const SERVICE_ID = process.env.EMAILJS_SERVICE_ID || "service_ur884qv";
const PUBLIC_KEY = process.env.EMAILJS_PUBLIC_KEY || "45tRyW8WG36pIFeBo";
const PRIVATE_KEY = process.env.EMAILJS_PRIVATE_KEY;

const TEST_EMAIL = "pascualgenhospi@gmail.com";

const TESTS = [
  { id: "template_ir71fnn", label: "A) FROM BACKUP: Original OTP candidate (FAILED before)", code: "111111", expectedSubject: "OTP for your Pascual General Hospital authentication" },
  { id: "template_65mdd0e",  label: "B) KNOWN VALID: Appointment Confirmation (WRONG format)",   code: "222222", expectedSubject: "Appointment/Patient Confirmation style" },
  { id: "template_zkps5b8",  label: "C) CURRENTLY USED: Admin Staff / NEW ACCOUNT Welcome (WRONG)", code: "333333", expectedSubject: "Welcome to Pascual General Hospital!" },
  { id: "template_xyatwcf",  label: "D) KNOWN VALID: Password Recovery (forgot password)",        code: "444444", expectedSubject: "Password Reset style" },
];

console.log("=== UNIQUE-CODE OTP TEMPLATE MATCHER ===");
console.log(`Target inbox: ${TEST_EMAIL}`);
console.log("Each template sends a UNIQUE 6-digit code. Check the email's ORANGE OTP BOX (if any):");
console.log("");
TESTS.forEach(t => console.log(`  ${t.code} → ${t.label}`));
console.log("");
console.log("IF an email shows the ORANGE DASHED BOX with one of these codes → THAT template is the REAL OTP ONE.");
console.log("");

const expTime = new Date(Date.now() + 15 * 60000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

async function testOne(tpl) {
  console.log(`[SEND] ${tpl.code} → ${tpl.id} ...`);
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
          to_name: "Pascualinga Admin",
          patient_name: "TEST PATIENT",
          appointment_date: "TEST DATE",
          reset_link: "https://reset-link.example.com",
          otp_code: tpl.code,
          otp: tpl.code,
          code: tpl.code,
          passcode: tpl.code,
          verification_code: tpl.code,
          temp_password: tpl.code,
          temporary_password: tpl.code,
          time: expTime,
          expiration_time: expTime,
          expiry: expTime,
          from_name: "Pascualinga Hospital",
          access_email: TEST_EMAIL,
        }
      })
    });
    const body = await res.text();
    if (res.ok) {
      console.log(`  ✅ SENT. Open inbox → find email containing code ${tpl.code}`);
      return true;
    } else {
      console.log(`  ❌ FAIL (HTTP ${res.status}) → ${body || "(no details)"}`);
      return false;
    }
  } catch (e) {
    console.log(`  ❌ NETWORK ERROR → ${e?.message || e}`);
    return false;
  }
}

(async () => {
  for (const tpl of TESTS) {
    await testOne(tpl);
    console.log("");
    await new Promise(r => setTimeout(r, 2500));
  }
  console.log("=== ALL 4 SENT (or attempted) ===");
  console.log("");
  console.log("GO TO YOUR INBOX NOW → buksan ang LAHAT ng bagong dumating na 4 na email.");
  console.log("Sa BAWAT email, TINGNAN:");
  console.log("  1. Ano ang SUBJECT LINE?");
  console.log("  2. May ORANGE DASHED BOX ba na may 6-DIGIT CODE?");
  console.log("  3. Kung meron — ANONG CODE ANG NASA LOOB? (111111, 222222, 333333, o 444444?)");
  console.log("  4. Match ba ang itsura sa 2nd pic mo (SECURITY VERIFICATION heading, Pascualinga Admin Team footer)?");
})();
