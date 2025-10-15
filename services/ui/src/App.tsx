import React, { useEffect, useState, useRef } from 'react';

type Status = { ready: boolean; tag?: string | null };

// -------------------------------
// Configuration
// -------------------------------
const LOCK_KEY = 'igen_lock_expiry';
const LAST_TAG_KEY = 'igen_last_tag';
const LOCK_TIMEOUT_MS = 10_000; // ⏱️ Change to 30_000 for 30s, etc.

export default function App() {
  const [status, setStatus] = useState<Status>({ ready: false });
  const [locked, setLocked] = useState(true);
  const [showPopup, setShowPopup] = useState(false);
  const inactivityTimer = useRef<number | null>(null);

  // -------------------------------
  // Locking Logic
  // -------------------------------
  const lock = () => {
    console.log('🔒 Locking screen');
    setLocked(true);
    setStatus({ ready: false, tag: null });
    localStorage.removeItem(LOCK_KEY);
  };

  const unlock = (tag: string | null) => {
    console.log('🔓 Unlocking screen');
    setLocked(false);
    setStatus({ ready: true, tag });
    const expiry = Date.now() + LOCK_TIMEOUT_MS;
    localStorage.setItem(LOCK_KEY, expiry.toString());
    resetTimer();
  };

  const resetTimer = () => {
    if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
    inactivityTimer.current = window.setTimeout(lock, LOCK_TIMEOUT_MS);
  };

  // -------------------------------
  // Backend Polling
  // -------------------------------
  async function fetchStatus() {
    try {
      const r = await fetch('/api/auth/status');
      const j = await r.json();
      const lastTag = localStorage.getItem(LAST_TAG_KEY);

      // Only trigger popup & unlock if tag changes
      if (j.tag && j.tag !== lastTag) {
        localStorage.setItem(LAST_TAG_KEY, j.tag);
        setShowPopup(true);
        setTimeout(() => setShowPopup(false), 2500);
        unlock(j.tag);
      }

      setStatus(j);
    } catch {
      setStatus({ ready: false });
    }
  }

  // -------------------------------
  // Initialization
  // -------------------------------
  useEffect(() => {
    const expiry = Number(localStorage.getItem(LOCK_KEY));
    if (!expiry || expiry <= Date.now()) {
      lock(); // cold boot lock
    } else {
      unlock(localStorage.getItem(LAST_TAG_KEY));
    }

    fetchStatus();
    const poll = setInterval(fetchStatus, 1500);

    const handleActivity = () => {
      if (!locked) resetTimer();
    };

    window.addEventListener('mousemove', handleActivity);
    window.addEventListener('keydown', handleActivity);
    window.addEventListener('click', handleActivity);

    return () => {
      clearInterval(poll);
      if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
      window.removeEventListener('mousemove', handleActivity);
      window.removeEventListener('keydown', handleActivity);
      window.removeEventListener('click', handleActivity);
    };
  }, [locked]);

  // -------------------------------
  // API Buttons
  // -------------------------------
  const callPing = async () => {
    try {
      const r = await fetch('/api/ping');
      const msg = await r.text();
      alert(`Backend says: ${msg}`);
      resetTimer();
    } catch {
      alert('⚠️ Backend not reachable.');
    }
  };

  const simulateRFID = async () => {
    await fetch('/api/simulate-scan', { method: 'POST' });
    fetchStatus();
  };

  // -------------------------------
  // UI Rendering
  // -------------------------------
  return (
    <main
      style={{
        fontFamily: 'system-ui, sans-serif',
        padding: 24,
        position: 'relative',
        minHeight: '100vh',
        background: '#f9fafb',
      }}
    >
      <h1>IGEN Shop Assistant</h1>

      <p>
        System status: {locked ? '🔒 Locked (awaiting RFID)' : '✅ Ready'}
        {status.tag && <span> — Tag: <code>{status.tag}</code></span>}
      </p>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        <button onClick={callPing}>Ping Backend</button>
        <button onClick={simulateRFID}>Simulate RFID Scan</button>
      </div>

      {!locked && (
        <section style={{ marginTop: 16 }}>
          <h2>Tool Catalogue</h2>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))',
              gap: 12,
            }}
          >
            {['Caliper', 'Soldering Iron', 'Multimeter', 'Hex Set'].map((tool) => (
              <div
                key={tool}
                style={{
                  border: '1px solid #ddd',
                  padding: 16,
                  borderRadius: 8,
                  background: 'white',
                  boxShadow: '0 2px 6px rgba(0,0,0,0.05)',
                }}
              >
                <h3 style={{ marginTop: 0 }}>{tool}</h3>
                <button>Dispense</button>
              </div>
            ))}
          </div>
        </section>
      )}

      {locked && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(0,0,0,0.7)',
            color: 'white',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 22,
            transition: 'opacity 0.3s ease',
          }}
        >
          <strong>🔒 Screen Locked</strong>
          <p style={{ marginTop: 8, fontSize: 18 }}>
            Please scan your RFID tag to continue.
          </p>
        </div>
      )}

      {showPopup && (
        <div
          style={{
            position: 'fixed',
            top: 20,
            right: 20,
            background: '#2563eb',
            color: 'white',
            padding: '12px 20px',
            borderRadius: 8,
            boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
          }}
        >
          <strong>New RFID Tag Detected:</strong> {status.tag}
        </div>
      )}
    </main>
  );
}
