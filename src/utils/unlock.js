export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
export const PIN = process.env.NEXT_PUBLIC_CHAT_PIN || '1234';
// Decoy PIN: opens a harmless "Add event / Set alert" window instead of the chat. Set NEXT_PUBLIC_FAKE_PIN='' to turn it off.
export const FAKE_PIN = process.env.NEXT_PUBLIC_FAKE_PIN ?? '0000';

const KEY = 'cal_unlock';
export const setUnlock = (monthIndex) => sessionStorage.setItem(KEY, String(monthIndex));
export const clearUnlock = () => sessionStorage.removeItem(KEY);
export const readUnlock = () => {
  const v = sessionStorage.getItem(KEY);
  return v === null ? null : Number(v);
};
