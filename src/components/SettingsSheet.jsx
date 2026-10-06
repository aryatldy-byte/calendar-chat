import { useEffect, useState } from 'react';
import { bioAvailable, bioRegister, bioVerify } from '../utils/biometric';
import { holdLock } from '../utils/autoLock';

function Seg({ value, options, onChange, label }) {
  return (
    <div role="group" aria-label={label} className="flex overflow-hidden rounded-lg border border-slate-300 dark:border-slate-600">
      {options.map(([v, text]) => (
        <button key={String(v)} onClick={() => onChange(v)} aria-pressed={value === v}
          className={`flex-1 px-2 py-1.5 text-sm ${value === v ? 'bg-wa-teal text-white' : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-white/10'}`}>
          {text}
        </button>
      ))}
    </div>
  );
}

function Row({ title, hint, children }) {
  return (
    <div className="py-3">
      <div className="text-sm font-medium text-slate-800 dark:text-slate-100">{title}</div>
      {hint && <div className="mb-2 text-xs text-slate-500 dark:text-slate-400">{hint}</div>}
      <div className={hint ? '' : 'mt-2'}>{children}</div>
    </div>
  );
}

export default function SettingsSheet({ settings, update, notif, onToggleNotif, onTest, onSignOut, onClose }) {
  const [bioOk, setBioOk] = useState(false);
  const [msg, setMsg] = useState('');
  useEffect(() => { bioAvailable().then(setBioOk); }, []);

  async function enableBio() {
    setMsg('');
    holdLock(120000);
    try {
      const id = await bioRegister();
      await bioVerify(id); // confirm it works before we rely on it
      update({ bioCred: id });
      setMsg('Face ID / fingerprint is on for this device.');
    } catch (_) {
      setMsg('Could not set it up (cancelled, or not available on this device).');
    }
  }

  const divider = 'divide-y divide-slate-100 dark:divide-white/10';
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div className="max-h-[90dvh] w-full max-w-md animate-pop overflow-y-auto rounded-t-2xl bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-xl dark:bg-[#233138] sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Settings">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Settings</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-full px-2 text-2xl leading-none text-slate-500 hover:bg-slate-100 dark:hover:bg-white/10">×</button>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">These settings apply to this device only.</p>

        <div className={divider}>
          <Row title="Theme">
            <Seg label="Theme" value={settings.theme} onChange={(v) => update({ theme: v })}
              options={[['system', 'Auto'], ['light', 'Light'], ['dark', 'Dark']]} />
          </Row>

          <Row title="Lock when in background" hint="Returns to the calendar after this long away from the app.">
            <Seg label="Lock in background" value={settings.lockBgSec} onChange={(v) => update({ lockBgSec: v })}
              options={[[15, '15 s'], [30, '30 s'], [60, '1 min'], [300, '5 min']]} />
          </Row>
          <Row title="Lock when idle" hint="Locks if you don't touch the screen.">
            <Seg label="Lock when idle" value={settings.lockIdleSec} onChange={(v) => update({ lockIdleSec: v })}
              options={[[60, '1 min'], [120, '2 min'], [300, '5 min'], [0, 'Never']]} />
          </Row>

          <Row title="Face ID / fingerprint"
            hint={settings.bioCred ? 'On: the calendar asks for Face ID / fingerprint instead of the 4-digit code.'
              : bioOk ? 'Use your face or fingerprint to open the chat instead of the 4-digit code.'
              : 'Not available on this device or browser (needs HTTPS and a screen lock).'}>
            {settings.bioCred ? (
              <div className="space-y-2">
                <button onClick={() => update({ bioCred: null })}
                  className="w-full rounded-lg border border-slate-300 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-white/10">
                  Turn off
                </button>
                <label className="flex items-center justify-between gap-3 text-sm text-slate-700 dark:text-slate-200">
                  <span>Also allow the 4-digit code as a backup</span>
                  <input type="checkbox" checked={settings.pinFallback} onChange={(e) => update({ pinFallback: e.target.checked })} className="h-5 w-5 accent-[#128C7E]" />
                </label>
              </div>
            ) : (
              <button onClick={enableBio} disabled={!bioOk}
                className="w-full rounded-lg bg-wa-teal py-2 text-sm font-medium text-white hover:bg-wa-dark disabled:opacity-50">
                Turn on
              </button>
            )}
            {msg && <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">{msg}</p>}
          </Row>

          <Row title="Online status & typing" hint="When off, others can't see when you're online or typing (you still see theirs).">
            <Seg label="Online status" value={settings.shareStatus} onChange={(v) => update({ shareStatus: v })}
              options={[[true, 'Share'], [false, 'Hide']]} />
          </Row>

          <Row title="Notifications">
            <div className="flex gap-2">
              <button onClick={onToggleNotif} disabled={notif === 'checking'}
                className="flex-1 rounded-lg border border-slate-300 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-white/10">
                {notif === 'on' ? 'Turn off' : 'Turn on'}
              </button>
              {notif === 'on' && (
                <button onClick={onTest}
                  className="flex-1 rounded-lg border border-slate-300 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-white/10">
                  Send test
                </button>
              )}
            </div>
          </Row>

          <Row title="Account">
            <button onClick={onSignOut} className="w-full rounded-lg border border-red-300 py-2 text-sm text-red-700 hover:bg-red-50 dark:border-red-500/50 dark:text-red-400 dark:hover:bg-red-500/10">
              Sign out
            </button>
          </Row>
        </div>
      </div>
    </div>
  );
}
