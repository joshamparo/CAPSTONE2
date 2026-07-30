# Debug Session: video-room-mismatch
- **Status**: [OPEN]
- **Issue**: Doctor web and patient app can each open a Jitsi call UI, but they do not end up in the same live room. The patient app shows "The conference has not yet started because no moderators have arrived" even after the doctor has already joined on web.
- **Debug Server**: http://192.168.1.74:7777/event
- **Log File**: .dbg/trae-debug-log-video-room-mismatch.ndjson

## Reproduction Steps
1. Log in on the doctor web dashboard with the assigned doctor/moderator account.
2. Start a video consultation for the same appointment that the patient app will join.
3. Open the patient app video consultation room for that same appointment.
4. Observe whether both clients resolve to the same room URL and whether the patient sees the doctor as an active moderator.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | Doctor web and patient app still resolve different room identifiers/URLs for the same appointment. | High | Low | Pending |
| B | The patient app is joining a different appointment source or appointment ID than the web doctor flow. | High | Medium | Pending |
| C | Moderator/auth configuration differs between web and app, so the doctor joins as a normal participant or anonymous user. | High | Medium | Pending |
| D | The backend start route sets `meeting_room_id`, but the client actually loads another URL from a separate flow or cached value. | Medium | Low | Pending |
| E | Jitsi token / JWT / moderator claim generation differs between platforms, so the app waits for a moderator in one room while the web is in another or unauthenticated state. | Medium | Medium | Pending |

## Log Evidence
- Pending
- Instrumentation added to backend `appointments` video start/join routes and frontend doctor web start flow.

## Verification Conclusion
- Pending
