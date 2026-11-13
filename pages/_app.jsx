import { useEffect } from 'react';
import Head from 'next/head';
import '../styles/globals.css';
import { useSettings } from '../src/utils/settings';

export default function App({ Component, pageProps }) {
  const [settings] = useSettings();

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () =>
      document.documentElement.classList.toggle('dark', settings.theme === 'dark' || (settings.theme === 'system' && mq.matches));
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [settings.theme]);

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }, []);

  return (
    <>
      <Head>
        <title>Calendar</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="robots" content="noindex,nofollow" />
        <meta name="theme-color" content="#075E54" />
        <link rel="manifest" href="/manifest.json" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="icon" href="/icon-192.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="Calendar" />
      </Head>
      <Component {...pageProps} />
    </>
  );
}
