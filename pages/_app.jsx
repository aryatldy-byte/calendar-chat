import Head from 'next/head';
import '../styles/globals.css';

export default function App({ Component, pageProps }) {
  return (
    <>
      <Head>
        <title>Calendar</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="robots" content="noindex,nofollow" />
        <meta name="theme-color" content="#075E54" />
      </Head>
      <Component {...pageProps} />
    </>
  );
}
