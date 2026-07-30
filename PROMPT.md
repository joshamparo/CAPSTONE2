# Welcome to the Pascualinga Capstone Prompt File!

> **How to use this file:**
> Chineck ko yung mobile code, at may mas malinaw na sagot na tayo:

Hindi lang “app gumagawa ng sariling room name” ang problema.
 Ang mas likely na totoong dahilan ay hindi pare-pareho ang room source / sourceTable / backend endpoint na ginagamit ng web at app .

## Ano yung nakita ko sa code
Chineck ko yung mobile code, at may mas malinaw na sagot na tayo:

Hindi lang “app gumagawa ng sariling room name” ang problema.
 Ang mas likely na totoong dahilan ay hindi pare-pareho ang room source / sourceTable / backend endpoint na ginagamit ng web at app .

## Ano yung nakita ko sa code
Sa patient main join flow, maayos na yung direksyon:

- PatientSchedule.jsx:L204-L220 tumatawag sa edge function at nagpapasa ng sourceTable
- PatientSchedule.jsx:L249-L318 ginagamit yung exact url / tokenUrl galing backend
Pero may ibang flows na puwedeng maghiwalay:

- PatientServicesScreen.jsx:L1077-L1094 tumatawag sa edge function na walang sourceTable
- PatientServicesScreen.jsx:L4642-L4666 may fallback pa sa lumang saved room fields
At sa doctor-side app flow na nasa repo:

- NurseVideo.jsx:L39-L55 tumatawag din sa edge function na walang sourceTable
- NurseVideo.jsx:L149-L174 ginagamit ang returned URL, pero again walang table hint
Tapos sa backend:

- daily-create-room/index.ts:L148-L163 kapag walang sourceTable , hahanapin niya ang appointment sa order na: appointments -> appointment_approval_requests -> service_appointment
- daily-create-room/index.ts:L327-L398 dito ginagawa/re-reuse ang Jitsi room
## Bakit ito important
Kung ang web gumagamit ng legacy flow na pascualinga-<appointmentId> o ibang endpoint, tapos ang app gumagamit ng edge function na apt-<id>-<hash> , hindi talaga kayo magkikita .

At kahit same edge function pa, kung:

- web = appointments
- app = appointment_approval_requests
possible pa ring maghiwalay ang room source.

## Recommendation ko for both web and app
### Web side
1. Tumigil sa manual room name generation
   
   - huwag gumawa ng pascualinga-<id>
   - huwag mag-concat ng sariling Jitsi URL
2. Tumawag sa parehong backend ng app
   
   - same daily-create-room
   - same appointmentId
   - same sourceTable
3. Open exact url returned by backend
   
   - hindi providerRoomName
   - hindi custom room name
Suggested payload:

### App side
1. Laging dumaan sa same backend join flow
   
   - yung nasa PatientSchedule.jsx ang tamang pattern
2. Iwasan yung alternate flows na walang sourceTable
   
   - especially yung active call banner sa PatientServicesScreen.jsx
3. Patient should join only backend-owned room
   
   - no local room building
   - no title-to-URL conversion
## Pinaka-importanteng test ninyong gawin
For the same appointment ID , patest niyo parehong sides:

### Web start
### App join
{
  "appointmentId": "90",
  "action": "join",
  "sourceTable": 
  "appointment_approval_requests"
}
Kapag magkaiba ang url na lumabas sa dalawang yan, ayun ang bug.

## Short version
Friend mo is partly right, pero after checking the mobile code, ang mas exact diagnosis ko ay:

- main patient schedule flow looks mostly correct
- real mismatch is likely on the web/doctor integration or alternate app join paths
- both sides must use the same backend, same appointmentId, same sourceTable, same returned url
Kung gusto mo, next message mo lang yung doctor web Start Call code o kahit paste mo lang yung request body at yung URL na ino-open niya, tapos tutulungan kitang i-compare line by line against the app flow.

## Recommendation ko for both web and app
### Web side
1. Tumigil sa manual room name generation
   
   - huwag gumawa ng pascualinga-<id>
   - huwag mag-concat ng sariling Jitsi URL
2. Tumawag sa parehong backend ng app
   
   - same daily-create-room
   - same appointmentId
   - same sourceTable
3. Open exact url returned by backend
   
   - hindi providerRoomName
   - hindi custom room name
Suggested payload:

### App side
1. Laging dumaan sa same backend join flow
   
   - yung nasa PatientSchedule.jsx ang tamang pattern
2. Iwasan yung alternate flows na walang sourceTable
   
   - especially yung active call banner sa PatientServicesScreen.jsx
3. Patient should join only backend-owned room
   
   - no local room building
   - no title-to-URL conversion
## Pinaka-importanteng test ninyong gawin
For the same appointment ID , patest niyo parehong sides:

### Web start
### App join
{
  "appointmentId": "90",
  "action": "join",
  "sourceTable": 
  "appointment_approval_requests"
}
Kapag magkaiba ang url na lumabas sa dalawang yan, ayun ang bug.

## Short version
Friend mo is partly right, pero after checking the mobile code, ang mas exact diagnosis ko ay:

- main patient schedule flow looks mostly correct
- real mismatch is likely on the web/doctor integration or alternate app join paths
- both sides must use the same backend, same appointmentId, same sourceTable, same returned url
Kung gusto mo, next message mo lang yung doctor web Start Call code o kahit paste mo lang yung request body at yung URL na ino-open niya, tapos tutulungan kitang i-compare line by line against the app flow.

## Pinaka-likely na cause
- Guess the problem why both video call features in app and web are working together but meeting room is not created for both.

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
