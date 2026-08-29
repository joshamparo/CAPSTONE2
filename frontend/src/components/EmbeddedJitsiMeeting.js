import React, { useEffect, useRef, useState } from 'react';

const scriptLoads = new Map();

const loadExternalApi = (origin) => {
  if (window.JitsiMeetExternalAPI) return Promise.resolve();
  if (scriptLoads.has(origin)) return scriptLoads.get(origin);

  const promise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-jitsi-origin="${origin}"]`);
    const script = existing || document.createElement('script');
    const timeout = window.setTimeout(() => reject(new Error('Jitsi took too long to load.')), 15000);

    const finish = () => {
      window.clearTimeout(timeout);
      if (window.JitsiMeetExternalAPI) resolve();
      else reject(new Error('Jitsi embed API did not initialize.'));
    };
    const fail = () => {
      window.clearTimeout(timeout);
      reject(new Error('Jitsi was blocked by a browser extension or network policy.'));
    };

    script.addEventListener('load', finish, { once: true });
    script.addEventListener('error', fail, { once: true });
    if (!existing) {
      script.src = `${origin}/external_api.js`;
      script.async = true;
      script.dataset.jitsiOrigin = origin;
      document.head.appendChild(script);
    }
  }).catch((error) => {
    scriptLoads.delete(origin);
    throw error;
  });

  scriptLoads.set(origin, promise);
  return promise;
};

const parseMeeting = (meetingUrl) => {
  const parsed = new URL(String(meetingUrl || '').trim());
  const roomName = decodeURIComponent(parsed.pathname.replace(/^\/+|\/+$/g, ''));
  if (!roomName) throw new Error('The video room name is missing.');
  const hash = new URLSearchParams(parsed.hash.replace(/^#/, ''));
  return {
    domain: parsed.host,
    origin: parsed.origin,
    roomName,
    displayName: hash.get('userInfo.displayName') || 'Participant',
    jwt: parsed.searchParams.get('jwt') || undefined
  };
};

export default function EmbeddedJitsiMeeting({ meetingUrl, title = 'Video Consultation' }) {
  const parentRef = useRef(null);
  const apiRef = useRef(null);
  const [error, setError] = useState('');
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let meeting;
    setError('');

    try {
      meeting = parseMeeting(meetingUrl);
    } catch (e) {
      setError(String(e?.message || 'Invalid video room link.'));
      return undefined;
    }

    loadExternalApi(meeting.origin)
      .then(() => {
        if (cancelled || !parentRef.current) return;
        apiRef.current = new window.JitsiMeetExternalAPI(meeting.domain, {
          roomName: meeting.roomName,
          parentNode: parentRef.current,
          width: '100%',
          height: '100%',
          ...(meeting.jwt ? { jwt: meeting.jwt } : {}),
          userInfo: { displayName: meeting.displayName },
          configOverwrite: {
            prejoinPageEnabled: false,
            disableInviteFunctions: true,
            startWithAudioMuted: false,
            startWithVideoMuted: false
          },
          interfaceConfigOverwrite: {
            SHOW_JITSI_WATERMARK: false,
            SHOW_WATERMARK_FOR_GUESTS: false,
            DISABLE_JOIN_LEAVE_NOTIFICATIONS: true
          }
        });
      })
      .catch((e) => {
        if (!cancelled) setError(String(e?.message || 'Unable to load Jitsi.'));
      });

    return () => {
      cancelled = true;
      if (apiRef.current) {
        apiRef.current.dispose();
        apiRef.current = null;
      }
    };
  }, [meetingUrl, retryKey]);

  if (error) {
    return (
      <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', padding: 24, background: '#f8fafc' }}>
        <div style={{ maxWidth: 520, textAlign: 'center' }}>
          <div style={{ color: '#b91c1c', fontWeight: 800 }}>Video call could not load inside the website</div>
          <div style={{ marginTop: 8, color: '#475569', lineHeight: 1.5 }}>{error}</div>
          <button type="button" onClick={() => setRetryKey((value) => value + 1)} style={{ marginTop: 16, border: 0, borderRadius: 9, padding: '9px 16px', background: '#0369a1', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>
            Retry Jitsi
          </button>
        </div>
      </div>
    );
  }

  return <div ref={parentRef} title={title} style={{ width: '100%', height: '100%' }} />;
}
