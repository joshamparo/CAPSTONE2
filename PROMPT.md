# Welcome to the Pascualinga Capstone Prompt File!

> **How to use this file:**
> now, tell me the best plan for this to make it successful. make sure that its convenient to the hospital staff and make sure its all working as expected.

## Pinaka-likely na cause
- Both videocall now are working and meeting room is created for both, but we need to fix the connection between the two. 
Oo chat, may need sa web side . Since connected na kayo sa same room pero avatar lang ang nakikita at walang naririnig , hindi na ito room-name mismatch. Mas mukhang web embed / iframe permissions / browser policy issue na.

Pinakaimportanteng sabihin mo sa web programmer:

## 1. I-test muna nila sa direct new tab, hindi sa modal/embed
Sabihin mo:

- gamitin nila yung exact url returned by backend
- i-open muna sa new tab
- huwag muna sa iframe/modal
Example:

Bakit:
 Kapag gumana ang audio/video sa new tab , ibig sabihin ang problema nasa web embed/modal , hindi sa Jitsi room mismo.

## 2. Kung naka-embed sa iframe/modal, dapat may tamang permissions
Sabihin mo ilagay ito sa iframe:

Kung may sandbox , puwedeng doon nabblock. For testing, sabihin mo:

- tanggalin muna ang sandbox , or
- siguraduhing may:
## 3. Huwag silang gagawa ng sariling room name
Sabihin mo ulit sa kanya:

- same appointmentId
- same sourceTable
- same daily-create-room
- exact returned url lang ang gamitin
Hindi:

- manual Jitsi URL
- sariling concat
- title-to-room conversion
## 4. Check browser/site permissions on web
Sabihin mo i-check ito sa web side:

- naka-HTTPS ang site
- pinayagan ng browser ang camera
- pinayagan ng browser ang microphone
- walang browser/site permission na naka-Block
- walang browser extension/adblock na nakikialam sa Jitsi iframe
## 5. Possible server header issue sa web
Kung naka-iframe kayo sa website, puwedeng may Permissions-Policy or CSP issue.

Sabihin mo ipa-check nila kung may headers na nagbablock ng media sa iframe, lalo na:

- Permissions-Policy
- Content-Security-Policy
Kung meron, dapat payagan ang Jitsi host.

## Pinakamabilis na test para sa web programmer
Sabihin mo ito exactly:

1. Tawagin ang backend daily-create-room
2. Kunin ang exact url
3. I-open muna sa new tab
4. Kapag gumana ang audio/video sa new tab pero hindi sa modal/embed:
   - problem is iframe/web container
5. Kapag hindi pa rin gumana kahit new tab:
   - problem is Jitsi/WebRTC path , hindi UI
## Base sa screenshots mo
Mukhang:

- same room na kayo
- parehong may local preview
- pero remote stream hindi nagre-render / hindi tumatawid nang maayos
So pinakamalakas kong hinala ngayon:
 web embed/modal permissions issue muna ang ipacheck.

Kung gusto mo, pwede kitang bigyan ng exact message na isesend mo sa web programmer para copy-paste mo na lang.

22:04
Liam TDP

e sa app side wala bang need gawin?

Agent

Thought process

Meron pa chat, pero based sa screenshots, mas maliit na yung app-side issue kaysa sa web side .

Bakit ko nasabi:

- sa app mo, nakikita mo na yung sarili mo sa maliit na preview
- sa web, nakikita rin ng doctor yung sarili niya
- ibig sabihin gumagana na ang local camera capture sa both sides
- ang hindi gumagana ngayon ay remote audio/video exchange/rendering
So yes, may app-side checks pa , pero hindi na ito yung main blocker .

## Sa app side, ito ang need ninyong siguraduhin
1. APK ang gamitin, hindi Expo Go
   
   - since doon na gumana ang camera/mic access
   - build config nasa eas.json
2. Permissions must stay allowed
   
   - Camera = Allow
   - Microphone = Allow
   - declared already in app.json
3. Current app Jitsi config is already in compatibility mode
   
   - nasa VideoCallScreen.jsx
   - naka-disable na yung mas risky paths like p2p , simulcast-heavy behavior, etc.
4. Update Android System WebView / Chrome sa phone
   
   - ito malaking factor sa embedded Jitsi video rendering
## Pero ang pinakamalakas pa ring suspect ngayon
Web embed/container permissions .

Kasi kung local preview works on both sides pero hindi tumatawid ang media:

- iframe/modal permission issue
- browser permission issue
- autoplay/WebRTC restriction sa web container
- or mali ang way nila pag-embed ng Jitsi
## So short answer
Oo, may app-side checks pa. Pero sa code side, hindi na app ang pinakauna kong gagalawin ngayon.
 Mas kailangan ipa-check sa web dev ang:

- direct new tab test
- iframe allow="camera; microphone; autoplay; ..."
- no manual room building
- same backend url
## Practical next move
Sabihin mo sa web programmer:

1. i-open muna ang returned Jitsi url sa new tab
2. kung gumana doon, problema ay nasa web modal/iframe
3. kung ayaw pa rin, saka tayo babalik sa deeper app/web WebRTC tuning
Kung gusto mo, gagawan kita ng exact copy-paste message para sa web programmer mo.
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
