# Welcome to the Pascualinga Capstone Prompt File!

> **How to use this file:**
> now, tell me the best plan for this to make it successful. make sure that its convenient to the hospital staff and make sure its all working as expected.

## Pinaka-likely na cause
Suri ko na ang updated PROMPT.md, bruh. Base sa mga requirements mo para maging "successful" at "convenient" ang system para sa hospital staff, narito ang Best Plan para sa HMO implementation:

🏥 The HMO Success Plan (Web-First Approach)
Para maging smooth ang workflow ng hospital staff (Cashier/Office Staff) at hindi sila mahirapan, kailangan nating i-implement ang HMO process na integrated sa billing nila.

1. Centralized HMO Approval Portal (Staff Side)
Dapat sa dashboard pa lang, makikita na ng staff kung sinong patients ang may pending HMO approval.

Convenience: Imbes na tumingin sa papel, may digital list sila ng patients na kailangang "itawag" sa HMO.
Feature: Isang dedicated tab sa OfficeStaffDashboard.js para sa "HMO Monitoring".
2. Smart Billing Deduction Logic
Ito ang pinaka-critical part para maging "working as expected":

Step-by-Step UI:
PhilHealth First: Isang checkbox o field para sa PhilHealth deduction.
HMO Contribution: Dropdown ng HMO providers (Maxicare, etc.) + field para sa "LOA Approved Amount".
Auto-Calculation: Ang system na ang mag-compute: (Total Bill - PhilHealth - HMO = Patient's Payable).
Staff Benefit: Hindi na sila magka-calculate sa calculator. Iwas-error sa sukli at billing.
3. Letter of Authority (LOA) Archiving
Feature: Capability na mag-upload o mag-input ng LOA reference number.
Staff Benefit: Madaling balikan kung sakaling magka-audit ang hospital.
🚀 Why this is the best plan?
Hospital Convenience: Ang staff ay may structured workflow. Hindi sila manghuhula kung magkano ang idededuct.
Accuracy: "Working as expected" dahil sundo nito ang PhilHealth-then-HMO rule na nasa screenshot mo.
Patient Satisfaction: Mabilis ang billing process, walang matagal na hintayan sa cashier.
🛠️ Next Action: Let's Code!
Gusto mo na bang simulan natin ang pag-apply ng HMO Billing Logic sa OfficeStaffDashboard.js?

Kaya nating gawin ito:

I-unhide ang HMO Fields na naka-placeholder lang ngayon.
I-link ang PhilHealth & HMO inputs sa Net Amount Due calculation.
Magdagdag ng "Status: Awaiting HMO LOA" indicator sa patient list.
Ready na ako, bruh! I-go mo lang, solid na 'to.

## Suggested setup
- Doctor web: action: "start"
- Patient app: action: "join"
- parehong source table
- parehong appointmentId
- parehong backend function
- parehong returned url

eto yung sabi sa app system namin.

---

## 📝 YOUR PROMPT HERE
**Date:** 2026-07-28
**Task:** 
*(Write your prompt here... e.g., "Fix the Video Consultation App to Web connection")*

**Additional Context/Notes:**
- 

---

## 🏥 Current System Status (As of last update)
- **Doctor Side:** 100% Ready
- **Nurse Side:** 100% Ready (Added STAT alerts & Acknowledgement)
- **Cashier Side:** 100% Ready (Thermal OR Layout, HMO hidden)
- **Pharmacist Side:** 100% Ready (Atomic Transactions for POS)
- **Clinical Staff:** 100% Ready (PDF/Image Viewer added)
- **Admin Side:** 100% Ready (Deep Activity Logs added)
- **UI Consistency:** All Profile pages matched to Admin UI template.

## 📌 Next Planned Tasks
- Video Consultation (App to Website connection fix)
